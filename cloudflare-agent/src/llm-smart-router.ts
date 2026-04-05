// ── Smart LLM Router ──────────────────────────────────────────────────────
// Usa Llama (gratis) para clasificar la intención y selecciona el mejor modelo.

import type { Env } from "./types";
import { findRelevantSkills } from "./skill-layer";

export type TaskComplexity = "simple" | "medium" | "complex";

export type AvailableTool =
  | "none"
  | "gmail_read"
  | "gmail_send"
  | "send_email"
  | "calendar_read"
  | "calendar_write"
  | "github"
  | "desktop_screenshot"
  | "desktop_scrape"
  | "desktop_download"
  | "desktop_fill_form"
  | "web_search"
  | "rag_search"
  | "prospect_research"
  | "tasks_manage"
  | "schedule_followup"
  | "crm_lookup"
  | "action_control"
  | "save_note"
  | "get_suggestions"
  | "inbox_organized"
  | "slack"
  | "notion"
  | "hubspot"
  | "shopify"
  | "make_trigger";

export interface RoutingDecision {
  complexity: TaskComplexity;
  model: string;
  provider: "cloudflare" | "anthropic" | "openai";
  tools_needed: AvailableTool[];
  estimated_cost: number;
  forced?: boolean; // true si el usuario forzó con !opus / !sonnet / !llama / !gpt
}

// ── Modelos por complejidad ────────────────────────────────────────────────

