import type { Env } from "./types";
import { authenticateUser } from "./auth";
import { upsertAgentWithSkills, insertKnowledgeDoc } from "./d1";
import { createDefaultWorkPlans } from "./work-plans";

// ── CORS ──────────────────────────────────────────────────────────────────
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

// ── Generación de system prompt ───────────────────────────────────────────

const TONE_MAP: Record<string, string> = {
  Profesional: "profesional y formal",
  Amigable: "amigable y cercano",
  Casual: "casual y relajado",
  Técnico: "técnico y preciso",
};

const LANG_MAP: Record<string, string> = {
  Español: "español",
  Inglés: "inglés",
  Portugués: "portugués",
};

function buildSystemPrompt(
  companyName: string,
  industry: string,
  description: string,
  agentName: string,
  tone: string,
  language: string
): string {
  const toneText = TONE_MAP[tone] ?? tone;
  const langText = LANG_MAP[language] ?? language;
  return `Eres ${agentName}, el asistente virtual de ${companyName}.

${companyName} es una empresa de ${industry} que ${description}.

Tu comunicación es ${toneText} y respondes principalmente en ${langText}.

Tu misión:
- Ayudar a los visitantes a conocer los productos y servicios de ${companyName}
- Responder preguntas sobre la empresa con precisión y claridad
- Guiar a cada visitante hacia la mejor solución para su situación
- Si no conoces la respuesta, decirlo con honestidad y ofrecer conectarlos con el equipo humano

Sé conciso y útil. Nunca inventes información que no esté en tu base de conocimiento.`;
}

// ── POST /api/setup/generate-prompt ──────────────────────────────────────

export async function handleGeneratePrompt(request: Request, env: Env): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return json({ error: "No autorizado" }, 401);

  let body: {
    company_name?: string;
    industry?: string;
    description?: string;
    agent_name?: string;
    tone?: string;
    language?: string;
  };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { company_name, industry, description, agent_name, tone, language } = body;
  if (!company_name || !industry || !description || !agent_name || !tone || !language) {
    return json({ error: "Todos los campos son requeridos" }, 400);
  }

  const system_prompt = buildSystemPrompt(company_name, industry, description, agent_name, tone, language);
  return json({ system_prompt });
}

// ── POST /api/setup/complete ──────────────────────────────────────────────

interface SetupDocument {
  title: string;
  content: string;
}

export async function handleSetupComplete(request: Request, env: Env): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return json({ error: "No autorizado" }, 401);

  let body: {
    company: { name?: string; industry?: string; description?: string; website?: string };
    agent: { name?: string; tone?: string; language?: string };
    documents: SetupDocument[];
  };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { company, agent, documents } = body;
  if (!company?.industry || !company?.description || !agent?.name || !agent?.tone || !agent?.language) {
    return json({ error: "Faltan campos requeridos" }, 400);
  }

  const companyId = user.company_id;
  const companyName = company.name?.trim() || user.company_name;

  // 1. Actualizar company
  await env.DB.prepare(
    `UPDATE companies SET name = ?, industry = ?, description = ?, website = ? WHERE id = ?`
  ).bind(
    companyName,
    company.industry.trim(),
    company.description.trim(),
    company.website?.trim() || null,
    companyId
  ).run();

  // 2. Generar system prompt + crear agente
  const systemPrompt = buildSystemPrompt(
    companyName,
    company.industry.trim(),
    company.description.trim(),
    agent.name.trim(),
    agent.tone,
    agent.language
  );

  const agentId = await upsertAgentWithSkills(
    env,
    companyId,
    agent.name.trim(),
    systemPrompt,
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    []
  );

  // 3. Vectorizar e indexar documentos
  let docsCount = 0;
  const docs = Array.isArray(documents) ? documents : [];

  for (const doc of docs) {
    if (!doc.title?.trim() || !doc.content?.trim()) continue;
    try {
      const embeddingRes = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [doc.content],
      }) as { data: number[][] };
      const vector = embeddingRes.data[0];

      const vectorId = `${companyId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await env.KNOWLEDGE_BASE.insert([{
        id: vectorId,
        values: vector,
        metadata: { company_id: companyId, title: doc.title.trim(), text: doc.content.slice(0, 900) },
      }]);

      await insertKnowledgeDoc(env, companyId, doc.title.trim(), vectorId, doc.content.slice(0, 300));
      docsCount++;
    } catch {
      // Continúa con el siguiente doc si uno falla
    }
  }

  // 4. Crear work plans por defecto para la empresa
  try {
    await createDefaultWorkPlans(env, companyId, company.industry.trim());
  } catch (wpErr) {
    console.error("[setup] Error creando work plans por defecto:", String(wpErr));
    // No bloquea el setup si falla
  }

  // 5. Marcar setup como completado
  await env.DB.prepare(
    `UPDATE companies SET setup_completed = 1 WHERE id = ?`
  ).bind(companyId).run();

  // Obtener slug actualizado de la company
  const companyRow = await env.DB.prepare(
    `SELECT slug FROM companies WHERE id = ?`
  ).bind(companyId).first<{ slug: string | null }>();

  return json({
    success: true,
    company_slug: companyRow?.slug ?? "",
    agent_id: agentId,
    docs_count: docsCount,
  });
}
