/**
 * WhatsApp Business Cloud API — Multi-tenant integration
 *
 * Endpoints:
 *   POST   /api/settings/whatsapp/connect    Bearer auth — connects WhatsApp
 *   DELETE /api/settings/whatsapp/disconnect  Bearer auth — disconnects WhatsApp
 *   GET    /api/settings/whatsapp/status      Bearer auth — connection status
 *
 * Webhook:
 *   GET  /webhook/whatsapp/:company-slug  — webhook verification (returns hub.challenge)
 *   POST /webhook/whatsapp/:company-slug  — receives messages
 */

import type { Env } from "./types";
import { authenticateUser } from "./auth";
import { getAgentProfileBySlug, saveChatMessage, countRecentMessages } from "./d1";
import { createDesktopTask } from "./desktop-tasks";
import { processMessage } from "./agent-brain";
import { checkUsageLimit, incrementUsage, shouldWarn80 } from "./usage";
import { orchestrate, loadHistory, saveConversationTurn, loadIntegrations } from "./orchestrator";
import { getValidGoogleToken } from "./google-oauth";

// ── Types ─────────────────────────────────────────────────────────────────

interface WhatsAppConfig {
  id: number;
  company_id: number;
  phone_number_id: string;
  access_token: string;
  verify_token: string;
  is_active: number;
}

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string };
  interactive?: { type: string; button_reply?: { id: string; title: string } };
}

interface WhatsAppContact {
  profile?: { name?: string };
  wa_id: string;
}

interface WhatsAppWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      value: {
        messaging_product: string;
        metadata?: { phone_number_id: string };
        contacts?: WhatsAppContact[];
        messages?: WhatsAppMessage[];
        statuses?: unknown[];
      };
      field: string;
    }>;
  }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const WA_API_BASE = "https://graph.facebook.com/v22.0";

async function sendWhatsAppText(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
): Promise<void> {
  const res = await fetch(`${WA_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`[whatsapp] Send error to ${to}:`, err);
  }
}

async function sendWhatsAppButtons(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>
): Promise<void> {
  // WhatsApp allows max 3 buttons, max 20 chars per title
  const safeButtons = buttons.slice(0, 3).map((b) => ({
    type: "reply" as const,
    reply: { id: b.id, title: b.title.slice(0, 20) },
  }));

  await fetch(`${WA_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText.slice(0, 1024) },
        action: { buttons: safeButtons },
      },
    }),
  });
}

async function markAsRead(
  phoneNumberId: string,
  accessToken: string,
  messageId: string
): Promise<void> {
  await fetch(`${WA_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });
}

// ── D1 inline queries ─────────────────────────────────────────────────────

async function getWhatsAppConfig(env: Env, companyId: number): Promise<WhatsAppConfig | null> {
  return env.DB.prepare(
    `SELECT id, company_id, phone_number_id, access_token, verify_token, is_active
     FROM whatsapp_configs WHERE company_id = ? AND is_active = 1 LIMIT 1`
  ).bind(companyId).first<WhatsAppConfig>();
}

async function getWhatsAppConfigBySlug(env: Env, slug: string): Promise<(WhatsAppConfig & { company_slug: string }) | null> {
  return env.DB.prepare(
    `SELECT wc.id, wc.company_id, wc.phone_number_id, wc.access_token, wc.verify_token, wc.is_active, c.slug as company_slug
     FROM whatsapp_configs wc
     JOIN companies c ON c.id = wc.company_id
     WHERE c.slug = ? AND wc.is_active = 1
     LIMIT 1`
  ).bind(slug).first<WhatsAppConfig & { company_slug: string }>();
}

async function saveWhatsAppConfig(
  env: Env,
  companyId: number,
  phoneNumberId: string,
  accessToken: string,
  verifyToken: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO whatsapp_configs (company_id, phone_number_id, access_token, verify_token)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET
       phone_number_id = excluded.phone_number_id,
       access_token = excluded.access_token,
       verify_token = excluded.verify_token,
       is_active = 1`
  ).bind(companyId, phoneNumberId, accessToken, verifyToken).run();
}

