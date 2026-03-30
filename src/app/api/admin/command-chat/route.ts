import { NextResponse } from "next/server";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";
const ADMIN_TOKEN = process.env.AGENT_ADMIN_TOKEN ?? "ailyn-admin-2026";
const DAEMON_URL = process.env.DAEMON_URL ?? "http://localhost:4000";
const DAEMON_TOKEN = process.env.DAEMON_TOKEN ?? "dev-token-123";

const MAX_TOOL_ROUNDS = 5; // safety limit para el bucle

// ── Tipos locales ─────────────────────────────────────────────────────────

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResult {
  id: string;
  content: string;
}

interface WorkerResponse {
  // Respuesta final
  reply?: string;
  // Necesita ejecución de tools
  pending_tool_calls?: ToolCall[];
  messages_before_tools?: unknown[];
  // Error
  error?: string;
}

// ── Ejecutar una tool call contra el daemon local ─────────────────────────

async function executeFsTool(tc: ToolCall): Promise<ToolResult> {
  const headers: Record<string, string> = { "x-daemon-token": DAEMON_TOKEN };
  let content: string;

  try {
    if (tc.name === "fs_list") {
      const path = String(tc.arguments.path ?? ".");
      const r = await fetch(
        `${DAEMON_URL}/api/fs/list?path=${encodeURIComponent(path)}`,
        { headers }
      );
      const data = await r.json() as { items?: Array<{ name: string; type: string }>; error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      const items = data.items ?? [];
      // Format as readable list for the model
      content = `Directorio: ${path}\nContenido (${items.length} elementos):\n` +
        items.map((it) => `  [${it.type}] ${it.name}`).join("\n");
    } else if (tc.name === "fs_read") {
      const filePath = String(tc.arguments.filePath ?? "");
      const r = await fetch(`${DAEMON_URL}/api/fs/read`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
      });
      const data = await r.json() as { content?: string; error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      content = data.content ?? "";
    } else if (tc.name === "fs_write") {
      const filePath = String(tc.arguments.filePath ?? "");
      const fileContent = String(tc.arguments.content ?? "");
      const r = await fetch(`${DAEMON_URL}/api/fs/write`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, content: fileContent }),
      });
      const data = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      content = `✅ Archivo escrito: ${filePath}`;
    } else {
      content = `[tool desconocida: ${tc.name}]`;
    }
  } catch (err) {
    content = `Error ejecutando ${tc.name}: ${String(err)}`;
  }

  return { id: tc.id, content };
}

// ── Llamar al Worker ──────────────────────────────────────────────────────

async function callWorker(payload: Record<string, unknown>): Promise<WorkerResponse> {
  const res = await fetch(`${WORKER_URL}/api/admin/command-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CF-Token": ADMIN_TOKEN },
    body: JSON.stringify(payload),
  });
  return res.json() as Promise<WorkerResponse>;
}

// ── Handler principal ─────────────────────────────────────────────────────

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = body as {
    message?: string;
    history?: unknown[];
    agent_id?: number;
  };

  // ── Sin agent_id: proxy directo (comportamiento anterior) ─────────────
  if (!parsed.agent_id) {
    const res = await callWorker(parsed as Record<string, unknown>);
    return NextResponse.json(res, { status: res.error ? 400 : 200 });
  }

  // ── God Mode: bucle tool-call ─────────────────────────────────────────
  let workerPayload: Record<string, unknown> = parsed as Record<string, unknown>;
  let workerRes = await callWorker(workerPayload);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const pending = workerRes.pending_tool_calls;
    if (!pending || pending.length === 0) break;

    // Ejecutar tools contra el daemon local en paralelo
    const toolResults = await Promise.all(pending.map(executeFsTool));

    // Llamar al Worker con los resultados
    workerPayload = {
      agent_id: parsed.agent_id,
      tool_results: toolResults,
      pending_tool_calls: pending,
      messages_before_tools: workerRes.messages_before_tools,
    };

    workerRes = await callWorker(workerPayload);
  }

  // Si después del límite todavía hay tool calls pendientes, devolver lo que hay
  const reply = workerRes.reply ?? workerRes.error ?? "Sin respuesta del agente.";
  return NextResponse.json({ reply });
}
