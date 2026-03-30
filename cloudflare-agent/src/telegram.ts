import type { Env } from "./types";

export async function sendMessage(
  env: Env,
  chatId: number,
  text: string
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });
}

export async function registerWebhook(
  env: Env,
  workerUrl: string
): Promise<Response> {
  const webhookUrl = `${workerUrl}/api/webhook/telegram`;
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: env.TELEGRAM_SECRET_TOKEN,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    }),
  });
  return new Response(await res.text(), { status: res.status });
}
