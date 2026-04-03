import type { AgentConfig } from "./executor";

export interface DesktopTask {
  id: number;
  task_type: string;
  instruction: string | null;
  config: string;
  status: string;
  batch_id: string | null;
  created_at: string;
}

export class ApiClient {
  private baseUrl: string;
  private token: string;

  constructor(config: AgentConfig) {
    this.baseUrl = config.apiUrl;
    this.token = config.token;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  async fetchPendingTasks(): Promise<DesktopTask[]> {
    const res = await fetch(`${this.baseUrl}/api/desktop/tasks?status=pending`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`fetchTasks failed: ${res.status}`);
    const data = (await res.json()) as { tasks: DesktopTask[] };
    return data.tasks ?? [];
  }

  async updateStatus(taskId: number, status: string, error?: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/desktop/tasks/${taskId}/status`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ status, error }),
    });
    if (!res.ok) throw new Error(`updateStatus failed: ${res.status}`);
  }

  async completeTask(taskId: number, result: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/desktop/tasks/${taskId}/complete`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ result }),
    });
    if (!res.ok) throw new Error(`completeTask failed: ${res.status}`);
  }
}