async function deactivateWhatsAppConfig(env: Env, companyId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE whatsapp_configs SET is_active = 0 WHERE company_id = ?`
  ).bind(companyId).run();
}

// ── POST /api/settings/whatsapp/connect ───────────────────────────────────

export async function handleWhatsAppConnect(
  request: Request,
  env: Env
): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return json({ error: "No autorizado" }, 401);

  let body: { phone_number_id?: string; access_token?: string; verify_token?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const phoneNumberId = body.phone_number_id?.trim();
  const accessToken = body.access_token?.trim();
  const verifyToken = body.verify_token?.trim();

  if (!phoneNumberId || !accessToken || !verifyToken) {
    return json({ error: "phone_number_id, access_token y verify_token son requeridos" }, 400);
  }

  // Validate the token by fetching the phone number info
  try {
    const res = await fetch(`${WA_API_BASE}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error("[whatsapp] Validation failed:", errBody);
      return json({ error: "Credenciales inválidas. Verifica tu Phone Number ID y Access Token." }, 400);
    }
  } catch (e) {
    console.error("[whatsapp] Validation error:", String(e));
    return json({ error: "No se pudo validar con WhatsApp API." }, 400);
  }

  // Save config
  await saveWhatsAppConfig(env, user.company_id, phoneNumberId, accessToken, verifyToken);

  // Build webhook URL for reference (user must configure this in Meta dashboard)
  const workerUrl = new URL(request.url);
  const webhookUrl = `${workerUrl.protocol}//${workerUrl.host}/webhook/whatsapp/${user.company_slug}`;

  return json({
    success: true,
    phone_number_id: phoneNumberId,
    webhook_url: webhookUrl,
    message: "Configuración guardada. Registra este webhook URL en tu Meta App dashboard.",
  });
}

// ── DELETE /api/settings/whatsapp/disconnect ──────────────────────────────

export async function handleWhatsAppDisconnect(
  request: Request,
  env: Env
): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return json({ error: "No autorizado" }, 401);

  const config = await getWhatsAppConfig(env, user.company_id);
  if (!config) return json({ error: "No hay WhatsApp conectado" }, 404);

  await deactivateWhatsAppConfig(env, user.company_id);

  return json({ success: true });
}

// ── GET /api/settings/whatsapp/status ─────────────────────────────────────

export async function handleWhatsAppStatus(
  request: Request,
  env: Env
): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return json({ error: "No autorizado" }, 401);

  const config = await getWhatsAppConfig(env, user.company_id);
  if (!config) return json({ connected: false });

  return json({
    connected: true,
    phone_number_id: config.phone_number_id,
  });
}

// ── Webhook handler (GET + POST) ──────────────────────────────────────────

