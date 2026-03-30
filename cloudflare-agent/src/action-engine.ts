// ── Action Engine: ciclo proponer → aprobar → ejecutar ───────────────────

import type { Env } from "./types";
import { sendEmail } from "./email-sender";

export interface ActionData {
  to: string;
  subject: string;
  body: string;
  from_name: string;
  from_email: string;
}

interface PendingAction {
  id: number;
  company_id: string;
  agent_id: number | null;
  lead_id: string | null;
  action_type: string;
  action_data: string;
  status: string;
  telegram_chat_id: string | null;
  telegram_message_id: number | null;
  followup_number: number;
}

// ── Crear acción y enviar solicitud de aprobación por Telegram ────────────

export async function proposeAction(
  env: Env,
  options: {
    company_id: string;
    agent_id?: number;
    lead_id: string;
    action_type: string;
    action_data: ActionData;
    telegram_chat_id: string;
    followup_number?: number;
  }
): Promise<number> {
  // 1. Guardar la acción en D1
  const result = await env.DB.prepare(`
    INSERT INTO pending_actions (company_id, agent_id, lead_id, action_type, action_data, status, telegram_chat_id, followup_number)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(
    options.company_id,
    options.agent_id ?? null,
    options.lead_id,
    options.action_type,
    JSON.stringify(options.action_data),
    options.telegram_chat_id,
    options.followup_number ?? 0
  ).run();

  const actionId = result.meta.last_row_id as number;

  // 2. Enviar mensaje a Telegram con botones inline
  const data = options.action_data;
  const followupLabel = options.followup_number ? ` (Follow-up #${options.followup_number})` : "";
  const bodyPreview = data.body
    .replace(/<[^>]*>/g, "")
    .trim()
    .substring(0, 400);

  const messageText =
    `📧 *Acción propuesta${followupLabel}*\n\n` +
    `*Para:* ${data.to}\n` +
    `*Asunto:* ${data.subject}\n\n` +
    `*Contenido:*\n${bodyPreview}${bodyPreview.length >= 400 ? "..." : ""}\n\n` +
    `¿Apruebas enviar este email?`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "✅ Enviar", callback_data: `action_approve_${actionId}` },
        { text: "❌ Descartar", callback_data: `action_reject_${actionId}` },
      ],
    ],
  };

  const tgResp = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: options.telegram_chat_id,
        text: messageText,
        parse_mode: "Markdown",
        reply_markup: inlineKeyboard,
      }),
    }
  );

  // Guardar message_id para referencia
  if (tgResp.ok) {
    const tgData = await tgResp.json() as { result?: { message_id?: number } };
    const messageId = tgData.result?.message_id;
    if (messageId) {
      await env.DB.prepare(
        "UPDATE pending_actions SET telegram_message_id = ? WHERE id = ?"
      ).bind(messageId, actionId).run();
    }
  }

  return actionId;
}

// ── Ejecutar una acción aprobada ──────────────────────────────────────────