const MODEL_MAP: Record<TaskComplexity, { model: string; provider: "cloudflare" | "anthropic" | "openai"; cost: number }> = {
  simple:  { model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", provider: "cloudflare", cost: 0 },
  medium:  { model: "claude-sonnet-4-20250514",                  provider: "anthropic",   cost: 0.02 },
  complex: { model: "claude-opus-4-20250514",                    provider: "anthropic",   cost: 0.10 },
};

// OpenAI alternatives (used with !gpt prefix or as fallback)
const OPENAI_MAP: Record<TaskComplexity, { model: string; cost: number }> = {
  simple:  { model: "gpt-4o-mini",  cost: 0.005 },
  medium:  { model: "gpt-4o",       cost: 0.03 },
  complex: { model: "gpt-4o",       cost: 0.03 },
};

// ── Forzar modelo con prefijos ─────────────────────────────────────────────

interface ForcedModel {
  complexity: TaskComplexity;
  message: string; // mensaje limpio sin el prefijo
}

export function detectForcedModel(message: string): ForcedModel | null {
  const lower = message.trimStart();
  if (lower.startsWith("!opus ") || lower.startsWith("!opus\n")) {
    return { complexity: "complex", message: message.replace(/^!opus\s*/i, "").trim() };
  }
  if (lower.startsWith("!sonnet ") || lower.startsWith("!sonnet\n")) {
    return { complexity: "medium", message: message.replace(/^!sonnet\s*/i, "").trim() };
  }
  if (lower.startsWith("!gpt ") || lower.startsWith("!gpt\n")) {
    return { complexity: "medium", message: message.replace(/^!gpt\s*/i, "").trim() };
  }
  if (lower.startsWith("!llama ") || lower.startsWith("!llama\n")) {
    return { complexity: "simple", message: message.replace(/^!llama\s*/i, "").trim() };
  }
  return null;
}

// ── Pre-detección por keywords (antes del LLM, más confiable) ─────────────

interface McpSkillInfo { skill_name: string; mcp_tool_name: string; description: string; synonyms?: string }

function preDetectTools(message: string, connectedProviders: string[] = [], mcpSkills: McpSkillInfo[] = []): { tools: AvailableTool[] } {
  const lower = message.toLowerCase();
  const tools: AvailableTool[] = [];

  // Email: dirección @ + verbo de envío (no requiere la palabra "email" explícita)
  const hasEmailAddress = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(message);
  const hasSendVerb = /\b(env[íi]a|manda|send|escribe|redacta|mandar|enviar|escribir|escribile|escribele|env[íi]ale|m[áa]ndale|contacta|cont[áa]ctale)\b/i.test(lower);
  const hasEmailWord = /\b(email|correo|mail|e-mail)\b/.test(lower);

  // Detectar si quiere enviar email: (dirección + verbo) O (dirección + palabra "email/correo")
  if (hasEmailAddress && (hasSendVerb || hasEmailWord)) tools.push("send_email");

  // Borrador / draft / etiquetar / organizar correo → usa gmail_send
  if (/\b(borrador|draft|etiqueta|label|carpeta|folder|archiva|organiza.*correo|clasifica.*email)\b/.test(lower)) {
    tools.push("gmail_send");
  }

  // Notes/Knowledge search: buscar en notas guardadas
  if (/\b(notas?|apuntes?|guard[ée]|knowledge|obsidian)\b/.test(lower)
    && /\b(tengo|sobre|busca|encuentra|qu[ée]|cu[áa]les|relacionad)\b/.test(lower)) {
    tools.push("rag_search");
  }

  // Calendar: agendar, reunión, cita → también leer calendario para detectar conflictos
  if (/\b(ag[ée]nda|agenda|reuni[óo]n|cita|meeting|agendar|programa|calend|junta|llamada con|videollamada)\b/.test(lower)
    && /\b(con|para|el|la|ma[ñn]ana|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|hoy|a las|pm|am)\b/.test(lower)) {
    tools.push("calendar_read");  // primero leer para detectar conflictos
    tools.push("calendar_write");
  }

  // Follow-up: seguimiento, recordatorio de envío
  const hasFollowupIntent = /\b(seguimiento|follow.?up|si no responde|recordar.?le|recontactar|volver a escribir)\b/.test(lower)
    || /\b(dale?|darle|hazle|hacer)\b.*\b(seguimiento)\b/.test(lower);
  const hasTimeRef = /\b(d[íi]as?|horas?|semanas?|ma[ñn]ana|hoy|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|pr[óo]xim|despu[ée]s)\b/.test(lower);
  if (hasFollowupIntent && (hasTimeRef || hasEmailAddress)) {
    tools.push("schedule_followup");
  }

  // CRM: preguntar por un contacto/lead específico
  if (/\b(qu[ée] pas[óo]|historial|estado|info|informaci[óo]n|cu[ée]ntame|d[ií]me)\b/.test(lower)
    && /\b(de|con|sobre)\b/.test(lower)
    && /[A-Z][a-z]/.test(message)) { // tiene un nombre propio (mayúscula seguida de minúscula)
    tools.push("crm_lookup");
  }

  // Email summary / organized inbox
  const wantsReadEmail = /\b(emails?|correos?|inbox|bandeja|gmail)\b/.test(lower)
    && /\b(important|resumen|resume|resum[ií]|tengo|lleg[óo]|nuevos?|pendientes?|sin leer|recib[ií]|hay|lee|leer|muestra|ver|revisa|organiza|clasifica|urgent|spam)\b/.test(lower);
  const wantsReadEmail2 = /\b(qu[ée]|cu[áa]les|rev[ií]sa|lee|muestra|dame|organiza)\b/.test(lower)
    && /\b(emails?|correos?|inbox|bandeja|gmail)\b/.test(lower);
  if (wantsReadEmail || wantsReadEmail2) {
    tools.push("gmail_read");
    tools.push("inbox_organized");
  }

  // Suggestions: pendientes, recomendaciones, qué hacer
  if (/\b(pendiente|recomiend|sugier|qu[ée] (hago|hacer|debo|tengo pendiente|me toca)|priorid|siguiente paso)\b/.test(lower)) {
    tools.push("get_suggestions");
  }

  // Web search: buscar en internet
  if (/\b(busca|buscar|investiga|googlea|search|encuentra en internet|busca en la web)\b/.test(lower)) {
    tools.push("web_search");
  }

  // Stop/cancel actions
  if (/\b(det[ée]n|detener|cancela|cancelar|para|parar|stop)\b/.test(lower)
    && /\b(follow.?up|seguimiento|cadena|email|reuni[óo]n|acci[óo]n)\b/.test(lower)) {
    tools.push("action_control");
  }

  // Video/content URL → save as note (but NOT if user wants to DO something with the URL)
  const hasUrl = /https?:\/\/[^\s]+/.test(message);
  const isVideoUrl = /\b(facebook\.com|fb\.watch|instagram\.com|tiktok\.com|youtube\.com|youtu\.be|reel|shorts|watch)\b/i.test(lower);
  const wantsSave = /\b(gu[áa]rda|guarda|nota|apunta|resume|resum[ií]|save|anota|obsidian)\b/i.test(lower);
  const hasActionIntent = /\b(genera|crea|traduce|calcula|descarga|entra|navega|abre|llena|screenshot|captura|QR|c[óo]digo)\b/i.test(lower);
  if (hasUrl && (isVideoUrl || wantsSave) && !hasActionIntent) {
    tools.push("save_note");
  }

  // ── Integraciones: solo detectar si la empresa las tiene conectadas ──
  const connected = new Set(connectedProviders);

  if (connected.has("slack")) {
    if (/\b(slack|canal|channel)\b/.test(lower) && /\b(env[íi]a|manda|publica|post|escribe|avisa|notifica)\b/.test(lower)) {
      tools.push("slack");
    }
  }

  if (connected.has("notion")) {
    if (/\b(notion|wiki|documentar|p[áa]gina)\b/.test(lower) && /\b(crea|guarda|agrega|busca|documenta)\b/.test(lower)) {
      tools.push("notion");
    }
  }

  if (connected.has("hubspot")) {
    if (/\b(hubspot|contacto|deal|negocio|oportunidad|pipeline)\b/.test(lower) && /\b(crea|agrega|busca|sync|actualiza)\b/.test(lower)) {
      tools.push("hubspot");
    }
  }

  if (connected.has("shopify")) {
    if (/\b(shopify|pedido|orden|producto|tienda|inventario)\b/.test(lower) && /\b(cu[áa]ntos|busca|muestra|estado|lista|últimos)\b/.test(lower)) {
      tools.push("shopify");
    }
  }

  if (connected.has("make")) {
    if (/\b(make|zapier|n8n|automatiza|escenario|trigger|webhook|registra|anota|guarda.*dato|log[gu]ea)\b/.test(lower)) {
      tools.push("make_trigger");
    }
  }

  // ── MCP Skills: detectar por keywords de descripcion + synonyms ──
  for (const skill of mcpSkills) {
    // Build keywords from: tool name, description words, and AI-generated synonyms
    const keywords: string[] = [
      skill.mcp_tool_name.replace(/_/g, " "),
      ...skill.description.toLowerCase().split(/\s+/).filter(w => w.length > 3),
    ];

    // Parse synonyms JSON and extract individual words/phrases
    if (skill.synonyms) {
      try {
        const syns = JSON.parse(skill.synonyms) as string[];
        for (const syn of syns) {
          // Add the full phrase (lowercased, cleaned)
          const clean = syn.replace(/^[\d.*\-\s]+/, "").replace(/[¿?¡!]/g, "").trim().toLowerCase();
          if (clean.length > 3) keywords.push(clean);
          // Also add individual significant words from the phrase
          for (const word of clean.split(/\s+/).filter(w => w.length > 3)) {
            keywords.push(word);
          }
        }
      } catch { /* invalid JSON */ }
    }

    // Deduplicate
    const uniqueKeywords = [...new Set(keywords)];

    // Match: full phrase, OR strong keyword (7+ chars), OR 2+ medium keywords (5+ chars)
    const phraseMatch = uniqueKeywords.some(kw => kw.includes(" ") && lower.includes(kw));
    const strongMatch = uniqueKeywords.some(kw => !kw.includes(" ") && kw.length >= 7 && lower.includes(kw));
    const mediumMatches = uniqueKeywords.filter(kw => !kw.includes(" ") && kw.length >= 5 && lower.includes(kw)).length;
    if (phraseMatch || strongMatch || mediumMatches >= 2) {
      tools.push(skill.skill_name);
    }
  }

  return { tools };
}

// ── Clasificación con Llama ────────────────────────────────────────────────

const CLASSIFICATION_PROMPT_BASE = `Clasifica el siguiente mensaje del usuario. Responde SOLO con JSON válido, sin markdown.

Complejidad:
- simple: saludos, preguntas directas, listas rápidas, formatear texto, datos ya disponibles
- medium: redactar emails, resumir, investigar un tema, responder con contexto, generar briefs
- complex: análisis estratégico, planificación multi-paso, comparar opciones con razonamiento profundo, decisiones de negocio

Herramientas disponibles:
TOOLS_LIST

Usa send_email cuando el usuario quiere enviar un correo/email (detecta frases como "envíale a fulano@...", "mándale un correo a...", "escríbele a...@...", o cualquier variación natural que implique enviar un mensaje a una dirección de email).
Usa calendar_write cuando el usuario quiere agendar, programar una reunión, cita, llamada o evento (frases como "agéndame con...", "programa una reunión", "ponme una cita el jueves").
Usa schedule_followup cuando el usuario quiere programar un seguimiento futuro (frases como "si no responde en 3 días", "dale seguimiento en una semana", "recuérdame escribirle mañana").
Usa crm_lookup cuando el usuario pregunta por el historial o estado de un contacto específico (frases como "qué pasó con Pedro?", "historial de SmartPasses", "cuéntame sobre el lead de Juan").
Usa action_control cuando el usuario quiere detener, cancelar o parar una acción, follow-up, cadena de emails o reunión (frases como "cancela el follow-up de Pedro", "detén el seguimiento", "para la cadena de emails").
Usa save_note cuando el usuario envía un URL de video o contenido web y quiere guardarlo, resumirlo o tomarlo como nota.
INTEGRATION_HINTS

Mensaje: "USER_MESSAGE"

JSON (solo esto, sin nada más):
{"complexity":"simple|medium|complex","tools":["tool1"]}`;

const BASE_TOOLS = "none, gmail_read, gmail_send, send_email, calendar_read, calendar_write, github, desktop_screenshot, desktop_scrape, desktop_download, desktop_fill_form, web_search, rag_search, prospect_research, tasks_manage, schedule_followup, crm_lookup, action_control, save_note, get_suggestions, inbox_organized";

const INTEGRATION_TOOL_MAP: Record<string, { tool: string; hint: string }> = {
  slack: { tool: "slack", hint: "Usa slack cuando el usuario quiere enviar un mensaje a un canal de Slack." },
  notion: { tool: "notion", hint: "Usa notion cuando el usuario quiere crear una página o buscar en Notion." },
  hubspot: { tool: "hubspot", hint: "Usa hubspot cuando el usuario quiere crear/buscar contactos o deals en el CRM." },
  shopify: { tool: "shopify", hint: "Usa shopify cuando el usuario pregunta por pedidos o productos de su tienda." },
  make: { tool: "make_trigger", hint: "Usa make_trigger cuando el usuario quiere registrar datos, automatizar algo, o disparar un escenario." },
};

function buildClassificationPrompt(connectedProviders: string[], mcpSkills: { skill_name: string; description: string }[] = []): string {
  const integrationTools = connectedProviders
    .filter(p => INTEGRATION_TOOL_MAP[p])
    .map(p => INTEGRATION_TOOL_MAP[p].tool);

  const mcpToolNames = mcpSkills.map(s => s.skill_name);

  const allExtraTools = [...integrationTools, ...mcpToolNames];
  const toolsList = allExtraTools.length > 0
    ? `${BASE_TOOLS}, ${allExtraTools.join(", ")}`
    : BASE_TOOLS;

  const integrationHints = connectedProviders
    .filter(p => INTEGRATION_TOOL_MAP[p])
    .map(p => INTEGRATION_TOOL_MAP[p].hint);

  const mcpHints = mcpSkills.map(s => `Usa ${s.skill_name} cuando: ${s.description}`);

  const allHints = [...integrationHints, ...mcpHints].join("\n");

  return CLASSIFICATION_PROMPT_BASE
    .replace("TOOLS_LIST", toolsList)
    .replace("INTEGRATION_HINTS", allHints ? `\n${allHints}` : "");
}

async function classifyWithLlama(message: string, env: Env, connectedProviders: string[] = [], companyId?: number): Promise<{ complexity: TaskComplexity; tools: AvailableTool[] }> {
  const safeMessage = JSON.stringify(message.slice(0, 500)).slice(1, -1);

  // Load MCP skills for this company
  let mcpSkillsList: { skill_name: string; description: string }[] = [];
  if (companyId) {
    try {
      const rows = await env.DB.prepare(
        `SELECT skill_name, description FROM mcp_skills WHERE company_id = ? AND is_active = 1 LIMIT 20`
      ).bind(companyId).all<{ skill_name: string; description: string }>();
      mcpSkillsList = rows.results ?? [];
    } catch { /* ignore */ }
  }

  const prompt = buildClassificationPrompt(connectedProviders, mcpSkillsList).replace("USER_MESSAGE", safeMessage);

  try {
    const result = await env.AI.run(
      "@cf/meta/llama-3.2-3b-instruct" as Parameters<typeof env.AI.run>[0],
      {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 128,
      }
    ) as { response?: unknown };

    const raw = typeof result.response === "string" ? result.response : JSON.stringify(result.response ?? "");

    // Extraer JSON del output (puede venir con texto extra)
    const jsonMatch = raw.match(/\{[^{}]+\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]) as { complexity?: string; tools?: string[] };

    const complexity: TaskComplexity =
      parsed.complexity === "complex" ? "complex" :
      parsed.complexity === "medium"  ? "medium"  : "simple";

    const baseValid = ["none","gmail_read","gmail_send","send_email","calendar_read","calendar_write","github","desktop_screenshot","desktop_scrape","desktop_download","desktop_fill_form","web_search","rag_search","prospect_research","tasks_manage","schedule_followup","crm_lookup","action_control","save_note","get_suggestions","inbox_organized"];
    const integrationValid = connectedProviders.filter(p => INTEGRATION_TOOL_MAP[p]).map(p => INTEGRATION_TOOL_MAP[p].tool);
    const mcpValid = mcpSkillsList.map(s => s.skill_name);
    const validTools = new Set<string>([...baseValid, ...integrationValid, ...mcpValid]);

    const tools: AvailableTool[] = (parsed.tools ?? ["none"])
      .filter((t): t is AvailableTool => validTools.has(t));

    return { complexity, tools: tools.length ? tools : ["none"] };
  } catch {
    // Default seguro: medium sin herramientas
    return { complexity: "medium", tools: ["none"] };
  }
}

// ── Detección de contexto conversacional ──────────────────────────────────
// Si el historial reciente tiene marcadores de acción o flujos en curso,
// el mensaje actual es un follow-up y necesita modelo inteligente.

interface ConversationContext {
  hasPendingAction: boolean;
  actionType: "email" | "calendar" | null;
}

function detectConversationContext(history: { role: string; content: string }[]): ConversationContext {
  // Revisar los últimos 4 mensajes del asistente
  const recentAssistant = history
    .filter(m => m.role === "assistant")
    .slice(-4);

  for (const msg of recentAssistant.reverse()) {
    const c = msg.content;
    // Flujo de email en curso
    if (/EMAIL_LISTO|email listo para enviar|quieres cambiar|redact/i.test(c)
      || /asunto:|subject:|correo a |email a /i.test(c)) {
      return { hasPendingAction: true, actionType: "email" };
    }
    // Flujo de calendario en curso
    if (/EVENTO_LISTO|evento listo para agendar|conflicto|cambiar.*(hora|horario)|agendar.*de todas formas/i.test(c)
      || /reunión con|llamada con|cita con|te sugiero las/i.test(c)) {
      return { hasPendingAction: true, actionType: "calendar" };
    }
  }

  return { hasPendingAction: false, actionType: null };
}

// ── Función principal ──────────────────────────────────────────────────────

/**
 * Determina qué modelo y herramientas usar para el mensaje.
 * Si el mensaje empieza con !opus/!sonnet/!llama, fuerza ese modelo.
 * Si no, usa Llama 3B para clasificar (~0.1s, gratis).
 *
 * @param history — historial reciente para detectar follow-ups de acciones
 * @returns { routing, cleanMessage } — cleanMessage sin el prefijo !modelo
 */
export async function route(
  rawMessage: string,
  env: Env,
  /** Si el plan de la empresa es 'free', downgrade a simple/cloudflare siempre */
  forceFree = false,
  /** Historial reciente para detectar contexto conversacional */
  history: { role: string; content: string }[] = [],
  /** Integraciones activas de la empresa */
  connectedProviders: string[] = [],
  /** ID de la empresa (para cargar MCP skills) */
  companyId?: number
): Promise<{ routing: RoutingDecision; cleanMessage: string }> {

  // Cargar MCP skills de la empresa (una vez para toda la función)
  let mcpSkills: McpSkillInfo[] = [];
  if (companyId) {
    try {
      const rows = await env.DB.prepare(
        `SELECT skill_name, mcp_tool_name, description, synonyms FROM mcp_skills WHERE company_id = ? AND is_active = 1 LIMIT 30`
      ).bind(companyId).all<McpSkillInfo>();
      mcpSkills = rows.results ?? [];
    } catch { /* ignore */ }
  }

  // Detectar si estamos en medio de una acción (email, calendario, etc.)
  const convContext = detectConversationContext(history);

  // Free tier: siempre Llama, pero SÍ detectar herramientas por keywords + Vectorize
  if (forceFree) {
    const preDetected = preDetectTools(rawMessage, connectedProviders, mcpSkills);
    // Semantic MCP search for free tier too
    if (mcpSkills.length > 0 && preDetected.tools.filter(t => t.startsWith("mcp_")).length === 0) {
      try {
        const semanticMcp = await findRelevantSkills(rawMessage, connectedProviders, env, 2, 0.40);
        for (const skill of semanticMcp.filter(s => s.startsWith("mcp_"))) {
          if (!preDetected.tools.includes(skill)) preDetected.tools.push(skill);
        }
      } catch { /* */ }
    }
    const tools: AvailableTool[] = preDetected.tools.length > 0 ? preDetected.tools : ["none"];
    const complexity: TaskComplexity = (preDetected.tools.length > 0 || convContext.hasPendingAction) ? "medium" : "simple";
    const m = MODEL_MAP.simple;
    return {
      routing: {
        complexity,
        model: m.model,
        provider: "cloudflare" as const,
        tools_needed: tools,
        estimated_cost: 0,
      },
      cleanMessage: rawMessage,
    };
  }

  // Forzar modelo con prefijo
  const forced = detectForcedModel(rawMessage);
  if (forced) {
    // !gpt → OpenAI provider
    const isGpt = rawMessage.trimStart().toLowerCase().startsWith("!gpt");
    const m = isGpt ? OPENAI_MAP[forced.complexity] : MODEL_MAP[forced.complexity];
    const provider = isGpt ? "openai" as const : MODEL_MAP[forced.complexity].provider;
    return {
      routing: {
        complexity: forced.complexity,
        model: m.model,
        provider,
        tools_needed: ["none"], // cuando se fuerza modelo, el usuario controla
        estimated_cost: m.cost,
        forced: true,
      },
      cleanMessage: forced.message,
    };
  }

  // Pre-detección por keywords antes del LLM (más confiable para acciones explícitas)
  const preDetected = preDetectTools(rawMessage, connectedProviders, mcpSkills);

  // SIEMPRE buscar MCP skills en Vectorize (busqueda semantica)
  // Esto es lo que permite escalar sin keywords hardcodeados
  if (mcpSkills.length > 0 && preDetected.tools.filter(t => t.startsWith("mcp_")).length === 0) {
    try {
      const semanticMcp = await findRelevantSkills(rawMessage, connectedProviders, env, 2, 0.40);
      const mcpResults = semanticMcp.filter(s => s.startsWith("mcp_"));
      for (const skill of mcpResults) {
        if (!preDetected.tools.includes(skill)) {
          preDetected.tools.push(skill);
        }
      }
    } catch { /* Vectorize unavailable */ }
  }

  // Optimization: skip Llama for short simple messages (but NOT if MCP skills detected)
  const hasMcpTools = preDetected.tools.some(t => t.startsWith("mcp_"));
  const shortSimple = rawMessage.length < 30 && preDetected.tools.length === 0 && !convContext.hasPendingAction;
  const longAmbiguous = rawMessage.length > 80 && preDetected.tools.length === 0 && !convContext.hasPendingAction;

  // If MCP skills were found, go to medium complexity
  if (hasMcpTools && preDetected.tools.length > 0) {
    const m = MODEL_MAP.medium;
    // Remove generic tools that conflict with MCP
    const mcpTools = preDetected.tools.filter(t => t.startsWith("mcp_") || (t !== "make_trigger" && t !== "save_note" && t !== "web_search"));
    return {
      routing: {
        complexity: "medium" as TaskComplexity,
        model: m.model,
        provider: m.provider,
        tools_needed: mcpTools as AvailableTool[],
        estimated_cost: m.cost,
      },
      cleanMessage: rawMessage,
    };
  }

  // Long ambiguous → Sonnet
  if (longAmbiguous) {
    const m = MODEL_MAP.medium;
    return {
      routing: {
        complexity: "medium" as TaskComplexity,
        model: m.model,
        provider: m.provider,
        tools_needed: ["none"] as AvailableTool[],
        estimated_cost: m.cost,
      },
      cleanMessage: rawMessage,
    };
  }

  if (shortSimple) {
    const m = MODEL_MAP.simple;
    return {
      routing: {
        complexity: "simple" as TaskComplexity,
        model: m.model,
        provider: m.provider,
        tools_needed: ["none"] as AvailableTool[],
        estimated_cost: m.cost,
      },
      cleanMessage: rawMessage,
    };
  }

  // If pre-detection found tools with high confidence (email+verb, calendar+time), skip classification
  const highConfidence = preDetected.tools.length > 0;
  let llamaComplexity: TaskComplexity = "medium";
  let llamaTools: AvailableTool[] = [];

  if (!highConfidence) {
    // Only call Llama if pre-detection didn't find anything
    const classified = await classifyWithLlama(rawMessage, env, connectedProviders, companyId);
    llamaComplexity = classified.complexity;
    llamaTools = classified.tools;
  }

  // Semantic search: SIEMPRE buscar MCP skills y agregar si matchean alto
  try {
    const semanticSkills = await findRelevantSkills(rawMessage, connectedProviders, env, 2, 0.55);
    if (semanticSkills.length > 0) {
      // MCP skills (mcp_*) tienen prioridad sobre tools nativos genéricos
      const mcpSkills = semanticSkills.filter(s => s.startsWith("mcp_"));
      if (mcpSkills.length > 0) {
        // Si encontramos MCP skills relevantes, reemplazar tools que puedan conflictuar
        llamaTools = [...llamaTools.filter(t => t !== "save_note" && t !== "none"), ...mcpSkills] as AvailableTool[];
      } else if (preDetected.tools.length === 0 && llamaTools.filter(t => t !== "none").length === 0) {
        // Fallback: usar skills nativos semánticos si no hay nada más
        llamaTools = semanticSkills as AvailableTool[];
      }
    }
  } catch {
    // Vectorize unavailable — continue without semantic detection
  }

  // Fusionar tools detectadas por keywords con las del clasificador
  let mergedTools = [...new Set([...preDetected.tools, ...llamaTools].filter(t => t !== "none"))];

  // Resolver conflictos
  if (mergedTools.includes("schedule_followup")) {
    mergedTools = mergedTools.filter(t => t !== "send_email" && t !== "gmail_send");
  }
  // MCP skills son más específicos — si hay uno, quitar tools genéricos que conflictúan
  const hasMcpSkill = mergedTools.some(t => t.startsWith("mcp_"));
  if (hasMcpSkill) {
    mergedTools = mergedTools.filter(t => t.startsWith("mcp_") || (t !== "make_trigger" && t !== "save_note" && t !== "web_search"));
  }

  const tools: AvailableTool[] = mergedTools.length > 0 ? mergedTools : ["none"];

  // Elevar complejidad a "medium" si:
  // - Se pre-detectó una herramienta de acción, O
  // - Hay una acción pendiente en la conversación (follow-up como "sí", "a las 4", "cámbialo")
  const needsElevation = preDetected.tools.length > 0 || convContext.hasPendingAction;
  const rawComplexity = highConfidence ? "medium" : llamaComplexity;
  const complexity: TaskComplexity =
    needsElevation && rawComplexity === "simple" ? "medium" : rawComplexity;

  const m = MODEL_MAP[complexity];

  return {
    routing: {
      complexity,
      model: m.model,
      provider: m.provider,
      tools_needed: tools,
      estimated_cost: m.cost,
    },
    cleanMessage: rawMessage,
  };
}

// ── Indicador de modelo para Telegram ─────────────────────────────────────

export function modelIndicator(routing: RoutingDecision, durationMs: number): string {
  const sec = (durationMs / 1000).toFixed(1);
  if (routing.provider === "openai") return `\n\n💚 gpt · ${sec}s`;
  switch (routing.complexity) {
    case "simple":  return `\n\n⚡ llama · ${sec}s`;
    case "medium":  return `\n\n🧠 sonnet · ${sec}s`;
    case "complex": return `\n\n🔮 opus · ${sec}s`;
  }
}
