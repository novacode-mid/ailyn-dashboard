import type { ChatHistory, ChatMessage, Env } from "./types";

const HISTORY_TTL_SECONDS = 60 * 60 * 24; // 24 horas
const MAX_HISTORY_MESSAGES = 20;           // ventana de contexto

function historyKey(chatId: number): string {
  return `chat:${chatId}:history`;
}

export async function getHistory(env: Env, chatId: number): Promise<ChatHistory> {
  const raw = await env.KV.get(historyKey(chatId), "json");
  if (!raw) return [];
  return raw as ChatHistory;
}

export async function appendHistory(
  env: Env,
  chatId: number,
  message: ChatMessage
): Promise<void> {
  const history = await getHistory(env, chatId);
  history.push(message);

  // Mantener solo los últimos N mensajes (sliding window)
  const trimmed = history.slice(-MAX_HISTORY_MESSAGES);

  await env.KV.put(historyKey(chatId), JSON.stringify(trimmed), {
    expirationTtl: HISTORY_TTL_SECONDS,
  });
}

export async function clearHistory(env: Env, chatId: number): Promise<void> {
  await env.KV.delete(historyKey(chatId));
}
