import { ApiClient } from "./api-client";
import type { AgentConfig } from "./config";
import { executeTask } from "./executor";
import * as logger from "./logger";

export async function startPoller(config: AgentConfig): Promise<void> {
  const api = new ApiClient(config);
  let processing = false;

  const poll = async () => {
    if (processing) return;

    try {
      const tasks = await api.fetchPendingTasks();

      for (const task of tasks) {
        processing = true;
        logger.log(`Tarea encontrada: #${task.id} — ${task.task_type}`);
        if (task.instruction) {
          logger.info(`Instrucción: "${task.instruction}"`);
        }

        // Mark as running
        await api.updateStatus(task.id, "running");

        // Execute
        const result = await executeTask(task, config);

        if (result.success) {
          await api.completeTask(task.id, result.data);
          logger.success(`Tarea #${task.id} completada`);
        } else {
          await api.updateStatus(task.id, "failed", result.error);
          logger.error(`Tarea #${task.id} falló: ${result.error}`);
        }

        processing = false;
      }
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
