// ── Orquestador Central de Ailyn ──────────────────────────────────────────
// Recibe un mensaje, lo enruta al modelo correcto, ejecuta herramientas,
// y retorna una respuesta completa con metadatos de uso.

import type { Env } from "./types";
import { route, modelIndicator } from "./llm-smart-router";
import type { RoutingDecision } from "./llm-smart-router";
import { executeTools, formatToolResults } from "./tool-executor";
import type { ExecutionContext } from "./tool-executor";
import { getPlanLLMProvider } from "./usage";
import { getCompanyFeatures, isToolAllowed, getBlockedMessage } from "./features";
import { loadMemory, detectLearningIntent, saveFact } from "./memory";

// Gmail draft helper (duplicado aquí para evitar import circular con tool-executor)
async function gmailCreateDraftViaOrchestrator(token: string, to: string, subject: string, body: string): Promise<void> {
  const email = [`To: ${to}`, `Subject: ${subject}`, `Content-Type: text/plain; charset=utf-8`, "", body].join("\r\n");
  const raw = btoa(unescape(encodeURIComponent(email))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) throw new Error(`Gmail draft error ${res.status}`);
}

export interface OrchestratorInput {
  message: string;
  companyId: number;
  companyName: string;
  industry?: string;
  sessionId: string;
  channel: "telegram" | "whatsapp" | "webchat" | "api";
  /** Historial reciente (últimos 10 mensajes) en formato { role, content } */
  history?: { role: "user" | "assistant"; content: string }[];
  /** Tokens de integraciones */
  googleToken?: string | null;
  githubToken?: string | null;
  /** Si true, fuerza Llama (plan free) */
  forceFree?: boolean;
}

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
}

export interface CalendarDraft {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  attendees: string[];
}

export interface FollowupDraft {
  to: string;
  days: number;
  context: string;
  subject: string;
  chain?: number[];
}

export interface NoteDraft {
  title: string;
  content: string;
  url: string;
}

export interface OrchestratorOutput {
  text: string;
  model_used: string;
  complexity: string;
  tools_used: string[];
  estimated_cost: number;
  /** Para incluir al final del mensaje de Telegram */
  indicator: string;
  /** Tiempo de respuesta en ms */
  duration_ms: number;
  /** Si el LLM generó un email, contiene el draft para aprobación */
  emailDraft?: EmailDraft;
  /** Si el LLM generó un evento, contiene el draft para aprobación */
  calendarDraft?: CalendarDraft;
  /** Si el LLM programó un follow-up, contiene los datos */
  followupDraft?: FollowupDraft;
  /** Actions that were detected but NOT yet handled (for multi-action sequencing) */
  remainingActions?: string[];
  /** If the LLM generated a note for Obsidian */
  noteDraft?: NoteDraft;
}

// ── Llamadas a modelos ─────────────────────────────────────────────────────

async function callCloudflareModel(
  model: string,
  systemPrompt: string,
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[],
  env: Env
): Promise<string> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history,
    { role: "user" as const, content: userMessage },
  ];
  const result = await env.AI.run(
    model as Parameters<typeof env.AI.run>[0],
    { messages, max_tokens: 2048 }
  ) as { response?: unknown };

  const resp = result.response;
  if (typeof resp === "object" && resp !== null && !Array.isArray(resp)) return JSON.stringify(resp);
  if (Array.isArray(resp)) return (resp as string[]).join("");
  return String(resp ?? "");
}

async function callAnthropicModel(
  model: string,
  systemPrompt: string,
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[],
  env: Env
): Promise<string> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return callCloudflareModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast", systemPrompt, userMessage, history, env);
  }

  const messages = [
    ...history,
    { role: "user" as const, content: userMessage },
  ];

  // Prompt Caching: marcar el system prompt como cacheable (90% descuento en tokens repetidos)
  // https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[orchestrator] Anthropic error ${res.status}: ${err}`);
    return callCloudflareModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast", systemPrompt, userMessage, history, env);
  }

  const data = await res.json() as { content: { text: string }[]; usage?: { cache_creation_input_tokens?: number; cache_read_input_tokens?: number } };
  if (data.usage?.cache_read_input_tokens) {
    console.log(`[orchestrator] Prompt cache HIT: ${data.usage.cache_read_input_tokens} tokens cached (90% savings)`);
  }
  return data.content[0]?.text ?? "";
}

