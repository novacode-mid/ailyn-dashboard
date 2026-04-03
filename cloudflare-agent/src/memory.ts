// ── Agent Memory System ────────────────────────────────────────────────────
// Ailyn aprende de cada interacción y recuerda preferencias, correcciones
// y hechos importantes por empresa.

import type { Env } from "./types";

export interface MemoryFact {
  id: number;
  category: string;
  fact: string;
  source: string;
  created_at: string;
}

// ── Categorías de memoria ─────────────────────────────────────────────────

export type MemoryCategory =
  | "preference"    // "Prefiere emails formales", "Horario de 9 a 6"
  | "correction"    // "No usar emojis en emails", "Su nombre es Pedro, no Pierre"
  | "contact"       // "Pedro de SmartPasses es cliente desde enero"
  | "business"      // "Cierra los viernes a las 3pm", "No trabaja sábados"
  | "style"         // "Tono casual en follow-ups", "Firma solo con nombre"
  | "general";      // Cualquier otro hecho relevante

// ── Guardar un hecho aprendido ────────────────────────────────────────────

export async function saveFact(
  env: Env,
  companyId: number,
  fact: string,
  category: MemoryCategory = "general",
  source = "conversation"
): Promise<void> {
  // Evitar duplicados exactos
  const existing = await env.DB.prepare(
    `SELECT id FROM company_memory WHERE company_id = ? AND fact = ? LIMIT 1`
  ).bind(companyId, fact).first();

  if (existing) return;

  await env.DB.prepare(
    `INSERT INTO company_memory (company_id, category, fact, source) VALUES (?, ?, ?, ?)`
  ).bind(companyId, category, fact, source).run();
}

// ── Cargar memoria de la empresa (para inyectar en system prompt) ─────────

export async function loadMemory(env: Env, companyId: number): Promise<string> {
  const rows = await env.DB.prepare(
    `SELECT category, fact FROM company_memory
     WHERE company_id = ?
     ORDER BY category, created_at DESC
     LIMIT 30`
  ).bind(companyId).all<{ category: string; fact: string }>();

  if (!rows.results?.length) return "";

  const grouped: Record<string, string[]> = {};
  for (const r of rows.results) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r.fact);
  }

  const categoryLabels: Record<string, string> = {
    preference: "Preferencias del usuario",
    correction: "Correcciones aprendidas",
    contact: "Contactos conocidos",
    business: "Datos del negocio",
    style: "Estilo de comunicación",
    general: "Hechos importantes",
  };

  let memory = "\n\n## Memoria de Ailyn (aprendizajes acumulados)\n";
  for (const [cat, facts] of Object.entries(grouped)) {
    memory += `\n**${categoryLabels[cat] ?? cat}:**\n`;
    for (const f of facts) {
      memory += `- ${f}\n`;
    }
  }
  memory += "\nUsa esta memoria para personalizar tus respuestas. No repitas lo que ya sabes.";

  return memory;
}

// ── Detectar si el mensaje contiene una corrección o preferencia ──────────

export function detectLearningIntent(
  userMessage: string,
  assistantResponse: string,
  history: { role: string; content: string }[]
): { shouldLearn: boolean; fact?: string; category?: MemoryCategory } {
  const lower = userMessage.toLowerCase();

  // Correcciones explícitas
  if (/\b(no,?\s*(es|soy|se llama|mi|mejor)|está mal|incorrecto|error|equivocad|corrige)\b/i.test(lower)) {
    return { shouldLearn: true, fact: userMessage, category: "correction" };
  }

  // Preferencias explícitas
  if (/\b(prefiero|me gusta|siempre|nunca|no me|quiero que|usa siempre|no uses)\b/i.test(lower)) {
    return { shouldLearn: true, fact: userMessage, category: "preference" };
  }

  // Datos de negocio
  if (/\b(mi (horario|empresa|negocio|tienda|restaurante)|abr[io]mos|cerramos|trabajamos|nuestro (tel[ée]fono|direcci[óo]n|sitio))\b/i.test(lower)) {
    return { shouldLearn: true, fact: userMessage, category: "business" };
  }

  // Info de contactos
  if (/\b(es (mi|nuestro) (cliente|proveedor|socio|contacto)|trabaja en|su (email|tel[ée]fono|cargo) es)\b/i.test(lower)) {
    return { shouldLearn: true, fact: userMessage, category: "contact" };
  }

  // Estilo de comunicación
  if (/\b(tono|estilo|formal|informal|casual|profesional|no.*emoji|firma|despedida)\b/i.test(lower)
    && /\b(usa|pon|cambia|prefiero|quiero)\b/i.test(lower)) {
    return { shouldLearn: true, fact: userMessage, category: "style" };
  }

  // Comando explícito "recuerda que..."
  if (/\b(recuerda|acuerdate|anota|guarda|aprende)\s+que\b/i.test(lower)) {
    const factMatch = userMessage.match(/(?:recuerda|acuerdate|anota|guarda|aprende)\s+que\s+(.+)/i);
    if (factMatch) {
      return { shouldLearn: true, fact: factMatch[1].trim(), category: "general" };
    }
  }

  return { shouldLearn: false };
}
