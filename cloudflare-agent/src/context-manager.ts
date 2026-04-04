// ── Context Manager: Manejo inteligente del historial de conversación ─────
// Tres capas de contexto para que Ailyn nunca pierda información importante:
//
// 1. RESUMEN PROGRESIVO — Cada 10 mensajes, genera un resumen compacto
//    de la conversación y lo guarda en KV. Siempre se inyecta.
//
// 2. ENTIDADES EXTRAÍDAS — Nombres, emails, datos clave mencionados
//    se guardan en company_memory para persistir entre sesiones.
//
// 3. VENTANA RECIENTE — Últimos 6 mensajes completos para contexto inmediato.
//
// Resultado: el LLM siempre ve:
//   [resumen de toda la conv] + [datos clave] + [últimos 6 msgs]
//   En vez de solo los últimos 6 mensajes.

import type { Env } from "./types";

// ── Generar resumen progresivo ───────────────────────────────────────────

export async function generateConversationSummary(
  messages: { role: string; content: string }[],
  env: Env
): Promise<string> {
  if (messages.length < 4) return "";

  const conversation = messages
    .map(m => `${m.role === "user" ? "Usuario" : "Ailyn"}: ${m.content.slice(0, 200)}`)
    .join("\n");

  try {
    const result = await env.AI.run(
      "@cf/meta/llama-3.2-3b-instruct" as Parameters<typeof env.AI.run>[0],
      {
        messages: [{
          role: "user",
          content: `Resume esta conversación en máximo 5 líneas. Incluye SOLO: nombres mencionados, datos importantes (emails, fechas, montos), decisiones tomadas, y tareas pendientes. No incluyas saludos ni charla trivial.

${conversation}

Resumen conciso:`,
        }],
        max_tokens: 200,
      }
    ) as { response?: string };

    return typeof result.response === "string" ? result.response.trim() : "";
  } catch {
    return "";
  }
}

// ── Extraer entidades clave de un mensaje ────────────────────────────────

export function extractEntities(message: string): {
  emails: string[];
  names: string[];
  amounts: string[];
  dates: string[];
} {
  const emails = message.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? [];

  // Nombres propios (palabras con mayúscula que no son inicio de oración)
  const namePattern = /(?:(?:de|con|a|para)\s+)([A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+)*)/g;
  const names: string[] = [];
  let match;
  while ((match = namePattern.exec(message)) !== null) {
    if (match[1].length > 2) names.push(match[1]);
  }

  // Montos
  const amounts = message.match(/\$[\d,]+(?:\.\d{2})?|\d+(?:,\d{3})*\s*(?:USD|MXN|dólares|pesos)/gi) ?? [];

  // Fechas
  const dates = message.match(/\d{1,2}\s*(?:de\s*)?\w+\s*(?:de\s*)?\d{4}|\b(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b|\b(?:hoy|mañana|ayer)\b/gi) ?? [];

  return { emails, names, amounts, dates };
}

// ── Guardar entidades como memoria ───────────────────────────────────────

export async function saveEntitiesAsMemory(
  env: Env,
  companyId: number,
  message: string,
  role: string
): Promise<void> {
  if (role !== "user") return;

  const entities = extractEntities(message);

  for (const name of entities.names) {
    const fact = `Contacto mencionado: ${name}`;
    const existing = await env.DB.prepare(
      `SELECT id FROM company_memory WHERE company_id = ? AND fact = ? LIMIT 1`
    ).bind(companyId, fact).first();
    if (!existing) {
      await env.DB.prepare(
        `INSERT INTO company_memory (company_id, category, fact, source) VALUES (?, 'contact', ?, 'auto-extract')`
      ).bind(companyId, fact).run();
    }
  }

  // Guardar asociaciones email-nombre
  if (entities.emails.length > 0 && entities.names.length > 0) {
    const fact = `${entities.names[0]} — email: ${entities.emails[0]}`;
    const existing = await env.DB.prepare(
      `SELECT id FROM company_memory WHERE company_id = ? AND fact LIKE ? LIMIT 1`
    ).bind(companyId, `%${entities.emails[0]}%`).first();
    if (!existing) {
      await env.DB.prepare(
        `INSERT INTO company_memory (company_id, category, fact, source) VALUES (?, 'contact', ?, 'auto-extract')`
      ).bind(companyId, fact).run();
    }
  }
}

// ── Cargar contexto completo para el LLM ─────────────────────────────────

export async function loadSmartContext(
  env: Env,
  companyId: number,
  sessionId: string,
  recentLimit = 6
): Promise<{
  history: { role: "user" | "assistant"; content: string }[];
  summaryContext: string;
}> {
  // 1. Cargar últimos mensajes recientes (ventana deslizante)
  const recentRows = await env.DB.prepare(
    `SELECT role, content FROM conversation_history
     WHERE company_id = ?
     ORDER BY created_at DESC LIMIT ?`
  ).bind(companyId, recentLimit).all<{ role: string; content: string }>();

  const history = (recentRows.results ?? [])
    .reverse()
    .map(r => ({
      role: r.role as "user" | "assistant",
      // Truncar respuestas del assistant para evitar repetición
      content: r.role === "assistant" ? r.content.slice(0, 300) : r.content,
    }));

  // 2. Buscar resumen existente en KV
  const summaryKey = `conv_summary:${companyId}`;
  let summary = await env.KV.get(summaryKey) ?? "";

  // 3. Contar mensajes totales de la sesión
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM conversation_history WHERE company_id = ?`
  ).bind(companyId).first<{ total: number }>();
  const totalMessages = countRow?.total ?? 0;

  // 4. Si hay más de 12 mensajes y no hay resumen reciente, generar uno
  const summaryAge = await env.KV.get(`${summaryKey}:age`);
  const lastSummarizedAt = summaryAge ? parseInt(summaryAge, 10) : 0;
  const shouldRegenerate = totalMessages > 12 && (totalMessages - lastSummarizedAt) >= 10;

  if (shouldRegenerate) {
    // Cargar mensajes anteriores (excluyendo los recientes) para resumir
    const olderRows = await env.DB.prepare(
      `SELECT role, content FROM conversation_history
       WHERE company_id = ?
       ORDER BY created_at DESC LIMIT 20 OFFSET ?`
    ).bind(companyId, recentLimit).all<{ role: string; content: string }>();

    const olderMessages = (olderRows.results ?? []).reverse();

    if (olderMessages.length >= 4) {
      const newSummary = await generateConversationSummary(olderMessages, env);
      if (newSummary) {
        // Combinar con resumen anterior si existe
        summary = summary
          ? `${summary}\n\nActualización reciente:\n${newSummary}`
          : newSummary;

        // Limitar tamaño total del resumen
        if (summary.length > 1000) {
          summary = summary.slice(-1000);
        }

        await env.KV.put(summaryKey, summary, { expirationTtl: 86400 * 7 }); // 7 días
        await env.KV.put(`${summaryKey}:age`, String(totalMessages), { expirationTtl: 86400 * 7 });
      }
    }
  }

  const summaryContext = summary
    ? `\n\n## Resumen de la conversación anterior\n${summary}\n\nUsa este resumen como contexto. NO lo repitas al usuario.`
    : "";

  return { history, summaryContext };
}