async function callOpenAIModel(
  model: string,
  systemPrompt: string,
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[],
  env: Env
): Promise<string> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    // Fallback a Anthropic, luego Llama
    return callAnthropicModel("claude-sonnet-4-20250514", systemPrompt, userMessage, history, env);
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history,
    { role: "user" as const, content: userMessage },
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[orchestrator] OpenAI error ${res.status}: ${err}`);
    // Fallback a Anthropic
    return callAnthropicModel("claude-sonnet-4-20250514", systemPrompt, userMessage, history, env);
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "";
}

// ── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(input: OrchestratorInput, toolContext: string, memoryContext = ""): string {
  const now = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

  // Add conversation context summary for reference resolution
  const historyContext = (input.history ?? []).length > 0
    ? `\n\n## Contexto de esta conversación\n${(input.history ?? []).slice(-6).map(m => `- ${m.role === "user" ? "Usuario" : "Tú"}: ${m.content.slice(0, 150)}`).join("\n")}\n\nUsa este contexto para interpretar referencias como "hazlo", "sí", "el mismo", "esa persona". Si el usuario dice algo ambiguo, infiere del contexto anterior.`
    : "";

  return `Eres Ailyn, el asistente personal inteligente de ${input.companyName}.
Eres directo, eficiente y proactivo. No repites lo que el usuario dice. No pides permiso para cosas obvias. Actúas.
Nunca menciones tu modelo subyacente (Llama, Sonnet, Opus). Eres simplemente "Ailyn".
NUNCA muestres JSON interno, function_calls, XML, ni datos técnicos al usuario. Solo responde en lenguaje natural.

## Idioma
Detecta automáticamente el idioma del usuario y responde en ese mismo idioma:
- Español → responde en español
- English → respond in English
- Português → responda em português
- Para cualquier otro idioma, responde en el idioma del mensaje
Mantén el idioma consistente durante toda la conversación a menos que el usuario cambie.

Empresa: ${input.companyName}${input.industry ? ` · Industria: ${input.industry}` : ""}
Fecha y hora: ${now}
Canal: ${input.channel}

## Reglas de autonomía
- Para ENVIAR emails: siempre redacta el draft con el marcador. El sistema mostrará botones de aprobación al usuario.
- Para AGENDAR reuniones: siempre genera el draft con el marcador. El sistema pedirá confirmación.
- Para FOLLOW-UPS: programa el seguimiento. El sistema pedirá confirmación.
- Para RESPONDER preguntas, buscar info, leer calendario/email: actúa directamente sin pedir permiso.
- NUNCA digas "¿quieres que lo envíe?" — el sistema de botones se encarga de la aprobación.

## Consulta de notas y knowledge base
Cuando el usuario pregunte por sus notas o conocimiento guardado ("qué notas tengo?", "qué guardé sobre X?"):
1. Si hay resultados de rag_search en los datos de herramientas, preséntalo como CATÁLOGO:
   📝 **Notas encontradas sobre [tema]:** (X resultados)

   1. 📌 **[Título de la nota]**
      Resumen en 1 línea

   2. 📌 **[Título de otra nota]**
      Resumen en 1 línea

2. Al final pregunta: "¿Quieres que profundice en alguna?"
3. Si el usuario pide detalle de una nota específica, muestra el contenido completo
4. NUNCA muestres el contenido completo de todas las notas — solo títulos y resumen corto
5. Si no hay resultados, di: "No encontré notas sobre ese tema. ¿Quieres que busque en internet?"

## Envío de emails
Cuando el usuario te pida enviar un email (con lenguaje natural como "envíale un correo a...", "mándale un email a...", "escríbele a..."):
1. Redacta el email completo con formato: Asunto: [asunto]\n\n[cuerpo]\n\nFirma: Equipo de ${input.companyName}
2. Al final del email incluye exactamente el marcador: ---EMAIL_LISTO---
3. El sistema lo enviará automáticamente. No le pidas confirmación al usuario — actúa.

## Agendar eventos
Cuando el usuario te pida agendar una reunión, cita, llamada o evento:
1. PRIMERO revisa los eventos existentes del calendario (si los tienes en los datos de herramientas)
2. Si hay un conflicto de horario, AVISA al usuario: "Tienes [evento] a esa hora. ¿Quieres agendar de todas formas o cambiar la hora?"
3. Si no hay conflicto, confirma los detalles en lenguaje natural y al final incluye:
---EVENTO_LISTO---
{"title":"título","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","description":"descripción","attendees":["email@ejemplo.com"]}
4. Si dice "mañana", "el jueves", etc. calcula la fecha real basándote en la fecha actual.

## Follow-ups automáticos
Cuando el usuario pida dar seguimiento o follow-up a alguien:
1. Confirma: a quién, en cuánto tiempo, y sobre qué tema
2. Al final incluye exactamente:
---FOLLOWUP_LISTO---
{"to":"email@ejemplo.com","days":3,"context":"contexto del seguimiento","subject":"asunto del follow-up"}
3. Si dice "si no responde en 3 días", usa days=3. Si dice "la próxima semana", usa days=7.

## Resumen de emails
Cuando el usuario pregunte por sus emails ("qué emails tengo?", "emails importantes", "qué llegó?"):
1. Revisa los datos de gmail_read en las herramientas
2. Presenta un resumen EJECUTIVO: máximo 5 emails, ordenados por importancia
3. Para cada email incluye: remitente, asunto, y una ACCIÓN SUGERIDA (responder, agendar reunión, archivar, dar follow-up)
4. Formato: emoji + remitente en negrita + asunto + acción sugerida
5. Al final sugiere: "¿Quieres que responda alguno o agende una reunión?"

## Borradores de Gmail
Cuando el usuario pida guardar un borrador ("guárdame un borrador", "draft para Pedro"):
1. Redacta el email completo
2. Al final incluye exactamente:
---BORRADOR_LISTO---
{"to":"email@ejemplo.com","subject":"asunto","body":"contenido del email"}
3. El sistema lo guardará automáticamente como borrador en Gmail

## Organización de correo
Cuando el usuario pida organizar, etiquetar o clasificar emails:
1. Si tienes datos del inbox_organized, presenta los emails por categoría
2. Ofrece acciones: archivar spam, crear etiquetas, mover a carpetas
3. Ejecuta las acciones que el usuario confirme

## CRM conversacional
Cuando el usuario pregunte por un contacto ("qué pasó con Pedro?", "historial de SmartPasses"):
1. Revisa los datos de crm_lookup en las herramientas
2. Presenta el historial como una TIMELINE clara y cronológica
3. Incluye: lead info (si existe), emails enviados, reuniones agendadas, follow-ups, estado actual
4. Al final sugiere PRÓXIMO PASO: "¿Quieres que le envíe otro email?", "¿Agendo reunión?", "¿Le doy seguimiento?"
5. Usa emojis: 📧 email, 📅 reunión, 🔄 follow-up, ⚡ lead, ✅ ejecutado, ⏳ pendiente

## Acciones combinadas
Si el usuario pide MÚLTIPLES acciones en un solo mensaje (ej: "envía email Y agéndame reunión Y dale seguimiento"):
1. Ejecuta la PRIMERA acción (genera el draft con su marcador)
2. Al final de tu respuesta, lista las acciones pendientes con: ---PENDIENTES: acción1, acción2---
Ejemplo: Si pidió email + reunión + followup, primero redacta el email con ---EMAIL_LISTO--- y al final agrega:
---PENDIENTES: agendar reunión con Pedro el jueves a las 3pm, follow-up en 3 días a pedro@smartpasses.io---
${memoryContext}
${historyContext}
${toolContext}`;
}

