import * as fs from "fs";
import * as path from "path";
import type { TaskResult } from "../executor";
import { resolvePath } from "./fs-utils";

export async function handleFsList(config: Record<string, unknown>): Promise<TaskResult> {
  const rawPath = config.path as string | undefined;
  if (!rawPath) return { success: false, data: {}, error: "path requerido" };

  try {
    const fullPath = resolvePath(rawPath);
    if (!fs.existsSync(fullPath)) {
      return { success: false, data: {}, error: `Directorio no encontrado: ${fullPath}` };
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const files = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "directory" : "file",
      size: e.isFile() ? fs.statSync(path.join(fullPath, e.name)).size : undefined,
    }));

    return { success: true, data: { path: fullPath, count: files.length, files } };
  } catch (err) {
    return { success: false, data: {}, error: `fs_list falló: ${err instanceof Error ? err.message : String(err)}` };
  }
}
