import { EventEmitter } from "events";
import { ApiClient, type DesktopTask } from "./api-client";
import { executeTask } from "./executor";

interface AgentConfig {
  apiUrl: string;
  token: string;
  pollInterval: number;
  headless: boolean;
}

interface LogEntry {
  type: "info" | "success" | "warn" | "error" | "log";
  message: string;
  timestamp: string;
}

const BROWSER_TYPES = new Set(["screenshot", "scrape_data", "fill_form", "download_file"]);

export class AgentRunner extends EventEmitter {
  private config: AgentConfig;
  private api: ApiClient;
  private interval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(config: AgentConfig) {
    super();
    this.config = config;
    this.api = new ApiClient(config);
  }

  private log(type: LogEntry["type"], message: string) {
    const entry: LogEntry = {
      type,
      message,
      timestamp: new Date().toLocaleTimeString("es-MX", { hour12: false }),
    };
    this.emit("log", entry);
  }

  start() {
    this.log("info", "Agente iniciado — esperando tareas...");
    this.poll();
    this.interval = setInterval(() => this.poll(), this.config.pollInterval);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.log("warn", "Agente detenido");
  }

  private async poll() {
    if (this.processing) return;

    try {
      const tasks = await this.api.fetchPendingTasks();
      if (tasks.length === 0) return;

      this.processing = true;

      // Group by batch
      const batches = new Map<string, DesktopTask[]>();
      const standalone: DesktopTask[] = [];
      for (const task of tasks) {
        if (task.batch_id) {
          const batch = batches.get(task.batch_id) ?? [];
          batch.push(task);
          batches.set(task.batch_id, batch);
        } else {
          standalone.push(task);
        }
      }

      for (const task of standalone) await this.runTask(task);
      for (const [batchId, batchTasks] of batches) {
        this.log("info", `Batch ${batchId.slice(0, 8)}... — ${batchTasks.length} tareas`);
        for (const task of batchTasks.sort((a, b) => a.id - b.id)) {
          await this.runTask(task);
        }
      }

      this.processing = false;
    } catch (err) {
      this.processing = false;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("401")) {
        this.log("error", "Token inválido o expirado");
        this.stop();
      }
    }
  }

  private async runTask(task: DesktopTask) {
    this.log("log", `Tarea #${task.id} — ${task.task_type}`);
    if (task.instruction) this.log("info", `"${task.instruction}"`);

    this.emit("taskUpdate", { ...task, status: "running" });
    await this.api.updateStatus(task.id, "running");

    const maxRetries = BROWSER_TYPES.has(task.task_type) ? 2 : 0;
    let result = await executeTask(task, this.config);

    for (let attempt = 1; !result.success && attempt <= maxRetries; attempt++) {
      this.log("warn", `Reintento ${attempt}/${maxRetries}...`);
      await new Promise((r) => setTimeout(r, 2000));
      result = await executeTask(task, this.config);
    }

    if (result.success) {
      await this.api.completeTask(task.id, result.data);
      this.log("success", `Tarea #${task.id} completada`);
      this.emit("taskUpdate", { ...task, status: "completed" });
    } else {
      await this.api.updateStatus(task.id, "failed", result.error);
      this.log("error", `Tarea #${task.id} falló: ${result.error}`);
      this.emit("taskUpdate", { ...task, status: "failed", error: result.error });
    }
  }
}