export async function executeAction(
  env: Env,
  actionId: number
): Promise<{ success: boolean; error?: string }> {
  const action = await env.DB.prepare(
    "SELECT * FROM pending_actions WHERE id = ?"
  ).bind(actionId).first() as PendingAction | null;

  if (!action || action.status !== "approved") {
    console.log("[execute] ABORT — action not found or not approved. status:", action?.status ?? "null");
    return { success: false, error: "Action not found or not approved" };
  }

  console.log("[execute] action type:", action.action_type);
  console.log("[execute] action data:", action.action_data);

  const data = JSON.parse(action.action_data) as ActionData;

  switch (action.action_type) {
    case "send_email":
    case "send_followup": {
      if (!env.RESEND_API_KEY) {
        // Sin Resend: marcar como ejecutado manualmente
        await env.DB.prepare(
          `UPDATE pending_actions SET status = 'executed', executed_at = datetime('now'),
           execution_result = 'No RESEND_API_KEY — email listo para envío manual' WHERE id = ?`
        ).bind(actionId).run();
        // Programar siguiente follow-up igual que si se hubiera enviado
        await scheduleFollowup(env, action);
        await updateLeadStatus(env, action.lead_id, "contacted");
        return { success: true, error: "No RESEND_API_KEY — showed for manual send" };
      }

      const emailResult = await sendEmail(env.RESEND_API_KEY, {
        to: data.to,
        subject: data.subject,
        body: data.body,
        from_name: data.from_name,
        from_email: data.from_email,
      });

      if (emailResult.success) {
        await env.DB.prepare(
          `UPDATE pending_actions SET status = 'executed', executed_at = datetime('now'),
           execution_result = ? WHERE id = ?`
        ).bind(`Sent via Resend. Message ID: ${emailResult.messageId}`, actionId).run();

        await scheduleFollowup(env, action);
        await updateLeadStatus(env, action.lead_id, "contacted");
        return { success: true };
      } else {
        await env.DB.prepare(
          `UPDATE pending_actions SET status = 'failed', executed_at = datetime('now'),
           execution_result = ? WHERE id = ?`
        ).bind(emailResult.error ?? "Unknown error", actionId).run();
        return { success: false, error: emailResult.error };
      }
    }

    case "close_lead": {
      await updateLeadStatus(env, action.lead_id, "closed");
      await env.DB.prepare(
        `UPDATE pending_actions SET status = 'executed', executed_at = datetime('now') WHERE id = ?`
      ).bind(actionId).run();
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown action type: ${action.action_type}` };
  }
}

// ── Aprobar una acción ────────────────────────────────────────────────────

export async function approveAction(
  env: Env,
  actionId: number
): Promise<{ success: boolean; error?: string }> {
  await env.DB.prepare(
    `UPDATE pending_actions SET status = 'approved', decided_at = datetime('now')
     WHERE id = ? AND status = 'pending'`
  ).bind(actionId).run();
  return executeAction(env, actionId);
}

// ── Rechazar una acción ───────────────────────────────────────────────────

export async function rejectAction(env: Env, actionId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE pending_actions SET status = 'rejected', decided_at = datetime('now')
     WHERE id = ? AND status = 'pending'`
  ).bind(actionId).run();
}

// ── Cerrar lead y cancelar todos sus pendientes ───────────────────────────

export async function closeLeadActions(env: Env, actionId: number): Promise<void> {
  const action = await env.DB.prepare(
    "SELECT lead_id FROM pending_actions WHERE id = ?"
  ).bind(actionId).first() as { lead_id: string | null } | null;

  if (action?.lead_id) {
    await updateLeadStatus(env, action.lead_id, "closed");
    await env.DB.prepare(
      `UPDATE pending_actions SET status = 'cancelled'
       WHERE lead_id = ? AND status IN ('pending', 'scheduled')`
    ).bind(action.lead_id).run();
  }
}

// ── Helpers internos ─────────────────────────────────────────────────────

async function scheduleFollowup(env: Env, action: PendingAction): Promise<void> {
  const nextFollowup = (action.followup_number ?? 0) + 1;
  if (nextFollowup > 3) return; // Máximo 3 follow-ups

  const followupDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO pending_actions
      (company_id, agent_id, lead_id, action_type, action_data, status, telegram_chat_id, followup_number, followup_scheduled_at)
    VALUES (?, ?, ?, 'send_followup', '{}', 'scheduled', ?, ?, ?)
  `).bind(
    action.company_id,
    action.agent_id,
    action.lead_id,
    action.telegram_chat_id,
    nextFollowup,
    followupDate
  ).run();
}

async function updateLeadStatus(env: Env, leadId: string | null, status: string): Promise<void> {
  if (!leadId) return;
  await env.DB.prepare(
    `UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(status, leadId).run();
}