export async function handleWhatsAppWebhook(
  request: Request,
  env: Env,
  companySlug: string
): Promise<Response> {
  // ── GET: Webhook verification ──────────────────────────────────────────
  if (request.method === "GET") {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode !== "subscribe" || !token || !challenge) {
      return new Response("Bad Request", { status: 400 });
    }

    // Look up config by slug to verify token
    const config = await getWhatsAppConfigBySlug(env, companySlug);
    if (!config || config.verify_token !== token) {
      return new Response("Forbidden", { status: 403 });
    }

    // Return the challenge to verify the webhook
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // ── POST: Incoming messages ────────────────────────────────────────────
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const config = await getWhatsAppConfigBySlug(env, companySlug);
  if (!config) return new Response("Not Found", { status: 404 });

  let payload: WhatsAppWebhookPayload;
  try {
    payload = await request.json<WhatsAppWebhookPayload>();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // WhatsApp sends status updates too — ignore those
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  if (!change?.value?.messages?.length) {
    return new Response("OK", { status: 200 });
  }

  const value = change.value;
  const message = value.messages![0];
  // Normalizar número de México: WhatsApp envía 521XXXXXXXXXX pero Meta espera 52XXXXXXXXXX
  let senderPhone = message.from;
  if (senderPhone.startsWith("521") && senderPhone.length === 13) {
    senderPhone = "52" + senderPhone.slice(3);
  }
  // Contact name available via value.contacts?.[0]?.profile?.name

  // Mark message as read
  await markAsRead(config.phone_number_id, config.access_token, message.id);

  // ── Interactive button reply (approval buttons) ────────────────────────
  if (message.type === "interactive" && message.interactive?.button_reply) {
    const buttonId = message.interactive.button_reply.id;
    const [action, actionIdStr] = buttonId.split(":");
    const actionId = parseInt(actionIdStr, 10);

    if (!actionId || isNaN(actionId)) return new Response("OK", { status: 200 });

    return handleButtonReply(env, config, senderPhone, action, actionId);
  }

  // ── Extract text from message ──────────────────────────────────────────
  let text: string;

  if (message.type === "text" && message.text?.body) {
    text = message.text.body.trim();
  } else if (message.type === "audio" && message.audio?.id) {
    // Download and transcribe audio
    try {
      // 1. Get media URL
      const mediaRes = await fetch(`${WA_API_BASE}/${message.audio.id}`, {
        headers: { Authorization: `Bearer ${config.access_token}` },
      });
      if (!mediaRes.ok) {
        await sendWhatsAppText(config.phone_number_id, config.access_token, senderPhone, "No pude obtener el audio.");
        return new Response("OK", { status: 200 });
      }
      const mediaInfo = await mediaRes.json() as { url?: string };
      if (!mediaInfo.url) {
        await sendWhatsAppText(config.phone_number_id, config.access_token, senderPhone, "No pude obtener el audio.");
        return new Response("OK", { status: 200 });
      }

      // 2. Download the audio file
      const audioRes = await fetch(mediaInfo.url, {
        headers: { Authorization: `Bearer ${config.access_token}` },
      });
      if (!audioRes.ok) {
        await sendWhatsAppText(config.phone_number_id, config.access_token, senderPhone, "No pude descargar el audio.");
        return new Response("OK", { status: 200 });
      }
      const audioBuffer = await audioRes.arrayBuffer();

      // 3. Transcribe with Whisper (Cloudflare Workers AI)
      const transcription = await env.AI.run(
        "@cf/openai/whisper" as Parameters<typeof env.AI.run>[0],
        { audio: [...new Uint8Array(audioBuffer)] }
      ) as { text?: string };

      const transcribedText = transcription.text?.trim();
      if (!transcribedText) {
        await sendWhatsAppText(config.phone_number_id, config.access_token, senderPhone, "No pude entender el audio. Intenta de nuevo.");
        return new Response("OK", { status: 200 });
      }

      text = transcribedText;
      // Confirm transcription
      await sendWhatsAppText(config.phone_number_id, config.access_token, senderPhone, `\uD83C\uDFA4 _${text}_`);
    } catch (e) {
      console.error("[whatsapp] Voice transcription error:", String(e));
      await sendWhatsAppText(config.phone_number_id, config.access_token, senderPhone, "Error al procesar el audio.");
      return new Response("OK", { status: 200 });
    }
  } else {
    // Unsupported message type — ignore
    return new Response("OK", { status: 200 });
  }

  // ── Find agent profile ─────────────────────────────────────────────────
  const agentProfile = await getAgentProfileBySlug(env, companySlug);
  if (!agentProfile) {
    await sendWhatsAppText(config.phone_number_id, config.access_token, senderPhone, "Este asistente no esta configurado aun.");
    return new Response("OK", { status: 200 });
  }

  const sessionId = `wa-${companySlug}-${senderPhone}`;

  // ── Usage limits ───────────────────────────────────────────────────────
  const chatLimit = await checkUsageLimit(env, agentProfile.company_id, "chat");
  if (!chatLimit.allowed) {
    await sendWhatsAppText(
      config.phone_number_id,
      config.access_token,
      senderPhone,
      `Has alcanzado el limite de mensajes de tu plan ${chatLimit.planName}. Tu agente no podra responder hasta el proximo mes o hasta que actualices en tu dashboard.`
    );
    return new Response("OK", { status: 200 });
  }

  // Rate limit: 30 messages per hour
  const recentCount = await countRecentMessages(env, sessionId, 60);
  if (recentCount >= 30) {
    await sendWhatsAppText(config.phone_number_id, config.access_token, senderPhone, "Has alcanzado el limite de mensajes por hora. Intenta mas tarde.");
    return new Response("OK", { status: 200 });
  }

  // ── Agent Brain: desktop actions ───────────────────────────────────────
  const brain = await processMessage(text, env, agentProfile.company_id);

  if (brain.type === "desktop_actions") {
    const batchId = crypto.randomUUID();
    await sendWhatsAppText(config.phone_number_id, config.access_token, senderPhone, `\uD83D\uDD0D ${brain.thinking}`);
    for (const action of brain.actions) {
      await createDesktopTask(env, agentProfile.company_id, action.tool, action.config, text, batchId);
    }
    await saveChatMessage(env, sessionId, agentProfile.company_id, agentProfile.agent_id, "user", text);
    await saveChatMessage(env, sessionId, agentProfile.company_id, agentProfile.agent_id, "assistant", `\uD83D\uDD0D ${brain.thinking}`);
    return new Response("OK", { status: 200 });
  }

  // ── Orchestrator ───────────────────────────────────────────────────────
  try {
    const history = await loadHistory(env, sessionId, 10, agentProfile.company_id);
    const integrations = await loadIntegrations(env, agentProfile.company_id);
    const googleToken = integrations.googleToken
      ? await getValidGoogleToken(env, agentProfile.company_id)
      : null;

    const companyRow = await env.DB.prepare(
      `SELECT name, industry FROM companies WHERE id = ?`
    ).bind(agentProfile.company_id).first<{ name: string; industry: string | null }>();

    const result = await orchestrate({
      message: text,
      companyId: agentProfile.company_id,
      companyName: companyRow?.name ?? agentProfile.company_name ?? "tu empresa",
      industry: companyRow?.industry ?? undefined,
      sessionId,
      channel: "whatsapp",
      history,
      googleToken,
      githubToken: integrations.githubToken,
    }, env);

    const reply = result.text || "Lo siento, no pude procesar tu mensaje.";

    // Save conversation
    const routing = {
      model: result.model_used,
      complexity: result.complexity as "simple" | "medium" | "complex",
      tools_needed: result.tools_used as never[],
      estimated_cost: result.estimated_cost,
      provider: "cloudflare" as const,
    };
    await saveConversationTurn(
      env,
      { message: text, companyId: agentProfile.company_id, companyName: companyRow?.name ?? "", sessionId, channel: "whatsapp" },
      text,
      reply,
      routing
    );
    await saveChatMessage(env, sessionId, agentProfile.company_id, agentProfile.agent_id, "user", text);
    await saveChatMessage(env, sessionId, agentProfile.company_id, agentProfile.agent_id, "assistant", reply);

    // Increment usage
    await incrementUsage(env, agentProfile.company_id, "chat");
    const warn80 = await shouldWarn80(env, agentProfile.company_id, "chat");
    if (warn80) {
      const updatedCheck = await checkUsageLimit(env, agentProfile.company_id, "chat");
      // Send usage warning to the same WhatsApp number (owner)
      await sendWhatsAppText(
        config.phone_number_id,
        config.access_token,
        senderPhone,
        `\u26A0\uFE0F Has usado ${updatedCheck.used} de ${updatedCheck.limit} mensajes de tu plan ${updatedCheck.planName} este mes.`
      );
    }

    // ── Email draft: show with interactive buttons ─────────────────────
    if (result.emailDraft) {
      const draft = result.emailDraft;
      const companyName = companyRow?.name ?? agentProfile.company_name ?? "tu empresa";

      const actionData = JSON.stringify({
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        from_name: companyName,
      });
      const insertResult = await env.DB.prepare(
        `INSERT INTO pending_actions (company_id, action_type, action_data, status, telegram_chat_id)
         VALUES (?, 'send_email', ?, 'pending', ?)`
      ).bind(String(agentProfile.company_id), actionData, senderPhone).run();

      const actionId = insertResult.meta.last_row_id;

      const preview = `\uD83D\uDCE7 *Email listo para enviar*\n\n*Para:* ${draft.to}\n*Asunto:* ${draft.subject}\n\n${draft.body.slice(0, 400)}${draft.body.length > 400 ? "..." : ""}`;

      await sendWhatsAppButtons(
        config.phone_number_id,
        config.access_token,
        senderPhone,
        preview + (result.indicator ?? ""),
        [
          { id: `email_approve:${actionId}`, title: "Enviar" },
          { id: `email_edit:${actionId}`, title: "Corregir" },
          { id: `email_reject:${actionId}`, title: "Cancelar" },
        ]
      );
    } else if (result.calendarDraft) {
      // ── Calendar draft ──────────────────────────────────────────────
      const draft = result.calendarDraft;

      const actionData = JSON.stringify({
        ...draft,
        companyId: agentProfile.company_id,
      });
      const insertResult = await env.DB.prepare(
        `INSERT INTO pending_actions (company_id, action_type, action_data, status, telegram_chat_id)
         VALUES (?, 'schedule_meeting', ?, 'pending', ?)`
      ).bind(String(agentProfile.company_id), actionData, senderPhone).run();

      const actionId = insertResult.meta.last_row_id;

      const attendeeText = draft.attendees.length > 0 ? `\n\uD83D\uDC65 Invitados: ${draft.attendees.join(", ")}` : "";
      const preview = `\uD83D\uDCC5 *Evento listo para agendar*\n\n*${draft.title}*\n\uD83D\uDDD3\uFE0F ${draft.date}\n\uD83D\uDD50 ${draft.startTime} - ${draft.endTime}${attendeeText}${draft.description ? `\n\uD83D\uDCDD ${draft.description}` : ""}`;

      await sendWhatsAppButtons(
        config.phone_number_id,
        config.access_token,
        senderPhone,
        preview + (result.indicator ?? ""),
        [
          { id: `cal_approve:${actionId}`, title: "Agendar" },
          { id: `cal_edit:${actionId}`, title: "Cambiar" },
          { id: `cal_reject:${actionId}`, title: "Cancelar" },
        ]
      );
    } else if (result.followupDraft) {
      // ── Follow-up draft ─────────────────────────────────────────────
      const draft = result.followupDraft;
      const scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + draft.days);
      const scheduledStr = scheduledDate.toISOString().split("T")[0];

      const actionData = JSON.stringify({
        to: draft.to,
        subject: draft.subject,
        context: draft.context,
        days: draft.days,
        companyId: agentProfile.company_id,
        companyName: companyRow?.name ?? agentProfile.company_name ?? "tu empresa",
      });
      const insertResult = await env.DB.prepare(
        `INSERT INTO pending_actions (company_id, action_type, action_data, status, telegram_chat_id, followup_number, followup_scheduled_at)
         VALUES (?, 'send_followup', ?, 'pending', ?, 1, ?)`
      ).bind(String(agentProfile.company_id), actionData, senderPhone, scheduledStr).run();

      const actionId = insertResult.meta.last_row_id;

      const preview = `\uD83D\uDD04 *Follow-up programado*\n\n*Para:* ${draft.to}\n*Asunto:* ${draft.subject}\n\uD83D\uDCC5 Se enviara el: ${scheduledStr} (en ${draft.days} dias)\n\uD83D\uDCDD ${draft.context}`;

      await sendWhatsAppButtons(
        config.phone_number_id,
        config.access_token,
        senderPhone,
        preview + (result.indicator ?? ""),
        [
          { id: `fu_approve:${actionId}`, title: "Programar" },
          { id: `fu_reject:${actionId}`, title: "Cancelar" },
        ]
      );
    } else if (result.noteDraft) {
      // ── Note draft: Obsidian + Vectorize ──────────────────────────────
      const note = result.noteDraft;
      const fileName = note.title.replace(/[^a-zA-Z0-9\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s-]/g, "").replace(/\s+/g, "-").slice(0, 60);
      const filePath = `C:/Users/IngPe/OneDrive/Documentos/Obsidian Vault/Ailyn Notes/${fileName}.md`;

      await createDesktopTask(env, agentProfile.company_id, "fs_write", {
        path: filePath,
        content: note.content,
      }, `Guardar nota en Obsidian: ${note.title}`);

      try {
        const embRes = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [note.content.slice(0, 1500)] }) as { data: number[][] };
        const vecId = `${agentProfile.company_id}-note-${Date.now()}`;
        await env.KNOWLEDGE_BASE.insert([{
          id: vecId,
          values: embRes.data[0],
          metadata: { company_id: agentProfile.company_id, title: note.title, text: note.content.slice(0, 900), type: "note", url: note.url },
        }]);
      } catch (e) { console.error("[note] Vectorize error:", String(e)); }

      await sendWhatsAppText(config.phone_number_id, config.access_token, senderPhone,
        `\uD83D\uDCDD *Nota guardada*\n\n*${note.title}*\n\uD83D\uDD17 ${note.url}\n\n\u2705 Obsidian + Knowledge Base\n\uD83D\uDD0D Pregunta: "qu\u00E9 notas tengo sobre..."`
      );
    } else {
      // Normal reply
      await sendWhatsAppText(config.phone_number_id, config.access_token, senderPhone, reply + (result.indicator ?? ""));
    }
  } catch (err) {
    console.error("[whatsapp] Orchestrator error:", String(err));
    await sendWhatsAppText(
      config.phone_number_id,
      config.access_token,
      senderPhone,
      "Hubo un error procesando tu mensaje. Intenta de nuevo en unos segundos."
    );
  }

  return new Response("OK", { status: 200 });
}

