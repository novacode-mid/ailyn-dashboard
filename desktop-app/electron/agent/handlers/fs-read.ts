import * as fs from "fs";
import type { TaskResult } from "../executor";
import { resolvePath } from "./fs-utils";

export async function handleFsRead(config: Record<string, unknown>): Promise<TaskResult> {
  const rawPath = config.path as string | undefined;
  if (!rawPath) return { success: false, data: {}, error: "path requerido" };

  try {
    const fullPath = resolvePath(rawPath);
    if (!fs.existsSync(fullPath)) {
      return { success: false, data: {}, error: `Archivo no encontrado: ${fullPath}` };
    }
    const content = fs.readFileSync(fullPath, "utf-8");
    return { success: true, data: { path: fullPath, content: content.slice(0, 10_000), size: content.length } };
  } catch (err) {
    return { success: false, data: {}, error: `fs_read falló: ${err instanceof Error ? err.message : String(err)}` };
  }
}
