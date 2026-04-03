import * as path from "path";
import * as os from "os";
import type { TaskResult } from "../executor";
import type { AgentConfig } from "../config";
import { withBrowser, takeScreenshot } from "./browser-utils";

export async function handleDownload(
  config: Record<string, unknown>,
  agentConfig: AgentConfig
): Promise<TaskResult> {
  const url = config.url as string | undefined;
  const selector = config.selector as string | undefined;

  if (!url) return { success: false, data: {}, error: "URL requerida" };

  try {
    const result = await withBrowser(agentConfig, async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(1000);

      const downloadDir = path.join(os.homedir(), "Downloads");

      if (selector) {
        // Click a download button and wait for download
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 15_000 }),
          page.click(selector),
        ]);

        const suggestedName = download.suggestedFilename();
        const savePath = path.join(downloadDir, suggestedName);
        await download.saveAs(savePath);

        const screenshot_b64 = await takeScreenshot(page);

        return {
          url,
          fileName: suggestedName,
          savedTo: savePath,
          screenshot_b64,
        };
      } else {
        // Direct URL download
        const response = await page.request.get(url);
        const buffer = await response.body();
        const fileName = path.basename(new URL(url).pathname) || "download";
        const savePath = path.join(downloadDir, fileName);

        const fs = await import("fs");
        fs.writeFileSync(savePath, buffer);

        return {
          url,
          fileName,
          savedTo: savePath,
          size: buffer.length,
        };
      }
    });

    return { success: true, data: result };
  } catch (err) {
    return { success: false, data: {}, error: `Download falló: ${err instanceof Error ? err.message : String(err)}` };
  }
}
