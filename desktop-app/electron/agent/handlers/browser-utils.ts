import { chromium, type Browser, type Page } from "playwright";
import type { AgentConfig } from "../executor";

const TIMEOUT = 30_000;

export async function withBrowser<T>(
  config: AgentConfig,
  fn: (page: Page) => Promise<T>
): Promise<T> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: config.headless });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    context.setDefaultTimeout(TIMEOUT);
    const page = await context.newPage();
    return await fn(page);
  } finally {
    if (browser) await browser.close();
  }
}

export async function takeScreenshot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ fullPage: false });
  return buffer.toString("base64");
}
