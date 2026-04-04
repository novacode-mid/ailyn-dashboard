// ── Code Mode: JSON Actions en vez de marcadores de texto ────────────────
// En vez de que el LLM genere texto con ---EMAIL_LISTO--- o ---CAL_LISTO---,
// le pedimos que genere un JSON estructurado con las acciones a ejecutar.
// Reduce ~60% de tokens porque el LLM no tiene que generar templates verbosos.

export interface ActionPayload {
  reply: string;
  actions?: Action[];
}

export type Action =
  | { type: "email"; to: string; subject: string; body: string }
  | { type: "calendar"; title: string; date: string; startTime: string; endTime: string; description: string; attendees: string[] }
  | { type: "followup"; to: string; days: number; subject: string; context: string }
  | { type: "note"; title: string; content: string; url: string }
  | { type: "make_trigger"; action: string; data: Record<string, unknown> };

// ── Prompt addon para Code Mode ──────────────────────────────────────────
// Se agrega al system prompt cuando las tools detectadas incluyen acciones

export const CODE_MODE_PROMPT = `
## Modo de acciones (IMPORTANTE)
Cuando necesites ejecutar una acción (enviar email, agendar, follow-up, nota, trigger), responde con JSON al final de tu mensaje usando este formato EXACTO:

---ACTIONS---
{
  "reply": "tu respuesta al usuario en lenguaje natural",
  "actions": [
    { "type": "email", "to": "email@example.com", "subject": "Asunto", "body": "Cuerpo del email" }
  ]
}
---END_ACTIONS---

Tipos de acciones disponibles:
- email: { type: "email", to: "...", subject: "...", body: "..." }
- calendar: { type: "calendar", title: "...", date: "YYYY-MM-DD", startTime: "HH:MM", endTime: "HH:MM", description: "...", attendees: ["email1"] }
- followup: { type: "followup", to: "...", days: N, subject: "...", context: "..." }
- note: { type: "note", title: "...", content: "contenido markdown", url: "fuente" }
- make_trigger: { type: "make_trigger", action: "descripción", data: { key: "value" } }

REGLAS:
- Siempre incluye "reply" con el texto para el usuario
- Puedes incluir múltiples acciones en el array
- Si NO necesitas ejecutar ninguna acción, responde normalmente sin el bloque ---ACTIONS---
- El "reply" debe ser conversacional, NO incluir JSON ni datos técnicos
`;

// ── Parsear respuesta con Code Mode ──────────────────────────────────────

export function parseCodeModeResponse(text: string): ActionPayload | null {
  const match = text.match(/---ACTIONS---\s*([\s\S]*?)\s*---END_ACTIONS---/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]) as ActionPayload;
    if (!parsed.reply || typeof parsed.reply !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Determinar si las tools requieren Code Mode ──────────────────────────

const ACTION_TOOLS = new Set([
  "send_email", "gmail_send", "calendar_write",
  "schedule_followup", "save_note", "make_trigger",
]);

export function shouldUseCodeMode(tools: string[]): boolean {
  return tools.some((t) => ACTION_TOOLS.has(t));
}
