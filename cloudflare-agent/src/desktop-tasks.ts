/**
 * desktop-tasks.ts — D1 helpers + endpoint handlers for Ailyn Desktop integration
 *
 * Routes (all behind Bearer auth):
 *   GET    /api/desktop/tasks          → list pending/running tasks for the authenticated company
 *   POST   /api/desktop/tasks          → create a new task
 *   GET    /api/desktop/tasks/:id      → get single task
 *   PUT    /api/desktop/tasks/:id/status   → update status (running | failed)
 *   POST   /api/desktop/tasks/:id/complete → mark completed + notify via Telegram
 */

import type { Env } from "./types";
import { authenticateUser } from "./auth";
import { runLLM } from "./llm-router";

// ── CORS ──────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface DesktopTask {
  id: number;
  company_id: number;
  task_type: string;
  instruction: string | null;
  config: string;           // JSON string
  status: string;
  result: string | null;    // JSON string
  screenshot_b64: string | null;
  error: string | null;
  batch_id: string | null;
  created_at: string;
  completed_at: string | null;
}

// ── D1 helpers ────────────────────────────────────────────────────────────

export async function listDesktopTasks(
  env: Env,
  companyId: number,
  status?: string
): Promise<DesktopTask[]> {
  if (status) {
    const r = await env.DB.prepare(
      `SELECT id, company_id, task_type, instruction, config, status, result,
              screenshot_b64, error, created_at, completed_at
       FROM desktop_tasks
       WHERE company_id = ? AND status = ?
       ORDER BY created_at DESC LIMIT 50`
    ).bind(companyId, status).all<DesktopTask>();
    return r.results ?? [];
  }
  const r = await env.DB.prepare(
    `SELECT id, company_id, task_type, instruction, config, status, result,
            screenshot_b64, error, created_at, completed_at
     FROM desktop_tasks
     WHERE company_id = ?
     ORDER BY created_at DESC LIMIT 50`
  ).bind(companyId).all<DesktopTask>();
  return r.results ?? [];
}

export async function getDesktopTask(
  env: Env,
  id: number,
  companyId: number
): Promise<DesktopTask | null> {
  return env.DB.prepare(
    `SELECT id, company_id, task_type, instruction, config, status, result,
            screenshot_b64, error, created_at, completed_at
     FROM desktop_tasks WHERE id = ? AND company_id = ?`
  ).bind(id, companyId).first<DesktopTask>();
}

export async function createDesktopTask(
  env: Env,
  companyId: number,
  taskType: string,
  config: Record<string, unknown>,
  instruction?: string,
  batchId?: string
): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO desktop_tasks (company_id, task_type, config, instruction, batch_id)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id`
  ).bind(companyId, taskType, JSON.stringify(config), instruction ?? null, batchId ?? null)
    .first<{ id: number }>();
  return r?.id ?? 0;
}

export async function updateDesktopTaskStatus(
  env: Env,
  id: number,
  companyId: number,
  status: string,
  error?: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE desktop_tasks SET status = ?, error = ? WHERE id = ? AND company_id = ?`
  ).bind(status, error ?? null, id, companyId).run();
}

export async function completeDesktopTask(
  env: Env,
  id: number,
  companyId: number,
  result: Record<string, unknown>
): Promise<void> {
  const screenshotB64 = (result.screenshot as string | undefined) ?? (result.screenshot_b64 as string | undefined) ?? null;
  await env.DB.prepare(
    `UPDATE desktop_tasks
     SET status = 'completed', result = ?, screenshot_b64 = ?, completed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND company_id = ?`
  ).bind(
    JSON.stringify(result),
    screenshotB64,
    id,
    companyId
  ).run();
}

// ── Telegram notification helpers ─────────────────────────────────────────

