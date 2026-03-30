const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";
const ADMIN_TOKEN = process.env.AGENT_ADMIN_TOKEN ?? "ailyn-admin-2026";

export interface TaskRow {
  id: number;
  title: string;
  description: string;
  status: "pending" | "processing" | "completed" | "failed" | "pending_approval";
  priority: number;
  result: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  pending_approval: number;
  recentTasks: TaskRow[];
  system_status: "active" | "paused";
}

// Parsea el campo "SIGUIENTE_PASO: ..." del resultado de Llama 3.3
export function parseNextStep(result: string | null): string {
  if (!result) return "—";
  const match = result.match(/SIGUIENTE_PASO:\s*(.+)/);
  return match?.[1]?.trim() ?? "—";
}

export function parseNotifyManager(result: string | null): boolean {
  if (!result) return false;
  return /NOTIFICAR_GERENTE:\s*true/i.test(result);
}

export async function setSystemStatus(status: "active" | "paused"): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/admin/system/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CF-Token": ADMIN_TOKEN,
    },
    body: JSON.stringify({ status }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Error setting status: ${res.status}`);
}

export async function fetchAgentStats(): Promise<AgentStats> {
  const res = await fetch(`${WORKER_URL}/api/admin/stats`, {
    headers: { "X-CF-Token": ADMIN_TOKEN },
    next: { revalidate: 30 }, // revalidar cada 30s (Next.js cache)
  });

  if (!res.ok) {
    throw new Error(`Error fetching stats: ${res.status}`);
  }

  return res.json() as Promise<AgentStats>;
}
