import type { Env } from "./types";
import { searchWeb, fetchPageContent } from "./web-search";
import { runLLM } from "./llm-router";

export interface LeadInput {
  contact_name: string;
  contact_email: string;
  contact_company?: string;
  contact_message?: string;
  contact_phone?: string;
  source: string;
}

export interface ResearchResult {
  company: {
    website: string | null;
    industry: string | null;
    size: string | null;
    location: string | null;
    description: string | null;
    techStack: string[];
    recentNews: string[];
  };
  contact: {
    role: string | null;
    seniority: string | null;
    linkedinUrl: string | null;
    linkedinInsights: string[];
  };
  classification: {
    recommendedUnit: string;
    secondaryUnits: string[];
    urgency: "high" | "medium" | "low";
    leadScore: number;
  };
  content: {
    briefSummary: string;
    briefFull: string;
    suggestedEmailSubject: string;
    suggestedEmailBody: string;
    talkingPoints: string[];
    estimatedValue: string;
    nextStep: string;
    followUpDate: string;
  };
}

function extractDomain(email: string): string | null {
  const domain = email.split("@")[1];
  if (!domain) return null;
  const generic = ["gmail.com","hotmail.com","outlook.com","yahoo.com","icloud.com","live.com","protonmail.com"];
  return generic.includes(domain.toLowerCase()) ? null : domain;
}

const URGENCY_MAP: Record<string, "high" | "medium" | "low"> = {
  alta: "high", high: "high",
  media: "medium", medium: "medium",
  baja: "low", low: "low",
};

function normalizeResult(result: ResearchResult): ResearchResult {
  const rawUrgency = (result.classification?.urgency ?? "low").toLowerCase();
  const score = result.classification?.leadScore ?? 0;
  // Normalize Spanish → English, then apply score-based override as safety net
  const fromMap = URGENCY_MAP[rawUrgency];
  const fromScore: "high" | "medium" | "low" = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  result.classification.urgency = fromMap ?? fromScore;
  return result;
}

function getDefaultResult(lead: LeadInput, companyName: string): ResearchResult {
  return {
    company: { website: null, industry: null, size: null, location: null, description: null, techStack: [], recentNews: [] },
    contact: { role: null, seniority: "unknown", linkedinUrl: null, linkedinInsights: [] },
    classification: { recommendedUnit: "consultoría", secondaryUnits: [], urgency: "medium", leadScore: 30 },
    content: {
      briefSummary: `Lead de ${companyName}: ${lead.contact_message ?? "Sin detalle"}. Requiere investigación manual.`,
      briefFull: `# Lead: ${lead.contact_name}\nEmpresa: ${companyName}\nMensaje: ${lead.contact_message ?? "N/A"}\n\n**Brief automático no disponible.**`,
      suggestedEmailSubject: "Respuesta a su solicitud",
      suggestedEmailBody: `Hola ${lead.contact_name},\n\nGracias por contactarnos. Recibimos su mensaje y nos gustaría conocer más sobre sus necesidades.\n\n¿Tiene disponibilidad para una llamada esta semana?`,
      talkingPoints: ["Entender necesidad específica"],
      estimatedValue: "Por determinar",
      nextStep: "Contactar para entender necesidad",
      followUpDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    },
  };
}

