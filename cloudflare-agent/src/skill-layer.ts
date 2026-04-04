// ── Skill Layer: Detección semántica de herramientas via Vectorize ────────
// Complementa el keyword matching de preDetectTools() con búsqueda vectorial.
// Si los regex no encuentran nada, busca semánticamente la herramienta más relevante.

import type { Env } from "./types";

// ── Catálogo de Skills ───────────────────────────────────────────────────
// Cada skill tiene descripción rica + sinónimos para generar embeddings precisos.

export interface SkillDefinition {
  name: string;
  description: string;
  synonyms: string[];
  requiresIntegration?: string; // Si requiere una integración conectada
}

export const SKILL_CATALOG: SkillDefinition[] = [
  {
    name: "send_email",
    description: "Enviar un correo electrónico a alguien",
    synonyms: ["manda correo", "escríbele", "envía email", "manda mensaje por correo", "contacta por email", "mándale un mail", "redacta correo"],
  },
  {
    name: "gmail_read",
    description: "Leer emails recibidos, revisar bandeja de entrada, ver correos pendientes",
    synonyms: ["revisa mis correos", "qué emails tengo", "bandeja de entrada", "correos sin leer", "nuevos mensajes", "inbox", "lee mis mails"],
  },
  {
    name: "calendar_write",
    description: "Agendar reunión, cita, llamada o evento en el calendario",
    synonyms: ["agenda reunión", "programa cita", "ponme una junta", "agendar llamada", "bloquea horario", "crea evento", "videollamada"],
  },
  {
    name: "calendar_read",
    description: "Ver eventos del calendario, qué tengo agendado, revisar horarios",
    synonyms: ["qué tengo hoy", "mis reuniones", "agenda del día", "horario libre", "cuándo estoy disponible", "próximos eventos"],
  },
  {
    name: "web_search",
    description: "Buscar información en internet, investigar un tema",
    synonyms: ["busca en internet", "googlea", "investiga sobre", "encuentra información", "qué dice internet sobre", "busca en la web"],
  },
  {
    name: "rag_search",
    description: "Buscar en notas guardadas, knowledge base, documentos internos",
    synonyms: ["busca en mis notas", "qué guardé sobre", "mis apuntes", "knowledge base", "documentos", "información guardada", "obsidian"],
  },
  {
    name: "save_note",
    description: "Guardar nota, resumir video, guardar contenido de URL",
    synonyms: ["guarda esto", "toma nota", "resume este video", "apunta esto", "guarda en obsidian", "anota"],
  },
  {
    name: "schedule_followup",
    description: "Programar seguimiento futuro, recordatorio para contactar a alguien",
    synonyms: ["dale seguimiento", "recuérdame escribirle", "follow up", "si no responde", "vuelve a contactar", "programa recordatorio"],
  },
  {
    name: "crm_lookup",
    description: "Buscar información de un contacto, lead, cliente, historial de interacciones",
    synonyms: ["qué pasó con", "historial de", "información del cliente", "estado del lead", "cuéntame sobre", "datos del contacto"],
  },
  {
    name: "get_suggestions",
    description: "Obtener sugerencias, pendientes, qué hacer ahora, prioridades",
    synonyms: ["qué tengo pendiente", "qué me recomiendas", "siguiente paso", "prioridades", "qué debo hacer"],
  },
  {
    name: "action_control",
    description: "Cancelar o detener una acción en curso, follow-up, cadena de emails",
    synonyms: ["cancela", "detén", "para el seguimiento", "stop", "no envíes", "cancela la reunión"],
  },
  {
    name: "slack",
    description: "Enviar mensaje a un canal o persona en Slack",
    synonyms: ["manda por slack", "publica en el canal", "avisa al equipo", "notifica en slack", "mensaje al chat del equipo", "chat azul"],
    requiresIntegration: "slack",
  },
  {
    name: "notion",
    description: "Crear página en Notion, buscar documentos, documentar algo",
    synonyms: ["guarda en notion", "crea página", "documenta en notion", "busca en notion", "wiki"],
    requiresIntegration: "notion",
  },
  {
    name: "hubspot",
    description: "Gestionar contactos y deals en HubSpot CRM",
    synonyms: ["crea contacto en crm", "nuevo deal", "busca en hubspot", "pipeline de ventas", "oportunidad de negocio"],
    requiresIntegration: "hubspot",
  },
  {
    name: "shopify",
    description: "Consultar pedidos, productos e inventario de la tienda Shopify",
    synonyms: ["pedidos de shopify", "cuántas ventas", "productos de la tienda", "inventario", "últimas órdenes"],
    requiresIntegration: "shopify",
  },
  {
    name: "make_trigger",
    description: "Disparar automatización en Make.com, registrar datos, ejecutar escenario",
    synonyms: ["automatiza", "registra dato", "trigger webhook", "dispara escenario", "guarda en sheets", "anota en la hoja", "registra venta", "loguea"],
    requiresIntegration: "make",
  },
];

