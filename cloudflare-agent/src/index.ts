import { runAdminChat, runChat, runDynamicChat, runDynamicChatWithResults, runReasoningWithTools } from "./ai";
import type { ToolCall, ToolResult } from "./ai";
import { createCompany, createTask, createWalletPass, deleteAgent, deleteCompany, deleteKnowledgeDoc, getAgentProfile, getAgentProfileById, getAgentProfileBySlug, getAgentStats, getCompanyDetail, getCompanyMetrics, getGlobalMetrics, getLeadById, getNextPendingTask, getUnattendedLeads, getUserBySmartpassId, getUserByTelegramId, insertKnowledgeDoc, isEmailAlreadySaved, listAgentsWithSkills, listCompaniesWithStats, listKnowledgeDocs, listLeads, listMonitoredEmails, listSkills, listWalletPasses, logAudit, markLeadNotified, saveLead, saveMonitoredEmail, saveChatMessage, getChatHistory, countRecentMessages, updateAgent, updateCompany, updateTaskStatus, updateWalletPassInstalled, updateWalletPassUrl, upsertAgentWithSkills, upsertUser } from "./d1";
import { createPass, emailPass, notifyViaPass } from "./smartpass";
import { proposeAction, approveAction, rejectAction, closeLeadActions } from "./action-engine";
import { runLLM } from "./llm-router";
import { analyzeEmail, fetchRecentEmails } from "./email-monitor";
import { researchLead } from "./lead-research";
import type { ResearchResult } from "./lead-research";
import { searchWeb } from "./web-search";
import { authenticateUser, handleRegister, handleLogin, handleLogout, handleMe } from "./auth";
import { handleGeneratePrompt, handleSetupComplete } from "./setup";
import {
  listWorkPlans, getWorkPlan, createWorkPlan, updateWorkPlan, deleteWorkPlan,
  replaceWorkPlanSteps, getWorkPlanSteps, listWorkPlanRuns, executeWorkPlan, runDueWorkPlans,
} from "./work-plans";
import { handleTelegramConnect, handleTelegramDisconnect, handleTelegramStatus, handleTelegramWebhookMulti } from "./telegram-multi";
import { handleWhatsAppConnect, handleWhatsAppDisconnect, handleWhatsAppStatus, handleWhatsAppWebhook } from "./whatsapp";
import { handleDesktopTasks, createDesktopTask } from "./desktop-tasks";
import { handleMarketplace } from "./agents-marketplace";
import { checkUsageLimit, incrementUsage, shouldWarn80, getUsageSummary, checkAgentsLimit } from "./usage";
import { orchestrate, loadHistory, saveConversationTurn, loadIntegrations } from "./orchestrator";
import { handleGoogleAuthStart, handleGoogleAuthCallback, handleGoogleDisconnect, getValidGoogleToken } from "./google-oauth";
import { appendHistory, clearHistory, getHistory } from "./kv";
import { sendPushNotification } from "./smartpasses";
import { registerWebhook, sendMessage } from "./telegram";
import { saveIntegration } from "./integrations-hub";
import { createCheckout, handlePolarWebhook } from "./billing";
import type { Env, TelegramUpdate } from "./types";

// ── CORS ──────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
  "https://ailyn-dashboard.pages.dev",
  "http://localhost:3000",
  "http://localhost:3002",
]);

function getAllowedOrigin(request: Request): string {
  const origin = request.headers.get("Origin") ?? "";
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  // Allow any *.ailyn-dashboard.pages.dev subdomain (preview deployments)
  if (/^https:\/\/[a-z0-9-]+\.ailyn-dashboard\.pages\.dev$/.test(origin)) return origin;
  return "https://ailyn-dashboard.pages.dev"; // default safe fallback
}

const CORS_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const CORS_HEADERS_ALLOW = "Content-Type, X-CF-Token, Authorization";

// Static CORS headers using safe fallback origin (used by legacy inline Response calls)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://ailyn-dashboard.pages.dev",
  "Access-Control-Allow-Methods": CORS_METHODS,
  "Access-Control-Allow-Headers": CORS_HEADERS_ALLOW,
  "Vary": "Origin",
} as const;

function corsResponse(body: string, status: number, extra?: Record<string, string>, request?: Request): Response {
  const origin = request ? getAllowedOrigin(request) : "https://ailyn-dashboard.pages.dev";
  return new Response(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": CORS_METHODS,
      "Access-Control-Allow-Headers": CORS_HEADERS_ALLOW,
      "Vary": "Origin",
      "Content-Type": "application/json",
      ...extra,
    },
  });
}

// ── API Key auth ──────────────────────────────────────────────────────────

async function authenticateApiKey(request: Request, env: Env): Promise<{ companyId: number; keyId: number; permissions: Record<string, boolean> } | null> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const apiKey = authHeader.startsWith("Bearer ak_") ? authHeader.slice(7) : null;
  if (!apiKey) return null;

  // Hash the key for lookup (store hashed, compare hashed)
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

  const row = await env.DB.prepare(
    `SELECT id, company_id, permissions, rate_limit, is_active FROM api_keys WHERE key_hash = ?`
  ).bind(keyHash).first<{ id: number; company_id: number; permissions: string; rate_limit: number; is_active: number }>();

  if (!row || !row.is_active) return null;

  // Rate limiting via KV
  const rateLimitKey = `api_rate:${row.id}:${Math.floor(Date.now() / 60000)}`; // per minute
  const currentCount = parseInt(await env.KV.get(rateLimitKey) ?? "0", 10);
  if (currentCount >= row.rate_limit) return null; // Rate limited
  await env.KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: 120 });

  // Update last_used_at
  env.DB.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).bind(row.id).run().catch(() => {});

  let permissions: Record<string, boolean>;
  try { permissions = JSON.parse(row.permissions); } catch { permissions = {}; }

  return { companyId: row.company_id, keyId: row.id, permissions };
}

// ── Outgoing webhooks ─────────────────────────────────────────────────────

async function triggerWebhooks(env: Env, companyId: number, event: string, data: Record<string, unknown>): Promise<void> {
  const webhooks = await env.DB.prepare(
    `SELECT id, url, secret, events FROM webhook_endpoints WHERE company_id = ? AND is_active = 1`
  ).bind(companyId).all<{ id: number; url: string; secret: string; events: string }>();

  for (const wh of (webhooks.results ?? [])) {
    try {
      const events = JSON.parse(wh.events) as string[];
      if (!events.includes("all") && !events.includes(event)) continue;

      const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });

      // Sign payload with webhook secret
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", encoder.encode(wh.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
      const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

      await fetch(wh.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ailyn-Signature": signature,
          "X-Ailyn-Event": event,
        },
        body: payload,
      });

      env.DB.prepare(`UPDATE webhook_endpoints SET last_triggered_at = datetime('now') WHERE id = ?`).bind(wh.id).run().catch(() => {});
    } catch (err) {
      console.error(`[webhook] Failed to trigger ${wh.url}:`, String(err));
    }
  }
}

// ── Input sanitization ────────────────────────────────────────────────────

function sanitize(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ── Handlers de comandos ──────────────────────────────────────────────────

async function handleCommand(
  env: Env,
  chatId: number,
  telegramId: string,
  text: string
): Promise<string> {
  const [command, ...args] = text.trim().split(" ");

  switch (command) {
    case "/clear": {
      await clearHistory(env, chatId);
      return "Historial borrado.";
    }

    case "/status": {
      return "✅ Agente activo — Cloudflare Edge, Zero-Trust, V8 Isolates.\nCron: cada 15 min.";
    }

    case "/help": {
      return [
        "<b>Comandos disponibles:</b>",
        "/status — Estado del sistema",
        "/task [título] — Crear tarea",
        "/tasks — Ver tareas (próximamente)",
        "/clear — Borrar historial",
        "/investigar [nombre] [email] [empresa] [mensaje] — Investigar lead",
        "/leads — Últimos 5 leads",
        "/emails — Revisar emails nuevos",
        "/buscar [query] — Investigar cualquier tema",
        "/screenshot [url] — Tomar screenshot (requiere Ailyn Desktop activo)",
        "/help — Esta ayuda",
        "",
        "O escríbeme directamente para conversar.",
      ].join("\n");
    }

    case "/screenshot": {
      const targetUrl = args[0];
      if (!targetUrl || !targetUrl.startsWith("http")) {
        return "Uso: /screenshot https://ejemplo.com\nRequiere que Ailyn Desktop esté corriendo.";
      }
      // Buscar company_id del usuario (Telegram legacy → company_id=1 para ailyn-labs)
      const companyRow = await env.DB.prepare(
        `SELECT id FROM companies WHERE slug = 'ailyn-labs' LIMIT 1`
      ).first<{ id: number }>();
      const companyId = companyRow?.id ?? 1;

      const taskId = await createDesktopTask(env, companyId, "screenshot", { url: targetUrl }, `Screenshot solicitado por Telegram`);
      return `🖥️ Tarea de screenshot creada (#${taskId})\n🔗 URL: ${targetUrl}\n⏳ Ailyn Desktop la procesará en los próximos 30 segundos.`;
    }

    case "/task": {
      if (args.length === 0) return "Uso: /task [título de la tarea]";
      const title = args.join(" ");
      const taskId = await createTask(
        env,
        title,
        `Tarea creada por usuario ${telegramId} vía Telegram`,
        5,
        telegramId
      );
      return `✅ Tarea #${taskId} creada: "${title}"\nSe procesará en el próximo ciclo autónomo (≤15 min).`;
    }

    case "/investigar": {
      // Uso: /investigar nombre [apellido...] email empresa mensaje...
      // Detecta el email por @ para manejar nombres con espacios
      const emailIdx = args.findIndex((a) => a.includes("@"));
      if (emailIdx === -1 || emailIdx === 0) {
        return "Uso: /investigar [nombre] [email] [empresa] [mensaje opcional]\nEjemplo: /investigar Felipe Gómez felipe@eco.com Ecopetrol Necesitan cloud";
      }
      const contactName = args.slice(0, emailIdx).join(" ");
      const contactEmail = args[emailIdx];
      const contactCompany = args[emailIdx + 1] ?? undefined;
      const msgParts = args.slice(emailIdx + 2);

      // Responder inmediatamente para no superar el timeout de Telegram
      await sendMessage(env, chatId, `⏳ Investigando a ${contactName} de ${contactCompany ?? "empresa desconocida"}...\nEsto tarda ~30 segundos.`);

      try {
        console.log("[investigar] START", Date.now());
        const research = await researchLead(
          {
            contact_name: contactName,
            contact_email: contactEmail,
            contact_company: contactCompany ?? undefined,
            contact_message: msgParts.join(" ") || undefined,
            source: "telegram",
          },
          env,
          "ailyn-labs",
          true  // skipWebSearch: evita timeout en waitUntil (RAG + Claude ~5s)
        );
        console.log("[investigar] researchLead done", Date.now());

        const leadId = await saveLead(env, "ailyn-labs", {
          contact_name: contactName,
          contact_email: contactEmail,
          contact_company: contactCompany ?? null,
          contact_message: msgParts.join(" ") || null,
          source: "telegram",
          research_status: "complete",
          company_website: research.company.website,
          company_industry: research.company.industry,
          company_size: research.company.size,
          company_location: research.company.location,
          company_description: research.company.description,
          company_tech_stack: JSON.stringify(research.company.techStack),
          company_recent_news: JSON.stringify(research.company.recentNews),
          contact_role: research.contact.role,
          contact_seniority: research.contact.seniority,
          contact_linkedin_url: research.contact.linkedinUrl,
          contact_linkedin_insights: JSON.stringify(research.contact.linkedinInsights),
          recommended_unit: research.classification.recommendedUnit,
          secondary_units: JSON.stringify(research.classification.secondaryUnits),
          urgency: research.classification.urgency,
          lead_score: research.classification.leadScore,
          brief_summary: research.content.briefSummary,
          brief_full: research.content.briefFull,
          suggested_email_subject: research.content.suggestedEmailSubject,
          suggested_email_body: research.content.suggestedEmailBody,
          talking_points: JSON.stringify(research.content.talkingPoints),
          estimated_value: research.content.estimatedValue,
          next_step: research.content.nextStep,
          follow_up_date: research.content.followUpDate,
        });

        await logAudit(env, "lead_researched_telegram", { leadId, contactName, contactEmail });

        const urgencyEmoji = research.classification.urgency === "high" ? "🔥 CALIENTE" :
          research.classification.urgency === "medium" ? "🟡 TIBIO" : "🔵 FRÍO";

        await sendMessage(env, chatId,
          `🔍 LEAD INVESTIGADO — ${urgencyEmoji}\n\n` +
          `🏢 ${contactCompany ?? "—"} (${research.company.industry ?? "industria desconocida"})\n` +
          `👤 ${contactName} — ${research.contact.role ?? "cargo desconocido"}\n` +
          `📧 ${contactEmail}\n` +
          `📊 Score: ${research.classification.leadScore}/100\n\n` +
          `📝 ${research.content.briefSummary}\n\n` +
          `🎯 Servicio: ${research.classification.recommendedUnit}\n` +
          `💰 Valor: ${research.content.estimatedValue}\n` +
          `⏰ Siguiente paso: ${research.content.nextStep}\n` +
          `🆔 Lead ID: ${leadId}`
        );

        // Smart Pass push si el lead es relevante
        if (research.classification.urgency === "high" || research.classification.leadScore >= 60) {
          const passes = await listWalletPasses(env, 2, 100).catch(() => []);
          if (passes.length > 0) {
            const passValues = {
              ultimoLead: `${contactName} (${contactCompany ?? "—"}) · Score ${research.classification.leadScore}`,
              score: String(research.classification.leadScore),
            };
            await Promise.allSettled(passes.map((p) => notifyViaPass(env, p.serial_number, passValues)));
          }
        }

        // Proponer email de primer contacto (usar email del brief — ya generado en la misma llamada LLM)
        try {
          const emailBody = research.content.suggestedEmailBody || "";
          console.log("[investigar] llamando proposeAction con chatId:", String(chatId));
          const actionId = await proposeAction(env, {
            company_id: "ailyn-labs",
            lead_id: leadId,
            action_type: "send_email",
            action_data: {
              to: contactEmail,
              subject: research.content.suggestedEmailSubject || `${research.classification.recommendedUnit} para ${contactCompany ?? contactName}`,
              body: emailBody,
              from_name: "Ailyn — AI · Link Your Network",
              from_email: "ailyn@novacode.pro"
            },
            telegram_chat_id: String(chatId),
          });
          console.log("[investigar] proposeAction done, actionId:", actionId, "timestamp:", Date.now());
        } catch (emailErr) {
          console.error("[investigar] bloque proposeAction failed completo:", String(emailErr));
        }
      } catch (err) {
        await sendMessage(env, chatId, `❌ Error investigando lead: ${String(err)}`);
      }
      return ""; // Ya se envió respuesta directamente
    }

    case "/leads": {
      const leads = await listLeads(env, { company_id: "ailyn-labs", limit: 5 });
      if (leads.length === 0) return "📋 No hay leads registrados aún.";
      const lines = leads.map((l) => {
        const urgencyEmoji = l.urgency === "high" ? "🔥" : l.urgency === "medium" ? "🟡" : "🔵";
        return `${urgencyEmoji} <b>${l.contact_name}</b> (${l.contact_company ?? "—"}) — Score: ${l.lead_score}/100`;
      });
      return `📋 <b>Últimos ${leads.length} leads:</b>\n\n${lines.join("\n")}`;
    }

    case "/emails": {
      await sendMessage(env, chatId, "📧 Revisando emails...");
      try {
        const emails = await fetchRecentEmails(env, 10);
        if (emails.length === 0) {
          await sendMessage(env, chatId, "📭 No hay emails no leídos o Gmail no está configurado.");
          return "";
        }

        let newCount = 0;
        const summaries: string[] = [];

        for (const email of emails) {
          const alreadySaved = await isEmailAlreadySaved(env, email.id);
          if (alreadySaved) continue;

          const analysis = await analyzeEmail(email, env);
          await saveMonitoredEmail(env, "ailyn-labs", email.id, {
            from_address: email.from,
            from_name: email.fromName,
            to_address: email.to,
            subject: email.subject,
            body_preview: email.bodyPreview,
            received_at: email.receivedAt,
            urgency: analysis.urgency,
            category: analysis.category,
            summary: analysis.summary,
            suggested_reply: analysis.suggestedReply,
            requires_action: analysis.requiresAction,
          });
          newCount++;

          const urgencyEmoji = analysis.urgency === "high" ? "🔴" : analysis.urgency === "medium" ? "🟡" : "⚪";
          summaries.push(`${urgencyEmoji} <b>${email.fromName}</b>: ${email.subject}\n   ${analysis.summary}`);
        }

        if (newCount === 0) {
          await sendMessage(env, chatId, `✅ ${emails.length} emails revisados — todos ya procesados.`);
        } else {
          await sendMessage(env, chatId, `📧 <b>${newCount} emails nuevos:</b>\n\n${summaries.join("\n\n")}`);
        }
      } catch (err) {
        await sendMessage(env, chatId, `❌ Error revisando emails: ${String(err)}`);
      }
      return "";
    }

    case "/buscar": {
      if (args.length === 0) return "Uso: /buscar [query]\nEjemplo: /buscar empresas de manufactura en Bogotá";
      await sendMessage(env, chatId, `🔍 Buscando: "${args.join(" ")}"...`);
      try {
        const results = await searchWeb(args.join(" "), env, { maxResults: 5, searchDepth: "advanced" });
        if (!results.rawText || results.rawText.includes("no disponible")) {
          await sendMessage(env, chatId, "⚠️ Búsqueda web no disponible. Configura TAVILY_API_KEY.");
          return "";
        }
        const summaryResp = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages: [
            { role: "system", content: "Eres un asistente de investigación. Responde en español, conciso y estructurado." },
            { role: "user", content: `Basándote en estos resultados de búsqueda, responde sobre: "${args.join(" ")}"\n\n${results.rawText}` },
          ],
        }) as { response?: string };
        await sendMessage(env, chatId, `🔍 <b>Resultado:</b>\n\n${(summaryResp.response ?? "Sin respuesta").substring(0, 3000)}`);
      } catch (err) {
        await sendMessage(env, chatId, `❌ Error en búsqueda: ${String(err)}`);
      }
      return "";
    }

    case "/pase": {
      // Uso: /pase nombre email [empresa] [rol]
      if (args.length < 2) {
        return "Uso: /pase [nombre] [email] [empresa] [rol]\nEjemplo: /pase 'Juan García' juan@empresa.com 'Empresa SA' Gerente";
      }
      const pNombre = args[0];
      const pEmail = args[1];
      const pEmpresa = args[2] ?? "Ailyn Labs";
      const pRol = args[3] ?? "";
      await sendMessage(env, chatId, `🎫 Creando Smart Pass para ${pNombre}...`);
      try {
        const passInfo = await createPass(env, { nombre: pNombre, empresa: pEmpresa, email: pEmail, rol: pRol });
        await createWalletPass(env, 2, {
          serial_number: passInfo.serialNumber,
          pass_type_id: passInfo.passTypeIdentifier,
          owner_name: pNombre,
          owner_email: pEmail,
          role: pRol || null,
          install_url: passInfo.url ?? null,
        });
        const urlLine = passInfo.url ? `\n🔗 URL: ${passInfo.url}` : "";
        await sendMessage(env, chatId, `✅ Smart Pass creado!\n👤 ${pNombre} (${pEmpresa})\nID: ${passInfo.serialNumber}${urlLine}`);
      } catch (err) {
        await sendMessage(env, chatId, `❌ Error creando pase: ${String(err)}`);
      }
      return "";
    }

    case "/notificar": {
      // Uso: /notificar mensaje
      if (args.length === 0) return "Uso: /notificar [mensaje]\nEjemplo: /notificar Nuevo lead: Juan García - Score 85";
      const mensaje = args.join(" ");
      await sendMessage(env, chatId, `📲 Enviando push a todos los pases...`);
      try {
        const passes = await listWalletPasses(env, 2, 100);
        if (passes.length === 0) {
          await sendMessage(env, chatId, "No hay pases registrados.");
          return "";
        }
        const results = await Promise.allSettled(
          passes.map((p) => notifyViaPass(env, p.serial_number, { ultimoLead: mensaje }))
        );
        const ok = results.filter((r) => r.status === "fulfilled").length;
        await sendMessage(env, chatId, `✅ Push enviado a ${ok}/${passes.length} pases`);
      } catch (err) {
        await sendMessage(env, chatId, `❌ Error enviando notificaciones: ${String(err)}`);
      }
      return "";
    }

    case "/pases": {
      try {
        const passes = await listWalletPasses(env, 2, 10);
        if (passes.length === 0) {
          return "No hay Smart Passes registrados.";
        }
        const lines = passes.map((p) =>
          `🎫 ${p.owner_name} | ${p.role ?? "—"} | ${p.installed ? "✅ Instalado" : "⏳ Pendiente"}`
        );
        return `<b>Smart Passes (${passes.length}):</b>\n\n${lines.join("\n")}`;
      } catch (err) {
        return `❌ Error: ${String(err)}`;
      }
    }

    default:
      return "";
  }
}

