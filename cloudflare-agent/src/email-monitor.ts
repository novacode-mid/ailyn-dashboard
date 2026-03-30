import type { Env } from "./types";

export interface EmailMessage {
  id: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  bodyPreview: string;
  receivedAt: string;
}

export interface EmailAnalysis {
  urgency: "high" | "medium" | "low";
  category: string;
  summary: string;
  suggestedReply: string;
  requiresAction: boolean;
}

/**
 * Obtener access token de Gmail usando refresh token.
 * Requiere GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN en secrets.
 */
async function getGmailAccessToken(env: Env): Promise<string | null> {
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    return null;
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GMAIL_CLIENT_ID,
        client_secret: env.GMAIL_CLIENT_SECRET,
        refresh_token: env.GMAIL_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) return null;
    const data = await response.json() as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Obtener emails no leídos recientes de Gmail.
 */
export async function fetchRecentEmails(env: Env, maxResults = 10): Promise<EmailMessage[]> {
  const token = await getGmailAccessToken(env);
  if (!token) return [];

  try {
    const listResp = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=is:unread is:inbox`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!listResp.ok) return [];
    const listData = await listResp.json() as { messages?: Array<{ id: string }> };
    if (!listData.messages?.length) return [];

    const emails: EmailMessage[] = [];
    for (const msg of listData.messages.slice(0, maxResults)) {
      const detailResp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!detailResp.ok) continue;
      const detail = await detailResp.json() as {
        payload?: { headers?: Array<{ name: string; value: string }> };
        snippet?: string;
        internalDate?: string;
      };

      const headers = detail.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

      const fromRaw = getHeader("From");
      const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/) ?? [null, fromRaw, fromRaw];

      emails.push({
        id: msg.id,
        from: fromMatch[2] ?? fromRaw,
        fromName: (fromMatch[1] ?? "").replace(/"/g, "").trim(),
        to: getHeader("To"),
        subject: getHeader("Subject"),
        bodyPreview: detail.snippet ?? "",
        receivedAt: detail.internalDate
          ? new Date(parseInt(detail.internalDate)).toISOString()
          : new Date().toISOString(),
      });
    }

    return emails;
  } catch {
    return [];
  }
}

/**
 * Analizar un email con IA y clasificarlo.
 */
export async function analyzeEmail(email: EmailMessage, env: Env): Promise<EmailAnalysis> {
  try {
    const resp = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
      messages: [
        {
          role: "system",
          content: "Analiza emails y responde SOLO con JSON válido. Sin texto adicional.",
        },
        {
          role: "user",
          content: `Analiza este email y responde SOLO JSON:

De: ${email.fromName} <${email.from}>
Asunto: ${email.subject}
Preview: ${email.bodyPreview}
Fecha: ${email.receivedAt}

JSON requerido:
{
  "urgency": "high | medium | low",
  "category": "prospecto | cliente | proveedor | spam | newsletter | personal | administrativo",
  "summary": "resumen de 1-2 oraciones",
  "suggestedReply": "borrador corto de respuesta o N/A",
  "requiresAction": true/false
}`,
        },
      ],
    }) as { response?: string };

    const text = (resp.response ?? "")
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    return JSON.parse(text) as EmailAnalysis;
  } catch {
    return {
      urgency: "medium",
      category: "unknown",
      summary: `Email de ${email.fromName}: ${email.subject}`,
      suggestedReply: "N/A",
      requiresAction: false,
    };
  }
}