// ── Indexar skills en Vectorize ──────────────────────────────────────────

export async function indexSkills(env: Env): Promise<{ indexed: number }> {
  const vectors: { id: string; values: number[]; metadata: Record<string, string> }[] = [];

  for (const skill of SKILL_CATALOG) {
    // Generar texto rico para embedding: descripción + sinónimos
    const text = `${skill.name}: ${skill.description}. Frases: ${skill.synonyms.join(", ")}`;

    const embRes = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [text],
    }) as { data: number[][] };

    vectors.push({
      id: `skill-${skill.name}`,
      values: embRes.data[0],
      metadata: {
        skill_name: skill.name,
        description: skill.description,
        requires_integration: skill.requiresIntegration ?? "",
      },
    });
  }

  // Upsert en Vectorize (reemplaza si ya existen)
  await env.KNOWLEDGE_BASE.upsert(vectors);

  return { indexed: vectors.length };
}

// ── Buscar skills relevantes semánticamente ──────────────────────────────

export async function findRelevantSkills(
  message: string,
  connectedProviders: string[],
  env: Env,
  topK = 3,
  threshold = 0.65
): Promise<string[]> {
  // Generar embedding del mensaje del usuario
  const embRes = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [message.slice(0, 500)],
  }) as { data: number[][] };

  // Buscar en Vectorize (topK más alto para filtrar skills de knowledge docs)
  const results = await env.KNOWLEDGE_BASE.query(embRes.data[0], {
    topK: topK * 3,
    returnMetadata: "all",
  });

  const connected = new Set(connectedProviders);
  const skills: string[] = [];

  let found = 0;
  for (const match of results.matches ?? []) {
    if (found >= topK) break;
    if ((match.score ?? 0) < threshold) continue;

    // Process native skills (prefix "skill-") and MCP skills (prefix "mcp-skill-")
    const isNativeSkill = match.id.startsWith("skill-") && !match.id.startsWith("skill-mcp");
    const isMcpSkill = match.id.startsWith("mcp-skill-");
    if (!isNativeSkill && !isMcpSkill) continue;

    const skillName = (match.metadata as Record<string, string>)?.skill_name;
    if (!skillName) continue;

    // Native skills: check integration requirement
    if (isNativeSkill) {
      const requiresIntegration = (match.metadata as Record<string, string>)?.requires_integration;
      if (requiresIntegration && !connected.has(requiresIntegration)) continue;
    }

    // MCP skills: check company_id matches (they're company-specific)
    if (isMcpSkill) {
      const skillCompanyId = (match.metadata as Record<string, string>)?.company_id;
      // companyId not available here — MCP skills are filtered by Vectorize id prefix
      // The id format is "mcp-skill-{companyId}-{toolName}" so we trust the match
      if (skillCompanyId && !match.id.includes(`mcp-skill-${skillCompanyId}`)) continue;
    }

    skills.push(skillName);
    found++;
  }

  return skills;
}
