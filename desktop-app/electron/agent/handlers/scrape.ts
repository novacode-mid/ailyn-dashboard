import type { TaskResult } from "../executor";
import type { AgentConfig } from "../executor";
import { withBrowser, takeScreenshot } from "./browser-utils";

export async function handleScrape(
  config: Record<string, unknown>,
  agentConfig: AgentConfig
): Promise<TaskResult> {
  const url = config.url as string | undefined;
  const selectors = config.selectors as Record<string, string> | undefined;

  if (!url) return { success: false, data: {}, error: "URL requerida" };

  try {
    const result = await withBrowser(agentConfig, async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(2000);
      const title = await page.title();

      const extracted: Record<string, string | null> = {};

      if (selectors && typeof selectors === "object") {
        for (const [key, selector] of Object.entries(selectors)) {
          try {
            const el = await page.$(selector);
            extracted[key] = el ? await el.textContent() : null;
          } catch {
            extracted[key] = null;
          }
        }
      } else {
        // No selectors: extract full page text
        extracted.body = await page.evaluate(() => (globalThis as unknown as { document: { body: { innerText: string } } }).document.body.innerText.slice(0, 5000));
      }

      const screenshot = await takeScreenshot(page);
      return { title, url, extracted, screenshot };
    });

    return { success: true, data: result };
  } catch (err) {
    return { success: false, data: {}, error: `Scrape falló: ${err instanceof Error ? err.message : String(err)}` };
  }
}