// ── Helpers de formato para notificaciones ────────────────────────────────

function formatEmailAlert(email: { fromName: string; from: string; subject: string; receivedAt: string }, analysis: { urgency: string; summary: string; suggestedReply: string }): string {
  const urgencyEmoji = analysis.urgency === "high" ? "🔴 URGENTE" : "🟡 IMPORTANTE";
  return `📧 EMAIL ${urgencyEmoji}\n\nDe: ${email.fromName} &lt;${email.from}&gt;\nAsunto: ${email.subject}\n📅 ${new Date(email.receivedAt).toLocaleString("es-CO")}\n\n📝 ${analysis.summary}\n\n💬 Respuesta sugerida:\n${analysis.suggestedReply}`;
}

// ── Handler del webhook de Telegram ──────────────────────────────────────

async function handleTelegramWebhook(
  env: Env,
  request: Request,
  secretToken: string
): Promise<Response> {
  // Validar token secreto en el path
  if (secretToken !== env.TELEGRAM_SECRET_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json<TelegramUpdate>();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const message = update.message;
  if (!message?.text || !message.from) {
    return new Response("OK", { status: 200 });
  }

  const chatId = message.chat.id;
  const telegramId = String(message.from.id);
  const text = message.text.trim();

  // Upsert usuario y verificar acceso
  await upsertUser(env, telegramId, message.from.username);
  const user = await getUserByTelegramId(env, telegramId);

  if (!user || user.is_active === 0) {
    await sendMessage(env, chatId, "No tienes acceso a este agente.");
    return new Response("OK", { status: 200 });
  }

  await logAudit(env, "message_received", { telegramId, text });

  // Detectar y ejecutar comandos
  if (text.startsWith("/")) {
    const reply = await handleCommand(env, chatId, telegramId, text);
    if (reply) {
      await sendMessage(env, chatId, reply);
      return new Response("OK", { status: 200 });
    }
  }

  // Modo conversación con historial KV
  const history = await getHistory(env, chatId);
  const aiReply = await runChat(env, history, text);

  await appendHistory(env, chatId, { role: "user", content: text });
  await appendHistory(env, chatId, { role: "assistant", content: aiReply });
  await sendMessage(env, chatId, aiReply);

  return new Response("OK", { status: 200 });
}

// ── Webchat público (sin autenticación) ──────────────────────────────────


async function handlePublicChat(env: Env, request: Request, slug: string): Promise<Response> {
  // Buscar agente activo por slug de empresa
  const agentProfile = await getAgentProfileBySlug(env, slug);
  if (!agentProfile) {
    return corsResponse(JSON.stringify({ error: "Empresa no encontrada o sin agente activo" }), 404);
  }

  let body: { message?: string; session_id?: string };
  try { body = await request.json(); } catch {
    return corsResponse(JSON.stringify({ error: "Invalid JSON" }), 400);
  }

  const userMessage = sanitize(body.message?.trim() ?? "");
  if (!userMessage) {
    return corsResponse(JSON.stringify({ error: "message is required" }), 400);
  }

  // Session
  const sessionId = body.session_id?.trim() || crypto.randomUUID();

  // ── Límite de plan ──────────────────────────────────────────────────────
  const chatLimit = await checkUsageLimit(env, agentProfile.company_id, "chat");
  if (!chatLimit.allowed) {
    return corsResponse(JSON.stringify({
      reply: "Este agente ha alcanzado su límite mensual de mensajes. Contacta a la empresa para más información.",
      session_id: sessionId,
      limit_reached: true,
    }), 200);
  }

  // Rate limit: máx 30 mensajes de usuario por sesión en la última hora
  const recentCount = await countRecentMessages(env, sessionId, 60);
  if (recentCount >= 30) {
    return corsResponse(JSON.stringify({ error: "Límite de mensajes alcanzado. Intenta de nuevo más tarde." }), 429);
  }

  // ── Orquestador Central ────────────────────────────────────────────────
  const history = await loadHistory(env, sessionId, 10, agentProfile.company_id);
  const integrations = await loadIntegrations(env, agentProfile.company_id);
  const googleToken = integrations.googleToken
    ? await getValidGoogleToken(env, agentProfile.company_id)
    : null;

  const companyRow = await env.DB.prepare(
    `SELECT name, industry FROM companies WHERE id = ?`
  ).bind(agentProfile.company_id).first<{ name: string; industry: string | null }>();

  const result = await orchestrate({
    message: userMessage,
    companyId: agentProfile.company_id,
    companyName: companyRow?.name ?? "tu empresa",
    industry: companyRow?.industry ?? undefined,
    sessionId,
    channel: "webchat",
    history,
    googleToken,
    githubToken: integrations.githubToken,
    connectedProviders: integrations.connectedProviders,
  }, env);

  const reply = result.text || "Lo siento, no pude procesar tu mensaje. Por favor intenta de nuevo.";

  // Guardar pending_actions para drafts (email, calendar, followup)
  let pendingActionId: number | null = null;
  if (result.emailDraft) {
    const actionData = JSON.stringify({ to: result.emailDraft.to, subject: result.emailDraft.subject, body: result.emailDraft.body, from_name: companyRow?.name ?? "Ailyn" });
    const ins = await env.DB.prepare(
      `INSERT INTO pending_actions (company_id, action_type, action_data, status) VALUES (?, 'send_email', ?, 'pending')`
    ).bind(String(agentProfile.company_id), actionData).run();
    pendingActionId = ins.meta.last_row_id as number;
  } else if (result.calendarDraft) {
    const actionData = JSON.stringify({ ...result.calendarDraft, companyId: agentProfile.company_id });
    const ins = await env.DB.prepare(
      `INSERT INTO pending_actions (company_id, action_type, action_data, status) VALUES (?, 'schedule_meeting', ?, 'pending')`
    ).bind(String(agentProfile.company_id), actionData).run();
    pendingActionId = ins.meta.last_row_id as number;
  } else if (result.followupDraft) {
    const scheduledDate = new Date(); scheduledDate.setDate(scheduledDate.getDate() + result.followupDraft.days);
    const actionData = JSON.stringify({ to: result.followupDraft.to, subject: result.followupDraft.subject, context: result.followupDraft.context, days: result.followupDraft.days, companyId: agentProfile.company_id, companyName: companyRow?.name ?? "Ailyn" });
    const ins = await env.DB.prepare(
      `INSERT INTO pending_actions (company_id, action_type, action_data, status, followup_number, followup_scheduled_at) VALUES (?, 'send_followup', ?, 'pending', 1, ?)`
    ).bind(String(agentProfile.company_id), actionData, scheduledDate.toISOString().split("T")[0]).run();
    pendingActionId = ins.meta.last_row_id as number;
  }

  // Guardar en ambos sistemas (conversation_history + legacy chat_messages)
  const routing = { model: result.model_used, complexity: result.complexity as "simple" | "medium" | "complex", tools_needed: result.tools_used as never[], estimated_cost: result.estimated_cost, provider: "cloudflare" as const };
  await saveConversationTurn(env, { message: userMessage, companyId: agentProfile.company_id, companyName: companyRow?.name ?? "", sessionId, channel: "webchat" }, userMessage, reply, routing);
  await saveChatMessage(env, sessionId, agentProfile.company_id, agentProfile.agent_id, "user", userMessage);
  await saveChatMessage(env, sessionId, agentProfile.company_id, agentProfile.agent_id, "assistant", reply);

  // Incrementar uso y revisar umbral 80%
  await incrementUsage(env, agentProfile.company_id, "chat");
  const warn80 = await shouldWarn80(env, agentProfile.company_id, "chat");
  if (warn80) {
    const updatedCheck = await checkUsageLimit(env, agentProfile.company_id, "chat");
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      await sendMessage(env, Number(env.TELEGRAM_CHAT_ID),
        `⚠️ Has usado ${updatedCheck.used} de ${updatedCheck.limit} mensajes de tu plan ${updatedCheck.planName} este mes. Actualiza para no quedarte sin servicio.`
      );
    }
  }

  return corsResponse(JSON.stringify({
    reply,
    session_id: sessionId,
    model_used: result.model_used,
    complexity: result.complexity,
    emailDraft: result.emailDraft ?? null,
    calendarDraft: result.calendarDraft ?? null,
    followupDraft: result.followupDraft ?? null,
    actionId: pendingActionId,
  }), 200);
}

async function handlePublicChatHistory(env: Env, request: Request, slug: string): Promise<Response> {
  // Verificar que la empresa existe
  const company = await env.DB.prepare(
    `SELECT id FROM companies WHERE slug = ?`
  ).bind(slug).first<{ id: number }>();
  if (!company) {
    return corsResponse(JSON.stringify({ error: "Empresa no encontrada" }), 404);
  }

  const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
  if (!sessionId) {
    return corsResponse(JSON.stringify({ messages: [] }), 200);
  }

  const messages = await getChatHistory(env, sessionId, 50);
  return corsResponse(JSON.stringify({ messages }), 200);
}

// ── Helper: hash numérico determinista del smartpassId ────────────────────
// Produce el mismo número dado el mismo smartpassId — usado como chatId en KV.

function smartpassSessionKey(smartpassId: string): number {
  return Math.abs(
    [...smartpassId].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0)
  );
}

// ── Handler del webchat autenticado por wallet ───────────────────────────

interface WalletChatRequest {
  message: string;
}

async function handleWalletChat(env: Env, request: Request): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const smartpassId = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!smartpassId) {
    return corsResponse(JSON.stringify({ error: "Missing Authorization header" }), 401);
  }

  const user = await getUserBySmartpassId(env, smartpassId);
  if (!user) {
    return corsResponse(JSON.stringify({ error: "Invalid or inactive pass token" }), 403);
  }

  let body: WalletChatRequest;
  try {
    body = await request.json<WalletChatRequest>();
  } catch {
    return corsResponse(JSON.stringify({ error: "Invalid JSON body" }), 400);
  }

  if (!body.message?.trim()) {
    return corsResponse(JSON.stringify({ error: "message is required" }), 400);
  }

  // Recuperar historial usando hash determinista del smartpassId
  const sessionKey = smartpassSessionKey(smartpassId);
  const history = await getHistory(env, sessionKey);

  const userText = body.message.trim();

  // ── Cargar perfil del agente desde D1 (multi-tenant) ─────────────────
  const agentProfile = await getAgentProfile(env, "NovaCode", "Asistente Ejecutivo");
  let systemPrompt = agentProfile?.role_prompt ?? "Eres un asistente ejecutivo corporativo.";
  const modelId = agentProfile?.model_id ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const tools = (agentProfile?.skills ?? [])
    .map((s) => s.schema)
    .filter(Boolean);

  // ── RAG: buscar contexto relevante en la base de conocimiento ─────────
  try {
    const queryEmbedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [userText],
    }) as { data: number[][] };

    const searchResults = await env.KNOWLEDGE_BASE.query(queryEmbedding.data[0], {
      topK: 3,
      filter: { company_id: agentProfile?.company_id ?? 1 },
      returnMetadata: "all",
    });

    const relevantDocs = (searchResults.matches ?? []).filter((m) => m.score >= 0.75);
    if (relevantDocs.length > 0) {
      const context = relevantDocs
        .map((m) => `[${(m.metadata as { title?: string })?.title ?? "Documento"}]\n(relevancia: ${(m.score * 100).toFixed(0)}%)`)
        .join("\n\n");
      systemPrompt = `${systemPrompt}\n\n## Contexto de la Empresa (Base de Conocimiento)\n${context}`;
    }
  } catch {
    // Si Vectorize falla no bloqueamos el chat
  }

  // Llamar al agente con perfil dinámico + contexto RAG
  const { text, toolCalls } = await runDynamicChat(
    env, history, userText, systemPrompt, modelId, tools
  );

  // Guardar mensaje del usuario en KV
  await appendHistory(env, sessionKey, { role: "user", content: userText });

  // ── Ejecutar tool calls si los hay ───────────────────────────────────
  const emailCall = toolCalls.find((tc) => tc.name === "send_email");
  const notifCall = toolCalls.find((tc) => tc.name === "send_smartpasses_notification");

  let reply: string;

  if (emailCall) {
    const { to_email, subject, body: emailBody } = emailCall.arguments as {
      to_email?: string; subject?: string; body?: string;
    };
    await logAudit(env, "email_sent", {
      to: to_email ?? "", subject: subject ?? "", body: emailBody ?? "",
      triggeredBy: smartpassId.slice(0, 8),
    });
    reply = `✅ Correo enviado exitosamente a ${to_email ?? "destinatario"}.`;
  } else if (notifCall) {
    const passId = String(notifCall.arguments.pass_id ?? "");
    const message = String(notifCall.arguments.message ?? "Notificación del agente.");
    if (passId) {
      await sendPushNotification(env, passId, "Ailyn", message.slice(0, 120));
      await logAudit(env, "wallet_tool_notification_sent", { passId, message });
    }
    reply = `✅ Notificación enviada.`;
  } else {
    reply = text || "Sin respuesta del modelo.";
  }

  // Guardar respuesta del asistente en KV
  await appendHistory(env, sessionKey, { role: "assistant", content: reply });

  await logAudit(env, "wallet_chat", { smartpassId: smartpassId.slice(0, 8), userId: user.id });

  return corsResponse(JSON.stringify({ reply }), 200);
}

// ── Server-side tool execution (Worker ejecuta sin pasar a Next.js) ──────

const SERVER_SIDE_TOOLS = new Set(["send_telegram_message", "send_smartpasses_notification"]);

interface ServerSideResult {
  clientToolCalls: ToolCall[];      // tools que deben ir a Next.js (fs_*, etc.)
  serverResults: string;            // respuesta final si solo había server tools
  updatedMessages: unknown[];       // mensajes actualizados tras ejecutar server tools
}

async function executeServerSideTools(
  env: Env,
  toolCalls: ToolCall[],
  messagesBeforeTools: unknown[],
  modelId: string,
  tools: unknown[]
): Promise<ServerSideResult> {
  const serverCalls = toolCalls.filter((tc) => SERVER_SIDE_TOOLS.has(tc.name));
  const clientToolCalls = toolCalls.filter((tc) => !SERVER_SIDE_TOOLS.has(tc.name));

  if (serverCalls.length === 0) {
    return { clientToolCalls, serverResults: "", updatedMessages: messagesBeforeTools };
  }

  // Ejecutar cada tool server-side
  const serverToolResults: ToolResult[] = [];
  for (const tc of serverCalls) {
    let content: string;

    if (tc.name === "send_telegram_message") {
      const message = String(tc.arguments.message ?? "Sin mensaje.");
      try {
        const tgRes = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message }),
          }
        );
        content = tgRes.ok
          ? "Notificación de Telegram enviada con éxito."
          : `Error Telegram ${tgRes.status}: ${await tgRes.text()}`;
      } catch (err) {
        content = `Error enviando Telegram: ${String(err)}`;
      }
    } else if (tc.name === "send_smartpasses_notification") {
      const passId = String(tc.arguments.pass_id ?? "");
      const msg = String(tc.arguments.message ?? "");
      if (passId) {
        await sendPushNotification(env, passId, "Ailyn", msg.slice(0, 120));
      }
      content = "Notificación Smart Passes enviada.";
    } else {
      content = `Tool ${tc.name} no implementada server-side.`;
    }

    serverToolResults.push({ id: tc.id, content });
  }

  // Obtener respuesta del modelo con los resultados de los server tools
  const { result, updatedMessages } = await runDynamicChatWithResults(
    env,
    messagesBeforeTools,
    modelId,
    tools,
    serverCalls,
    serverToolResults
  );

  // Si el modelo también quiere client tools, los mezclamos con los pendientes
  const mergedClientCalls = [...clientToolCalls, ...result.toolCalls];

  return {
    clientToolCalls: mergedClientCalls,
    serverResults: result.text,
    updatedMessages,
  };
}

// ── Webhook v2: /api/webhook/telegram con header auth + Agente Master Dev ─

