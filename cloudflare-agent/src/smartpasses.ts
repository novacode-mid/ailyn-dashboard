import type { Env } from "./types";

const SMARTPASSES_API_BASE = "https://api.smartpasses.io/v1";

interface PushPayload {
  smartpass_id: string;
  notification: {
    title: string;
    body: string;
  };
}

interface PushResponse {
  success: boolean;
  message_id?: string;
  error?: string;
}

export async function sendPushNotification(
  env: Env,
  smartpassId: string,
  title: string,
  body: string
): Promise<void> {
  const payload: PushPayload = {
    smartpass_id: smartpassId,
    notification: { title, body },
  };

  const response = await fetch(`${SMARTPASSES_API_BASE}/notifications/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SMARTPASSES_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Smart Passes API error ${response.status}: ${text}`);
  }

  const result = (await response.json()) as PushResponse;
  if (!result.success) {
    throw new Error(`Smart Passes push failed: ${result.error ?? "unknown error"}`);
  }
}

// Valida que un smartpass_id existe y está activo en la API externa
export async function validateSmartpass(
  env: Env,
  smartpassId: string
): Promise<boolean> {
  const response = await fetch(
    `${SMARTPASSES_API_BASE}/passes/${encodeURIComponent(smartpassId)}/validate`,
    {
      headers: { Authorization: `Bearer ${env.SMARTPASSES_API_KEY}` },
    }
  );
  return response.ok;
}