// ── Button reply handler ──────────────────────────────────────────────────

async function handleButtonReply(
  env: Env,
  config: WhatsAppConfig,
  senderPhone: string,
  action: string,
  actionId: number
): Promise<Response> {
  const send = (text: string) =>
    sendWhatsAppText(config.phone_number_id, config.access_token, senderPhone, text);

  // ── Email: approve / reject / edit ─────────────────────────────────────
  if (action === "email_approve") {
    const pending = await env.DB.prepare(
      `SELECT action_data, status FROM pending_actions WHERE id = ?`
    ).bind(actionId).first<{ action_data: string; status: string }>();

    if (!pending || pending.status !== "pending") {
      await send("Esta accion ya fue procesada.");
      return new Response("OK", { status: 200 });
    }

    const data = JSON.parse(pending.action_data) as {
      to: string; subject: string; body: string; from_name: string;
    };

    if (!env.RESEND_API_KEY) {
      await send("RESEND_API_KEY no configurado. No se puede enviar.");
      return new Response("OK", { status: 200 });
    }

    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: `${data.from_name} <ailyn@novacode.pro>`,
          to: [data.to],
          subject: data.subject,
          text: data.body,
        }),
      });

      if (resendRes.ok) {
        await env.DB.prepare(
          `UPDATE pending_actions SET status = 'executed', executed_at = datetime('now') WHERE id = ?`
        ).bind(actionId).run();
        await send(`Email enviado a ${data.to}`);
      } else {
        const err = await resendRes.text();
        await env.DB.prepare(
          `UPDATE pending_actions SET status = 'failed', execution_result = ? WHERE id = ?`
        ).bind(err, actionId).run();
        await send(`Error al enviar: ${err}`);
      }
    } catch (e) {
      await send(`Error: ${String(e)}`);
    }
    return new Response("OK", { status: 200 });
  }

  if (action === "email_reject") {
    await env.DB.prepare(
      `UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`
    ).bind(actionId).run();
    await send("Email cancelado.");
    return new Response("OK", { status: 200 });
  }

  if (action === "email_edit") {
    await env.DB.prepare(
      `UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`
    ).bind(actionId).run();
    await send("OK, dime que quieres cambiar y lo vuelvo a redactar.");
    return new Response("OK", { status: 200 });
  }

  // ── Calendar: approve / reject / edit ──────────────────────────────────
  if (action === "cal_approve") {
    const pending = await env.DB.prepare(
      `SELECT action_data, status FROM pending_actions WHERE id = ?`
    ).bind(actionId).first<{ action_data: string; status: string }>();

    if (!pending || pending.status !== "pending") {
      await send("Esta accion ya fue procesada.");
      return new Response("OK", { status: 200 });
    }

    const data = JSON.parse(pending.action_data) as {
      title: string; date: string; startTime: string; endTime: string;
      description: string; attendees: string[]; companyId: number;
    };

    const freshToken = await getValidGoogleToken(env, data.companyId);
    if (!freshToken) {
      await send("Google Calendar no conectado. Conecta tu cuenta en el dashboard.");
      return new Response("OK", { status: 200 });
    }

    try {
      const startDateTime = `${data.date}T${data.startTime}:00`;
      const endDateTime = `${data.date}T${data.endTime}:00`;

      const eventBody: Record<string, unknown> = {
        summary: data.title,
        description: data.description,
        start: { dateTime: startDateTime, timeZone: "America/Mexico_City" },
        end: { dateTime: endDateTime, timeZone: "America/Mexico_City" },
      };
      if (data.attendees.length > 0) {
        eventBody.attendees = data.attendees.map((email) => ({ email }));
      }

      const calRes = await fetch(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${freshToken}`,
          },
          body: JSON.stringify(eventBody),
        }
      );

      if (calRes.ok) {
        const event = (await calRes.json()) as { htmlLink?: string };
        await env.DB.prepare(
          `UPDATE pending_actions SET status = 'executed', executed_at = datetime('now'), execution_result = ? WHERE id = ?`
        ).bind(event.htmlLink ?? "ok", actionId).run();
        const attendeeText =
          data.attendees.length > 0 ? `\nInvitados: ${data.attendees.join(", ")}` : "";
        await send(
          `Evento agendado\n\n${data.title}\n${data.date} ${data.startTime}-${data.endTime}${attendeeText}`
        );
      } else {
        const err = await calRes.text();
        await env.DB.prepare(
          `UPDATE pending_actions SET status = 'failed', execution_result = ? WHERE id = ?`
        ).bind(err, actionId).run();
        await send(`Error al crear evento: ${err}`);
      }
    } catch (e) {
      await send(`Error: ${String(e)}`);
    }
    return new Response("OK", { status: 200 });
  }

  if (action === "cal_reject") {
    await env.DB.prepare(
      `UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`
    ).bind(actionId).run();
    await send("Evento cancelado.");
    return new Response("OK", { status: 200 });
  }

  if (action === "cal_edit") {
    await env.DB.prepare(
      `UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`
    ).bind(actionId).run();
    await send("OK, dime que quieres cambiar del evento.");
    return new Response("OK", { status: 200 });
  }

  // ── Follow-up: approve / reject ────────────────────────────────────────
  if (action === "fu_approve") {
    const pending = await env.DB.prepare(
      `SELECT status FROM pending_actions WHERE id = ?`
    ).bind(actionId).first<{ status: string }>();
    if (!pending || pending.status !== "pending") {
      await send("Esta accion ya fue procesada.");
      return new Response("OK", { status: 200 });
    }
    await env.DB.prepare(
      `UPDATE pending_actions SET status = 'scheduled', decided_at = datetime('now') WHERE id = ?`
    ).bind(actionId).run();
    await send("Follow-up programado. Te avisare cuando se envie.");
    return new Response("OK", { status: 200 });
  }

  if (action === "fu_reject") {
    await env.DB.prepare(
      `UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`
    ).bind(actionId).run();
    await send("Follow-up cancelado.");
    return new Response("OK", { status: 200 });
  }

  return new Response("OK", { status: 200 });
}
