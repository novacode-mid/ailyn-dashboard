import type { DesktopTask } from "./api-client";
import type { AgentConfig } from "./config";
import { handleScreenshot } from "./handlers/screenshot";
import { handleScrape } from "./handlers/scrape";
import { handleFillForm } from "./handlers/fill-form";
import { handleDownload } from "./handlers/download";
import { handleFsWrite } from "./handlers/fs-write";
import { handleFsRead } from "./handlers/fs-read";
import { handleFsList } from "./handlers/fs-list";
import { handleFsDelete } from "./handlers/fs-delete";
import * as logger from "./logger";

export interface TaskResult {
  success: boolean;
  data: Record<string, unknown>;
  error?: string;
}

export async function executeTask(task: DesktopTask, config: AgentConfig): Promise<TaskResult> {
  let parsedConfig: Record<string, unknown>;
  try {
    parsedConfig = typeof task.config === "string" ? JSON.parse(task.config) : task.config;
  } catch {
    return { success: false, data: {}, error: "Config JSON inválido" };
  }

  logger.info(`Ejecutando: ${task.task_type} (task #${task.id})`);

  switch (task.task_type) {
    case "screenshot":
      return handleScreenshot(parsedConfig, config);
    case "scrape_data":
      return handleScrape(parsedConfig, config);
    case "fill_form":
      return handleFillForm(parsedConfig, config);
    case "download_file":
      return handleDownload(parsedConfig, config);
    case "fs_write":
      return handleFsWrite(parsedConfig);
    case "fs_read":
      return handleFsRead(parsedConfig);
    case "fs_list":
      return handleFsList(parsedConfig);
    case "fs_delete":
      return handleFsDelete(parsedConfig);
    default:
      return { success: false, data: {}, error: `Tipo de tarea desconocido: ${task.task_type}` };
  }
}
