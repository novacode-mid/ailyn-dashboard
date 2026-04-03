import * as os from "os";
import * as path from "path";

export function resolvePath(p: string): string {
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (p === "~") return os.homedir();
  return path.resolve(p);
}