async function notifyTaskComplete(
  env: Env,
  companyId: number,
  task: DesktopTask,
  result: Record<string, unknown>
): Promise<void> {
  // Obtener chat_id del dueño de la empresa (Telegram owner)
  const ownerRow = await env.DB.prepare(
    `SELECT tc.owner_chat_id, tc.bot_token
     FROM telegram_configs tc
     WHERE tc.company_id = ? AND tc.is_active = 1`
  ).bind(companyId).first<{ owner_chat_id: string | null; bot_token: string }>();

  // Si hay owner_chat_id, usar el bot de la empresa.
  // Si no, usar el bot global (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID).
  const chatIdStr = ownerRow?.owner_chat_id ?? env.TELEGRAM_CHAT_ID;
  const botToken  = ownerRow?.owner_chat_id
    ? ownerRow.bot_token
    : (env.TELEGRAM_BOT_TOKEN ?? ownerRow?.bot_token);
  const chatId    = Number(chatIdStr);
  if (!chatId || !botToken) {
    console.error("[desktop-tasks] notifyTaskComplete: no chatId or botToken", { chatIdStr, hasBotToken: !!botToken });
    return;
  }

  const typeLabel: Record<string, string> = {
    screenshot:    "📸 Screenshot",
    download_file: "📥 Descarga de archivo",
    fill_form:     "📝 Llenado de formulario",
    scrape_data:   "🔎 Extracción de datos",
  };
  const label = typeLabel[task.task_type] ?? task.task_type;
  const config = JSON.parse(task.config) as { url?: string };

  // Si hay screenshot, enviarlo como foto
  const screenshotB64 = (result.screenshot as string | undefined) ?? (result.screenshot_b64 as string | undefined);
  if (screenshotB64) {
    // Convertir base64 a bytes y enviar como multipart/form-data
    const bytes = base64ToUint8Array(screenshotB64);
    const form  = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", new Blob([bytes], { type: "image/png" }), "screenshot.png");
    form.append("caption",
      `🖥️ Tarea completada: ${label}\n` +
      `🔗 URL: ${config.url ?? "—"}\n` +
      `✅ Status: Completado`
    );
    const photoRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    if (!photoRes.ok) {
      const errText = await photoRes.text();
      console.error("[desktop-tasks] sendPhoto failed:", photoRes.status, errText);
    }
    return;
  }

  // Sin screenshot — enviar texto
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text:
        `🖥️ Tarea completada: ${label}\n` +
        `🔗 URL: ${config.url ?? "—"}\n` +
        `✅ Status: Completado`,
    }),
  });
}

async function notifyTaskFailed(
  env: Env,
  companyId: number,
  task: DesktopTask,
  error: string
): Promise<void> {
  const ownerRow = await env.DB.prepare(
    `SELECT tc.owner_chat_id, tc.bot_token
     FROM telegram_configs tc
     WHERE tc.company_id = ? AND tc.is_active = 1`
  ).bind(companyId).first<{ owner_chat_id: string | null; bot_token: string }>();

  const chatIdStr = ownerRow?.owner_chat_id ?? env.TELEGRAM_CHAT_ID;
  const botToken  = ownerRow?.owner_chat_id
    ? ownerRow.bot_token
    : (env.TELEGRAM_BOT_TOKEN ?? ownerRow?.bot_token);
  const chatId    = Number(chatIdStr);
  if (!chatId || !botToken) return;

  const config = JSON.parse(task.config) as { url?: string };

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text:
        `❌ Tarea fallida: ${task.task_type}\n\n` +
        `🔗 URL: ${config.url ?? "—"}\n` +
        `💥 Error: ${error}`,
    }),
  });
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Batch completion + LLM summary ────────────────────────────────────────

async function checkAndSendBatchSummary(
  env: Env,
  batchId: string,
  companyId: number
): Promise<void> {
  // Obtener todas las tareas del batch
  const batchTasks = await env.DB.prepare(
    `SELECT id, task_type, instruction, config, status, result, screenshot_b64, error
     FROM desktop_tasks
     WHERE batch_id = ? AND company_id = ?`
  ).bind(batchId, companyId).all<DesktopTask>();

  const tasks = batchTasks.results ?? [];
  if (tasks.length === 0) return;

  // Verificar que todas estén terminadas (completed o failed)
  const allDone = tasks.every((t) => t.status === "completed" || t.status === "failed");
  if (!allDone) return;

  // Construir contexto de resultados para el LLM
  const instruction = tasks[0].instruction ?? "Tarea del usuario";
  const resultsText = tasks
    .map((t, i) => {
      const cfg = JSON.parse(t.config) as { url?: string; selectors?: Record<string, string> };
      if (t.status === "failed") {
        return `Acción ${i + 1} (${t.task_type} en ${cfg.url ?? "?"}): FALLÓ — ${t.error ?? "error desconocido"}`;
      }
      let resultStr = "";
      if (t.result) {
        try {
          const res = JSON.parse(t.result) as Record<string, unknown>;
          // Excluir screenshot (muy largo) del contexto de texto
          const { screenshot: _s, ...rest } = res;
          resultStr = JSON.stringify(rest);
        } catch {
          resultStr = t.result.slice(0, 500);
        }
      }
      return `Acción ${i + 1} (${t.task_type} en ${cfg.url ?? "?"}): COMPLETADA\nDatos: ${resultStr}`;
    })
    .join("\n\n");

  // Generar resumen con LLM
  const summarySystemPrompt = `Eres Ailyn, un asistente que resume resultados de tareas web de forma clara y útil.
Genera un resumen en español, conciso y accionable. Máximo 3 párrafos. No incluyas JSON ni código.`;

  const summaryUserMsg = `El usuario pidió: "${instruction}"

Resultados obtenidos:
${resultsText}

Genera un resumen útil de lo que encontraste. Si falló alguna acción, menciona qué salió mal brevemente.`;

  let summaryText = "";
  try {
    const llmResult = await runLLM(env, "summarize", summarySystemPrompt, summaryUserMsg, companyId);
    summaryText = llmResult.text.trim();
  } catch (e) {
    console.error("[desktop-tasks] batch LLM summary error:", String(e));
    summaryText = `✅ Completé ${tasks.filter((t) => t.status === "completed").length}/${tasks.length} acciones.`;
  }

  // Obtener datos de Telegram para notificar
  const ownerRow = await env.DB.prepare(
    `SELECT owner_chat_id, bot_token FROM telegram_configs WHERE company_id = ? AND is_active = 1`
  ).bind(companyId).first<{ owner_chat_id: string | null; bot_token: string }>();

  const chatIdStr = ownerRow?.owner_chat_id ?? env.TELEGRAM_CHAT_ID;
  const botToken  = ownerRow?.owner_chat_id
    ? ownerRow.bot_token
    : (env.TELEGRAM_BOT_TOKEN ?? ownerRow?.bot_token);
  const chatId = Number(chatIdStr);
  if (!chatId || !botToken) return;

  // Enviar resumen de texto
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: summaryText }),
  });

  // Enviar screenshots si hay
  for (const t of tasks) {
    if (t.screenshot_b64) {
      try {
        const bytes = base64ToUint8Array(t.screenshot_b64);
        const cfg = JSON.parse(t.config) as { url?: string };
        const form = new FormData();
        form.append("chat_id", String(chatId));
        form.append("photo", new Blob([bytes], { type: "image/png" }), "screenshot.png");
        form.append("caption", `📸 ${cfg.url ?? t.task_type}`);
        const photoRes = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: "POST",
          body: form,
        });
        if (!photoRes.ok) {
          console.error("[desktop-tasks] batch sendPhoto failed:", await photoRes.text());
        }
      } catch (e) {
        console.error("[desktop-tasks] batch screenshot send error:", String(e));
      }
    }
  }
}

