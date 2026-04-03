import { ApiClient, type DesktopTask } from "./api-client";
import type { AgentConfig } from "./config";
import { executeTask } from "./executor";
import * as logger from "./logger";

const BROWSER_TYPES = new Set(["screenshot", "scrape_data", "fill_form", "download_file"]);

async function runTask(task: DesktopTask, config: AgentConfig, api: ApiClient): Promise<void> {
  logger.log(`Tarea encontrada: #${task.id} — ${task.task_type}`);
  if (task.instruction) logger.info(`Instrucción: "${task.instruction}"`);

  await api.updateStatus(task.id, "running");

  const maxRetries = BROWSER_TYPES.has(task.task_type) ? 2 : 0;
  let lastResult = await executeTask(task, config);

  for (let attempt = 1; !lastResult.success && attempt <= maxRetries; attempt++) {
    logger.warn(`Reintento ${attempt}/${maxRetries} para tarea #${task.id}...`);
    await new Promise((r) => setTimeout(r, 2000));
    lastResult = await executeTask(task, config);
  }

  if (lastResult.success) {
    await api.completeTask(task.id, lastResult.data);
    logger.success(`Tarea #${task.id} completada`);
  } else {
    await api.updateStatus(task.id, "failed", lastResult.error);
    logger.error(`Tarea #${task.id} falló: ${lastResult.error}`);
  }
}

export async function startPoller(config: AgentConfig): Promise<void> {
  const api = new ApiClient(config);
  let processing = false;

  const poll = async () => {
    if (processing) return;

    try {
      const tasks = await api.fetchPendingTasks();
      if (tasks.length === 0) return;

      processing = true;

      // Group tasks by batch_id for sequential execution
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

      // Execute standalone tasks
      for (const task of standalone) {
        await runTask(task, config, api);
      }

      // Execute batch tasks in sequence (sorted by id = creation order)
      for (const [batchId, batchTasks] of batches) {
        logger.info(`Batch ${batchId.slice(0, 8)}... — ${batchTasks.length} tareas en secuencia`);
        const sorted = batchTasks.sort((a, b) => a.id - b.id);
        for (const task of sorted) {
          await runTask(task, config, api);
        }
      }

      processing = false;
    } catch (err) {
      processing = false;
      const msg = err instanceof Error ? err.message : String(err);
      // Don't spam on auth errors
      if (msg.includes("401")) {
        logger.error("Token inválido o expirado. Ejecuta 'openclaw login' de nuevo.");
        process.exit(1);
      }
      if (!msg.includes("fetch")) {
        logger.warn(`Error polling: ${msg}`);
      }
    }
  };

  // Initial poll
  await poll();

  // Continuous polling
  setInterval(poll, config.pollInterval);

  // Keep alive
  await new Promise(() => {});
}
