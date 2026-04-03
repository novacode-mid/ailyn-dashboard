import * as fs from "fs";
import type { TaskResult } from "../executor";
import { resolvePath } from "./fs-utils";

export async function handleFsDelete(config: Record<string, unknown>): Promise<TaskResult> {
  const rawPath = config.path as string | undefined;
  if (!rawPath) return { success: false, data: {}, error: "path requerido" };

  try {
    const fullPath = resolvePath(rawPath);
    if (!fs.existsSync(fullPath)) {
      return { success: false, data: {}, error: `No encontrado: ${fullPath}` };
    }

    fs.rmSync(fullPath, { recursive: true, force: true });
    return { success: true, data: { path: fullPath, deleted: true } };
  } catch (err) {
    return { success: false, data: {}, error: `fs_delete falló: ${err instanceof Error ? err.message : String(err)}` };
  }
}