// ── Guardar en historial ───────────────────────────────────────────────────

export async function saveConversationTurn(
  env: Env,
  input: OrchestratorInput,
  userContent: string,
  assistantContent: string,
  routing: RoutingDecision
): Promise<void> {
  // Guardar mensaje del usuario
  await env.DB.prepare(
    `INSERT INTO conversation_history (company_id, channel, session_id, role, content, model_used, tools_used, complexity, cost_estimate)
     VALUES (?, ?, ?, 'user', ?, NULL, NULL, NULL, 0)`
  ).bind(input.companyId, input.channel, input.sessionId, userContent).run();

  // Guardar respuesta del asistente
  await env.DB.prepare(
    `INSERT INTO conversation_history (company_id, channel, session_id, role, content, model_used, tools_used, complexity, cost_estimate)
     VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?)`
  ).bind(
    input.companyId,
    input.channel,
    input.sessionId,
    assistantContent,
    routing.model,
    JSON.stringify(routing.tools_needed),
    routing.complexity,
    routing.estimated_cost
  ).run();
}

/** Carga los últimos N turnos del historial UNIFICADO por empresa (todos los canales) */
export async function loadHistory(
  env: Env,
  sessionId: string,
  limit = 10,
  companyId?: number
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  // Si tenemos companyId, cargar historial unificado (Telegram + WhatsApp + Desktop + Webchat)
  // Esto permite que Ailyn recuerde todo sin importar el canal
  if (companyId) {
    const rows = await env.DB.prepare(
      `SELECT role, content FROM conversation_history
       WHERE company_id = ?
       ORDER BY created_at DESC LIMIT ?`
    ).bind(companyId, limit).all<{ role: string; content: string }>();

    return (rows.results ?? [])
      .reverse()
      .map(r => ({ role: r.role as "user" | "assistant", content: r.content }));
  }

  // Fallback: historial por sesión (para webchat público sin auth)
  const rows = await env.DB.prepare(
    `SELECT role, content FROM conversation_history
     WHERE session_id = ?
     ORDER BY created_at DESC LIMIT ?`
  ).bind(sessionId, limit).all<{ role: string; content: string }>();

  return (rows.results ?? [])
    .reverse()
    .map(r => ({ role: r.role as "user" | "assistant", content: r.content }));
}