export async function researchLead(
  lead: LeadInput,
  env: Env,
  companyId?: string | number,
  skipWebSearch = false
): Promise<ResearchResult> {
  const domain = extractDomain(lead.contact_email);
  const companyName = lead.contact_company ?? domain?.replace(/\.(com|co|net|org)$/, "") ?? "Desconocida";

  console.log("[researchLead] START skipWebSearch=", skipWebSearch, Date.now());
  let companySearch = { rawText: "" };
  let websiteContent = "";

  if (!skipWebSearch) {
    const searchQuery = lead.contact_message
      ? `${companyName} ${lead.contact_message}`
      : `${companyName} empresa servicios tecnología`;
    [companySearch, websiteContent] = await Promise.all([
      searchWeb(searchQuery, env, { maxResults: 4 }),
      domain ? fetchPageContent(`https://${domain}`) : Promise.resolve(""),
    ]);
  }
  console.log("[researchLead] searches done", Date.now());

  // RAG: consultar base de conocimiento
  let relevantKnowledge = "";
  try {
    const embResp = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [lead.contact_message ?? `${companyName} tecnología servicios`],
    }) as { data: number[][] };
    const vecResults = await env.KNOWLEDGE_BASE.query(embResp.data[0], { topK: 5, returnMetadata: "all" });
    relevantKnowledge = (vecResults.matches ?? [])
      .filter((m) => m.score >= 0.45)
      .map((m) => (m.metadata as { text?: string })?.text ?? "")
      .filter(Boolean)
      .join("\n\n");
  } catch {
    // RAG falla silenciosamente
  }
  console.log("[researchLead] RAG done", Date.now());

  // Truncar resultados para no exceder contexto (~4000 tokens disponibles para datos)
  const truncate = (s: string, max: number) => s.length > max ? s.substring(0, max) + "..." : s;

  const prompt = `Analista de inteligencia comercial de Ailyn (Colombia). Genera un brief de ventas en JSON.

UNIDADES DE DATA SERVICIOS: Data Núcleo (infraestructura/redes/cloud), Data Ingenio (consultoría IT/proyectos), Data Fuerza (hardware laptops/servidores), Data Flujo (renting tecnológico), Data Control (software/automatización/IA), Data Capital (financiamiento IT), Data Ciclo (sostenibilidad/e-waste)

LEAD: ${lead.contact_name} | ${lead.contact_email} | ${companyName}
MENSAJE: ${lead.contact_message ?? "N/A"}

DATOS INVESTIGADOS:
${truncate(companySearch.rawText, 1000) || "Sin resultados web"}
---
${truncate(websiteContent, 800) || "Sitio no accesible"}
${relevantKnowledge ? `---\nCONOCIMIENTO INTERNO DATA SERVICIOS:\n${truncate(relevantKnowledge, 600)}` : ""}

URGENCIA: usa "high" si score>=70 o hay urgencia/deadline explícito, "medium" si score 40-69, "low" si score<40

Responde ÚNICAMENTE con este JSON (sin texto antes ni después, sin markdown):
{"company":{"website":null,"industry":null,"size":null,"location":null,"description":null,"techStack":[],"recentNews":[]},"contact":{"role":null,"seniority":"unknown","linkedinUrl":null,"linkedinInsights":[]},"classification":{"recommendedUnit":"Data Núcleo","secondaryUnits":[],"urgency":"high","leadScore":75},"content":{"briefSummary":"resumen ejecutivo 2 oraciones","briefFull":"# Brief\\n## Empresa\\n...","suggestedEmailSubject":"asunto","suggestedEmailBody":"email personalizado en español","talkingPoints":["punto 1"],"estimatedValue":"Por determinar","nextStep":"acción concreta","followUpDate":"2026-04-01"}}`;

  try {
    console.log("[researchLead] calling LLM...", Date.now());
    const llmResult = await runLLM(
      env,
      "brief_generation",
      "Responde SOLO con JSON válido. Sin markdown wrapping. Sin texto adicional.",
      prompt,
      companyId
    );
    console.log("[researchLead] LLM done", Date.now());

    console.log(`[researchLead] brief generated by ${llmResult.provider}/${llmResult.model}`);

    let text = llmResult.text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      text = text.substring(jsonStart, jsonEnd + 1);
    }

    const parsed = JSON.parse(text) as ResearchResult;
    // Attach the provider info for callers that want to persist it
    (parsed as ResearchResult & { _llmProvider?: string; _llmModel?: string })._llmProvider = llmResult.provider;
    (parsed as ResearchResult & { _llmProvider?: string; _llmModel?: string })._llmModel = llmResult.model;

    return normalizeResult(parsed);
  } catch (err) {
    console.error("[researchLead] failed:", String(err));
    return getDefaultResult(lead, companyName);
  }
}
