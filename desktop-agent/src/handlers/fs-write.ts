import * as fs from "fs";
import * as path from "path";
import type { TaskResult } from "../executor";
import { resolvePath } from "./fs-utils";

export async function handleFsWrite(config: Record<string, unknown>): Promise<TaskResult> {
  const rawPath = config.path as string | undefined;
  const content = config.content as string | undefined;

  if (!rawPath) return { success: false, data: {}, error: "path requerido" };
  if (content === undefined) return { success: false, data: {}, error: "content requerido" };

  try {
    const fullPath = resolvePath(rawPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
    return { success: true, data: { path: fullPath, size: Buffer.byteLength(content) } };
  } catch (err) {
    return { success: false, data: {}, error: `fs_write falló: ${err instanceof Error ? err.message : String(err)}` };
  }
}
