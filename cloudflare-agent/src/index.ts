import { runAdminChat, runChat, runDynamicChat, runDynamicChatWithResults, runReasoningWithTools } from "./ai";
import type { ToolCall, ToolResult } from "./ai";
import { createCompany, createTask, createWalletPass, deleteAgent, deleteCompany, deleteKnowledgeDoc, getAgentProfile, getAgentProfileById, getAgentStats, getCompanyDetail, getCompanyMetrics, getGlobalMetrics, getLeadById, getNextPendingTask, getUnattendedLeads, getUserBySmartpassId, getUserByTelegramId, insertKnowledgeDoc, isEmailAlreadySaved, listAgentsWithSkills, listCompaniesWithStats, listKnowledgeDocs, listLeads, listMonitoredEmails, listSkills, listWalletPasses, logAudit, markLeadNotified, saveLead, saveMonitoredEmail, updateAgent, updateCompany, updateTaskStatus, updateWalletPassInstalled, updateWalletPassUrl, upsertAgentWithSkills, upsertUser } from "./d1";
import { createPass, emailPass, notifyViaPass } from "./smartpass";
import { proposeAction, approveAction, rejectAction, closeLeadActions } from "./action-engine";
import { runLLM } from "./llm-router";
import { analyzeEmail, fetchRecentEmails } from "./email-monitor";
import { researchLead } from "./lead-research";
import type { ResearchResult } from "./lead-research";
import { searchWeb } from "./web-search";
import { appendHistory, clearHistory, getHistory } from "./kv";
import { sendPushNotification } from "./smartpasses";
import { registerWebhook, sendMessage } from "./telegram";
import type { Env, TelegramUpdate } from "./types";

// ── CORS ──────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-CF-Token, Authorization",
} as const;