async function handleTelegramWebhookV2(
  env: Env,
  request: Request,
  ctx: ExecutionContext,
): Promise<Response> {
  // Validar token via header (enviado por Telegram cuando se usa secret_token en setWebhook)
  const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  console.log("[webhook] secret header present:", secretHeader.length > 0, "| matches:", secretHeader === env.TELEGRAM_SECRET_TOKEN);
  if (secretHeader !== env.TELEGRAM_SECRET_TOKEN) {
    console.log("[webhook] UNAUTHORIZED — secret mismatch");
    return new Response("Unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json<TelegramUpdate>();
  } catch {
    console.log("[webhook] BAD REQUEST — JSON parse failed");
    return new Response("Bad Request", { status: 400 });
  }

  console.log("[webhook] update keys:", Object.keys(update));

  // ── Callback queries (botones inline) ────────────────────────────────
  if (update.callback_query) {
    const cq = update.callback_query;
    const callbackData = cq.data ?? "";
    const cbChatId = cq.message?.chat?.id;
    const cbMessageId = cq.message?.message_id;
    const cbUserId = String(cq.from.id);

    console.log("[callback] received:", callbackData);
    console.log("[callback] from chat:", cbChatId, "| authorized chat:", env.TELEGRAM_CHAT_ID);
    console.log("[callback] message_id:", cbMessageId, "| user:", cbUserId);

    // Responder al callback inmediatamente para quitar el loading del botón
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cq.id }),
    });

    // Verificar que viene del chat autorizado
    if (cbChatId && String(cbChatId) !== String(env.TELEGRAM_CHAT_ID)) {
      console.log("[callback] REJECTED — unauthorized chat:", cbChatId);
      return new Response("OK", { status: 200 });
    }

    const editMessage = async (text: string) => {
      if (!cbChatId || !cbMessageId) {
        console.log("[callback] editMessage SKIPPED — no cbChatId or cbMessageId:", cbChatId, cbMessageId);
        return;
      }
      const editResp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cbChatId,
          message_id: cbMessageId,
          text,
          parse_mode: "Markdown",
        }),
      });
      console.log("[callback] editMessage status:", editResp.status, "| body:", await editResp.text());
    };

    if (callbackData.startsWith("action_approve_")) {
      const actionId = parseInt(callbackData.replace("action_approve_", ""), 10);
      console.log("[callback] approving actionId:", actionId);
      const action = await env.DB.prepare(
        'SELECT id FROM pending_actions WHERE id = ? AND status = "pending"'
      ).bind(actionId).first();
      console.log("[callback] action found:", action ? "EXISTS (pending)" : "NOT FOUND or not pending");
      if (!action) {
        return new Response("OK", { status: 200 }); // Ya procesada o no existe — ignorar
      }
      console.log("[callback] RESEND_API_KEY present:", !!env.RESEND_API_KEY);
      console.log("[callback] calling approveAction for id:", actionId);
      await logAudit(env, "action_approved", { actionId, telegramId: cbUserId });
      const result = await approveAction(env, actionId);
      console.log("[callback] approve result:", JSON.stringify(result));
      if (result.success) {
        if (result.error?.includes("No RESEND_API_KEY")) {
          await editMessage("✅ *Email aprobado y listo para envío manual.*\n\nNo hay RESEND_API_KEY configurado — copia el contenido y envíalo desde tu cliente de email.\n\nAilyn programó follow-up automático en 48h.");
        } else {
          await editMessage("✅ *Email enviado exitosamente.*\n\nAilyn programó un follow-up automático en 48 horas si no hay respuesta.");
        }
      } else {
        const safeError = (result.error ?? "Error desconocido").replace(/[*_`[\]]/g, "");
        await editMessage(`❌ Error al enviar: ${safeError}\n\nEl email no se envió. Puedes intentar enviarlo manualmente.`);
      }
    } else if (callbackData.startsWith("action_reject_")) {
      const actionId = parseInt(callbackData.replace("action_reject_", ""), 10);
      console.log("[callback] rejecting actionId:", actionId);
      const action = await env.DB.prepare(
        'SELECT id FROM pending_actions WHERE id = ? AND status = "pending"'
      ).bind(actionId).first();
      console.log("[callback] action found:", action ? "EXISTS (pending)" : "NOT FOUND or not pending");
      if (!action) {
        return new Response("OK", { status: 200 }); // Ya procesada o no existe — ignorar
      }
      await rejectAction(env, actionId);
      await logAudit(env, "action_rejected", { actionId, telegramId: cbUserId });
      await editMessage("🗑️ *Acción descartada.* El email no se enviará.");
    } else if (callbackData.startsWith("action_close_")) {
      const actionId = parseInt(callbackData.replace("action_close_", ""), 10);
      await closeLeadActions(env, actionId);
      await logAudit(env, "lead_closed", { actionId, telegramId: cbUserId });
      await editMessage("🔒 *Lead cerrado.* No se enviarán más follow-ups.");
    }

    return new Response("OK", { status: 200 });
  }

  const message = update.message;
  if (!message?.text || !message.from) {
    return new Response("OK", { status: 200 });
  }

  // Deduplicación por message_id — evita procesar reintentos de Telegram
  const messageId = message.message_id;
  const dedupKey = `tg_dedup:${messageId}`;
  const alreadyProcessed = await env.KV.get(dedupKey);
  if (alreadyProcessed) {
    return new Response("OK", { status: 200 });
  }
  await env.KV.put(dedupKey, "1", { expirationTtl: 60 });

  const chatId = message.chat.id;
  const text = message.text.trim();

  // Solo aceptar mensajes del chat_id autorizado
  if (String(chatId) !== String(env.TELEGRAM_CHAT_ID)) {
    await sendMessage(env, chatId, "No tienes acceso a este agente.");
    return new Response("OK", { status: 200 });
  }

  const telegramId = String(message.from.id);
  await logAudit(env, "telegram_v2_message", { telegramId, text: text.slice(0, 100) });

  // Comandos especiales
  if (text.startsWith("/")) {
    // Comandos lentos (>5s): lanzar en background para no superar timeout de Telegram
    const SLOW_COMMANDS = ["/investigar", "/buscar", "/emails", "/pase", "/notificar", "/screenshot"];
    const isSlowCommand = SLOW_COMMANDS.some((cmd) => text === cmd || text.startsWith(cmd + " "));

    if (isSlowCommand) {
      ctx.waitUntil(
        handleCommand(env, chatId, telegramId, text).catch(async (err) => {
          await sendMessage(env, chatId, `❌ Error: ${String(err)}`);
        })
      );
      return new Response("OK", { status: 200 });
    }

    const reply = await handleCommand(env, chatId, telegramId, text);
    if (reply) {
      await sendMessage(env, chatId, reply);
    }
    return new Response("OK", { status: 200 });
  }

  // Chat regular — lanzar en background para responder 200 a Telegram en <1s
  ctx.waitUntil((async () => {
    try {
      const history = await getHistory(env, chatId);
      const reply = await runChat(env, history, text, "ailyn-labs");
      await appendHistory(env, chatId, { role: "user", content: text });
      await appendHistory(env, chatId, { role: "assistant", content: reply });
      await sendMessage(env, chatId, reply);
    } catch (err) {
      await sendMessage(env, chatId, `❌ Error: ${String(err)}`);
    }
  })());

  return new Response("OK", { status: 200 });
}

// ── Fetch handler (modo reactivo) ─────────────────────────────────────────

async function handleFetch(env: Env, request: Request, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // POST /webhook/telegram/:slug-or-secret
  // Si tiene X-Telegram-Bot-Api-Secret-Token header → bot multi-tenant (nueva lógica)
  // Si no → bot legacy con secretToken en el path
  if (request.method === "POST" && pathname.startsWith("/webhook/telegram/")) {
    const segment = pathname.split("/")[3] ?? "";
    if (request.headers.has("X-Telegram-Bot-Api-Secret-Token")) {
      return handleTelegramWebhookMulti(request, env, segment);
    }
    return handleTelegramWebhook(env, request, segment);
  }

  // POST /api/webhook/telegram — Webhook v2 con header auth + Agente Master Dev
  if (request.method === "POST" && pathname === "/api/webhook/telegram") {
    return handleTelegramWebhookV2(env, request, ctx);
  }

  // WhatsApp webhook (GET for verification, POST for messages)
  if (pathname.startsWith("/webhook/whatsapp/")) {
    const slug = pathname.split("/")[3] ?? "";
    return handleWhatsAppWebhook(request, env, slug);
  }

  // GET /setup — registra el webhook (solo usar una vez)
  if (request.method === "GET" && pathname === "/setup") {
    const workerUrl = `${url.protocol}//${url.host}`;
    return registerWebhook(env, workerUrl);
  }

  // GET /api/admin/stats — métricas del agente (protegido por API token)
  if (request.method === "GET" && pathname === "/api/admin/stats") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const stats = await getAgentStats(env);
    return new Response(JSON.stringify(stats), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // GET /api/admin/superadmin — all-in-one superadmin data
  if (request.method === "GET" && pathname === "/api/admin/superadmin") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);

    try {
      const [companies, globalStats, recentActions, systemStatus, activeFollowups] = await Promise.all([
        env.DB.prepare(`
          SELECT c.id, c.name, c.slug, c.plan_slug, c.industry, c.created_at,
            (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) as user_count,
            (SELECT COUNT(*) FROM conversation_history ch WHERE ch.company_id = c.id) as message_count,
            (SELECT COUNT(*) FROM pending_actions pa WHERE pa.company_id = CAST(c.id AS TEXT) AND pa.action_type = 'send_email' AND pa.status = 'executed') as emails_sent,
            (SELECT COUNT(*) FROM pending_actions pa WHERE pa.company_id = CAST(c.id AS TEXT) AND pa.action_type = 'schedule_meeting' AND pa.status = 'executed') as meetings_count,
            (SELECT tc.bot_username FROM telegram_configs tc WHERE tc.company_id = c.id AND tc.is_active = 1) as telegram_bot,
            (SELECT CASE WHEN wc.id IS NOT NULL THEN 1 ELSE 0 END FROM whatsapp_configs wc WHERE wc.company_id = c.id AND wc.is_active = 1) as has_whatsapp,
            (SELECT CASE WHEN i.id IS NOT NULL THEN 1 ELSE 0 END FROM integrations i WHERE i.company_id = c.id AND i.provider = 'google' AND i.is_active = 1) as has_google
          FROM companies c ORDER BY c.created_at DESC
        `).all(),

        env.DB.prepare(`
          SELECT
            (SELECT COUNT(*) FROM companies) as total_companies,
            (SELECT COUNT(*) FROM users) as total_users,
            (SELECT COUNT(*) FROM conversation_history) as total_messages,
            (SELECT COUNT(*) FROM conversation_history WHERE created_at >= datetime('now', '-24 hours')) as messages_24h,
            (SELECT COUNT(*) FROM conversation_history WHERE created_at >= datetime('now', '-7 days')) as messages_7d,
            (SELECT COUNT(*) FROM pending_actions WHERE action_type = 'send_email' AND status = 'executed') as total_emails,
            (SELECT COUNT(*) FROM pending_actions WHERE action_type = 'schedule_meeting' AND status = 'executed') as total_meetings,
            (SELECT COUNT(*) FROM pending_actions WHERE action_type = 'send_followup' AND status IN ('scheduled','executed')) as total_followups,
            (SELECT COUNT(*) FROM leads) as total_leads
        `).first(),

        env.DB.prepare(`
          SELECT pa.id, pa.company_id, pa.action_type, pa.action_data, pa.status, pa.created_at, pa.executed_at,
                 c.name as company_name
          FROM pending_actions pa
          LEFT JOIN companies c ON CAST(c.id AS TEXT) = pa.company_id
          ORDER BY pa.created_at DESC LIMIT 20
        `).all(),

        env.KV.get("SYSTEM_STATUS"),

        env.DB.prepare(`
          SELECT pa.id, pa.company_id, pa.action_data, pa.status, pa.followup_scheduled_at, pa.followup_number,
                 c.name as company_name
          FROM pending_actions pa
          LEFT JOIN companies c ON CAST(c.id AS TEXT) = pa.company_id
          WHERE pa.action_type = 'send_followup' AND pa.status IN ('pending', 'scheduled')
          ORDER BY pa.followup_scheduled_at ASC
        `).all(),
      ]);

      const recentParsed = (recentActions.results ?? []).map((a: Record<string, unknown>) => {
        let parsed = {};
        try { parsed = JSON.parse((a.action_data as string) ?? "{}"); } catch { /* ignore */ }
        return { ...a, action_data: parsed };
      });

      const followupsParsed = (activeFollowups.results ?? []).map((a: Record<string, unknown>) => {
        let parsed = {};
        try { parsed = JSON.parse((a.action_data as string) ?? "{}"); } catch { /* ignore */ }
        return { ...a, action_data: parsed };
      });

      return corsResponse(JSON.stringify({
        companies: companies.results ?? [],
        stats: globalStats ?? {},
        recentActions: recentParsed,
        systemStatus: systemStatus ?? "active",
        activeFollowups: followupsParsed,
      }), 200);
    } catch (err) {
      return corsResponse(JSON.stringify({ error: String(err) }), 500);
    }
  }

  // POST /api/admin/company/:id/plan — change company plan
  if (request.method === "POST" && pathname.match(/^\/api\/admin\/company\/(\d+)\/plan$/)) {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const companyId = parseInt(pathname.split("/")[4], 10);
    const body = await request.json() as { plan_slug: string };
    await env.DB.prepare(`UPDATE companies SET plan_slug = ? WHERE id = ?`).bind(body.plan_slug, companyId).run();
    return corsResponse(JSON.stringify({ ok: true }), 200);
  }

  // POST /api/admin/company/:id/impersonate — crear sesión temporal como usuario de esa empresa
  const impersonateMatch = pathname.match(/^\/api\/admin\/company\/(\d+)\/impersonate$/);
  if (request.method === "POST" && impersonateMatch) {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const companyId = parseInt(impersonateMatch[1], 10);

    // Buscar el primer usuario (owner) de esa empresa
    const user = await env.DB.prepare(
      `SELECT u.id, u.name, u.email, u.company_id, c.name as company_name, c.slug as company_slug, c.setup_completed
       FROM users u JOIN companies c ON u.company_id = c.id
       WHERE u.company_id = ? ORDER BY u.id ASC LIMIT 1`
    ).bind(companyId).first<{ id: number; name: string; email: string; company_id: number; company_name: string; company_slug: string; setup_completed: number }>();

    if (!user) return corsResponse(JSON.stringify({ error: "No hay usuarios en esta empresa" }), 404);

    // Crear sesión temporal (expira en 2 horas)
    const sessionId = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`
    ).bind(sessionId, user.id, expiresAt).run();

    return corsResponse(JSON.stringify({
      token: sessionId,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company_id: user.company_id,
        company_name: user.company_name,
        company_slug: user.company_slug,
        setup_completed: user.setup_completed,
        impersonated: true,
      },
    }));
  }

  // GET /api/admin/plan-features — get features for all plans
  if (request.method === "GET" && pathname === "/api/admin/plan-features") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const plans = await env.DB.prepare(`SELECT slug, name, features FROM plans`).all();
    return corsResponse(JSON.stringify({ plans: plans.results ?? [] }));
  }

  // POST /api/admin/plan-features — update features for a plan
  if (request.method === "POST" && pathname === "/api/admin/plan-features") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const body = await request.json() as { slug: string; features: Record<string, boolean> };
    if (!body.slug || !body.features) return corsResponse(JSON.stringify({ error: "slug and features required" }), 400);
    await env.DB.prepare(`UPDATE plans SET features = ? WHERE slug = ?`).bind(JSON.stringify(body.features), body.slug).run();
    return corsResponse(JSON.stringify({ ok: true }));
  }

  // POST /api/admin/system/toggle — toggle system pause/active
  if (request.method === "POST" && pathname === "/api/admin/system/toggle") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const current = await env.KV.get("SYSTEM_STATUS") ?? "active";
    const newStatus = current === "active" ? "paused" : "active";
    await env.KV.put("SYSTEM_STATUS", newStatus);
    return corsResponse(JSON.stringify({ status: newStatus }), 200);
  }

  // ── GitHub Integration ──────────────────────────────────────────────────
  // POST /api/settings/github/connect — guarda PAT de GitHub
  if (request.method === "POST" && pathname === "/api/settings/github/connect") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);
    let body: { token?: string };
    try { body = await request.json(); } catch { return corsResponse(JSON.stringify({ error: "Invalid JSON" }), 400, undefined, request); }
    if (!body.token?.trim()) return corsResponse(JSON.stringify({ error: "token requerido" }), 400, undefined, request);
    await env.DB.prepare(
      `INSERT INTO integrations (company_id, provider, access_token, is_active, updated_at)
       VALUES (?, 'github', ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(company_id, provider) DO UPDATE SET access_token = excluded.access_token, is_active = 1, updated_at = CURRENT_TIMESTAMP`
    ).bind(user.company_id, body.token.trim()).run();
    return corsResponse(JSON.stringify({ ok: true }), 200, undefined, request);
  }

  // DELETE /api/settings/github/connect — desconecta GitHub
  if (request.method === "DELETE" && pathname === "/api/settings/github/connect") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);
    await env.DB.prepare(
      `UPDATE integrations SET is_active = 0 WHERE company_id = ? AND provider = 'github'`
    ).bind(user.company_id).run();
    return corsResponse(JSON.stringify({ ok: true }), 200, undefined, request);
  }

  // GET /api/settings/integrations — estado de integraciones
  if (request.method === "GET" && pathname === "/api/settings/integrations") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);
    const rows = await env.DB.prepare(
      `SELECT provider, is_active, extra_data, updated_at FROM integrations WHERE company_id = ?`
    ).bind(user.company_id).all<{ provider: string; is_active: number; extra_data: string | null; updated_at: string }>();
    const integrations = (rows.results ?? []).map(r => ({
      provider: r.provider,
      connected: r.is_active === 1,
      email: r.extra_data ? (JSON.parse(r.extra_data) as { email?: string }).email ?? null : null,
      updated_at: r.updated_at,
    }));
    return corsResponse(JSON.stringify({ integrations }), 200, undefined, request);
  }

  // POST /api/settings/integrations — conectar una integración
  if (request.method === "POST" && pathname === "/api/settings/integrations") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    let body: { provider?: string; access_token?: string; extra_data?: Record<string, unknown> };
    try { body = await request.json(); } catch { return corsResponse(JSON.stringify({ error: "JSON inválido" }), 400, undefined, request); }

    const VALID_PROVIDERS = new Set(["slack", "notion", "hubspot", "shopify", "make"]);
    if (!body.provider || !VALID_PROVIDERS.has(body.provider)) {
      return corsResponse(JSON.stringify({ error: "Provider inválido. Válidos: slack, notion, hubspot, shopify, make" }), 400, undefined, request);
    }
    if (!body.access_token?.trim()) {
      return corsResponse(JSON.stringify({ error: "access_token requerido" }), 400, undefined, request);
    }

    await saveIntegration(env, user.company_id, body.provider, body.access_token.trim(), body.extra_data ?? {});
    return corsResponse(JSON.stringify({ ok: true, provider: body.provider }), 200, undefined, request);
  }

  // DELETE /api/settings/integrations — desconectar una integración
  if (request.method === "DELETE" && pathname === "/api/settings/integrations") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    let body: { provider?: string };
    try { body = await request.json(); } catch { return corsResponse(JSON.stringify({ error: "JSON inválido" }), 400, undefined, request); }

    const VALID_PROVIDERS = new Set(["slack", "notion", "hubspot", "shopify", "make"]);
    if (!body.provider || !VALID_PROVIDERS.has(body.provider)) {
      return corsResponse(JSON.stringify({ error: "Provider inválido" }), 400, undefined, request);
    }

    await env.DB.prepare(
      `UPDATE integrations SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND provider = ?`
    ).bind(user.company_id, body.provider).run();
    return corsResponse(JSON.stringify({ ok: true, provider: body.provider }), 200, undefined, request);
  }

  // ── Personal Tasks ─────────────────────────────────────────────────────
  if (pathname === "/api/tasks") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    if (request.method === "GET") {
      const status = url.searchParams.get("status") ?? "pending";
      const rows = await env.DB.prepare(
        `SELECT * FROM personal_tasks WHERE company_id = ? AND status = ? ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, created_at DESC LIMIT 50`
      ).bind(user.company_id, status).all();
      return corsResponse(JSON.stringify({ tasks: rows.results }), 200, undefined, request);
    }

    if (request.method === "POST") {
      let body: { title?: string; description?: string; priority?: string; due_date?: string };
      try { body = await request.json(); } catch { return corsResponse(JSON.stringify({ error: "Invalid JSON" }), 400, undefined, request); }
      if (!body.title?.trim()) return corsResponse(JSON.stringify({ error: "title requerido" }), 400, undefined, request);
      const res = await env.DB.prepare(
        `INSERT INTO personal_tasks (company_id, title, description, priority, due_date, source) VALUES (?, ?, ?, ?, ?, 'manual') RETURNING id`
      ).bind(user.company_id, body.title.trim(), body.description ?? null, body.priority ?? "normal", body.due_date ?? null).first<{ id: number }>();
      return corsResponse(JSON.stringify({ ok: true, id: res?.id }), 201, undefined, request);
    }
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (taskMatch) {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);
    const taskId = Number(taskMatch[1]);

    if (request.method === "PUT") {
      let body: { status?: string; title?: string; priority?: string };
      try { body = await request.json(); } catch { return corsResponse(JSON.stringify({ error: "Invalid JSON" }), 400, undefined, request); }
      await env.DB.prepare(
        `UPDATE personal_tasks SET status = COALESCE(?, status), title = COALESCE(?, title), priority = COALESCE(?, priority), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?`
      ).bind(body.status ?? null, body.title ?? null, body.priority ?? null, taskId, user.company_id).run();
      return corsResponse(JSON.stringify({ ok: true }), 200, undefined, request);
    }

    if (request.method === "DELETE") {
      await env.DB.prepare(`DELETE FROM personal_tasks WHERE id = ? AND company_id = ?`).bind(taskId, user.company_id).run();
      return corsResponse(JSON.stringify({ ok: true }), 200, undefined, request);
    }
  }

  // ── Google OAuth ────────────────────────────────────────────────────────
  if (request.method === "GET" && pathname === "/api/auth/google") {
    return handleGoogleAuthStart(request, env);
  }
  if (request.method === "GET" && pathname === "/api/auth/google/callback") {
    return handleGoogleAuthCallback(request, env);
  }
  if (request.method === "DELETE" && pathname === "/api/auth/google") {
    return handleGoogleDisconnect(request, env);
  }

  // GET /api/usage — resumen de uso del período actual (auth: Bearer o X-CF-Token)
  if (request.method === "GET" && pathname === "/api/usage") {
    const user = await authenticateUser(request, env);
    const adminToken = request.headers.get("X-CF-Token");
    let companyId: number | null = null;
    if (user) {
      companyId = user.company_id;
    } else if (adminToken === env.CLOUDFLARE_ADMIN_TOKEN) {
      // Admin: requiere query param company_id
      const qcId = url.searchParams.get("company_id");
      if (qcId) companyId = Number(qcId);
    }
    if (!companyId) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401, undefined, request);
    const summary = await getUsageSummary(env, companyId);
    const agentsCheck = await checkAgentsLimit(env, companyId);
    return corsResponse(JSON.stringify({
      plan: summary.plan,
      period: summary.period,
      usage: {
        chat_messages: { used: summary.usage.chat_messages_used, limit: summary.plan.chat_messages_limit },
        leads: { used: summary.usage.leads_used, limit: summary.plan.leads_limit },
        work_plans: { used: summary.usage.work_plan_runs_used, limit: summary.plan.work_plans_limit },
        agents: { used: agentsCheck.used, limit: summary.plan.agents_limit },
      },
    }), 200, undefined, request);
  }

  // OPTIONS preflight — cubre TODAS las rutas /api/*
  if (request.method === "OPTIONS") {
    const origin = getAllowedOrigin(request);
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": CORS_METHODS,
      "Access-Control-Allow-Headers": CORS_HEADERS_ALLOW,
      "Vary": "Origin",
    }});
  }

  // POST /api/admin/system/status — Kill Switch (pausa/reanuda el agente)
  if (request.method === "POST" && pathname === "/api/admin/system/status") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    let body: { status?: string };
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const newStatus = body.status === "paused" ? "paused" : "active";
    await env.KV.put("SYSTEM_STATUS", newStatus);
    await logAudit(env, "system_status_changed", { status: newStatus });
    return new Response(JSON.stringify({ ok: true, system_status: newStatus }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // POST /api/admin/command-chat — Admin Command Chat (God Mode cuando agent_id presente)
  if (request.method === "POST" && pathname === "/api/admin/command-chat") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    let body: {
      // Primera llamada con agente
      message?: string;
      history?: { role: string; content: string }[];
      agent_id?: number;
      // Llamada de continuación (después de ejecutar tools)
      tool_results?: ToolResult[];
      pending_tool_calls?: ToolCall[];
      messages_before_tools?: unknown[];
    };
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // ── God Mode (agent_id presente) ──────────────────────────────────────
    if (body.agent_id) {
      const profile = await getAgentProfileById(env, body.agent_id);
      if (!profile) {
        return new Response(JSON.stringify({ error: "Agent not found" }), {
          status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
      const tools = profile.skills.map((s) => s.schema).filter(Boolean);

      // ── Continuación: model ya llamó tools, llegaron resultados ──────────
      if (body.tool_results && body.messages_before_tools && body.pending_tool_calls) {
        let result: { text: string; toolCalls: ToolCall[] };
        let updatedMessages: unknown[];
        try {
          const r = await runDynamicChatWithResults(
            env,
            body.messages_before_tools,
            profile.model_id,
            tools,
            body.pending_tool_calls,
            body.tool_results
          );
          result = r.result;
          updatedMessages = r.updatedMessages;
        } catch (err) {
          return new Response(JSON.stringify({ error: `runDynamicChatWithResults: ${String(err)}` }), {
            status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        }

        if (result.toolCalls.length > 0) {
          // Procesar tools server-side antes de pasar el resto a Next.js
          const { clientToolCalls, serverResults, updatedMessages: msgsAfterServer } =
            await executeServerSideTools(env, result.toolCalls, updatedMessages, profile.model_id, tools);

          if (clientToolCalls.length > 0) {
            return new Response(JSON.stringify({
              pending_tool_calls: clientToolCalls,
              messages_before_tools: msgsAfterServer,
            }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
          }

          return new Response(JSON.stringify({ reply: serverResults || "Sin respuesta." }), {
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        }

        return new Response(JSON.stringify({ reply: result.text || "Sin respuesta." }), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      // ── Primera llamada con agente ─────────────────────────────────────
      if (!body.message?.trim()) {
        return new Response(JSON.stringify({ error: "message required" }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
      const history = (body.history ?? []).filter(
        (m): m is { role: "user" | "assistant" | "system"; content: string } =>
          ["user", "assistant", "system"].includes(m.role)
      );

      const { text, toolCalls } = await runDynamicChat(
        env, history, body.message, profile.role_prompt, profile.model_id, tools
      );

      if (toolCalls.length > 0) {
        const messagesBeforeTools = [
          { role: "system", content: profile.role_prompt },
          ...history,
          { role: "user", content: body.message },
        ];

        // Ejecutar tools server-side antes de pasar el resto a Next.js
        const { clientToolCalls, serverResults, updatedMessages: msgsAfterServer } =
          await executeServerSideTools(env, toolCalls, messagesBeforeTools, profile.model_id, tools);

        if (clientToolCalls.length > 0) {
          return new Response(JSON.stringify({
            pending_tool_calls: clientToolCalls,
            messages_before_tools: msgsAfterServer,
          }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
        }

        // Todos los tools eran server-side: devolver respuesta final
        return new Response(JSON.stringify({ reply: serverResults || "Sin respuesta." }), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      return new Response(JSON.stringify({ reply: text || "Sin respuesta." }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // ── Standard Admin Chat (sin agent_id) ────────────────────────────────
    if (!body.message?.trim()) {
      return new Response(JSON.stringify({ error: "message required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const history = (body.history ?? []).filter(
      (m): m is { role: "user" | "assistant" | "system"; content: string } =>
        ["user", "assistant", "system"].includes(m.role)
    );
    const reply = await runAdminChat(env, history, body.message);
    return new Response(JSON.stringify({ reply }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // POST /api/admin/tasks/inject — inyectar tarea directamente en D1
  if (request.method === "POST" && pathname === "/api/admin/tasks/inject") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    let body: { title?: string; description?: string; priority?: number };
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    if (!body.title?.trim() || !body.description?.trim()) {
      return new Response(JSON.stringify({ error: "title and description required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const priority = Math.min(10, Math.max(1, body.priority ?? 5));
    const taskId = await createTask(env, body.title.trim(), body.description.trim(), priority, "admin-dashboard");
    await logAudit(env, "task_injected_via_dashboard", { taskId, title: body.title });
    return new Response(JSON.stringify({ ok: true, taskId }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // ── Knowledge Base RAG endpoints ──────────────────────────────────────

  // POST /api/admin/knowledge/upload — vectorizar y guardar documento
  if (request.method === "POST" && pathname === "/api/admin/knowledge/upload") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    let body: { company_id?: number; title?: string; content?: string };
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    if (!body.company_id || !body.title?.trim() || !body.content?.trim()) {
      return new Response(JSON.stringify({ error: "company_id, title and content are required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const safeTitle   = sanitize(body.title.trim());
    const safeContent = sanitize(body.content.trim());

    // Generar embedding con BGE
    const embeddingRes = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [safeContent],
    }) as { data: number[][] };
    const vector = embeddingRes.data[0];

    // ID único para Vectorize
    const vectorId = `${body.company_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Insertar en Vectorize con metadatos
    await env.KNOWLEDGE_BASE.insert([{
      id: vectorId,
      values: vector,
      metadata: { company_id: body.company_id, title: safeTitle, text: safeContent.slice(0, 900) },
    }]);

    // Guardar registro en D1
    const docId = await insertKnowledgeDoc(
      env,
      body.company_id,
      body.title.trim(),
      vectorId,
      body.content.slice(0, 300)
    );

    await logAudit(env, "knowledge_doc_uploaded", { docId, companyId: body.company_id, title: body.title });
    return new Response(JSON.stringify({ ok: true, docId, vectorId }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // GET /api/admin/knowledge/docs?company_id=X — listar documentos (admin OR client)
  if (request.method === "GET" && pathname === "/api/admin/knowledge/docs") {
    const adminAuth = (request.headers.get("X-CF-Token") ?? "") === env.CLOUDFLARE_ADMIN_TOKEN;
    const clientUser = adminAuth ? null : await authenticateUser(request, env);
    if (!adminAuth && !clientUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    // Client: use their own company_id; admin: use query param
    const companyId = clientUser ? clientUser.company_id : Number(url.searchParams.get("company_id") ?? "0");
    if (!companyId) {
      return new Response(JSON.stringify({ error: "company_id required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    const docs = await listKnowledgeDocs(env, companyId);
    return new Response(JSON.stringify(docs), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // ── Multi-Tenant CRUD endpoints ────────────────────────────────────────

  // GET /api/admin/companies
  if (request.method === "GET" && pathname === "/api/admin/companies") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const companies = await listCompaniesWithStats(env);
    return new Response(JSON.stringify(companies), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // GET /api/admin/skills
  if (request.method === "GET" && pathname === "/api/admin/skills") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const skills = await listSkills(env);
    return new Response(JSON.stringify(skills), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // GET /api/admin/agents
  if (request.method === "GET" && pathname === "/api/admin/agents") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const agents = await listAgentsWithSkills(env);
    return new Response(JSON.stringify(agents), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // POST /api/admin/agents — crear o actualizar agente con skills
  if (request.method === "POST" && pathname === "/api/admin/agents") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    let body: { company_id?: number; name?: string; role_prompt?: string; model_id?: string; skill_ids?: number[] };
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    if (!body.company_id || !body.name?.trim() || !body.role_prompt?.trim()) {
      return new Response(JSON.stringify({ error: "company_id, name and role_prompt are required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const agentId = await upsertAgentWithSkills(
      env,
      body.company_id,
      body.name.trim(),
      body.role_prompt.trim(),
      body.model_id?.trim() || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      body.skill_ids ?? []
    );
    await logAudit(env, "agent_upserted", { agentId, name: body.name });
    return new Response(JSON.stringify({ ok: true, agentId }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // POST /admin/trigger-cron — fuerza ejecución manual del cron (protegido por API token)
  if (request.method === "POST" && pathname === "/admin/trigger-cron") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }
    await handleScheduled(env);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // POST /admin/trigger-morning-report — dispara el reporte matutino manualmente
  if (request.method === "POST" && pathname === "/admin/trigger-morning-report") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }
    ctx.waitUntil(handleMorningReport(env));
    return new Response(JSON.stringify({ ok: true, message: "Reporte iniciado" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // (preflight OPTIONS ya manejado globalmente arriba)

  // POST /api/chat/wallet — webchat autenticado por Smart Pass token
  if (request.method === "POST" && pathname === "/api/chat/wallet") {
    return handleWalletChat(env, request);
  }

  // GET /api/chat/:slug/history?session_id=xxx — historial de sesión pública
  const chatHistoryMatch = pathname.match(/^\/api\/chat\/([^/]+)\/history$/);
  if (request.method === "GET" && chatHistoryMatch) {
    return handlePublicChatHistory(env, request, chatHistoryMatch[1]);
  }

  // POST /api/chat/:slug — webchat público sin autenticación
  const publicChatMatch = pathname.match(/^\/api\/chat\/([^/]+)$/);
  if (request.method === "POST" && publicChatMatch && publicChatMatch[1] !== "wallet") {
    return handlePublicChat(env, request, publicChatMatch[1]);
  }

  // Health check
  if (pathname === "/health") {
    return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Config endpoints (API keys por tenant en KV) ──────────────────────

  const isConfigPath = pathname === "/api/admin/config";

  if (isConfigPath) {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // POST /api/admin/config — guardar key en KV
    if (request.method === "POST") {
      let body: { company_id?: unknown; key?: unknown; value?: unknown };
      try { body = await request.json(); } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
      if (!body.company_id || !body.key || !body.value) {
        return new Response(JSON.stringify({ error: "company_id, key and value required" }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
      const allowedKeys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
      if (!allowedKeys.includes(String(body.key))) {
        return new Response(JSON.stringify({ error: `key must be one of: ${allowedKeys.join(", ")}` }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
      const kvKey = `config:${body.company_id}:${body.key}`;
      await env.KV.put(kvKey, String(body.value));
      await logAudit(env, "config_key_set", { company_id: body.company_id, key: body.key });
      return new Response(JSON.stringify({ ok: true, kvKey }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // GET /api/admin/config?company_id=2 — leer config (valores enmascarados)
    if (request.method === "GET") {
      const companyId = new URL(request.url).searchParams.get("company_id");
      if (!companyId) {
        return new Response(JSON.stringify({ error: "company_id required" }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
      const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
      const result: Record<string, string | null> = {};
      for (const key of keys) {
        const val = await env.KV.get(`config:${companyId}:${key}`);
        // Mask: show only last 4 chars, never the full value
        result[key] = val ? `...${val.slice(-4)}` : null;
      }
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // DELETE /api/admin/config — borrar key de KV
    if (request.method === "DELETE") {
      let body: { company_id?: unknown; key?: unknown };
      try { body = await request.json(); } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
      if (!body.company_id || !body.key) {
        return new Response(JSON.stringify({ error: "company_id and key required" }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
      const kvKey = `config:${body.company_id}:${body.key}`;
      await env.KV.delete(kvKey);
      await logAudit(env, "config_key_deleted", { company_id: body.company_id, key: body.key });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
  }

  // ── Approve/Reject actions (Bearer auth — for desktop/webchat) ───────────

  // POST /api/actions/:id/execute — ejecutar acción pendiente (Bearer auth)
  const executeActionMatch = pathname.match(/^\/api\/actions\/(\d+)\/execute$/);
  if (request.method === "POST" && executeActionMatch) {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    const actionId = parseInt(executeActionMatch[1], 10);
    const body = await request.json() as { action: "approve" | "reject" };

    const pending = await env.DB.prepare(
      `SELECT action_type, action_data, status FROM pending_actions WHERE id = ? AND company_id = ?`
    ).bind(actionId, String(user.company_id)).first<{ action_type: string; action_data: string; status: string }>();

    if (!pending || pending.status !== "pending") {
      return corsResponse(JSON.stringify({ error: "Acción no encontrada o ya procesada" }), 404, undefined, request);
    }

    if (body.action === "reject") {
      await env.DB.prepare(`UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`).bind(actionId).run();
      return corsResponse(JSON.stringify({ ok: true, message: "Acción cancelada" }), 200, undefined, request);
    }

    // Approve — ejecutar según tipo
    const data = JSON.parse(pending.action_data) as Record<string, unknown>;

    if (pending.action_type === "send_email") {
      if (!env.RESEND_API_KEY) return corsResponse(JSON.stringify({ error: "RESEND_API_KEY no configurado" }), 500, undefined, request);
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.RESEND_API_KEY}` },
        body: JSON.stringify({ from: `${data.from_name} <ailyn@novacode.pro>`, to: [data.to], subject: data.subject, text: data.body }),
      });
      if (resendRes.ok) {
        await env.DB.prepare(`UPDATE pending_actions SET status = 'executed', executed_at = datetime('now') WHERE id = ?`).bind(actionId).run();
        return corsResponse(JSON.stringify({ ok: true, message: `Email enviado a ${data.to}` }), 200, undefined, request);
      } else {
        const err = await resendRes.text();
        return corsResponse(JSON.stringify({ error: `Error enviando email: ${err}` }), 500, undefined, request);
      }
    }

    if (pending.action_type === "schedule_meeting") {
      const freshToken = await getValidGoogleToken(env, user.company_id);
      if (!freshToken) return corsResponse(JSON.stringify({ error: "Google Calendar no conectado" }), 400, undefined, request);
      const eventBody: Record<string, unknown> = {
        summary: data.title, description: data.description,
        start: { dateTime: `${data.date}T${data.startTime}:00`, timeZone: "America/Mexico_City" },
        end: { dateTime: `${data.date}T${data.endTime}:00`, timeZone: "America/Mexico_City" },
      };
      if (Array.isArray(data.attendees) && data.attendees.length > 0) {
        eventBody.attendees = (data.attendees as string[]).map(email => ({ email }));
      }
      const calRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${freshToken}` },
        body: JSON.stringify(eventBody),
      });
      if (calRes.ok) {
        await env.DB.prepare(`UPDATE pending_actions SET status = 'executed', executed_at = datetime('now') WHERE id = ?`).bind(actionId).run();
        return corsResponse(JSON.stringify({ ok: true, message: `Evento agendado: ${data.title}` }), 200, undefined, request);
      } else {
        const err = await calRes.text();
        return corsResponse(JSON.stringify({ error: `Error creando evento: ${err}` }), 500, undefined, request);
      }
    }

    if (pending.action_type === "send_followup") {
      await env.DB.prepare(`UPDATE pending_actions SET status = 'scheduled', decided_at = datetime('now') WHERE id = ?`).bind(actionId).run();
      return corsResponse(JSON.stringify({ ok: true, message: "Follow-up programado" }), 200, undefined, request);
    }

    return corsResponse(JSON.stringify({ error: "Tipo de acción no soportado" }), 400, undefined, request);
  }

  // ── Actions endpoints ─────────────────────────────────────────────────

  // GET /api/actions?company_id=openclaw-labs&status=pending — listar acciones
  if (request.method === "GET" && pathname === "/api/actions") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const url = new URL(request.url);
    const companyId = url.searchParams.get("company_id") ?? "ailyn-labs";
    const status = url.searchParams.get("status") ?? "pending";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 50);
    const actions = await env.DB.prepare(
      `SELECT pa.*, l.contact_name, l.contact_email, l.contact_company
       FROM pending_actions pa
       LEFT JOIN leads l ON pa.lead_id = l.id
       WHERE pa.company_id = ? AND pa.status = ?
       ORDER BY pa.created_at DESC LIMIT ?`
    ).bind(companyId, status, limit).all();
    return new Response(JSON.stringify({ ok: true, actions: actions.results ?? [] }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // POST /api/actions/:id/approve — aprobar desde dashboard
  const approveMatch = pathname.match(/^\/api\/actions\/(\d+)\/approve$/);
  if (request.method === "POST" && approveMatch) {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const actionId = parseInt(approveMatch[1], 10);
    const result = await approveAction(env, actionId);
    return new Response(JSON.stringify({ ok: result.success, error: result.error }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // POST /api/actions/:id/reject — rechazar desde dashboard
  const rejectMatch = pathname.match(/^\/api\/actions\/(\d+)\/reject$/);
  if (request.method === "POST" && rejectMatch) {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const actionId = parseInt(rejectMatch[1], 10);
    await rejectAction(env, actionId);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // ── Lead Intelligence endpoints ────────────────────────────────────────

  // POST /api/leads/research — investigar un lead con IA + búsqueda web
  if (request.method === "POST" && pathname === "/api/leads/research") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    let body: { company_id?: string; contact_name?: string; contact_email?: string; contact_company?: string; contact_message?: string; contact_phone?: string; source?: string };
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    if (!body.company_id || !body.contact_name?.trim() || !body.contact_email?.trim()) {
      return new Response(JSON.stringify({ error: "company_id, contact_name and contact_email required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const research = await researchLead(
      {
        contact_name: body.contact_name.trim(),
        contact_email: body.contact_email.trim(),
        contact_company: body.contact_company,
        contact_message: body.contact_message,
        contact_phone: body.contact_phone,
        source: body.source ?? "api",
      },
      env,
      body.company_id
    );

    const leadId = await saveLead(env, body.company_id, {
      contact_name: body.contact_name.trim(),
      contact_email: body.contact_email.trim(),
      contact_phone: body.contact_phone ?? null,
      contact_company: body.contact_company ?? null,
      contact_message: body.contact_message ?? null,
      source: body.source ?? "api",
      research_status: "complete",
      company_website: research.company.website,
      company_industry: research.company.industry,
      company_size: research.company.size,
      company_location: research.company.location,
      company_description: research.company.description,
      company_tech_stack: JSON.stringify(research.company.techStack),
      company_recent_news: JSON.stringify(research.company.recentNews),
      contact_role: research.contact.role,
      contact_seniority: research.contact.seniority,
      contact_linkedin_url: research.contact.linkedinUrl,
      contact_linkedin_insights: JSON.stringify(research.contact.linkedinInsights),
      recommended_unit: research.classification.recommendedUnit,
      secondary_units: JSON.stringify(research.classification.secondaryUnits),
      urgency: research.classification.urgency,
      lead_score: research.classification.leadScore,
      brief_summary: research.content.briefSummary,
      brief_full: research.content.briefFull,
      suggested_email_subject: research.content.suggestedEmailSubject,
      suggested_email_body: research.content.suggestedEmailBody,
      talking_points: JSON.stringify(research.content.talkingPoints),
      estimated_value: research.content.estimatedValue,
      next_step: research.content.nextStep,
      follow_up_date: research.content.followUpDate,
      llm_provider: (research as ResearchResult & { _llmProvider?: string })._llmProvider ?? "cloudflare",
      llm_model: (research as ResearchResult & { _llmModel?: string })._llmModel ?? "llama-3.3-70b",
    });

    await logAudit(env, "lead_researched_api", { leadId, contactEmail: body.contact_email });

    // Notificación Telegram
    const urgencyEmoji = research.classification.urgency === "high" ? "🔥 CALIENTE" :
      research.classification.urgency === "medium" ? "🟡 TIBIO" : "🔵 FRÍO";
    const tgMessage =
      `🔍 LEAD INVESTIGADO — ${urgencyEmoji}\n\n` +
      `🏢 ${body.contact_company ?? "—"} (${research.company.industry ?? "—"})\n` +
      `👤 ${body.contact_name} — ${research.contact.role ?? "—"}\n` +
      `📧 ${body.contact_email}\n` +
      `📊 Score: ${research.classification.leadScore}/100\n\n` +
      `📝 ${research.content.briefSummary}\n\n` +
      `🎯 Servicio: ${research.classification.recommendedUnit}\n` +
      `💰 Valor: ${research.content.estimatedValue}\n` +
      `⏰ Siguiente paso: ${research.content.nextStep}`;
    await sendMessage(env, Number(env.TELEGRAM_CHAT_ID), tgMessage).catch(() => { /* notificación opcional */ });

    // Notificación Smart Pass (si hay pases registrados)
    if (research.classification.urgency === "high" || research.classification.leadScore >= 60) {
      const passes = await listWalletPasses(env, 2, 100).catch(() => []);
      if (passes.length > 0) {
        const passValues = {
          ultimoLead: `${body.contact_name} (${body.contact_company ?? "—"}) · Score ${research.classification.leadScore}`,
          score: String(research.classification.leadScore),
          leadsHoy: new Date().toLocaleDateString("es-CO"),
        };
        await Promise.allSettled(passes.map((p) => notifyViaPass(env, p.serial_number, passValues)));
      }
    }

    return new Response(JSON.stringify({
      success: true,
      lead_id: leadId,
      brief_summary: research.content.briefSummary,
      recommended_unit: research.classification.recommendedUnit,
      urgency: research.classification.urgency,
      lead_score: research.classification.leadScore,
      brief_full: research.content.briefFull,
      suggested_email_subject: research.content.suggestedEmailSubject,
      suggested_email_body: research.content.suggestedEmailBody,
    }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // GET /api/leads — listar leads (admin token OR client Bearer)
  if (request.method === "GET" && pathname === "/api/leads") {
    const adminAuth = (request.headers.get("X-CF-Token") ?? "") === env.CLOUDFLARE_ADMIN_TOKEN;
    const clientUser = adminAuth ? null : await authenticateUser(request, env);
    if (!adminAuth && !clientUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    // Scope: client sees only their company slug; admin can filter by query param
    const companyId = clientUser?.company_slug ?? url.searchParams.get("company_id") ?? undefined;
    const urgency = url.searchParams.get("urgency") ?? undefined;
    const researchStatus = url.searchParams.get("research_status") ?? undefined;
    const recommendedUnit = url.searchParams.get("recommended_unit") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "50");
    const leads = await listLeads(env, { company_id: companyId, urgency, research_status: researchStatus, recommended_unit: recommendedUnit, limit });
    return new Response(JSON.stringify(leads), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // GET /api/leads/:id — lead completo (admin token OR client Bearer)
  if (request.method === "GET" && pathname.startsWith("/api/leads/")) {
    const adminAuth = (request.headers.get("X-CF-Token") ?? "") === env.CLOUDFLARE_ADMIN_TOKEN;
    const clientUser = adminAuth ? null : await authenticateUser(request, env);
    if (!adminAuth && !clientUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    const leadId = pathname.split("/")[3] ?? "";
    const lead = await getLeadById(env, leadId);
    if (!lead) return new Response(JSON.stringify({ error: "Lead not found" }), { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    // Scope check for client users
    if (clientUser && (lead as { company_id?: string }).company_id !== clientUser.company_slug) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    return new Response(JSON.stringify(lead), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // ── Email Monitor endpoints ────────────────────────────────────────────

  // POST /api/emails/check — forzar check de Gmail
  if (request.method === "POST" && pathname === "/api/emails/check") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    let body: { company_id?: string; max_results?: number } = {};
    try { body = await request.json(); } catch { /* body is optional */ }
    const companyId = body.company_id ?? "ailyn-labs";

    const emails = await fetchRecentEmails(env, body.max_results ?? 10);
    const newEmails: Array<{ email: string; subject: string; urgency: string; summary: string }> = [];

    for (const email of emails) {
      const alreadySaved = await isEmailAlreadySaved(env, email.id);
      if (alreadySaved) continue;

      const analysis = await analyzeEmail(email, env);
      await saveMonitoredEmail(env, companyId, email.id, {
        from_address: email.from,
        from_name: email.fromName,
        to_address: email.to,
        subject: email.subject,
        body_preview: email.bodyPreview,
        received_at: email.receivedAt,
        urgency: analysis.urgency,
        category: analysis.category,
        summary: analysis.summary,
        suggested_reply: analysis.suggestedReply,
        requires_action: analysis.requiresAction,
      });

      if (analysis.urgency === "high" || analysis.requiresAction) {
        await sendMessage(env, Number(env.TELEGRAM_CHAT_ID), formatEmailAlert(email, analysis)).catch(() => { /* opcional */ });
      }
      newEmails.push({ email: email.from, subject: email.subject, urgency: analysis.urgency, summary: analysis.summary });
    }

    await logAudit(env, "email_check_forced", { companyId, newCount: newEmails.length });
    return new Response(JSON.stringify({ ok: true, new_emails: newEmails.length, emails: newEmails }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // GET /api/emails — listar emails monitoreados
  if (request.method === "GET" && pathname === "/api/emails") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const companyId = url.searchParams.get("company_id") ?? undefined;
    const urgency = url.searchParams.get("urgency") ?? undefined;
    const requiresAction = url.searchParams.has("requires_action") ? url.searchParams.get("requires_action") === "true" : undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "20");
    const emails = await listMonitoredEmails(env, { company_id: companyId, urgency, requires_action: requiresAction, limit });
    return new Response(JSON.stringify(emails), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // POST /api/research — búsqueda web ad-hoc
  if (request.method === "POST" && pathname === "/api/research") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    let body: { query?: string };
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    if (!body.query?.trim()) {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const results = await searchWeb(body.query.trim(), env, { maxResults: 5, searchDepth: "advanced" });
    const summaryResp = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: "Eres un asistente de investigación. Responde en español, estructurado y conciso." },
        { role: "user", content: `Investiga: "${body.query}"\n\nResultados:\n${results.rawText}` },
      ],
    }) as { response?: string };

    return new Response(JSON.stringify({
      query: body.query,
      summary: summaryResp.response ?? "Sin respuesta",
      sources: results.results.map((r) => ({ title: r.title, url: r.url })),
    }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // ── User-facing Wallet endpoints (Bearer auth) ────────────────────────────

  // GET /api/wallet/my-passes — list passes for authenticated user's company
  if (request.method === "GET" && pathname === "/api/wallet/my-passes") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);
    const passes = await listWalletPasses(env, user.company_id);
    return corsResponse(JSON.stringify({ passes }), 200, undefined, request);
  }

  // POST /api/wallet/create-pass — create pass for a customer (Bearer auth)
  if (request.method === "POST" && pathname === "/api/wallet/create-pass") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    let body: { name: string; email?: string; phone?: string };
    try { body = await request.json(); } catch { return corsResponse(JSON.stringify({ error: "Invalid JSON" }), 400, undefined, request); }

    if (!body.name) return corsResponse(JSON.stringify({ error: "name is required" }), 400, undefined, request);

    try {
      // Get company info for the pass
      const company = await env.DB.prepare(`SELECT name, slug FROM companies WHERE id = ?`).bind(user.company_id).first<{ name: string; slug: string }>();
      const companyName = company?.name ?? "Mi empresa";
      const companySlug = company?.slug ?? "default";

      const passInfo = await createPass(env, {
        nombre: body.name,
        empresa: companyName,
        email: body.email,
        rol: "Cliente"
      });

      const dbId = await createWalletPass(env, user.company_id, {
        serial_number: passInfo.serialNumber,
        pass_type_id: passInfo.passTypeIdentifier,
        owner_name: body.name,
        owner_email: body.email ?? null,
        role: "Cliente",
        install_url: passInfo.url ?? null,
      });

      if (passInfo.url) await updateWalletPassUrl(env, passInfo.serialNumber, passInfo.url);

      return corsResponse(JSON.stringify({
        ok: true,
        id: dbId,
        install_url: passInfo.url,
        webchat_url: `https://ailyn-dashboard.pages.dev/chat/${companySlug}`,
      }), 200, undefined, request);
    } catch (err) {
      return corsResponse(JSON.stringify({ error: String(err) }), 500, undefined, request);
    }
  }

  // POST /api/wallet/send-pass — send pass via email to customer (Bearer auth)
  if (request.method === "POST" && pathname === "/api/wallet/send-pass") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    const body = await request.json() as { serial_number: string; email: string };
    if (!body.serial_number || !body.email) return corsResponse(JSON.stringify({ error: "serial_number and email required" }), 400, undefined, request);

    try {
      await emailPass(env, body.serial_number, body.email);
      return corsResponse(JSON.stringify({ ok: true }), 200, undefined, request);
    } catch (err) {
      return corsResponse(JSON.stringify({ error: String(err) }), 500, undefined, request);
    }
  }

  // POST /api/wallet/push-notification — send push to all pass holders (Bearer auth)
  if (request.method === "POST" && pathname === "/api/wallet/push-notification") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    const body = await request.json() as { title: string; message: string };
    if (!body.title || !body.message) return corsResponse(JSON.stringify({ error: "title and message required" }), 400, undefined, request);

    const passes = await listWalletPasses(env, user.company_id, 100);
    let sent = 0;
    for (const pass of passes) {
      try {
        await notifyViaPass(env, pass.serial_number, { header: body.title, secondary: body.message });
        sent++;
      } catch { /* skip failed */ }
    }

    return corsResponse(JSON.stringify({ ok: true, total: passes.length, sent }), 200, undefined, request);
  }

  // ── Wallet Passes endpoints (Admin — X-CF-Token) ─────────────────────────

  // POST /api/wallet/create — crear un nuevo pase para un contacto
  if (request.method === "POST" && pathname === "/api/wallet/create") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    let body: { nombre?: string; empresa?: string; email?: string; rol?: string; company_id?: number };
    try { body = await request.json(); } catch { body = {}; }
    if (!body.nombre || !body.empresa) {
      return new Response(JSON.stringify({ error: "nombre and empresa required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    try {
      const passInfo = await createPass(env, { nombre: body.nombre, empresa: body.empresa, email: body.email, rol: body.rol });
      const companyId = body.company_id ?? 2;
      const dbId = await createWalletPass(env, companyId, {
        serial_number: passInfo.serialNumber,
        pass_type_id: passInfo.passTypeIdentifier,
        owner_name: body.nombre,
        owner_email: body.email ?? null,
        role: body.rol ?? null,
        install_url: passInfo.url ?? null,
      });
      if (passInfo.url) await updateWalletPassUrl(env, passInfo.serialNumber, passInfo.url);
      return new Response(JSON.stringify({ ok: true, dbId, serialNumber: passInfo.serialNumber, url: passInfo.url }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
  }

  // POST /api/wallet/notify — actualizar valores de un pase + push
  if (request.method === "POST" && pathname === "/api/wallet/notify") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    const body = await request.json() as { serial_number: string; values: Record<string, string> };
    if (!body.serial_number || !body.values) {
      return new Response(JSON.stringify({ error: "serial_number and values required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    await notifyViaPass(env, body.serial_number, body.values);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // POST /api/wallet/notify-company — notificar a todos los pases de una empresa
  if (request.method === "POST" && pathname === "/api/wallet/notify-company") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    const body = await request.json() as { company_id?: number; values: Record<string, string> };
    const companyId = body.company_id ?? 2;
    const passes = await listWalletPasses(env, companyId, 100);
    const results = await Promise.allSettled(
      passes.map((p) => notifyViaPass(env, p.serial_number, body.values))
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    return new Response(JSON.stringify({ ok: true, total: passes.length, succeeded }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // GET /api/wallet/passes — listar pases
  if (request.method === "GET" && pathname === "/api/wallet/passes") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    const url = new URL(request.url);
    const companyId = Number(url.searchParams.get("company_id") ?? "2");
    const passes = await listWalletPasses(env, companyId);
    return new Response(JSON.stringify({ ok: true, passes }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // POST /api/wallet/email — enviar pase por email
  if (request.method === "POST" && pathname === "/api/wallet/email") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    const body = await request.json() as { serial_number: string; email: string };
    if (!body.serial_number || !body.email) {
      return new Response(JSON.stringify({ error: "serial_number and email required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    await emailPass(env, body.serial_number, body.email);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // /api/wallet/webhook — todos los métodos, sin auth
  if (pathname === "/api/wallet/webhook") {
    const method = request.method;
    const qToken = new URL(request.url).searchParams.get("token");

    // GET con token en query param (algunos webhooks verifican así)
    if (method === "GET") {
      console.log("Webhook GET:", request.url);
      if (qToken) {
        return new Response(JSON.stringify({ token: qToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // POST con JSON
    let body: Record<string, unknown> = {};
    try {
      const rawText = await request.text();
      console.log("Webhook POST raw:", rawText, "| url:", request.url);
      body = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    } catch (e) {
      console.log("Webhook parse error:", String(e));
    }

    const eventType = (body.type ?? body.event) as string | undefined;
    const bodyToken = (body.token ?? body.challenge) as string | undefined;

    // Verificación: responder con el token recibido (sea en body o query param)
    if (eventType === "webhook.verify" || qToken) {
      const replyToken = bodyToken ?? qToken ?? "";
      return new Response(JSON.stringify({ token: replyToken }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (eventType === "registration.created") {
      const serialNumber = body.serialNumber as string | undefined;
      if (serialNumber) {
        await updateWalletPassInstalled(env, serialNumber);
        await logAudit(env, "wallet_pass_installed", JSON.stringify({ serialNumber }));
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // ── Admin Panel — Companies CRUD ─────────────────────────────────────────

  // Helper de auth para admin panel
  const isAdmin = () => (request.headers.get("X-CF-Token") ?? "") === env.CLOUDFLARE_ADMIN_TOKEN;

  // POST /api/admin/companies — crear company
  if (request.method === "POST" && pathname === "/api/admin/companies") {
    if (!isAdmin()) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    let body: { name?: string };
    try { body = await request.json(); } catch {
      return corsResponse(JSON.stringify({ error: "Invalid JSON" }), 400);
    }
    if (!body.name?.trim()) return corsResponse(JSON.stringify({ error: "name required" }), 400);
    try {
      const id = await createCompany(env, body.name.trim());
      await logAudit(env, "company_created", { id, name: body.name });
      return corsResponse(JSON.stringify({ ok: true, id }), 201);
    } catch {
      return corsResponse(JSON.stringify({ error: "Company name already exists" }), 409);
    }
  }

  // GET /api/admin/companies/:id — detalle con agents
  if (request.method === "GET" && /^\/api\/admin\/companies\/\d+$/.test(pathname)) {
    if (!isAdmin()) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const id = parseInt(pathname.split("/")[4]);
    const detail = await getCompanyDetail(env, id);
    if (!detail) return corsResponse(JSON.stringify({ error: "Not found" }), 404);
    return corsResponse(JSON.stringify(detail), 200);
  }

  // PUT /api/admin/companies/:id — editar company
  if (request.method === "PUT" && /^\/api\/admin\/companies\/\d+$/.test(pathname)) {
    if (!isAdmin()) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const id = parseInt(pathname.split("/")[4]);
    let body: { name?: string };
    try { body = await request.json(); } catch {
      return corsResponse(JSON.stringify({ error: "Invalid JSON" }), 400);
    }
    if (!body.name?.trim()) return corsResponse(JSON.stringify({ error: "name required" }), 400);
    await updateCompany(env, id, body.name.trim());
    await logAudit(env, "company_updated", { id, name: body.name });
    return corsResponse(JSON.stringify({ ok: true }), 200);
  }

  // DELETE /api/admin/companies/:id — eliminar company
  if (request.method === "DELETE" && /^\/api\/admin\/companies\/\d+$/.test(pathname)) {
    if (!isAdmin()) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const id = parseInt(pathname.split("/")[4]);
    await deleteCompany(env, id);
    await logAudit(env, "company_deleted", { id });
    return corsResponse(JSON.stringify({ ok: true }), 200);
  }

  // GET /api/admin/companies/:id/metrics — métricas de empresa
  if (request.method === "GET" && /^\/api\/admin\/companies\/\d+\/metrics$/.test(pathname)) {
    if (!isAdmin()) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const id = parseInt(pathname.split("/")[4]);
    const company = await env.DB.prepare(`SELECT slug FROM companies WHERE id = ?`).bind(id).first<{ slug: string | null }>();
    if (!company?.slug) return corsResponse(JSON.stringify({ error: "Not found" }), 404);
    const metrics = await getCompanyMetrics(env, company.slug);
    return corsResponse(JSON.stringify(metrics), 200);
  }

  // ── Admin Panel — Agents CRUD ────────────────────────────────────────────

  // PUT /api/admin/agents/:id — editar agent
  if (request.method === "PUT" && /^\/api\/admin\/agents\/\d+$/.test(pathname)) {
    if (!isAdmin()) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const id = parseInt(pathname.split("/")[4]);
    let body: { name?: string; role_prompt?: string; model_id?: string; is_active?: number; skill_ids?: number[] };
    try { body = await request.json(); } catch {
      return corsResponse(JSON.stringify({ error: "Invalid JSON" }), 400);
    }
    await updateAgent(env, id, body);
    await logAudit(env, "agent_updated", { id });
    return corsResponse(JSON.stringify({ ok: true }), 200);
  }

  // DELETE /api/admin/agents/:id — eliminar agent
  if (request.method === "DELETE" && /^\/api\/admin\/agents\/\d+$/.test(pathname)) {
    if (!isAdmin()) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const id = parseInt(pathname.split("/")[4]);
    await deleteAgent(env, id);
    await logAudit(env, "agent_deleted", { id });
    return corsResponse(JSON.stringify({ ok: true }), 200);
  }

  // ── Admin Panel — Knowledge CRUD ─────────────────────────────────────────

  // DELETE /api/admin/knowledge/:id — eliminar doc del RAG
  if (request.method === "DELETE" && /^\/api\/admin\/knowledge\/\d+$/.test(pathname)) {
    if (!isAdmin()) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const id = parseInt(pathname.split("/")[4]);
    const vectorId = await deleteKnowledgeDoc(env, id);
    if (!vectorId) return corsResponse(JSON.stringify({ error: "Not found" }), 404);
    // Eliminar de Vectorize también
    try { await env.KNOWLEDGE_BASE.deleteByIds([vectorId]); } catch { /* ok si ya no existe */ }
    await logAudit(env, "knowledge_doc_deleted", { id, vectorId });
    return corsResponse(JSON.stringify({ ok: true }), 200);
  }

  // ── Admin Panel — Global Metrics ─────────────────────────────────────────

  // GET /api/admin/metrics — métricas globales
  if (request.method === "GET" && pathname === "/api/admin/metrics") {
    if (!isAdmin()) return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    const metrics = await getGlobalMetrics(env);
    return corsResponse(JSON.stringify(metrics), 200);
  }

  // ── Client Auth ──────────────────────────────────────────────────────────

  if (request.method === "OPTIONS") {
    const origin = getAllowedOrigin(request);
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": CORS_METHODS,
      "Access-Control-Allow-Headers": CORS_HEADERS_ALLOW,
      "Vary": "Origin",
    }});
  }

  if (request.method === "POST" && pathname === "/api/auth/register") {
    return handleRegister(request, env);
  }

  if (request.method === "POST" && pathname === "/api/auth/login") {
    return handleLogin(request, env);
  }

  if (request.method === "POST" && pathname === "/api/auth/logout") {
    return handleLogout(request, env);
  }

  if (request.method === "GET" && pathname === "/api/auth/me") {
    return handleMe(request, env);
  }

  if (request.method === "POST" && pathname === "/api/setup/generate-prompt") {
    return handleGeneratePrompt(request, env);
  }

  if (request.method === "POST" && pathname === "/api/setup/complete") {
    return handleSetupComplete(request, env);
  }

  // Telegram multi-tenant settings
  if (request.method === "POST" && pathname === "/api/settings/telegram/connect") {
    return handleTelegramConnect(request, env);
  }

  if (request.method === "DELETE" && pathname === "/api/settings/telegram/disconnect") {
    return handleTelegramDisconnect(request, env);
  }

  if (request.method === "GET" && pathname === "/api/settings/telegram/status") {
    return handleTelegramStatus(request, env);
  }

  // WhatsApp multi-tenant settings
  if (request.method === "POST" && pathname === "/api/settings/whatsapp/connect") {
    return handleWhatsAppConnect(request, env);
  }

  if (request.method === "DELETE" && pathname === "/api/settings/whatsapp/disconnect") {
    return handleWhatsAppDisconnect(request, env);
  }

  if (request.method === "GET" && pathname === "/api/settings/whatsapp/status") {
    return handleWhatsAppStatus(request, env);
  }

  // ── Work Plans API ──────────────────────────────────────────────────────

  if (pathname === "/api/work-plans" || pathname.startsWith("/api/work-plans/")) {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401);

    // GET /api/work-plans — listar planes de la empresa
    if (request.method === "GET" && pathname === "/api/work-plans") {
      const plans = await listWorkPlans(env, user.company_id);
      const plansWithSteps = await Promise.all(
        plans.map(async (p) => ({
          ...p,
          steps: await getWorkPlanSteps(env, p.id),
        }))
      );
      return corsResponse(JSON.stringify(plansWithSteps), 200);
    }

    // POST /api/work-plans — crear plan
    if (request.method === "POST" && pathname === "/api/work-plans") {
      let body: { name?: string; description?: string; cron_expression?: string; steps?: Array<{ action_type: string; config: unknown }> };
      try { body = await request.json(); } catch { return corsResponse(JSON.stringify({ error: "Invalid JSON" }), 400); }
      if (!body.name?.trim() || !body.cron_expression?.trim()) {
        return corsResponse(JSON.stringify({ error: "name y cron_expression son requeridos" }), 400);
      }
      const planId = await createWorkPlan(env, user.company_id, {
        name: body.name.trim(),
        description: body.description,
        cron_expression: body.cron_expression.trim(),
      });
      if (body.steps?.length) {
        await replaceWorkPlanSteps(env, planId, body.steps);
      }
      return corsResponse(JSON.stringify({ ok: true, id: planId }), 201);
    }

    // Rutas con :id
    const idMatch = pathname.match(/^\/api\/work-plans\/(\d+)(\/.*)?$/);
    if (idMatch) {
      const planId = Number(idMatch[1]);
      const subpath = idMatch[2] ?? "";

      // GET /api/work-plans/:id/runs — historial de ejecuciones
      if (request.method === "GET" && subpath === "/runs") {
        const plan = await getWorkPlan(env, planId, user.company_id);
        if (!plan) return corsResponse(JSON.stringify({ error: "Not Found" }), 404);
        const runs = await listWorkPlanRuns(env, planId, 20);
        return corsResponse(JSON.stringify(runs), 200);
      }

      // POST /api/work-plans/:id/trigger — ejecutar ahora
      if (request.method === "POST" && subpath === "/trigger") {
        const plan = await getWorkPlan(env, planId, user.company_id);
        if (!plan) return corsResponse(JSON.stringify({ error: "Not Found" }), 404);
        ctx.waitUntil(executeWorkPlan(env, plan));
        return corsResponse(JSON.stringify({ ok: true, message: "Ejecución iniciada" }), 200);
      }

      // PUT /api/work-plans/:id — actualizar plan
      if (request.method === "PUT" && subpath === "") {
        let body: { name?: string; description?: string; cron_expression?: string; is_active?: number; steps?: Array<{ action_type: string; config: unknown }> };
        try { body = await request.json(); } catch { return corsResponse(JSON.stringify({ error: "Invalid JSON" }), 400); }
        await updateWorkPlan(env, planId, user.company_id, {
          name: body.name,
          description: body.description,
          cron_expression: body.cron_expression,
          is_active: body.is_active,
        });
        if (body.steps !== undefined) {
          await replaceWorkPlanSteps(env, planId, body.steps);
        }
        return corsResponse(JSON.stringify({ ok: true }), 200);
      }

      // DELETE /api/work-plans/:id — eliminar plan
      if (request.method === "DELETE" && subpath === "") {
        await deleteWorkPlan(env, planId, user.company_id);
        return corsResponse(JSON.stringify({ ok: true }), 200);
      }
    }

    return corsResponse(JSON.stringify({ error: "Not Found" }), 404);
  }

  // Admin: migrar bot legado a telegram_configs (uso único)
  if (request.method === "POST" && pathname === "/api/admin/migrate/telegram") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return corsResponse(JSON.stringify({ error: "Unauthorized" }), 401);
    }
    let body: { company_id?: number };
    try { body = await request.json(); } catch { body = {}; }
    const companyId = body.company_id;
    if (!companyId) return corsResponse(JSON.stringify({ error: "company_id required" }), 400);

    // Validar bot token actual
    const meResp = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`
    ).then((r) => r.json()) as { ok: boolean; result?: { username?: string } };
    if (!meResp.ok) return corsResponse(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN invalid" }), 500);

    const botUsername = meResp.result?.username ?? "bot";
    const webhookSecret = crypto.randomUUID();

    const { saveTelegramConfig: saveTC } = await import("./telegram-multi").then(
      () => ({ saveTelegramConfig: null })
    ).catch(() => ({ saveTelegramConfig: null }));
    void saveTC;

    // Guardar en D1 directamente
    await env.DB.prepare(
      `INSERT INTO telegram_configs (company_id, bot_token, bot_username, webhook_secret)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(company_id) DO UPDATE SET
         bot_token = excluded.bot_token,
         bot_username = excluded.bot_username,
         webhook_secret = excluded.webhook_secret,
         is_active = 1`
    ).bind(companyId, env.TELEGRAM_BOT_TOKEN, botUsername, webhookSecret).run();

    // Re-registrar webhook con nueva URL y secret
    const url = new URL(request.url);
    const slug = await env.DB.prepare("SELECT slug FROM companies WHERE id = ?")
      .bind(companyId).first<{ slug: string }>();
    if (!slug?.slug) return corsResponse(JSON.stringify({ error: "Company slug not found" }), 404);

    const webhookUrl = `${url.protocol}//${url.host}/webhook/telegram/${slug.slug}`;
    const whResp = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, secret_token: webhookSecret, allowed_updates: ["message"] }),
      }
    ).then((r) => r.json()) as { ok: boolean; description?: string };

    return corsResponse(JSON.stringify({
      success: true,
      bot_username: botUsername,
      webhook_url: webhookUrl,
      telegram_webhook_registered: whResp.ok,
    }), 200);
  }

  // ── Agents Marketplace API ───────────────────────────────────────────────
  if (pathname.startsWith("/api/agents")) {
    return handleMarketplace(request, env, pathname);
  }

  // ── Activity Center API ──────────────────────────────────────────────
  if (request.method === "GET" && pathname === "/api/activity") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    try {
      const cid = String(user.company_id);

      const [activeRows, recentRows] = await Promise.all([
        env.DB.prepare(
          `SELECT id, action_type, action_data, status, followup_scheduled_at, created_at
           FROM pending_actions
           WHERE company_id = ? AND status IN ('pending', 'scheduled')
           ORDER BY created_at DESC LIMIT 20`
        ).bind(cid).all(),
        env.DB.prepare(
          `SELECT id, action_type, action_data, status, executed_at, created_at
           FROM pending_actions
           WHERE company_id = ? AND status IN ('executed', 'rejected', 'failed') AND created_at >= datetime('now', '-7 days')
           ORDER BY created_at DESC LIMIT 20`
        ).bind(cid).all(),
      ]);

      const parseRow = (r: Record<string, unknown>, includeExecuted: boolean) => {
        const base: Record<string, unknown> = {
          id: r.id,
          type: r.action_type,
          status: r.status,
          created_at: r.created_at,
        };
        if (r.followup_scheduled_at) base.scheduled_at = r.followup_scheduled_at;
        if (includeExecuted && r.executed_at) base.executed_at = r.executed_at;
        try {
          const data = JSON.parse(r.action_data as string);
          const parsed: Record<string, unknown> = {};
          if (data.to) parsed.to = data.to;
          if (data.subject) parsed.subject = data.subject;
          if (data.chainIndex !== undefined) parsed.chainIndex = data.chainIndex;
          if (data.chain) parsed.chain = data.chain;
          if (data.title) parsed.title = data.title;
          if (data.date) parsed.date = data.date;
          base.data = parsed;
        } catch {
          base.data = {};
        }
        return base;
      };

      const active = (activeRows.results ?? []).map((r) => parseRow(r as Record<string, unknown>, false));
      const recent = (recentRows.results ?? []).map((r) => parseRow(r as Record<string, unknown>, true));

      const capabilities = [
        { icon: "\u{1F4E7}", name: "Enviar emails", description: "\"Envíale un email a pedro@... con una propuesta\"", status: "active" },
        { icon: "\u{1F4C5}", name: "Agendar reuniones", description: "\"Agéndame una reunión con Pedro el jueves a las 3\"", status: "active" },
        { icon: "\u{1F504}", name: "Follow-ups automáticos", description: "\"Dale seguimiento a pedro@... en 3 días\"", status: "active" },
        { icon: "\u{1F399}\uFE0F", name: "Notas de voz", description: "Envía un audio y Ailyn lo transcribe y ejecuta", status: "active" },
        { icon: "\u{1F4EC}", name: "Resumen de emails", description: "\"Qué emails importantes tengo?\"", status: "active" },
        { icon: "\u{1F4CA}", name: "CRM conversacional", description: "\"Qué pasó con Pedro?\"", status: "active" },
        { icon: "\u{1F50D}", name: "Búsqueda web", description: "\"Busca información sobre SmartPasses\"", status: "active" },
        { icon: "\u{1F4C5}", name: "Leer calendario", description: "\"Qué tengo hoy en mi calendario?\"", status: "active" },
      ];

      return corsResponse(JSON.stringify({ active, recent, capabilities }), 200, undefined, request);
    } catch (err) {
      console.error("Activity center error:", err);
      return corsResponse(JSON.stringify({ error: "Error al obtener actividad" }), 500, undefined, request);
    }
  }

  // POST /api/activity/:id/cancel — cancelar acción pendiente
  if (request.method === "POST" && pathname.match(/^\/api\/activity\/\d+\/cancel$/)) {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    const actionId = parseInt(pathname.split("/")[3], 10);
    try {
      await env.DB.prepare(
        `UPDATE pending_actions SET status = 'cancelled', decided_at = datetime('now') WHERE id = ? AND company_id = ? AND status IN ('pending', 'scheduled')`
      ).bind(actionId, String(user.company_id)).run();
      return corsResponse(JSON.stringify({ ok: true }), 200, undefined, request);
    } catch (err) {
      console.error("Cancel action error:", err);
      return corsResponse(JSON.stringify({ error: "Error al cancelar acción" }), 500, undefined, request);
    }
  }

  // ── Public API — Key Management ──────────────────────────────────────────

  // POST /api/keys/create — generate new API key
  if (request.method === "POST" && pathname === "/api/keys/create") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    const body = await request.json() as { name?: string };
    const keyName = body.name?.trim() || "Default";

    // Generate API key: ak_ + 48 random chars
    const rawKey = "ak_" + Array.from(crypto.getRandomValues(new Uint8Array(36)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    const prefix = rawKey.slice(0, 10); // ak_XXXXXX for display

    // Hash for storage
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawKey));
    const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

    await env.DB.prepare(
      `INSERT INTO api_keys (company_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?)`
    ).bind(user.company_id, keyHash, prefix, keyName).run();

    // Return the FULL key only once — after this it can never be retrieved
    return corsResponse(JSON.stringify({
      key: rawKey,
      prefix,
      name: keyName,
      warning: "Save this key. It cannot be retrieved again.",
    }), 200, undefined, request);
  }

  // GET /api/keys — list API keys (masked)
  if (request.method === "GET" && pathname === "/api/keys") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    const keys = await env.DB.prepare(
      `SELECT id, key_prefix, name, permissions, rate_limit, is_active, last_used_at, created_at FROM api_keys WHERE company_id = ?`
    ).bind(user.company_id).all();

    return corsResponse(JSON.stringify({ keys: keys.results ?? [] }), 200, undefined, request);
  }

  // DELETE /api/keys/:id — revoke API key
  if (request.method === "DELETE" && pathname.match(/^\/api\/keys\/\d+$/)) {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);
    const keyId = parseInt(pathname.split("/")[3], 10);
    await env.DB.prepare(`UPDATE api_keys SET is_active = 0 WHERE id = ? AND company_id = ?`).bind(keyId, user.company_id).run();
    return corsResponse(JSON.stringify({ ok: true }), 200, undefined, request);
  }

  // ── Public API — REST Endpoints ──────────────────────────────────────────

  // POST /v1/chat — send message, get response
  if (request.method === "POST" && pathname === "/v1/chat") {
    const auth = await authenticateApiKey(request, env);
    if (!auth) return corsResponse(JSON.stringify({ error: "Invalid API key or rate limited" }), 401);
    if (!auth.permissions.chat) return corsResponse(JSON.stringify({ error: "Chat permission not granted" }), 403);

    const body = await request.json() as { message: string; session_id?: string };
    if (!body.message?.trim()) return corsResponse(JSON.stringify({ error: "message required" }), 400);

    const sessionId = body.session_id ?? `api-${auth.companyId}-${Date.now()}`;
    const company = await env.DB.prepare(`SELECT name, industry FROM companies WHERE id = ?`).bind(auth.companyId).first<{ name: string; industry: string | null }>();

    const history = await loadHistory(env, sessionId, 10, auth.companyId);
    const integrations = await loadIntegrations(env, auth.companyId);
    const googleToken = integrations.googleToken ? await getValidGoogleToken(env, auth.companyId) : null;

    const result = await orchestrate({
      message: body.message.trim(),
      companyId: auth.companyId,
      companyName: company?.name ?? "API",
      industry: company?.industry ?? undefined,
      sessionId,
      channel: "api",
      history,
      googleToken,
      githubToken: integrations.githubToken,
      connectedProviders: integrations.connectedProviders,
    }, env);

    // Trigger webhooks
    await triggerWebhooks(env, auth.companyId, "chat.completed", {
      message: body.message, reply: result.text, model: result.model_used, session_id: sessionId,
    });

    return corsResponse(JSON.stringify({
      reply: result.text,
      session_id: sessionId,
      model: result.model_used,
      complexity: result.complexity,
      tools_used: result.tools_used,
      emailDraft: result.emailDraft ?? null,
      calendarDraft: result.calendarDraft ?? null,
      followupDraft: result.followupDraft ?? null,
    }));
  }

  // GET /v1/inbox — get organized inbox
  if (request.method === "GET" && pathname === "/v1/inbox") {
    const auth = await authenticateApiKey(request, env);
    if (!auth) return corsResponse(JSON.stringify({ error: "Invalid API key" }), 401);

    const inbox = await env.DB.prepare(
      `SELECT from_name, from_address, subject, snippet, category, priority, action_suggested, created_at
       FROM email_inbox WHERE company_id = ? ORDER BY priority ASC, created_at DESC LIMIT 20`
    ).bind(auth.companyId).all();

    return corsResponse(JSON.stringify({ emails: inbox.results ?? [] }));
  }

  // GET /v1/crm/:name — CRM lookup
  if (request.method === "GET" && pathname.match(/^\/v1\/crm\/.+$/)) {
    const auth = await authenticateApiKey(request, env);
    if (!auth) return corsResponse(JSON.stringify({ error: "Invalid API key" }), 401);
    if (!auth.permissions.crm) return corsResponse(JSON.stringify({ error: "CRM permission not granted" }), 403);

    const contactName = decodeURIComponent(pathname.split("/")[3]);
    const searchTerm = `%${contactName}%`;

    const [emails, meetings, followups, leads] = await Promise.all([
      env.DB.prepare(`SELECT action_data, status, created_at FROM pending_actions WHERE company_id = ? AND action_type = 'send_email' AND action_data LIKE ? ORDER BY created_at DESC LIMIT 5`).bind(String(auth.companyId), searchTerm).all(),
      env.DB.prepare(`SELECT action_data, status, created_at FROM pending_actions WHERE company_id = ? AND action_type = 'schedule_meeting' AND action_data LIKE ? ORDER BY created_at DESC LIMIT 5`).bind(String(auth.companyId), searchTerm).all(),
      env.DB.prepare(`SELECT action_data, status, followup_scheduled_at FROM pending_actions WHERE company_id = ? AND action_type = 'send_followup' AND action_data LIKE ? ORDER BY created_at DESC LIMIT 5`).bind(String(auth.companyId), searchTerm).all(),
      env.DB.prepare(`SELECT contact_name, contact_email, contact_company, lead_score, urgency, status, created_at FROM leads WHERE company_id = ? AND (contact_name LIKE ? OR contact_company LIKE ?) ORDER BY created_at DESC LIMIT 3`).bind(auth.companyId, searchTerm, searchTerm).all(),
    ]);

    return corsResponse(JSON.stringify({ contact: contactName, emails: emails.results, meetings: meetings.results, followups: followups.results, leads: leads.results }));
  }

  // GET /v1/activity — recent activity
  if (request.method === "GET" && pathname === "/v1/activity") {
    const auth = await authenticateApiKey(request, env);
    if (!auth) return corsResponse(JSON.stringify({ error: "Invalid API key" }), 401);

    const actions = await env.DB.prepare(
      `SELECT id, action_type, action_data, status, created_at, executed_at FROM pending_actions WHERE company_id = ? ORDER BY created_at DESC LIMIT 20`
    ).bind(String(auth.companyId)).all();

    return corsResponse(JSON.stringify({ actions: actions.results ?? [] }));
  }

  // POST /v1/actions/:id/execute — execute a pending action via API
  if (request.method === "POST" && pathname.match(/^\/v1\/actions\/\d+\/execute$/)) {
    const auth = await authenticateApiKey(request, env);
    if (!auth) return corsResponse(JSON.stringify({ error: "Invalid API key" }), 401);

    const actionId = parseInt(pathname.split("/")[3], 10);
    const body = await request.json() as { action: "approve" | "reject" };
    // For reject, mark as rejected
    if (body.action === "reject") {
      await env.DB.prepare(`UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE id = ? AND company_id = ?`).bind(actionId, String(auth.companyId)).run();
      return corsResponse(JSON.stringify({ ok: true, message: "Rejected" }));
    }
    // For approve, mark as scheduled - the existing cron will handle execution
    await env.DB.prepare(`UPDATE pending_actions SET status = 'scheduled', decided_at = datetime('now') WHERE id = ? AND company_id = ?`).bind(actionId, String(auth.companyId)).run();
    return corsResponse(JSON.stringify({ ok: true, message: "Approved" }));
  }

  // ── Webhook Management ──────────────────────────────────────────────────

  // POST /api/webhooks/create — register webhook endpoint
  if (request.method === "POST" && pathname === "/api/webhooks/create") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    const body = await request.json() as { url: string; events?: string[] };
    if (!body.url?.startsWith("https://")) return corsResponse(JSON.stringify({ error: "URL must be HTTPS" }), 400, undefined, request);

    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
    const events = JSON.stringify(body.events ?? ["all"]);

    const result = await env.DB.prepare(
      `INSERT INTO webhook_endpoints (company_id, url, events, secret) VALUES (?, ?, ?, ?)`
    ).bind(user.company_id, body.url, events, secret).run();

    return corsResponse(JSON.stringify({ id: result.meta.last_row_id, secret, events: body.events ?? ["all"] }), 200, undefined, request);
  }

  // GET /api/webhooks/list — list webhooks
  if (request.method === "GET" && pathname === "/api/webhooks/list") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    const webhooks = await env.DB.prepare(
      `SELECT id, url, events, is_active, last_triggered_at, created_at FROM webhook_endpoints WHERE company_id = ?`
    ).bind(user.company_id).all();

    return corsResponse(JSON.stringify({ webhooks: webhooks.results ?? [] }), 200, undefined, request);
  }

  // DELETE /api/webhooks/:id — delete webhook
  if (request.method === "DELETE" && pathname.match(/^\/api\/webhooks\/\d+$/)) {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);
    const whId = parseInt(pathname.split("/")[3], 10);
    await env.DB.prepare(`DELETE FROM webhook_endpoints WHERE id = ? AND company_id = ?`).bind(whId, user.company_id).run();
    return corsResponse(JSON.stringify({ ok: true }), 200, undefined, request);
  }

  // ── Dashboard Summary API ─────────────────────────────────────────────
  if (request.method === "GET" && pathname === "/api/dashboard/summary") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    try {
      const companyId = user.company_id;
      const currentPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM

      const [planRow, usageRow, statsRow, leadsCountRow, recentRows, integrationsRows, telegramRow, whatsappRow] = await Promise.all([
        // 1. Plan info
        env.DB.prepare(
          `SELECT p.slug, p.name, p.chat_messages_limit, p.leads_limit, p.work_plans_limit
           FROM plans p JOIN companies c ON c.plan_slug = p.slug WHERE c.id = ?`
        ).bind(companyId).first<{ slug: string; name: string; chat_messages_limit: number; leads_limit: number; work_plans_limit: number }>(),

        // 2. Usage this month
        env.DB.prepare(
          `SELECT chat_messages_used, leads_used, work_plan_runs_used
           FROM usage_tracking WHERE company_id = ? AND period = ?`
        ).bind(companyId, currentPeriod).first<{ chat_messages_used: number; leads_used: number; work_plan_runs_used: number }>(),

        // 3. Stats from pending_actions
        env.DB.prepare(
          `SELECT
            SUM(CASE WHEN action_type='send_email' AND status='executed' THEN 1 ELSE 0 END) as emails_sent,
            SUM(CASE WHEN action_type='send_followup' AND status IN ('scheduled','executed') THEN 1 ELSE 0 END) as followups_scheduled,
            SUM(CASE WHEN action_type='schedule_meeting' AND status='executed' THEN 1 ELSE 0 END) as meetings_scheduled
           FROM pending_actions WHERE company_id = ?`
        ).bind(String(companyId)).first<{ emails_sent: number; followups_scheduled: number; meetings_scheduled: number }>(),

        // 4. Total leads
        env.DB.prepare(`SELECT COUNT(*) as total FROM leads WHERE company_id = ?`)
          .bind(companyId).first<{ total: number }>(),

        // 5. Recent activity
        env.DB.prepare(
          `SELECT action_type, action_data, status, created_at
           FROM pending_actions WHERE company_id = ? ORDER BY created_at DESC LIMIT 10`
        ).bind(String(companyId)).all<{ action_type: string; action_data: string | null; status: string; created_at: string }>(),

        // 6. Integrations
        env.DB.prepare(
          `SELECT provider, is_active FROM integrations WHERE company_id = ? AND is_active = 1`
        ).bind(companyId).all<{ provider: string; is_active: number }>(),

        // 7. Telegram config
        env.DB.prepare(
          `SELECT id FROM telegram_configs WHERE company_id = ? AND is_active = 1 LIMIT 1`
        ).bind(companyId).first<{ id: number }>(),

        // 8. WhatsApp config
        env.DB.prepare(
          `SELECT id FROM whatsapp_configs WHERE company_id = ? AND is_active = 1 LIMIT 1`
        ).bind(companyId).first<{ id: number }>(),
      ]);

      const plan = planRow
        ? { slug: planRow.slug, name: planRow.name, chat_limit: planRow.chat_messages_limit, leads_limit: planRow.leads_limit }
        : { slug: "free", name: "Free", chat_limit: 50, leads_limit: 10 };

      const usage = {
        chat_messages: usageRow?.chat_messages_used ?? 0,
        leads: usageRow?.leads_used ?? 0,
        work_plan_runs: usageRow?.work_plan_runs_used ?? 0,
      };

      const stats = {
        emails_sent: statsRow?.emails_sent ?? 0,
        followups_scheduled: statsRow?.followups_scheduled ?? 0,
        meetings_scheduled: statsRow?.meetings_scheduled ?? 0,
        total_leads: leadsCountRow?.total ?? 0,
      };

      const recentActivity = (recentRows.results ?? []).map((r) => {
        let description = r.action_type;
        if (r.action_data) {
          try {
            const data = JSON.parse(r.action_data) as Record<string, unknown>;
            description = (data.description as string) || (data.summary as string) || r.action_type;
          } catch { /* use action_type as fallback */ }
        }
        return { type: r.action_type, description, status: r.status, created_at: r.created_at };
      });

      const activeProviders = new Set((integrationsRows.results ?? []).map((r) => r.provider));
      const integrations = {
        telegram: !!telegramRow,
        whatsapp: !!whatsappRow,
        google: activeProviders.has("google"),
        github: activeProviders.has("github"),
      };

      return corsResponse(JSON.stringify({ plan, usage, stats, recent_activity: recentActivity, integrations }), 200, undefined, request);
    } catch (err) {
      console.error("Dashboard summary error:", err);
      return corsResponse(JSON.stringify({ error: "Error al obtener resumen del dashboard" }), 500, undefined, request);
    }
  }

  // GET /api/conversations — listar sesiones de chat agrupadas
  if (request.method === "GET" && pathname === "/api/conversations") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    const channel = new URL(request.url).searchParams.get("channel");
    const query = channel
      ? `SELECT session_id, channel, MIN(created_at) as first_msg, MAX(created_at) as last_msg, COUNT(*) as msg_count
         FROM conversation_history WHERE company_id = ? AND channel = ? GROUP BY session_id ORDER BY last_msg DESC LIMIT 50`
      : `SELECT session_id, channel, MIN(created_at) as first_msg, MAX(created_at) as last_msg, COUNT(*) as msg_count
         FROM conversation_history WHERE company_id = ? GROUP BY session_id ORDER BY last_msg DESC LIMIT 50`;

    const params = channel ? [user.company_id, channel] : [user.company_id];
    const rows = await env.DB.prepare(query).bind(...params).all();
    return corsResponse(JSON.stringify({ sessions: rows.results ?? [] }), 200, undefined, request);
  }

  // GET /api/conversations/:sessionId — mensajes de una sesion
  const convMatch = pathname.match(/^\/api\/conversations\/(.+)$/);
  if (request.method === "GET" && convMatch) {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    const sessionId = decodeURIComponent(convMatch[1]);
    const rows = await env.DB.prepare(
      `SELECT role, content, model_used, tools_used, complexity, created_at
       FROM conversation_history WHERE company_id = ? AND session_id = ? ORDER BY created_at ASC LIMIT 200`
    ).bind(user.company_id, sessionId).all();
    return corsResponse(JSON.stringify({ messages: rows.results ?? [] }), 200, undefined, request);
  }

  // POST /api/billing/checkout — crear sesion de pago
  if (request.method === "POST" && pathname === "/api/billing/checkout") {
    const user = await authenticateUser(request, env);
    if (!user) return corsResponse(JSON.stringify({ error: "No autorizado" }), 401, undefined, request);

    let body: { plan?: string };
    try { body = await request.json(); } catch { return corsResponse(JSON.stringify({ error: "Invalid JSON" }), 400, undefined, request); }

    const validPlans = new Set(["starter", "pro", "enterprise"]);
    if (!body.plan || !validPlans.has(body.plan)) {
      return corsResponse(JSON.stringify({ error: "Plan inválido" }), 400, undefined, request);
    }

    try {
      const result = await createCheckout(env, user.company_id, body.plan, "https://ailyn-dashboard.pages.dev/billing?success=true");
      return corsResponse(JSON.stringify({ url: result.url, id: result.id }), 200, undefined, request);
    } catch (err) {
      console.error("[billing] checkout error:", String(err));
      return corsResponse(JSON.stringify({ error: "Error al crear checkout. Verifica la configuración de Polar." }), 500, undefined, request);
    }
  }

  // ── Polar Webhook ────────────────────────────────────────────────────────
  // POST /api/webhooks/polar — Polar payment webhook
  if (request.method === "POST" && pathname === "/api/webhooks/polar") {
    const body = await request.text();

    // Validate signature
    const webhookId = request.headers.get("webhook-id") ?? "";
    const webhookTimestamp = request.headers.get("webhook-timestamp") ?? "";
    const webhookSignature = request.headers.get("webhook-signature") ?? "";

    if (!env.POLAR_WEBHOOK_SECRET) {
      console.error("[polar] POLAR_WEBHOOK_SECRET not configured");
      return new Response("Server error", { status: 500 });
    }

    // Verify signature
    const signedContent = `${webhookId}.${webhookTimestamp}.${body}`;
    const secretBytes = Uint8Array.from(atob(env.POLAR_WEBHOOK_SECRET.replace("whsec_", "")), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
    const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sig)));

    // Polar sends multiple signatures separated by space, each prefixed with "v1,"
    const signatures = webhookSignature.split(" ").map(s => s.replace("v1,", ""));
    const valid = signatures.some(s => s === expectedSig);

    if (!valid) {
      console.error("[polar] Invalid webhook signature");
      return new Response("Invalid signature", { status: 403 });
    }

    let event: { type: string; data: Record<string, unknown> };
    try {
      event = JSON.parse(body) as { type: string; data: Record<string, unknown> };
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    try {
      const data = event.data;
      const metadata = (data.metadata ?? {}) as Record<string, string>;
      const companyId = metadata.company_id ? parseInt(metadata.company_id, 10) : null;
      const planSlug = metadata.plan_slug ?? null;

      // Log the event
      await env.DB.prepare(
        `INSERT INTO billing_events (company_id, event_type, polar_subscription_id, polar_customer_id, plan_slug, amount_cents, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        companyId,
        event.type,
        (data.id as string) ?? null,
        (data.customer_id as string) ?? null,
        planSlug,
        (data.amount as number) ?? null,
        body.slice(0, 5000)
      ).run();

      switch (event.type) {
        case "subscription.active": {
          if (!companyId || !planSlug) {
            console.error("[polar] subscription.active missing company_id or plan_slug in metadata");
            break;
          }
          await env.DB.prepare(`UPDATE companies SET plan_slug = ? WHERE id = ?`).bind(planSlug, companyId).run();
          console.log(`[polar] Company ${companyId} upgraded to ${planSlug}`);
          break;
        }

        case "subscription.canceled":
        case "subscription.revoked": {
          if (!companyId) break;
          await env.DB.prepare(`UPDATE companies SET plan_slug = 'free' WHERE id = ?`).bind(companyId).run();
          console.log(`[polar] Company ${companyId} downgraded to free`);
          break;
        }

        default:
          console.log(`[polar] Unhandled event: ${event.type}`);
      }
    } catch (err) {
      console.error("[polar] Webhook processing error:", String(err));
      return new Response("Processing error", { status: 500 });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  // ── Desktop Tasks API ────────────────────────────────────────────────────
  if (pathname.startsWith("/api/desktop/tasks")) {
    return handleDesktopTasks(request, env, pathname);
  }

  return new Response("Not Found", { status: 404 });
}

// ── Parser del output de razonamiento ────────────────────────────────────

function parseReasoningField(result: string, field: string): string {
  const match = result.match(new RegExp(`${field}:\\s*(.+)`));
  return match?.[1]?.trim() ?? "";
}

// ── Follow-ups automáticos ────────────────────────────────────────────────

async function executeDueFollowups(env: Env): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  // Buscar follow-ups aprobados (scheduled) cuya fecha ya pasó
  const dueFollowups = await env.DB.prepare(
    `SELECT id, action_data, telegram_chat_id FROM pending_actions
     WHERE action_type = 'send_followup' AND status = 'scheduled'
     AND followup_scheduled_at <= ?
     LIMIT 10`
  ).bind(today).all<{ id: number; action_data: string; telegram_chat_id: number | null }>();

  if (!dueFollowups.results?.length) return;

  for (const fu of dueFollowups.results) {
    try {
      const data = JSON.parse(fu.action_data) as {
        to: string; subject: string; context: string;
        companyId: number; companyName: string;
        chain?: number[]; chainIndex?: number; chain_stopped?: boolean;
      };

      // Check if the chain was manually stopped
      if (data.chain_stopped) {
        await env.DB.prepare(
          `UPDATE pending_actions SET status = 'rejected', execution_result = 'chain_stopped_by_user' WHERE id = ?`
        ).bind(fu.id).run();
        console.log(`[followup] Chain stopped by user for #${fu.id}`);
        continue;
      }

      const chain = data.chain ?? [data.days ?? 3];
      const chainIndex = data.chainIndex ?? 0;
      const chainTotal = chain.length;
      const followupNumber = chainIndex + 1;

      // Generar el email de follow-up con LLM
      const followupResult = await runLLM(
        env,
        "email_draft",
        `Eres Ailyn, asistente de ${data.companyName}. Redacta un email breve de follow-up profesional.`,
        `Escribe el follow-up #${followupNumber} de ${chainTotal} para ${data.to}. Contexto original: ${data.context}. Asunto: Re: ${data.subject}. ${followupNumber === 1 ? "Sé breve (3-4 párrafos), amable pero directo." : followupNumber === 2 ? "Este es un segundo seguimiento. Sé más conciso, recuerda el contexto original brevemente." : "Este es el último seguimiento. Sé breve y directo, menciona que es el último contacto al respecto."} Firma: Equipo de ${data.companyName}`,
        data.companyId
      );

      if (!env.RESEND_API_KEY) {
        console.error("[followup] No RESEND_API_KEY");
        continue;
      }

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: `${data.companyName} <ailyn@novacode.pro>`,
          to: [data.to],
          subject: `Re: ${data.subject}`,
          text: followupResult.text,
        }),
      });

      if (resendRes.ok) {
        await env.DB.prepare(
          `UPDATE pending_actions SET status = 'executed', executed_at = datetime('now'), execution_result = 'sent' WHERE id = ?`
        ).bind(fu.id).run();

        // Schedule the NEXT follow-up in the chain if there is one
        const hasNextInChain = chainIndex < chainTotal - 1;
        let nextInfo = "";

        if (hasNextInChain) {
          const nextChainIndex = chainIndex + 1;
          const nextDays = chain[nextChainIndex];
          const nextDate = new Date();
          nextDate.setDate(nextDate.getDate() + nextDays);
          const nextScheduledStr = nextDate.toISOString().split("T")[0];

          const nextActionData = JSON.stringify({
            ...data,
            chainIndex: nextChainIndex,
          });

          await env.DB.prepare(
            `INSERT INTO pending_actions (company_id, action_type, action_data, status, telegram_chat_id, followup_number, followup_scheduled_at)
             VALUES (?, 'send_followup', ?, 'scheduled', ?, ?, ?)`
          ).bind(
            String(data.companyId),
            nextActionData,
            fu.telegram_chat_id,
            nextChainIndex + 1,
            nextScheduledStr
          ).run();

          nextInfo = `\n\n⏭️ Próximo follow-up (${nextChainIndex + 1}/${chainTotal}): ${nextScheduledStr}`;
        }

        // Notificar por Telegram si tenemos el chat_id
        if (fu.telegram_chat_id) {
          const tgConfig = await env.DB.prepare(
            `SELECT tc.bot_token FROM telegram_configs tc
             JOIN companies c ON c.id = tc.company_id
             WHERE c.id = ? AND tc.is_active = 1`
          ).bind(data.companyId).first<{ bot_token: string }>();

          if (tgConfig) {
            const stopHint = hasNextInChain ? `\n\n<i>Responde "detener seguimiento a ${data.to}" para cancelar la cadena.</i>` : "";
            await fetch(`https://api.telegram.org/bot${tgConfig.bot_token}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: fu.telegram_chat_id,
                text: `🔄 <b>Follow-up ${followupNumber}/${chainTotal} enviado</b>\n\n<b>Para:</b> ${data.to}\n<b>Asunto:</b> Re: ${data.subject}\n\n${followupResult.text.slice(0, 300)}...${nextInfo}${stopHint}`,
                parse_mode: "HTML",
              }),
            });
          }
        }

        console.log(`[followup] Sent follow-up ${followupNumber}/${chainTotal} #${fu.id} to ${data.to}`);
      } else {
        const err = await resendRes.text();
        await env.DB.prepare(
          `UPDATE pending_actions SET status = 'failed', execution_result = ? WHERE id = ?`
        ).bind(err, fu.id).run();
        console.error(`[followup] Resend error for #${fu.id}:`, err);
      }
    } catch (e) {
      console.error(`[followup] Error processing #${fu.id}:`, String(e));
      await env.DB.prepare(
        `UPDATE pending_actions SET status = 'failed', execution_result = ? WHERE id = ?`
      ).bind(String(e), fu.id).run();
    }
  }
}

// ── Scheduled handler (modo proactivo) ────────────────────────────────────

// ── Análisis proactivo silencioso — guarda sugerencias, NO envía mensajes ──

async function proactiveAnalysis(env: Env): Promise<void> {
  const companies = await env.DB.prepare(`SELECT id FROM companies`).all<{ id: number }>();
  if (!companies.results?.length) return;

  for (const company of companies.results) {
    try {
      const cid = company.id;
      const cidStr = String(cid);
      const suggestions: { type: string; text: string; action?: string }[] = [];

      // ── 1. Emails sin responder hace 3+ días ──────────────────────────
      const oldEmails = await env.DB.prepare(`
        SELECT action_data FROM pending_actions
        WHERE company_id = ? AND action_type = 'send_email' AND status = 'executed'
        AND executed_at <= datetime('now', '-3 days') AND executed_at >= datetime('now', '-14 days')
        ORDER BY executed_at DESC LIMIT 5
      `).bind(cidStr).all<{ action_data: string }>();

      for (const row of (oldEmails.results ?? [])) {
        try {
          const data = JSON.parse(row.action_data) as { to?: string; subject?: string };
          if (!data.to) continue;
          const hasFollowup = await env.DB.prepare(
            `SELECT id FROM pending_actions WHERE company_id = ? AND action_type = 'send_followup' AND status IN ('scheduled','pending') AND action_data LIKE ? LIMIT 1`
          ).bind(cidStr, `%${data.to}%`).first();
          if (!hasFollowup) {
            suggestions.push({
              type: "followup",
              text: `Email a ${data.to} (${data.subject ?? "sin asunto"}) hace 3+ días sin follow-up`,
              action: `Dale seguimiento a ${data.to} sobre ${data.subject ?? "el email anterior"}`,
            });
          }
        } catch { /* skip */ }
      }

      // ── 2. Reuniones pasadas sin seguimiento ──────────────────────────
      const pastMeetings = await env.DB.prepare(`
        SELECT action_data FROM pending_actions
        WHERE company_id = ? AND action_type = 'schedule_meeting' AND status = 'executed'
        AND executed_at <= datetime('now', '-2 days') AND executed_at >= datetime('now', '-7 days')
        ORDER BY executed_at DESC LIMIT 3
      `).bind(cidStr).all<{ action_data: string }>();

      for (const row of (pastMeetings.results ?? [])) {
        try {
          const data = JSON.parse(row.action_data) as { title?: string; attendees?: string[] };
          const attendee = (data.attendees ?? [])[0];
          if (!attendee) continue;
          const hasFollowup = await env.DB.prepare(
            `SELECT id FROM pending_actions WHERE company_id = ? AND action_type IN ('send_email','send_followup') AND created_at >= datetime('now', '-2 days') AND action_data LIKE ? LIMIT 1`
          ).bind(cidStr, `%${attendee}%`).first();
          if (!hasFollowup) {
            suggestions.push({
              type: "meeting_followup",
              text: `Reunión "${data.title ?? "sin título"}" pasó hace días sin seguimiento`,
              action: `Envíale un email de seguimiento a ${attendee} sobre ${data.title ?? "la reunión"}`,
            });
          }
        } catch { /* skip */ }
      }

      // ── 3. Acciones pendientes olvidadas (más de 24h) ─────────────────
      const oldPending = await env.DB.prepare(`
        SELECT COUNT(*) as c FROM pending_actions
        WHERE company_id = ? AND status = 'pending' AND created_at <= datetime('now', '-24 hours')
      `).bind(cidStr).first<{ c: number }>();
      if ((oldPending?.c ?? 0) > 0) {
        suggestions.push({
          type: "pending",
          text: `${oldPending!.c} acción(es) pendiente(s) de aprobación desde hace 24h+`,
        });
      }

      // ── Guardar sugerencias en KV (sobrescribe las anteriores) ────────
      if (suggestions.length > 0) {
        await env.KV.put(
          `suggestions:${cid}`,
          JSON.stringify(suggestions),
          { expirationTtl: 86400 } // 24h
        );
      }
    } catch (err) {
      console.error(`[proactive] Company ${company.id} error:`, String(err));
    }
  }
}

async function handleScheduled(env: Env): Promise<void> {
  // Kill Switch: si el agente está pausado, saltar el ciclo
  const systemStatus = await env.KV.get("SYSTEM_STATUS");
  if (systemStatus === "paused") {
    console.log("Agente pausado, saltando ciclo");
    return;
  }

  // ── Follow-ups automáticos — enviar follow-ups programados que ya vencieron ──
  try {
    await executeDueFollowups(env);
  } catch (fuErr) {
    console.error("[cron] Follow-ups error:", String(fuErr));
  }

  // ── Work Plans — evaluar y ejecutar planes que correspondan ──────────────
  try {
    await runDueWorkPlans(env);
  } catch (wpErr) {
    console.error("[cron] Work Plans error:", String(wpErr));
  }

  // ── Email monitoring multi-tenant (cada 15 min) ────────────────────────
  try {
    await monitorEmailsMultiTenant(env);
  } catch (emailErr) {
    console.error("[cron] Email monitoring error:", String(emailErr));
  }

  // ── Análisis proactivo silencioso (cada hora — guarda sugerencias, NO envía mensajes) ──
  const nowMin = new Date().getMinutes();
  if (nowMin < 15) {
    try {
      await proactiveAnalysis(env);
    } catch (alertErr) {
      console.error("[cron] Proactive analysis error:", String(alertErr));
    }
  }

  // ── Recordatorio de leads sin atender (~1/hora: cuando los minutos son 0) ─
  // El cron corre cada 15 min; revisamos cada ~4 ciclos usando timestamp
  try {
    const now = new Date();
    if (now.getMinutes() < 15) { // Primera ventana de cada hora
      const unattended = await getUnattendedLeads(env, "ailyn-labs");
      if (unattended.length > 0 && env.TELEGRAM_CHAT_ID) {
        const lines = unattended.map((l) =>
          `• ${l.contact_name} de ${l.contact_company ?? "—"} (Score: ${l.lead_score}, ${l.urgency})`
        );
        await sendMessage(
          env,
          Number(env.TELEGRAM_CHAT_ID),
          `⚠️ <b>${unattended.length} lead(s) sin atender hace 24h+:</b>\n\n${lines.join("\n")}`
        );
        for (const l of unattended) {
          await markLeadNotified(env, l.id);
        }
      }
    }
  } catch {
    // Recordatorio de leads no debe bloquear el cron
  }

  // ── Follow-ups automáticos programados ───────────────────────────────
  try {
    const now = new Date().toISOString();
    interface ScheduledFollowup {
      id: number;
      company_id: string;
      lead_id: string | null;
      telegram_chat_id: string | null;
      followup_number: number;
      contact_name: string | null;
      contact_email: string | null;
      contact_company: string | null;
      contact_message: string | null;
      recommended_unit: string | null;
      brief_summary: string | null;
    }
    const followupsResult = await env.DB.prepare(`
      SELECT pa.id, pa.company_id, pa.lead_id, pa.telegram_chat_id, pa.followup_number,
             l.contact_name, l.contact_email, l.contact_company, l.contact_message,
             l.recommended_unit, l.brief_summary
      FROM pending_actions pa
      LEFT JOIN leads l ON pa.lead_id = l.id
      WHERE pa.status = 'scheduled' AND pa.followup_scheduled_at <= ? AND pa.followup_number <= 3
      LIMIT 5
    `).bind(now).all();

    for (const followup of (followupsResult.results ?? []) as unknown as ScheduledFollowup[]) {
      if (!followup.telegram_chat_id || !followup.lead_id) continue;

      const followupNum = followup.followup_number ?? 1;
      const tone =
        followupNum === 1 ? "Quería dar seguimiento a mi email anterior..." :
        followupNum === 2 ? "Entiendo que estás ocupado, solo quería..." :
        "Último mensaje sobre esto. Si no es buen momento, sin problema...";

      const followupPrompt =
        `Redacta un email de follow-up #${followupNum} B2B en español.\n\n` +
        `CONTEXTO:\n` +
        `- Empresa: ${followup.contact_company ?? "Desconocida"}\n` +
        `- Contacto: ${followup.contact_name ?? "—"}\n` +
        `- Necesidad original: ${followup.contact_message ?? "consulta general"}\n` +
        `- Servicio recomendado: ${followup.recommended_unit ?? "—"}\n` +
        `- Ya enviamos ${followupNum - 1} email(s) previo(s) sin respuesta\n\n` +
        `TONO: "${tone}"\n` +
        `REGLAS:\n` +
        `- Máximo 100 palabras\n` +
        `- Solo el body HTML con etiquetas <p>. Sin asunto, sin firma.`;

      const emailDraft = await runLLM(env, "email_draft", "Eres un experto en comunicación comercial B2B. Genera SOLO el body HTML con etiquetas <p>. Sin asunto, sin firma.", followupPrompt, followup.company_id);
      const subject =
        followupNum === 3
          ? `Último seguimiento: ${followup.recommended_unit ?? "propuesta"}`
          : `Seguimiento: ${followup.recommended_unit ?? "propuesta"} para ${followup.contact_company ?? "su empresa"}`;

      // Actualizar la acción con los datos del email y cambiar a pending
      await env.DB.prepare(`
        UPDATE pending_actions SET status = 'pending', action_data = ?
        WHERE id = ?
      `).bind(JSON.stringify({
        to: followup.contact_email ?? "",
        subject,
        body: emailDraft.text,
        from_name: "Ailyn — AI · Link Your Network",
        from_email: "ailyn@novacode.pro"
      }), followup.id).run();

      // Enviar a Telegram para aprobación
      const bodyPreview = emailDraft.text.replace(/<[^>]*>/g, "").trim().substring(0, 300);
      const messageText =
        `📧 *Follow-up #${followupNum} — ${followup.contact_company ?? followup.contact_name}*\n\n` +
        `*Para:* ${followup.contact_email ?? "—"}\n` +
        `*Asunto:* ${subject}\n\n` +
        `*Email:*\n${bodyPreview}${bodyPreview.length >= 300 ? "..." : ""}\n\n` +
        `Han pasado 48h sin respuesta. ¿Envío este follow-up?`;

      const inlineKeyboard = {
        inline_keyboard: [[
          { text: "✅ Enviar follow-up", callback_data: `action_approve_${followup.id}` },
          { text: "❌ No enviar", callback_data: `action_reject_${followup.id}` },
          { text: "🔒 Cerrar lead", callback_data: `action_close_${followup.id}` },
        ]],
      };

      const tgResp = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: followup.telegram_chat_id,
            text: messageText,
            parse_mode: "Markdown",
            reply_markup: inlineKeyboard,
          }),
        }
      );
      if (tgResp.ok) {
        const tgData = await tgResp.json() as { result?: { message_id?: number } };
        const msgId = tgData.result?.message_id;
        if (msgId) {
          await env.DB.prepare(
            "UPDATE pending_actions SET telegram_message_id = ? WHERE id = ?"
          ).bind(msgId, followup.id).run();
        }
      }
    }
  } catch (followupErr) {
    console.error("[cron] follow-up processing failed:", followupErr);
  }

  const task = await getNextPendingTask(env);
  if (!task) return; // No hay tareas pendientes

  // Marcar como processing para evitar race conditions entre cron runs
  await updateTaskStatus(env, task.id, "processing");

  try {
    const { text: result, toolCalls } = await runReasoningWithTools(
      env,
      task.title,
      task.description,
      task.id
    );

    // ── Verificar si el agente invocó request_human_approval ─────────────
    const approvalCall = toolCalls.find((tc) => tc.name === "request_human_approval");

    if (approvalCall) {
      const reason = String(approvalCall.arguments.reason ?? "Aprobación requerida por el agente.");

      // Cambiar estado a pending_approval y guardar la razón como resultado
      await updateTaskStatus(env, task.id, "pending_approval", `APROBACIÓN REQUERIDA: ${reason}`);
      await logAudit(env, "task_pending_approval", { taskId: task.id, reason });

      // Notificar al gerente vía Smart Passes + inyectar en historial de chat
      if (task.created_by) {
        const creator = await getUserByTelegramId(env, task.created_by);
        if (creator?.smartpass_id) {
          // Push notification
          await sendPushNotification(
            env,
            creator.smartpass_id,
            `⚠️ Aprobación requerida: #${task.id}`,
            reason.slice(0, 120)
          );

          // Inyectar mensaje proactivo en el historial de chat del wallet
          const proactiveMsg = `⚠️ **Requiere Autorización (Tarea #${task.id}):** ${reason}\n\n¿Apruebas la ejecución de esta tarea? (Responde Sí/Aprobar o No/Rechazar)`;
          const sessionKey = smartpassSessionKey(creator.smartpass_id);
          await appendHistory(env, sessionKey, { role: "assistant", content: proactiveMsg });

          await logAudit(env, "approval_notification_sent", {
            taskId: task.id,
            smartpassId: creator.smartpass_id,
          });
        }
      }

      // Notificar por Telegram también
      if (env.TELEGRAM_CHAT_ID) {
        const msg = [
          `⚠️ <b>Aprobación requerida</b>`,
          `Tarea #${task.id} — ${task.title}`,
          ``,
          `Razón: ${reason}`,
        ].join("\n");
        await sendMessage(env, Number(env.TELEGRAM_CHAT_ID), msg);
      }

      return; // No continuar con el flujo normal
    }

    // ── Flujo normal: tarea completada autónomamente ───────────────────────
    await updateTaskStatus(env, task.id, "completed", result);
    await logAudit(env, "task_completed", { taskId: task.id, title: task.title });

    // Notificar al canal corporativo vía Telegram
    if (env.TELEGRAM_CHAT_ID) {
      const summary = [
        `✅ <b>Tarea completada</b>`,
        `ID: #${task.id} — ${task.title}`,
        ``,
        result.slice(0, 400),
      ].join("\n");
      await sendMessage(env, Number(env.TELEGRAM_CHAT_ID), summary);
    }

    // Notificación push al gerente si el agente lo determinó necesario
    const shouldNotify = parseReasoningField(result, "NOTIFICAR_GERENTE").toLowerCase() === "true";
    if (shouldNotify && task.created_by) {
      const creator = await getUserByTelegramId(env, task.created_by);
      if (creator?.smartpass_id) {
        const alertTitle = parseReasoningField(result, "ALERTA_TITULO") || task.title;
        const alertBody = parseReasoningField(result, "ALERTA_CUERPO") || `Tarea #${task.id} requiere atención.`;
        await sendPushNotification(env, creator.smartpass_id, alertTitle, alertBody);
        await logAudit(env, "push_notification_sent", {
          taskId: task.id,
          smartpassId: creator.smartpass_id,
        });
      }
    }

    // ── Verificar si el agente invocó send_smartpasses_notification ───────
    const notifCall = toolCalls.find((tc) => tc.name === "send_smartpasses_notification");
    if (notifCall) {
      const passId = String(notifCall.arguments.pass_id ?? "");
      const message = String(notifCall.arguments.message ?? `Tarea #${task.id} procesada.`);
      if (passId) {
        await sendPushNotification(env, passId, `Ailyn`, message.slice(0, 120));
        await logAudit(env, "tool_notification_sent", { taskId: task.id, passId });
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await updateTaskStatus(env, task.id, "failed", errorMsg);
    await logAudit(env, "task_failed", { taskId: task.id, error: errorMsg });
  }
}

// ── Email monitoring multi-tenant ──────────────────────────────────────────

async function monitorEmailsMultiTenant(env: Env): Promise<void> {
  // Buscar empresas con Google conectado
  const companies = await env.DB.prepare(`
    SELECT c.id, c.name FROM companies c
    JOIN integrations i ON i.company_id = c.id AND i.provider = 'google' AND i.is_active = 1
  `).all<{ id: number; name: string }>();

  if (!companies.results?.length) return;

  for (const company of companies.results) {
    try {
      const token = await getValidGoogleToken(env, company.id);
      if (!token) continue;

      // Leer últimos 10 emails
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=newer_than:1d`;
      const listRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!listRes.ok) continue;
      const list = await listRes.json() as { messages?: { id: string }[] };
      if (!list.messages?.length) continue;

      const newEmails: { gmailId: string; from: string; fromName: string; subject: string; snippet: string }[] = [];

      for (const m of list.messages) {
        // Skip si ya está en email_inbox
        const exists = await env.DB.prepare(
          `SELECT id FROM email_inbox WHERE company_id = ? AND gmail_id = ?`
        ).bind(company.id, m.id).first();
        if (exists) continue;

        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!msgRes.ok) continue;
        const msg = await msgRes.json() as { id: string; snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
        const headers = msg.payload?.headers ?? [];
        const from = headers.find(h => h.name === "From")?.value ?? "Desconocido";
        const subject = headers.find(h => h.name === "Subject")?.value ?? "(sin asunto)";
        const fromName = from.split("<")[0].trim().replace(/"/g, "");

        newEmails.push({ gmailId: m.id, from, fromName, subject, snippet: msg.snippet?.slice(0, 200) ?? "" });
      }

      if (newEmails.length === 0) continue;

      // Clasificar TODOS los emails nuevos con Llama (gratis)
      const emailList = newEmails.map((e, i) =>
        `${i + 1}. De: ${e.fromName} | Asunto: ${e.subject} | ${e.snippet.slice(0, 80)}`
      ).join("\n");

      const classResult = await env.AI.run(
        "@cf/meta/llama-3.2-3b-instruct" as Parameters<typeof env.AI.run>[0],
        {
          messages: [{
            role: "user",
            content: `Clasifica cada email en UNA categoría. Responde SOLO con JSON array, sin nada más.

Categorías:
- urgent: requiere acción inmediata (pagos, problemas, clientes pidiendo algo)
- action: requiere respuesta pero no es urgente
- info: newsletters útiles, reportes, actualizaciones informativas
- social: redes sociales, notificaciones de apps
- spam: marketing no solicitado, promociones, suscripciones

También sugiere una acción para cada uno: responder, archivar, dar_followup, ignorar

Emails:
${emailList}

JSON (solo esto):
[{"n":1,"cat":"urgent","act":"responder"},{"n":2,"cat":"spam","act":"ignorar"}]`,
          }],
          max_tokens: 256,
        }
      ) as { response?: unknown };

      // Parse classification
      const rawClass = String(classResult.response ?? "[]");
      let classifications: { n: number; cat: string; act: string }[] = [];
      try {
        const jsonMatch = rawClass.match(/\[[\s\S]*\]/);
        if (jsonMatch) classifications = JSON.parse(jsonMatch[0]);
      } catch { /* use defaults */ }

      const catMap: Record<string, number> = { urgent: 1, action: 2, info: 3, social: 4, spam: 5 };

      // Guardar cada email clasificado
      for (let i = 0; i < newEmails.length; i++) {
        const e = newEmails[i];
        const cl = classifications.find(c => c.n === i + 1);
        const category = cl?.cat ?? "other";
        const priority = catMap[category] ?? 3;
        const action = cl?.act ?? "revisar";

        await env.DB.prepare(
          `INSERT OR IGNORE INTO email_inbox (company_id, gmail_id, from_address, from_name, subject, snippet, category, priority, action_suggested)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(company.id, e.gmailId, e.from, e.fromName, e.subject, e.snippet, category, priority, action).run();
      }
    } catch (err) {
      console.error(`[email-monitor] Company ${company.id} error:`, String(err));
    }
  }
}

// ── Reporte semanal/diario multi-tenant (cron 0 14 * * * = 8:00am México) ──

async function handleMorningReport(env: Env): Promise<void> {
  // Obtener todas las empresas con Telegram activo
  const companies = await env.DB.prepare(`
    SELECT c.id, c.name, tc.bot_token, tc.owner_chat_id
    FROM companies c
    JOIN telegram_configs tc ON tc.company_id = c.id AND tc.is_active = 1
    WHERE tc.owner_chat_id IS NOT NULL
  `).all<{ id: number; name: string; bot_token: string; owner_chat_id: string }>();

  if (!companies.results?.length) return;

  const now = new Date();
  const isMonday = now.getUTCDay() === 1;
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const dayName = days[now.getUTCDay()];
  const day = now.getUTCDate();
  const months = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const dateStr = `${day} de ${months[now.getUTCMonth()]}`;

  for (const company of companies.results) {
    try {
      const cid = company.id;
      const cidStr = String(cid);

      const [weekEmails, weekMeetings, weekFollowups, todayFollowups, weekMessages, pendingActions] = await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) as c FROM pending_actions WHERE company_id = ? AND action_type = 'send_email' AND status = 'executed' AND executed_at >= datetime('now', '-7 days')`).bind(cidStr).first<{ c: number }>(),
        env.DB.prepare(`SELECT COUNT(*) as c FROM pending_actions WHERE company_id = ? AND action_type = 'schedule_meeting' AND status = 'executed' AND executed_at >= datetime('now', '-7 days')`).bind(cidStr).first<{ c: number }>(),
        env.DB.prepare(`SELECT COUNT(*) as c FROM pending_actions WHERE company_id = ? AND action_type = 'send_followup' AND status IN ('executed','scheduled') AND created_at >= datetime('now', '-7 days')`).bind(cidStr).first<{ c: number }>(),
        env.DB.prepare(`SELECT COUNT(*) as c FROM pending_actions WHERE company_id = ? AND status = 'scheduled' AND date(followup_scheduled_at) = date('now')`).bind(cidStr).first<{ c: number }>(),
        env.DB.prepare(`SELECT COUNT(*) as c FROM conversation_history WHERE company_id = ? AND role = 'user' AND created_at >= datetime('now', '-7 days')`).bind(cid).first<{ c: number }>(),
        env.DB.prepare(`SELECT COUNT(*) as c FROM pending_actions WHERE company_id = ? AND status = 'pending'`).bind(cidStr).first<{ c: number }>(),
      ]);

      const emails = weekEmails?.c ?? 0;
      const meetings = weekMeetings?.c ?? 0;
      const followups = weekFollowups?.c ?? 0;
      const todayFu = todayFollowups?.c ?? 0;
      const messages = weekMessages?.c ?? 0;
      const pending = pendingActions?.c ?? 0;

      let message: string;

      if (isMonday) {
        // Reporte semanal completo los lunes
        message = [
          `📊 <b>Reporte semanal — ${company.name}</b>`,
          `${dayName} ${dateStr}`,
          "",
          `📧 Emails enviados: <b>${emails}</b>`,
          `📅 Reuniones agendadas: <b>${meetings}</b>`,
          `🔄 Follow-ups enviados: <b>${followups}</b>`,
          `💬 Mensajes procesados: <b>${messages}</b>`,
          "",
          todayFu > 0 ? `⏰ Follow-ups programados hoy: <b>${todayFu}</b>` : "",
          pending > 0 ? `⚠️ Acciones pendientes de aprobación: <b>${pending}</b>` : "",
          "",
          emails + meetings + followups > 0
            ? `💡 Ailyn te ahorró aproximadamente <b>${Math.round((emails * 5 + meetings * 10 + followups * 3))} minutos</b> esta semana`
            : `💡 Tip: Prueba decir "envíale un email a..." para que Ailyn te ayude`,
        ].filter(Boolean).join("\n");
      } else {
        // Resumen corto los demás días (solo si hay actividad)
        if (todayFu === 0 && pending === 0) continue;
        message = [
          `☀️ <b>Buenos días — ${company.name}</b>`,
          "",
          todayFu > 0 ? `⏰ Tienes <b>${todayFu}</b> follow-up${todayFu > 1 ? "s" : ""} programado${todayFu > 1 ? "s" : ""} para hoy` : "",
          pending > 0 ? `⚠️ <b>${pending}</b> acción${pending > 1 ? "es" : ""} pendiente${pending > 1 ? "s" : ""} de aprobación` : "",
        ].filter(Boolean).join("\n");
      }

      await fetch(`https://api.telegram.org/bot${company.bot_token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: Number(company.owner_chat_id), text: message, parse_mode: "HTML" }),
      });
    } catch (err) {
      console.error(`[report] Company ${company.id} failed:`, String(err));
    }
  }
}

// ── Entry point principal ─────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleFetch(env, request, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === "0 14 * * *") {
      ctx.waitUntil(handleMorningReport(env));
    } else {
      ctx.waitUntil(handleScheduled(env));
    }
  },
};
