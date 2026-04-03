import type { TaskResult } from "../executor";
import type { AgentConfig } from "../config";
import { withBrowser, takeScreenshot } from "./browser-utils";

export async function handleScreenshot(
  config: Record<string, unknown>,
  agentConfig: AgentConfig
): Promise<TaskResult> {
  const url = config.url as string | undefined;
  if (!url) return { success: false, data: {}, error: "URL requerida" };

  try {
    const result = await withBrowser(agentConfig, async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(2000);
      const title = await page.title();
      const screenshot = await takeScreenshot(page);
      return { title, url, screenshot };
    });

    return { success: true, data: result };
  } catch (err) {
    return { success: false, data: {}, error: `Screenshot falló: ${err instanceof Error ? err.message : String(err)}` };
  }
}