// ── Route handlers ────────────────────────────────────────────────────────

export async function handleDesktopTasks(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return json({ error: "No autorizado" }, 401);

  const companyId = user.company_id;

  // GET /api/desktop/tasks[?status=pending]
  if (request.method === "GET" && pathname === "/api/desktop/tasks") {
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    const tasks  = await listDesktopTasks(env, companyId, status);
    // Strip heavy screenshot_b64 from list to keep payload small
    const light  = tasks.map(({ screenshot_b64: _s, ...t }) => t);
    return json({ tasks: light });
  }

  // GET /api/desktop/tasks/:id
  const idMatch = pathname.match(/^\/api\/desktop\/tasks\/(\d+)$/);
  if (request.method === "GET" && idMatch) {
    const task = await getDesktopTask(env, Number(idMatch[1]), companyId);
    if (!task) return json({ error: "Tarea no encontrada" }, 404);
    return json(task);
  }

  // POST /api/desktop/tasks — crear tarea
  if (request.method === "POST" && pathname === "/api/desktop/tasks") {
    let body: { task_type?: string; config?: Record<string, unknown>; instruction?: string };
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!body.task_type || !body.config) {
      return json({ error: "task_type y config son requeridos" }, 400);
    }
    const id = await createDesktopTask(env, companyId, body.task_type, body.config, body.instruction);
    return json({ id, status: "pending" }, 201);
  }

  // PUT /api/desktop/tasks/:id/status
  const statusMatch = pathname.match(/^\/api\/desktop\/tasks\/(\d+)\/status$/);
  if (request.method === "PUT" && statusMatch) {
    let body: { status?: string; error?: string };
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!body.status) return json({ error: "status requerido" }, 400);
    await updateDesktopTaskStatus(env, Number(statusMatch[1]), companyId, body.status, body.error);

    // Si falló, notificar por Telegram
    if (body.status === "failed" && body.error) {
      const task = await getDesktopTask(env, Number(statusMatch[1]), companyId);
      if (task) {
        await notifyTaskFailed(env, companyId, task, body.error).catch(() => {});
      }
    }
    return json({ ok: true });
  }

  // POST /api/desktop/tasks/:id/complete
  const completeMatch = pathname.match(/^\/api\/desktop\/tasks\/(\d+)\/complete$/);
  if (request.method === "POST" && completeMatch) {
    let body: { result?: Record<string, unknown> };
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const taskId = Number(completeMatch[1]);
    const result = body.result ?? {};
    await completeDesktopTask(env, taskId, companyId, result);

    // Notificar por Telegram con screenshot si hay
    const task = await getDesktopTask(env, taskId, companyId);
    if (task) {
      if (task.batch_id) {
        // Tarea de batch: verificar si todas terminaron y enviar resumen LLM
        await checkAndSendBatchSummary(env, task.batch_id, companyId).catch((e) => {
          console.error("[desktop-tasks] checkAndSendBatchSummary error:", String(e));
        });
      } else {
        // Tarea individual: notificación directa con screenshot
        await notifyTaskComplete(env, companyId, task, result).catch((e) => {
          console.error("[desktop-tasks] notifyTaskComplete error:", String(e));
        });
      }
    }
    return json({ ok: true });
  }

  return json({ error: "Not Found" }, 404);
}
