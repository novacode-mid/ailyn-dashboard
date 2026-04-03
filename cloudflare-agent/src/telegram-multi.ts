/**
 * Telegram Multi-tenant — un bot por empresa
 *
 * Endpoints:
 *   POST   /api/settings/telegram/connect    Bearer auth — conecta bot
 *   DELETE /api/settings/telegram/disconnect Bearer auth — desconecta bot
 *   GET    /api/settings/telegram/status     Bearer auth — estado del bot
 *
 * Webhook:
 *   POST /webhook/telegram/:company-slug     — recibe mensajes del bot
 */

import type { Env, TelegramUpdate } from "./types";
import { authenticateUser } from "./auth";
import {
  getTelegramConfig,
  getTelegramConfigBySlug,
  saveTelegramConfig,
  deactivateTelegramConfig,
  getAgentProfileBySlug,
  saveChatMessage,
  countRecentMessages,
} from "./d1";
import { createDesktopTask } from "./desktop-tasks";
import { processMessage } from "./agent-brain";
import { checkUsageLimit, incrementUsage, shouldWarn80 } from "./usage";
import { orchestrate, loadHistory, saveConversationTurn, loadIntegrations } from "./orchestrator";
import { getValidGoogleToken } from "./google-oauth";

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

async function telegramRequest(
  botToken: string,
  method: string,
  body: unknown
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; result?: unknown; description?: string }>;
}

async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string
): Promise<void> {
  await telegramRequest(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  });
}

// ── POST /api/settings/telegram/connect ───────────────────────────────────

export async function handleTelegramConnect(
  request: Request,
  env: Env
): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return json({ error: "No autorizado" }, 401);

  let body: { bot_token?: string };
  try { body = await request.json(); } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const botToken = body.bot_token?.trim();
  if (!botToken) return json({ error: "bot_token is required" }, 400);

  // Validar el token con Telegram API
  const meResp = await telegramRequest(botToken, "getMe", {});
  if (!meResp.ok) {
    return json({ error: "Token inválido. Verifica el token de @BotFather." }, 400);
  }

  const botInfo = meResp.result as { username?: string; first_name?: string };
  const botUsername = botInfo.username ?? botInfo.first_name ?? "bot";

  // Generar webhook_secret único
  const webhookSecret = crypto.randomUUID();

  // Guardar en D1
  await saveTelegramConfig(env, user.company_id, botToken, botUsername, webhookSecret);

  // Registrar webhook en Telegram
  const workerUrl = new URL(request.url);
  const webhookUrl = `${workerUrl.protocol}//${workerUrl.host}/webhook/telegram/${user.company_slug}`;

  const webhookResp = await telegramRequest(botToken, "setWebhook", {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ["message", "callback_query"],
  });

  if (!webhookResp.ok) {
    // Rollback: desactivar config si falla el webhook
    await deactivateTelegramConfig(env, user.company_id);
    return json({ error: `No se pudo registrar el webhook: ${webhookResp.description}` }, 500);
  }

  return json({ success: true, bot_username: botUsername });
}

// ── DELETE /api/settings/telegram/disconnect ──────────────────────────────

export async function handleTelegramDisconnect(
  request: Request,
  env: Env
): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return json({ error: "No autorizado" }, 401);

  const config = await getTelegramConfig(env, user.company_id);
  if (!config) return json({ error: "No hay bot conectado" }, 404);

  // Eliminar webhook en Telegram
  await telegramRequest(config.bot_token, "deleteWebhook", {});

  // Desactivar en D1
  await deactivateTelegramConfig(env, user.company_id);

  return json({ success: true });
}

// ── GET /api/settings/telegram/status ─────────────────────────────────────

export async function handleTelegramStatus(
  request: Request,
  env: Env
): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return json({ error: "No autorizado" }, 401);

  const config = await getTelegramConfig(env, user.company_id);
  if (!config) return json({ connected: false });

  return json({ connected: true, bot_username: config.bot_username });
}

// ── POST /webhook/telegram/:company-slug ──────────────────────────────────