/** Carga tokens de integraciones de la empresa */
export async function loadIntegrations(env: Env, companyId: number): Promise<{ googleToken: string | null; githubToken: string | null }> {
  const google = await env.DB.prepare(
    `SELECT access_token FROM integrations WHERE company_id = ? AND provider = 'google' AND is_active = 1`
  ).bind(companyId).first<{ access_token: string }>();

  const github = await env.DB.prepare(
    `SELECT access_token FROM integrations WHERE company_id = ? AND provider = 'github' AND is_active = 1`
  ).bind(companyId).first<{ access_token: string }>();

  return {
    googleToken: google?.access_token ?? null,
    githubToken: github?.access_token ?? null,
  };
}

// ── Función principal ──────────────────────────────────────────────────────

export async function orchestrate(
  input: OrchestratorInput,
  env: Env
): Promise<OrchestratorOutput> {
  const start = Date.now();

  // 1. Determinar si forzar free tier
  const planProvider = input.forceFree
    ? "cloudflare"
    : await getPlanLLMProvider(env, input.companyId).catch(() => "cloudflare" as const);
  const forceFree = planProvider === "cloudflare" || (input.forceFree ?? false);

  // 2. Router: clasificar + seleccionar modelo (con historial para detectar follow-ups)
  const { routing, cleanMessage } = await route(input.message, env, forceFree, input.history ?? []);

  // 2.5 Response Cache: para mensajes simples sin herramientas, buscar en KV
  const isSimpleNoTools = routing.complexity === "simple" && routing.tools_needed[0] === "none";
  if (isSimpleNoTools) {
    const cacheKey = `cache:${input.companyId}:${cleanMessage.toLowerCase().trim().slice(0, 100)}`;
    const cached = await env.KV.get(cacheKey);
    if (cached) {
      const duration = Date.now() - start;
      console.log(`[orchestrator] Cache HIT for: "${cleanMessage.slice(0, 50)}" (saved LLM call)`);
      return {
        text: cached,
        model_used: "cache",
        complexity: "simple",
        tools_used: ["none"],
        estimated_cost: 0,
        indicator: `\n\n⚡ cache · ${(duration / 1000).toFixed(1)}s`,
        duration_ms: duration,
      };
    }
  }

  // 3. Ejecutar herramientas
  const ctx: ExecutionContext = {
    companyId: input.companyId,
    companyName: input.companyName,
    sessionId: input.sessionId,
    userMessage: cleanMessage,
    googleToken: input.googleToken,
    githubToken: input.githubToken,
  };

  // 3.5 Feature flags: filtrar tools no permitidos por el plan
  const features = await getCompanyFeatures(env, input.companyId);
  const blockedTools: string[] = [];
  const allowedTools = routing.tools_needed.filter(t => {
    if (t === "none") return true;
    if (isToolAllowed(t, features)) return true;
    blockedTools.push(getBlockedMessage(t));
    return false;
  });

  const toolResults = allowedTools[0] !== "none" && allowedTools.length > 0
    ? await executeTools(allowedTools as typeof routing.tools_needed, ctx, env)
    : [];

  // Si hay tools bloqueados, agregar mensaje al contexto
  const blockedContext = blockedTools.length > 0
    ? `\n\n⚠️ Funciones no disponibles en el plan actual:\n${blockedTools.join("\n")}`
    : "";

  const toolContext = formatToolResults(toolResults) + blockedContext;

  // 3.7 Cargar memoria de la empresa
  const memoryContext = await loadMemory(env, input.companyId);

  // 4. Generar respuesta con el modelo seleccionado
  const systemPrompt = buildSystemPrompt(input, toolContext, memoryContext);
  const history = input.history ?? [];

  let responseText: string;

  if (routing.provider === "anthropic") {
    responseText = await callAnthropicModel(routing.model, systemPrompt, cleanMessage, history, env);
  } else if (routing.provider === "openai") {
    responseText = await callOpenAIModel(routing.model, systemPrompt, cleanMessage, history, env);
  } else {
    responseText = await callCloudflareModel(routing.model, systemPrompt, cleanMessage, history, env);
  }

  // 5. Post-procesamiento: extraer email draft si el LLM lo generó (NO enviar — esperar aprobación)
  // Detectar por marcador en el texto, no solo por tools_needed (el usuario puede confirmar en un mensaje de seguimiento)
  let emailDraft: EmailDraft | undefined;

  if (responseText.includes("---EMAIL_LISTO---")) {
    // Extraer destinatario del texto o de tool results
    const emailResult = toolResults.find(r => r.tool === "send_email");
    const recipientFromTool = (emailResult?.data as { to?: string })?.to;
    const recipientFromText = responseText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)?.[0];
    const recipient = recipientFromTool || recipientFromText;

    if (recipient) {
      const emailBody = responseText.replace("---EMAIL_LISTO---", "").trim();
      const subjectMatch = emailBody.match(/^(?:Asunto|Subject):\s*(.+)/im);
      const subject = subjectMatch ? subjectMatch[1].trim() : "Mensaje de " + input.companyName;
      const body = emailBody.replace(/^(?:Asunto|Subject):.+\n?/im, "").trim();

      emailDraft = { to: recipient, subject, body };
      responseText = emailBody.replace("---EMAIL_LISTO---", "").trim();
    }
  }

  // 6. Post-procesamiento: extraer calendar draft si el LLM lo generó
  // Detectar por marcador en el texto, no solo por tools_needed (confirmaciones en mensajes de seguimiento)
  let calendarDraft: CalendarDraft | undefined;

  if (responseText.includes("---EVENTO_LISTO---")) {
    const parts = responseText.split("---EVENTO_LISTO---");
    const jsonStr = parts[1]?.trim();
    if (jsonStr) {
      try {
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as CalendarDraft;
          if (parsed.title && parsed.date && parsed.startTime) {
            calendarDraft = {
              title: parsed.title,
              date: parsed.date,
              startTime: parsed.startTime,
              endTime: parsed.endTime || parsed.startTime.replace(/:\d{2}$/, m => `:${parseInt(m.slice(1)) + 60 > 59 ? "00" : m.slice(1)}`),
              description: parsed.description || "",
              attendees: parsed.attendees || [],
            };
          }
        }
      } catch {
        console.error("[orchestrator] Failed to parse calendar JSON");
      }
    }
    responseText = parts[0]?.trim() ?? responseText;
  }

  // 7. Post-procesamiento: extraer follow-up de los tool results (programático, no depende del LLM)
  let followupDraft: FollowupDraft | undefined;

  const followupResult = toolResults.find(r => r.tool === "schedule_followup" && r.success);
  const followupData = followupResult?.data as { action?: string; to?: string; days?: number; context?: string; subject?: string } | undefined;
  if (followupData?.action === "followup_ready" && followupData.to) {
    followupDraft = {
      to: followupData.to,
      days: followupData.days ?? 3,
      context: followupData.context || "",
      subject: followupData.subject || "Seguimiento",
      chain: (followupData as Record<string, unknown>).chain as number[] ?? [3, 7, 14],
    };
  }

  // Limpiar marcador si el LLM lo generó de todas formas
  if (responseText.includes("---FOLLOWUP_LISTO---")) {
    responseText = responseText.split("---FOLLOWUP_LISTO---")[0]?.trim() ?? responseText;
  }

  // 8. Detect remaining actions for multi-action sequencing
  let remainingActions: string[] = [];
  const pendingMatch = responseText.match(/---PENDIENTES:\s*(.+?)---/i);
  if (pendingMatch) {
    remainingActions = pendingMatch[1].split(",").map(a => a.trim()).filter(Boolean);
    responseText = responseText.replace(/---PENDIENTES:.+?---/i, "").trim();
  }

  // 9. Extract note for Obsidian
  let noteDraft: NoteDraft | undefined;

  if (responseText.includes("---NOTA_LISTA---") && responseText.includes("---FIN_NOTA---")) {
    const noteMatch = responseText.match(/---NOTA_LISTA---\s*([\s\S]*?)\s*---FIN_NOTA---/);
    if (noteMatch) {
      const noteContent = noteMatch[1].trim();
      const titleMatch = noteContent.match(/^#\s+(.+)/m);
      const urlMatch = noteContent.match(/\*\*Fuente:\*\*\s*(https?:\/\/[^\s]+)/);
      noteDraft = {
        title: titleMatch ? titleMatch[1].trim() : "Nota de Ailyn",
        content: noteContent,
        url: urlMatch ? urlMatch[1] : "",
      };
      responseText = responseText.replace(/---NOTA_LISTA---[\s\S]*?---FIN_NOTA---/, "").trim();
      if (!responseText) {
        responseText = `\uD83D\uDCDD Nota lista: "${noteDraft.title}". Se guardar\u00E1 en tu Obsidian.`;
      }
    }
  }

  // 9.5 Crear borrador en Gmail si el LLM generó ---BORRADOR_LISTO---
  if (responseText.includes("---BORRADOR_LISTO---")) {
    const parts = responseText.split("---BORRADOR_LISTO---");
    const jsonStr = parts[1]?.trim();
    if (jsonStr && input.googleToken) {
      try {
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const draft = JSON.parse(jsonMatch[0]) as { to: string; subject: string; body: string };
          if (draft.to && draft.subject) {
            const { getValidGoogleToken: getToken } = await import("./google-oauth");
            const freshToken = await getToken(env, input.companyId);
            if (freshToken) {
              await gmailCreateDraftViaOrchestrator(freshToken, draft.to, draft.subject, draft.body);
              responseText = parts[0]?.trim() + `\n\n✅ Borrador guardado en Gmail para ${draft.to}`;
            }
          }
        }
      } catch (e) {
        console.error("[orchestrator] Draft creation error:", String(e));
        responseText = parts[0]?.trim() + "\n\n⚠️ No se pudo crear el borrador en Gmail.";
      }
    } else {
      responseText = parts[0]?.trim() ?? responseText;
    }
  }

  // Guardar en cache si fue simple sin herramientas ni drafts (TTL: 1 hora)
  if (isSimpleNoTools && !emailDraft && !calendarDraft && !followupDraft && !noteDraft && responseText.length < 2000) {
    const cacheKey = `cache:${input.companyId}:${cleanMessage.toLowerCase().trim().slice(0, 100)}`;
    env.KV.put(cacheKey, responseText, { expirationTtl: 3600 }).catch(() => {});
  }

  // 10. Detectar si el usuario enseñó algo → guardar en memoria
  const learning = detectLearningIntent(cleanMessage, responseText, input.history ?? []);
  if (learning.shouldLearn && learning.fact) {
    saveFact(env, input.companyId, learning.fact, learning.category).catch(() => {});
  }

  // 11. Limpiar respuesta — eliminar XML/JSON interno que el LLM no debería mostrar
  responseText = responseText
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, "")
    .replace(/<function_result>[\s\S]*?<\/function_result>/g, "")
    .replace(/<invoke[\s\S]*?<\/invoke>/g, "")
    .replace(/```json\s*\{[\s\S]*?"action":\s*"save_note"[\s\S]*?```/g, "")
    .replace(/\{[\s\S]*?"action":\s*"save_note"[\s\S]*?"status":\s*"saved"\s*\}/g, "")
    .trim();

  const duration = Date.now() - start;
  const indicator = modelIndicator(routing, duration);

  return {
    text: responseText,
    model_used: routing.model,
    complexity: routing.complexity,
    tools_used: routing.tools_needed,
    estimated_cost: routing.estimated_cost,
    indicator,
    duration_ms: duration,
    emailDraft,
    calendarDraft,
    followupDraft,
    noteDraft,
    remainingActions: remainingActions.length > 0 ? remainingActions : undefined,
  };
}