function corsResponse(body: string, status: number, extra?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...extra },
  });
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
        "/help — Esta ayuda",
        "",
        "O escríbeme directamente para conversar.",
      ].join("\n");
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
    const SLOW_COMMANDS = ["/investigar", "/buscar", "/emails", "/pase", "/notificar"];
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

  // POST /webhook/telegram/:secretToken
  if (request.method === "POST" && pathname.startsWith("/webhook/telegram/")) {
    const secretToken = pathname.split("/")[3] ?? "";
    return handleTelegramWebhook(env, request, secretToken);
  }

  // POST /api/webhook/telegram — Webhook v2 con header auth + Agente Master Dev
  if (request.method === "POST" && pathname === "/api/webhook/telegram") {
    return handleTelegramWebhookV2(env, request, ctx);
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

  // OPTIONS preflight — cubre TODAS las rutas /api/*
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
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

    // Generar embedding con BGE
    const embeddingRes = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [body.content],
    }) as { data: number[][] };
    const vector = embeddingRes.data[0];

    // ID único para Vectorize
    const vectorId = `${body.company_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Insertar en Vectorize con metadatos
    await env.KNOWLEDGE_BASE.insert([{
      id: vectorId,
      values: vector,
      metadata: { company_id: body.company_id, title: body.title.trim(), text: body.content.slice(0, 900) },
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

  // GET /api/admin/knowledge/docs?company_id=X — listar documentos de empresa
  if (request.method === "GET" && pathname === "/api/admin/knowledge/docs") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const companyId = Number(url.searchParams.get("company_id") ?? "0");
    if (!companyId) {
      return new Response(JSON.stringify({ error: "company_id required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const docs = await listKnowledgeDocs(env, companyId);
    return new Response(JSON.stringify(docs), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
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

  // GET /api/leads — listar leads
  if (request.method === "GET" && pathname === "/api/leads") {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const companyId = url.searchParams.get("company_id") ?? undefined;
    const urgency = url.searchParams.get("urgency") ?? undefined;
    const researchStatus = url.searchParams.get("research_status") ?? undefined;
    const recommendedUnit = url.searchParams.get("recommended_unit") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "20");
    const leads = await listLeads(env, { company_id: companyId, urgency, research_status: researchStatus, recommended_unit: recommendedUnit, limit });
    return new Response(JSON.stringify(leads), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  // GET /api/leads/:id — lead completo
  if (request.method === "GET" && pathname.startsWith("/api/leads/")) {
    const auth = request.headers.get("X-CF-Token") ?? "";
    if (auth !== env.CLOUDFLARE_ADMIN_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
    const leadId = pathname.split("/")[3] ?? "";
    const lead = await getLeadById(env, leadId);
    if (!lead) return new Response(JSON.stringify({ error: "Lead not found" }), { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
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

  // ── Wallet Passes endpoints ────────────────────────────────────────────

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
    const company = await env.DB.prepare(`SELECT name FROM companies WHERE id = ?`).bind(id).first<{ name: string }>();
    if (!company) return corsResponse(JSON.stringify({ error: "Not found" }), 404);
    const metrics = await getCompanyMetrics(env, company.name);
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

  return new Response("Not Found", { status: 404 });
}

// ── Parser del output de razonamiento ────────────────────────────────────

function parseReasoningField(result: string, field: string): string {
  const match = result.match(new RegExp(`${field}:\\s*(.+)`));
  return match?.[1]?.trim() ?? "";
}

// ── Scheduled handler (modo proactivo) ────────────────────────────────────

async function handleScheduled(env: Env): Promise<void> {
  // Kill Switch: si el agente está pausado, saltar el ciclo
  const systemStatus = await env.KV.get("SYSTEM_STATUS");
  if (systemStatus === "paused") {
    console.log("Agente pausado, saltando ciclo");
    return;
  }

  // ── Email monitoring automático (cada 15 min) ─────────────────────────
  if (env.GMAIL_REFRESH_TOKEN) {
    try {
      const emails = await fetchRecentEmails(env, 10);
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
        if ((analysis.urgency === "high" || analysis.requiresAction) && env.TELEGRAM_CHAT_ID) {
          await sendMessage(env, Number(env.TELEGRAM_CHAT_ID), formatEmailAlert(email, analysis));
        }
      }
    } catch {
      // Email monitoring no debe bloquear el cron principal
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

// ── Reporte matutino diario (cron 0 14 * * * = 8:00am Mérida) ────────────

async function handleMorningReport(env: Env): Promise<void> {
  try {
    const [hotLeads, todayFollowups, newLeadsWeek, emailsSentWeek] = await Promise.all([
      env.DB.prepare(`
        SELECT contact_name, contact_company, lead_score, urgency, recommended_unit, status
        FROM leads
        WHERE company_id = 'ailyn-labs'
          AND lead_score >= 80
          AND status NOT IN ('closed', 'rejected')
        ORDER BY lead_score DESC
        LIMIT 5
      `).all(),
      env.DB.prepare(`
        SELECT COUNT(*) as count FROM pending_actions
        WHERE status = 'scheduled'
          AND date(followup_scheduled_at) = date('now')
      `).first<{ count: number }>(),
      env.DB.prepare(`
        SELECT COUNT(*) as count FROM leads
        WHERE company_id = 'ailyn-labs'
          AND created_at >= datetime('now', '-7 days')
      `).first<{ count: number }>(),
      env.DB.prepare(`
        SELECT COUNT(*) as count FROM pending_actions
        WHERE status = 'executed'
          AND action_type IN ('send_email', 'send_followup')
          AND executed_at >= datetime('now', '-7 days')
      `).first<{ count: number }>(),
    ]);

    type HotLead = { contact_name: string; contact_company: string | null; lead_score: number; recommended_unit: string | null; status: string };
    const hot = (hotLeads.results ?? []) as HotLead[];

    const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const now = new Date();
    const dayName = days[now.getUTCDay()];
    const day = now.getUTCDate();
    const months = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    const dateStr = `${day} de ${months[now.getUTCMonth()]} de ${now.getUTCFullYear()}`;

    const hotSection = hot.length === 0
      ? "  (ninguno esta semana)"
      : hot.map(l => `• ${l.contact_company ?? l.contact_name} — ${l.contact_name} (score ${l.lead_score}) → ${l.status}`).join("\n");

    const topLead = hot[0]
      ? `${hot[0].contact_company ?? hot[0].contact_name} (score ${hot[0].lead_score})`
      : "Sin leads calientes activos";

    const message = [
      `📊 Buenos días Pedro. Reporte Ailyn — ${dayName} ${dateStr}`,
      "",
      `🔥 Leads calientes (${hot.length}):`,
      hotSection,
      "",
      `⏰ Follow-ups programados hoy: ${todayFollowups?.count ?? 0}`,
      `📥 Leads nuevos esta semana: ${newLeadsWeek?.count ?? 0}`,
      `📧 Emails enviados esta semana: ${emailsSentWeek?.count ?? 0}`,
      "",
      `💡 Prioridad de hoy: ${topLead}`,
    ].join("\n");

    await sendMessage(env, Number(env.TELEGRAM_CHAT_ID), message);
    await logAudit(env, "morning_report_sent", { hotLeads: hot.length });
  } catch (err) {
    console.error("[morning-report] failed:", String(err));
    await sendMessage(env, Number(env.TELEGRAM_CHAT_ID), `⚠️ Reporte matutino falló: ${String(err)}`);
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