export async function handleTelegramWebhookMulti(
  request: Request,
  env: Env,
  companySlug: string
): Promise<Response> {
  // Buscar config del bot por slug
  const config = await getTelegramConfigBySlug(env, companySlug);
  if (!config) return new Response("Not Found", { status: 404 });

  // Validar webhook secret
  const incomingSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (incomingSecret !== config.webhook_secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try { update = await request.json<TelegramUpdate>(); } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // ── Callback Query: botones de aprobación ───────────────────────────────
  if (update.callback_query) {
    const cb = update.callback_query;
    const cbData = cb.data ?? "";
    const cbChatId = cb.message?.chat.id;

    // Responder al callback para quitar el "loading" del botón
    await telegramRequest(config.bot_token, "answerCallbackQuery", { callback_query_id: cb.id });

    if (!cbChatId) return new Response("OK", { status: 200 });

    // Formato: email_approve:{actionId} | email_reject:{actionId} | email_edit:{actionId}
    const [action, actionIdStr] = cbData.split(":");
    const actionId = parseInt(actionIdStr, 10);

    if (!actionId || isNaN(actionId)) return new Response("OK", { status: 200 });

    if (action === "email_approve") {
      // Buscar la acción pendiente
      const pending = await env.DB.prepare(
        `SELECT action_data, status FROM pending_actions WHERE id = ?`
      ).bind(actionId).first<{ action_data: string; status: string }>();

      if (!pending || pending.status !== "pending") {
        await sendTelegramMessage(config.bot_token, cbChatId, "⚠️ Esta acción ya fue procesada.");
        return new Response("OK", { status: 200 });
      }

      const data = JSON.parse(pending.action_data) as { to: string; subject: string; body: string; from_name: string };

      if (!env.RESEND_API_KEY) {
        await sendTelegramMessage(config.bot_token, cbChatId, "⚠️ RESEND_API_KEY no configurado. No se puede enviar.");
        return new Response("OK", { status: 200 });
      }

      try {
        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.RESEND_API_KEY}`,
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
          await sendTelegramMessage(config.bot_token, cbChatId, `✅ Email enviado a <b>${data.to}</b>`);
        } else {
          const err = await resendRes.text();
          await env.DB.prepare(
            `UPDATE pending_actions SET status = 'failed', execution_result = ? WHERE id = ?`
          ).bind(err, actionId).run();
          await sendTelegramMessage(config.bot_token, cbChatId, `❌ Error al enviar: ${err}`);
        }
      } catch (e) {
        await sendTelegramMessage(config.bot_token, cbChatId, `❌ Error: ${String(e)}`);
      }
      return new Response("OK", { status: 200 });
    }

    if (action === "email_reject") {
      await env.DB.prepare(
        `UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`
      ).bind(actionId).run();
      await sendTelegramMessage(config.bot_token, cbChatId, "❌ Email cancelado.");
      return new Response("OK", { status: 200 });
    }

    if (action === "email_edit") {
      await env.DB.prepare(
        `UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`
      ).bind(actionId).run();
      await sendTelegramMessage(config.bot_token, cbChatId, "✏️ OK, dime qué quieres cambiar y lo vuelvo a redactar.");
      return new Response("OK", { status: 200 });
    }

    // ── Calendario: aprobar/rechazar/editar evento ────────────────────────
    if (action === "cal_approve") {
      const pending = await env.DB.prepare(
        `SELECT action_data, status FROM pending_actions WHERE id = ?`
      ).bind(actionId).first<{ action_data: string; status: string }>();

      if (!pending || pending.status !== "pending") {
        await sendTelegramMessage(config.bot_token, cbChatId, "⚠️ Esta acción ya fue procesada.");
        return new Response("OK", { status: 200 });
      }

      const data = JSON.parse(pending.action_data) as {
        title: string; date: string; startTime: string; endTime: string;
        description: string; attendees: string[]; googleToken: string; companyId: number;
      };

      // Obtener token fresco de Google
      const freshToken = await getValidGoogleToken(env, data.companyId);
      if (!freshToken) {
        await sendTelegramMessage(config.bot_token, cbChatId, "⚠️ Google Calendar no conectado. Conecta tu cuenta en el dashboard.");
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
          eventBody.attendees = data.attendees.map(email => ({ email }));
        }

        const calRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${freshToken}`,
          },
          body: JSON.stringify(eventBody),
        });

        if (calRes.ok) {
          const event = await calRes.json() as { htmlLink?: string };
          await env.DB.prepare(
            `UPDATE pending_actions SET status = 'executed', executed_at = datetime('now'), execution_result = ? WHERE id = ?`
          ).bind(event.htmlLink ?? "ok", actionId).run();
          const attendeeText = data.attendees.length > 0 ? `\nInvitados: ${data.attendees.join(", ")}` : "";
          await sendTelegramMessage(config.bot_token, cbChatId,
            `✅ Evento agendado\n\n📅 <b>${data.title}</b>\n🕐 ${data.date} ${data.startTime}-${data.endTime}${attendeeText}`
          );
        } else {
          const err = await calRes.text();
          await env.DB.prepare(
            `UPDATE pending_actions SET status = 'failed', execution_result = ? WHERE id = ?`
          ).bind(err, actionId).run();
          await sendTelegramMessage(config.bot_token, cbChatId, `❌ Error al crear evento: ${err}`);
        }
      } catch (e) {
        await sendTelegramMessage(config.bot_token, cbChatId, `❌ Error: ${String(e)}`);
      }
      return new Response("OK", { status: 200 });
    }

    if (action === "cal_reject") {
      await env.DB.prepare(
        `UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`
      ).bind(actionId).run();
      await sendTelegramMessage(config.bot_token, cbChatId, "❌ Evento cancelado.");
      return new Response("OK", { status: 200 });
    }

    if (action === "cal_edit") {
      await env.DB.prepare(
        `UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`
      ).bind(actionId).run();
      await sendTelegramMessage(config.bot_token, cbChatId, "✏️ OK, dime qué quieres cambiar del evento.");
      return new Response("OK", { status: 200 });
    }

    // ── Follow-up: aprobar/rechazar ───────────────────────────────────────
    if (action === "fu_approve") {
      const pending = await env.DB.prepare(
        `SELECT status FROM pending_actions WHERE id = ?`
      ).bind(actionId).first<{ status: string }>();
      if (!pending || pending.status !== "pending") {
        await sendTelegramMessage(config.bot_token, cbChatId, "⚠️ Esta acción ya fue procesada.");
        return new Response("OK", { status: 200 });
      }
      await env.DB.prepare(
        `UPDATE pending_actions SET status = 'scheduled', decided_at = datetime('now') WHERE id = ?`
      ).bind(actionId).run();
      await sendTelegramMessage(config.bot_token, cbChatId, "✅ Follow-up programado. Te avisaré cuando se envíe.");
      return new Response("OK", { status: 200 });
    }

    if (action === "fu_reject") {
      await env.DB.prepare(
        `UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now') WHERE id = ?`
      ).bind(actionId).run();
      await sendTelegramMessage(config.bot_token, cbChatId, "❌ Follow-up cancelado.");
      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });
  }

  // ── Mensaje normal (texto o voz) ─────────────────────────────────────────
  const message = update.message;
  if (!message?.from) return new Response("OK", { status: 200 });
  if (!message.text && !message.voice) return new Response("OK", { status: 200 });

  const chatId = message.chat.id;
  const fromName = message.from.first_name ?? message.from.username ?? "Usuario";

  // ── Transcripción de nota de voz ────────────────────────────────────────
  let text: string;
  if (message.voice) {
    try {
      // 1. Obtener URL del archivo de Telegram
      const fileRes = await telegramRequest(config.bot_token, "getFile", { file_id: message.voice.file_id });
      const filePath = (fileRes.result as { file_path?: string })?.file_path;
      if (!filePath) {
        await sendTelegramMessage(config.bot_token, chatId, "⚠️ No pude obtener el audio.");
        return new Response("OK", { status: 200 });
      }

      // 2. Descargar el audio
      const audioUrl = `https://api.telegram.org/file/bot${config.bot_token}/${filePath}`;
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) {
        await sendTelegramMessage(config.bot_token, chatId, "⚠️ No pude descargar el audio.");
        return new Response("OK", { status: 200 });
      }
      const audioBuffer = await audioRes.arrayBuffer();

      // 3. Transcribir con Whisper (Cloudflare Workers AI — gratis)
      const transcription = await env.AI.run(
        "@cf/openai/whisper" as Parameters<typeof env.AI.run>[0],
        { audio: [...new Uint8Array(audioBuffer)] }
      ) as { text?: string };

      const transcribedText = transcription.text?.trim();
      if (!transcribedText) {
        await sendTelegramMessage(config.bot_token, chatId, "⚠️ No pude entender el audio. Intenta de nuevo.");
        return new Response("OK", { status: 200 });
      }

      text = transcribedText;
      // Confirmar la transcripción al usuario
      await sendTelegramMessage(config.bot_token, chatId, `🎙️ <i>${text}</i>`);
    } catch (e) {
      console.error("[telegram] Voice transcription error:", String(e));
      await sendTelegramMessage(config.bot_token, chatId, "⚠️ Error al procesar el audio.");
      return new Response("OK", { status: 200 });
    }
  } else {
    text = message.text!.trim();
  }

  // Buscar agente activo de la empresa
  const agentProfile = await getAgentProfileBySlug(env, companySlug);
  if (!agentProfile) {
    await sendTelegramMessage(config.bot_token, chatId, "Este asistente no está configurado aún.");
    return new Response("OK", { status: 200 });
  }

  // Comandos básicos
  if (text === "/start") {
    await sendTelegramMessage(
      config.bot_token,
      chatId,
      `¡Hola ${fromName}! Soy el asistente de <b>${agentProfile.company_name}</b>. ¿En qué puedo ayudarte?`
    );
    return new Response("OK", { status: 200 });
  }

  if (text === "/help") {
    await sendTelegramMessage(
      config.bot_token,
      chatId,
      `Soy el asistente de <b>${agentProfile.company_name}</b>. Puedes preguntarme sobre nuestros servicios o productos. Escríbeme lo que necesitas.`
    );
    return new Response("OK", { status: 200 });
  }

  // Session por chat_id
  const sessionId = `tg-${companySlug}-${chatId}`;

  // ── Límite de plan ──────────────────────────────────────────────────────
  const chatLimit = await checkUsageLimit(env, agentProfile.company_id, "chat");
  if (!chatLimit.allowed) {
    await sendTelegramMessage(
      config.bot_token,
      chatId,
      `🚫 Has alcanzado el límite de mensajes de tu plan ${chatLimit.planName}. Tu agente no podrá responder hasta el próximo mes o hasta que actualices en tu dashboard.`
    );
    return new Response("OK", { status: 200 });
  }

  // Rate limit: 30 mensajes por hora
  const recentCount = await countRecentMessages(env, sessionId, 60);
  if (recentCount >= 30) {
    await sendTelegramMessage(config.bot_token, chatId, "Has alcanzado el límite de mensajes por hora. Intenta más tarde.");
    return new Response("OK", { status: 200 });
  }

  // ── Agent Brain: acciones desktop explícitas ───────────────────────────
  const brain = await processMessage(text, env, agentProfile.company_id);

  if (brain.type === "desktop_actions") {
    const batchId = crypto.randomUUID();
    await sendTelegramMessage(config.bot_token, chatId, `🔍 ${brain.thinking}`);
    for (const action of brain.actions) {
      await createDesktopTask(env, agentProfile.company_id, action.tool, action.config, text, batchId);
    }
    await saveChatMessage(env, sessionId, agentProfile.company_id, agentProfile.agent_id, "user", text);
    await saveChatMessage(env, sessionId, agentProfile.company_id, agentProfile.agent_id, "assistant", `🔍 ${brain.thinking}`);
    return new Response("OK", { status: 200 });
  }

  // ── Orquestador Central ────────────────────────────────────────────────
  try {
    // Cargar historial del orquestador (conversation_history)
    const history = await loadHistory(env, sessionId, 10, agentProfile.company_id);

    // Cargar integraciones (Google, GitHub)
    const integrations = await loadIntegrations(env, agentProfile.company_id);
    const googleToken = integrations.googleToken
      ? await getValidGoogleToken(env, agentProfile.company_id)
      : null;

    // Datos de la empresa
    const companyRow = await env.DB.prepare(
      `SELECT name, industry FROM companies WHERE id = ?`
    ).bind(agentProfile.company_id).first<{ name: string; industry: string | null }>();

    const result = await orchestrate({
      message: text,
      companyId: agentProfile.company_id,
      companyName: companyRow?.name ?? agentProfile.company_name ?? "tu empresa",
      industry: companyRow?.industry ?? undefined,
      sessionId,
      channel: "telegram",
      history,
      googleToken,
      githubToken: integrations.githubToken,
      connectedProviders: integrations.connectedProviders,
    }, env);

    const reply = result.text || "Lo siento, no pude procesar tu mensaje.";

    // Guardar en conversation_history y en chat_messages (legacy)
    const routing = { model: result.model_used, complexity: result.complexity as "simple" | "medium" | "complex", tools_needed: result.tools_used as never[], estimated_cost: result.estimated_cost, provider: "cloudflare" as const };
    await saveConversationTurn(env, { message: text, companyId: agentProfile.company_id, companyName: companyRow?.name ?? "", sessionId, channel: "telegram" }, text, reply, routing);
    await saveChatMessage(env, sessionId, agentProfile.company_id, agentProfile.agent_id, "user", text);
    await saveChatMessage(env, sessionId, agentProfile.company_id, agentProfile.agent_id, "assistant", reply);

    // Incrementar uso y notificar al 80%
    await incrementUsage(env, agentProfile.company_id, "chat");
    const warn80 = await shouldWarn80(env, agentProfile.company_id, "chat");
    if (warn80 && config.owner_chat_id) {
      const updatedCheck = await checkUsageLimit(env, agentProfile.company_id, "chat");
      await sendTelegramMessage(
        config.bot_token,
        Number(config.owner_chat_id),
        `⚠️ Has usado ${updatedCheck.used} de ${updatedCheck.limit} mensajes de tu plan ${updatedCheck.planName} este mes. Actualiza para no quedarte sin servicio.`
      );
    }

    // ── Email draft: mostrar con botones de aprobación ──────────────────
    if (result.emailDraft) {
      const draft = result.emailDraft;
      const companyName = companyRow?.name ?? agentProfile.company_name ?? "tu empresa";

      // Guardar en pending_actions
      const actionData = JSON.stringify({
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        from_name: companyName,
      });
      const insertResult = await env.DB.prepare(
        `INSERT INTO pending_actions (company_id, action_type, action_data, status, telegram_chat_id)
         VALUES (?, 'send_email', ?, 'pending', ?)`
      ).bind(String(agentProfile.company_id), actionData, chatId).run();

      const actionId = insertResult.meta.last_row_id;

      // Mostrar preview del email con botones
      const preview = `📧 <b>Email listo para enviar</b>\n\n<b>Para:</b> ${draft.to}\n<b>Asunto:</b> ${draft.subject}\n\n${draft.body.slice(0, 500)}${draft.body.length > 500 ? "..." : ""}`;

      await telegramRequest(config.bot_token, "sendMessage", {
        chat_id: chatId,
        text: preview + result.indicator,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Enviar", callback_data: `email_approve:${actionId}` },
              { text: "✏️ Corregir", callback_data: `email_edit:${actionId}` },
              { text: "❌ Cancelar", callback_data: `email_reject:${actionId}` },
            ],
          ],
        },
      });
    } else if (result.calendarDraft) {
      // ── Calendar draft: mostrar con botones de aprobación ──────────────
      const draft = result.calendarDraft;

      const actionData = JSON.stringify({
        ...draft,
        companyId: agentProfile.company_id,
      });
      const insertResult = await env.DB.prepare(
        `INSERT INTO pending_actions (company_id, action_type, action_data, status, telegram_chat_id)
         VALUES (?, 'schedule_meeting', ?, 'pending', ?)`
      ).bind(String(agentProfile.company_id), actionData, chatId).run();

      const actionId = insertResult.meta.last_row_id;

      const attendeeText = draft.attendees.length > 0 ? `\n👥 Invitados: ${draft.attendees.join(", ")}` : "";
      const preview = `📅 <b>Evento listo para agendar</b>\n\n<b>${draft.title}</b>\n🗓️ ${draft.date}\n🕐 ${draft.startTime} - ${draft.endTime}${attendeeText}${draft.description ? `\n📝 ${draft.description}` : ""}`;

      await telegramRequest(config.bot_token, "sendMessage", {
        chat_id: chatId,
        text: preview + result.indicator,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Agendar", callback_data: `cal_approve:${actionId}` },
              { text: "✏️ Cambiar", callback_data: `cal_edit:${actionId}` },
              { text: "❌ Cancelar", callback_data: `cal_reject:${actionId}` },
            ],
          ],
        },
      });
    } else if (result.followupDraft) {
      // ── Follow-up draft: mostrar con botones de aprobación (cadena de 3) ─
      const draft = result.followupDraft;
      const chain = draft.chain ?? [draft.days, draft.days + 4, draft.days + 11];
      const scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + chain[0]);
      const scheduledStr = scheduledDate.toISOString().split("T")[0];

      const actionData = JSON.stringify({
        to: draft.to,
        subject: draft.subject,
        context: draft.context,
        days: draft.days,
        chain,
        chainIndex: 0,
        companyId: agentProfile.company_id,
        companyName: companyRow?.name ?? agentProfile.company_name ?? "tu empresa",
      });
      const insertResult = await env.DB.prepare(
        `INSERT INTO pending_actions (company_id, action_type, action_data, status, telegram_chat_id, followup_number, followup_scheduled_at)
         VALUES (?, 'send_followup', ?, 'pending', ?, 1, ?)`
      ).bind(String(agentProfile.company_id), actionData, chatId, scheduledStr).run();

      const actionId = insertResult.meta.last_row_id;

      // Build chain dates for preview
      const chainDates = chain.map((d) => {
        const dt = new Date();
        dt.setDate(dt.getDate() + d);
        return dt.toISOString().split("T")[0];
      });
      const ordinals = ["1er", "2do", "3er"];
      const chainPreview = chain.map((d, i) => `\n📅 ${ordinals[i] ?? `${i + 1}to`} follow-up: ${chainDates[i]} (en ${d} días)`).join("");

      const preview = `🔄 <b>Follow-up programado (cadena de ${chain.length})</b>\n\n<b>Para:</b> ${draft.to}\n<b>Asunto:</b> ${draft.subject}${chainPreview}\n⏹️ Se detiene si responden\n📝 ${draft.context}\n\n<i>Responde "detener" para cancelar la cadena.</i>`;

      await telegramRequest(config.bot_token, "sendMessage", {
        chat_id: chatId,
        text: preview + result.indicator,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Programar", callback_data: `fu_approve:${actionId}` },
              { text: "❌ Cancelar", callback_data: `fu_reject:${actionId}` },
            ],
          ],
        },
      });
    } else if (result.noteDraft) {
      // ── Note draft: Obsidian + Vectorize ──────────────────────────────
      const note = result.noteDraft;
      const fileName = note.title.replace(/[^a-zA-Z0-9\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s-]/g, "").replace(/\s+/g, "-").slice(0, 60);
      const filePath = `C:/Users/IngPe/OneDrive/Documentos/Obsidian Vault/Ailyn Notes/${fileName}.md`;

      // 1. Desktop task → escribe .md en Obsidian
      await createDesktopTask(env, agentProfile.company_id, "fs_write", {
        path: filePath,
        content: note.content,
      }, `Guardar nota en Obsidian: ${note.title}`);

      // 2. Indexar en Vectorize para búsqueda semántica
      try {
        const embRes = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [note.content.slice(0, 1500)] }) as { data: number[][] };
        const vecId = `${agentProfile.company_id}-note-${Date.now()}`;
        await env.KNOWLEDGE_BASE.insert([{
          id: vecId,
          values: embRes.data[0],
          metadata: { company_id: agentProfile.company_id, title: note.title, text: note.content.slice(0, 900), type: "note", url: note.url },
        }]);
      } catch (e) { console.error("[note] Vectorize error:", String(e)); }

      await sendTelegramMessage(config.bot_token, chatId,
        `\uD83D\uDCDD <b>Nota guardada</b>\n\n<b>${note.title}</b>\n\uD83D\uDD17 ${note.url}\n\n\u2705 Obsidian + Knowledge Base\n\uD83D\uDD0D Pregunta: <i>"qu\u00E9 notas tengo sobre..."</i>` + result.indicator
      );
    } else {
      // Respuesta normal (sin email, calendario ni follow-up)
      await sendTelegramMessage(config.bot_token, chatId, reply + result.indicator);
    }

    // ── Multi-action: si hay acciones pendientes, notificar ────────────
    if (result.remainingActions && result.remainingActions.length > 0) {
      const pendingList = result.remainingActions.map((a, i) => `${i + 1}. ${a}`).join("\n");
      await sendTelegramMessage(
        config.bot_token,
        chatId,
        `⏭️ <b>Acciones pendientes:</b>\n${pendingList}\n\nEscribe "siguiente" o "continúa" para ejecutar la próxima acción.`
      );
    }

    // Notificar al dueño si es primer mensaje
    if (history.length === 0 && config.owner_chat_id) {
      await sendTelegramMessage(
        config.bot_token,
        Number(config.owner_chat_id),
        `🔔 Nuevo mensaje en tu bot\nDe: ${fromName}\nMensaje: ${text.slice(0, 100)}`
      );
    }
  } catch (err) {
    console.error("[telegram] Orchestrator error:", String(err));
    await sendTelegramMessage(
      config.bot_token,
      chatId,
      "⚠️ Hubo un error procesando tu mensaje. Intenta de nuevo en unos segundos."
    );
  }

  return new Response("OK", { status: 200 });
}
