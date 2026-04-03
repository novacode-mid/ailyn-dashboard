import type { TaskResult } from "../executor";
import type { AgentConfig } from "../executor";
import { withBrowser, takeScreenshot } from "./browser-utils";

interface FormField {
  selector: string;
  value: string;
}

export async function handleFillForm(
  config: Record<string, unknown>,
  agentConfig: AgentConfig
): Promise<TaskResult> {
  const url = config.url as string | undefined;
  const fields = config.fields as FormField[] | undefined;
  const submitSelector = config.submitSelector as string | undefined;

  if (!url) return { success: false, data: {}, error: "URL requerida" };
  if (!fields || !Array.isArray(fields)) return { success: false, data: {}, error: "fields requeridos" };

  try {
    const result = await withBrowser(agentConfig, async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(1000);

      // Fill each field
      const filledFields: string[] = [];
      for (const field of fields) {
        try {
          await page.fill(field.selector, field.value);
          filledFields.push(field.selector);
        } catch {
          filledFields.push(`${field.selector} (FAILED)`);
        }
      }

      // Take pre-submit screenshot
      const beforeScreenshot = await takeScreenshot(page);

      // Submit if selector provided — try each selector individually
      let submitted = false;
      if (submitSelector) {
        const selectors = submitSelector.split(",").map(s => s.trim()).filter(Boolean);
        for (const sel of selectors) {
          try {
            await page.click(sel, { timeout: 3000 });
            await page.waitForTimeout(2000);
            submitted = true;
            break;
          } catch {
            // Try next selector
          }
        }
        // Fallback: try clicking any visible button with submit-like text
        if (!submitted) {
          try {
            await page.click('button[type="submit"]', { timeout: 3000 });
            await page.waitForTimeout(2000);
            submitted = true;
          } catch {
            // Last resort: click first button in the form
            try {
              await page.click("form button", { timeout: 3000 });
              await page.waitForTimeout(2000);
              submitted = true;
            } catch { /* give up */ }
          }
        }
      }

      const screenshot = await takeScreenshot(page);
      const currentUrl = page.url();

      return {
        url,
        currentUrl,
        filledFields,
        submitted,
        screenshot,
        beforeScreenshot,
      };
    });

    return { success: true, data: result };
  } catch (err) {
    return { success: false, data: {}, error: `Fill form falló: ${err instanceof Error ? err.message : String(err)}` };
  }
}
