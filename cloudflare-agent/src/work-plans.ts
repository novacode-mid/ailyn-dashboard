/**
 * Work Plans — Automatizaciones autónomas por empresa
 *
 * Cada empresa tiene work plans con steps que se ejecutan en cron.
 * Tipos de acción: prospect_research, send_report, follow_up, auto_email, knowledge_refresh
 */

import type { Env } from "./types";
import { researchLead } from "./lead-research";
import { searchWeb } from "./web-search";
import { runLLM } from "./llm-router";
import { saveLead, listLeads, getTelegramConfig } from "./d1";
import { checkUsageLimit, incrementUsage } from "./usage";
import { getValidGoogleToken } from "./google-oauth";

// ── Interfaces ─────────────────────────────────────────────────────────────

export interface WorkPlan {
  id: number;
  company_id: number;
  name: string;
  description: string | null;
  cron_expression: string;
  is_active: number;
  last_run_at: string | null;
  created_at: string;
}

export interface WorkPlanStep {
  id: number;
  work_plan_id: number;
  step_order: number;
  action_type: string;
  config: string; // JSON string
}

export interface WorkPlanRun {
  id: number;
  work_plan_id: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  results: string | null;
  error: string | null;
}

// ── D1 helpers ─────────────────────────────────────────────────────────────

export async function listWorkPlans(env: Env, companyId: number): Promise<WorkPlan[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM work_plans WHERE company_id = ? ORDER BY created_at ASC`
  ).bind(companyId).all<WorkPlan>();
  return res.results ?? [];
}

export async function getWorkPlan(env: Env, id: number, companyId: number): Promise<WorkPlan | null> {
  return env.DB.prepare(
    `SELECT * FROM work_plans WHERE id = ? AND company_id = ?`
  ).bind(id, companyId).first<WorkPlan>();
}

export async function getWorkPlanSteps(env: Env, workPlanId: number): Promise<WorkPlanStep[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM work_plan_steps WHERE work_plan_id = ? ORDER BY step_order ASC`
  ).bind(workPlanId).all<WorkPlanStep>();
  return res.results ?? [];
}

export async function createWorkPlan(
  env: Env,
  companyId: number,
  data: { name: string; description?: string; cron_expression: string }
): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO work_plans (company_id, name, description, cron_expression) VALUES (?, ?, ?, ?)`
  ).bind(companyId, data.name, data.description ?? null, data.cron_expression).run();
  return res.meta.last_row_id as number;
}

export async function updateWorkPlan(
  env: Env,
  id: number,
  companyId: number,
  data: { name?: string; description?: string; cron_expression?: string; is_active?: number }
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.cron_expression !== undefined) { fields.push("cron_expression = ?"); values.push(data.cron_expression); }
  if (data.is_active !== undefined) { fields.push("is_active = ?"); values.push(data.is_active); }
  if (fields.length === 0) return;
  values.push(id, companyId);
  await env.DB.prepare(
    `UPDATE work_plans SET ${fields.join(", ")} WHERE id = ? AND company_id = ?`
  ).bind(...values).run();
}

export async function deleteWorkPlan(env: Env, id: number, companyId: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM work_plan_steps WHERE work_plan_id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM work_plans WHERE id = ? AND company_id = ?`).bind(id, companyId).run();
}

export async function replaceWorkPlanSteps(
  env: Env,
  workPlanId: number,
  steps: Array<{ action_type: string; config: unknown }>
): Promise<void> {
  await env.DB.prepare(`DELETE FROM work_plan_steps WHERE work_plan_id = ?`).bind(workPlanId).run();
  for (let i = 0; i < steps.length; i++) {
    await env.DB.prepare(
      `INSERT INTO work_plan_steps (work_plan_id, step_order, action_type, config) VALUES (?, ?, ?, ?)`
    ).bind(workPlanId, i + 1, steps[i].action_type, JSON.stringify(steps[i].config)).run();
  }
}

export async function createWorkPlanRun(env: Env, workPlanId: number): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO work_plan_runs (work_plan_id, status) VALUES (?, 'running')`
  ).bind(workPlanId).run();
  return res.meta.last_row_id as number;
}

export async function updateWorkPlanRun(
  env: Env,
  runId: number,
  status: string,
  results?: unknown,
  error?: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE work_plan_runs SET status = ?, completed_at = datetime('now'), results = ?, error = ? WHERE id = ?`
  ).bind(status, results ? JSON.stringify(results) : null, error ?? null, runId).run();
}

export async function listWorkPlanRuns(env: Env, workPlanId: number, limit = 10): Promise<WorkPlanRun[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM work_plan_runs WHERE work_plan_id = ? ORDER BY started_at DESC LIMIT ?`
  ).bind(workPlanId, limit).all<WorkPlanRun>();
  return res.results ?? [];
}

export async function markWorkPlanRan(env: Env, workPlanId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE work_plans SET last_run_at = datetime('now') WHERE id = ?`
  ).bind(workPlanId).run();
}

export async function getAllActivePlans(env: Env): Promise<WorkPlan[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM work_plans WHERE is_active = 1`
  ).all<WorkPlan>();
  return res.results ?? [];
}

// ── Cron parser ────────────────────────────────────────────────────────────
// Soporta: * , valores fijos, rangos (1-5), listas (1,3,5)

function matchField(field: string, value: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      if (value >= lo && value <= hi) return true;
    } else if (Number(part) === value) {
      return true;
    }
  }
  return false;
}

export function cronMatches(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  // JS: getDay() 0=Sunday, cron 0=Sunday → compatible
  return (
    matchField(minute, date.getUTCMinutes()) &&
    matchField(hour, date.getUTCHours()) &&
    matchField(dayOfMonth, date.getUTCDate()) &&
    matchField(month, date.getUTCMonth() + 1) &&
    matchField(dayOfWeek, date.getUTCDay())
  );
}

// ── Telegram helper (multi-tenant aware) ──────────────────────────────────

async function sendCompanyMessage(env: Env, companyId: number, text: string): Promise<void> {
  const config = await getTelegramConfig(env, companyId);
  if (config?.owner_chat_id && config.bot_token) {
    await fetch(`https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.owner_chat_id, text, parse_mode: "HTML" }),
    });
  } else if (env.TELEGRAM_CHAT_ID) {
    // Fallback al bot global (para Ailyn Labs interno)
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
  }
}

// ── Action handlers ────────────────────────────────────────────────────────

interface StepResult {
  action: string;
  success: boolean;
  summary: string;
  data?: unknown;
}

// ── Prospect Queue helpers ─────────────────────────────────────────────────

interface ProspectQueueItem {
  id: number;
  work_plan_id: number;
  company_id: number;
  company_name: string;
  industry: string | null;
  region: string | null;
  company_slug: string | null;
  status: string;
}

async function countQueueItems(env: Env, workPlanId: number): Promise<{ pending: number; total: number }> {
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
     FROM prospect_queue WHERE work_plan_id = ?`
  ).bind(workPlanId).first<{ total: number; pending: number }>();
  return { total: row?.total ?? 0, pending: row?.pending ?? 0 };
}

// ── Paso 1 de prospección: solo encola empresas (fast, ~5s) ───────────────

async function runProspectResearch(
  env: Env,
  workPlanId: number,
  companyId: number,
  config: { industry?: string; region?: string; count?: number; company_slug?: string }
): Promise<StepResult> {
  const industry = config.industry ?? "tecnología";
  const region = config.region ?? "México";
  const count = Math.min(config.count ?? 5, 10);
  const companySlug = config.company_slug ?? String(companyId);

  try {
    // Si ya hay items en cola para este plan, no re-encolar
    const { pending, total } = await countQueueItems(env, workPlanId);
    if (total > 0 && pending > 0) {
      return {
        action: "prospect_research",
        success: true,
        summary: `Ya en progreso: ${pending} empresas pendientes de investigar (se procesan cada 15 min)`,
      };
    }
    if (total > 0 && pending === 0) {
      // Queue ya drenada — los leads ya fueron investigados
      return {
        action: "prospect_research",
        success: true,
        summary: `${total} empresas ya investigadas en este ciclo`,
      };
    }

    // Queue vacía → buscar nombres y encolar
    const query = `empresas de ${industry} en ${region} que necesiten software o servicios digitales`;
    const searchResponse = await searchWeb(query, env, { maxResults: count * 2, searchDepth: "basic" });
    const searchText = searchResponse.rawText ?? "";

    if (!searchText || searchText.includes("no disponible")) {
      return { action: "prospect_research", success: false, summary: "Tavily no disponible — configura TAVILY_API_KEY" };
    }

    // Extraer nombres de empresas con LLM (rápido, un solo call)
    const extractPrompt = `Del siguiente resultado de búsqueda, extrae una lista de ${count} nombres de empresas reales (no individuos). Devuelve SOLO un array JSON sin texto adicional: ["Empresa 1", "Empresa 2", ...]
Resultado: ${searchText.substring(0, 2000)}`;

    const extractResp = await runLLM(env, "quick_classify", "Eres un extractor de datos.", extractPrompt, companyId, []);
    let companies: string[] = [];
    try {
      const match = extractResp.text.match(/\[[\s\S]*?\]/);
      companies = match ? JSON.parse(match[0]) : [];
    } catch {
      companies = [];
    }

    if (companies.length === 0) {
      return { action: "prospect_research", success: false, summary: "No se encontraron empresas en la búsqueda" };
    }

    // Insertar en la cola — cada empresa se procesará en un cron separado
    for (const name of companies.slice(0, count)) {
      await env.DB.prepare(
        `INSERT INTO prospect_queue (work_plan_id, company_id, company_name, industry, region, company_slug)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(workPlanId, companyId, name.trim(), industry, region, companySlug).run();
    }

    console.log(`[prospect_research] Plan ${workPlanId}: ${companies.slice(0, count).length} empresas encoladas`);
    return {
      action: "prospect_research",
      success: true,
      summary: `${companies.slice(0, count).length} empresas encoladas — se investigarán en los próximos ciclos (cada 15 min)`,
    };
  } catch (err) {
    return { action: "prospect_research", success: false, summary: String(err) };
  }
}

// ── Paso 2 (cron cada 15 min): procesar UNA empresa de la cola ─────────────

export async function processOneProspectQueueItem(env: Env): Promise<void> {
  // Tomar un item pendiente (el más antiguo)
  const item = await env.DB.prepare(
    `SELECT pq.*, wp.company_id AS wp_company_id, wp.name AS plan_name
     FROM prospect_queue pq
     JOIN work_plans wp ON wp.id = pq.work_plan_id
     WHERE pq.status = 'pending'
     ORDER BY pq.created_at ASC LIMIT 1`
  ).first<ProspectQueueItem & { plan_name: string }>();

  if (!item) return; // Cola vacía

  // Marcar como processing (evita doble procesamiento)
  await env.DB.prepare(
    `UPDATE prospect_queue SET status = 'processing' WHERE id = ?`
  ).bind(item.id).run();

  console.log(`[prospect-queue] Procesando: "${item.company_name}" (plan ${item.work_plan_id})`);

  const companySlug = item.company_slug ?? String(item.company_id);

  try {
    const research = await researchLead(
      {
        contact_name: `Decisor de ${item.company_name}`,
        contact_email: `contacto@${item.company_name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
        contact_company: item.company_name,
        source: "prospect_research_auto",
      },
      env
    );

    const leadId = await saveLead(env, companySlug, {
      contact_name: research.contact.role
        ? `${research.contact.role} de ${item.company_name}`
        : `Decisor de ${item.company_name}`,
      contact_email: `contacto@${item.company_name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
      contact_company: item.company_name,
      source: "prospect_research_auto",
      research_status: "complete",
      company_industry: research.company.industry,
      company_location: research.company.location,
      company_description: research.company.description,
      company_website: research.company.website,
      urgency: research.classification.urgency,
      lead_score: research.classification.leadScore,
      brief_summary: research.content.briefSummary,
      estimated_value: research.content.estimatedValue,
      next_step: research.content.nextStep,
    });

    await env.DB.prepare(
      `UPDATE prospect_queue SET status = 'done', result_lead_id = ?, processed_at = datetime('now') WHERE id = ?`
    ).bind(leadId, item.id).run();

    console.log(`[prospect-queue] ✅ Lead guardado: ${leadId} — ${item.company_name} (score: ${research.classification.leadScore})`);
  } catch (err) {
    await env.DB.prepare(
      `UPDATE prospect_queue SET status = 'failed', error = ?, processed_at = datetime('now') WHERE id = ?`
    ).bind(String(err), item.id).run();
    console.error(`[prospect-queue] ❌ Error con "${item.company_name}":`, String(err));
  }

  // Verificar si la cola del plan quedó drenada → enviar reporte
  const { pending } = await countQueueItems(env, item.work_plan_id);
  if (pending === 0) {
    // Obtener todos los leads investigados de este batch
    const doneItems = await env.DB.prepare(
      `SELECT result_lead_id FROM prospect_queue
       WHERE work_plan_id = ? AND status = 'done' AND result_lead_id IS NOT NULL
       ORDER BY processed_at DESC`
    ).bind(item.work_plan_id).all<{ result_lead_id: string }>();

    const leadIds = (doneItems.results ?? []).map((r) => r.result_lead_id);
    let hot = 0, warm = 0, topLead: { name: string; score: number } | null = null;

    for (const lid of leadIds) {
      const lead = await env.DB.prepare(
        `SELECT contact_company, lead_score FROM leads WHERE id = ?`
      ).bind(lid).first<{ contact_company: string; lead_score: number }>();
      if (!lead) continue;
      if (lead.lead_score >= 70) hot++;
      else if (lead.lead_score >= 40) warm++;
      if (!topLead || lead.lead_score > topLead.score) {
        topLead = { name: lead.contact_company ?? lid, score: lead.lead_score };
      }
    }

    // Limpiar la cola del plan (para el próximo ciclo)
    await env.DB.prepare(
      `DELETE FROM prospect_queue WHERE work_plan_id = ?`
    ).bind(item.work_plan_id).run();

    const msg =
      `🤖 <b>Prospección completada: "${item.plan_name}"</b>\n\n` +
      `📊 Resultados:\n` +
      `• ${leadIds.length} empresas investigadas\n` +
      `• 🔥 ${hot} leads calientes (score ≥70)\n` +
      `• 🌡 ${warm} leads tibios (40-69)\n` +
      (topLead ? `\n🏆 Top lead: <b>${topLead.name}</b> (score ${topLead.score})\n\n¿Quieres que les envíe email? Revisa en tu dashboard.` : "");

    await sendCompanyMessage(env, item.company_id, msg);
    console.log(`[prospect-queue] Plan ${item.work_plan_id}: cola drenada, reporte enviado`);
  }
}

async function runSendReport(
  env: Env,
  companyId: number,
  config: { type?: string },
  previousResults: StepResult[]
): Promise<StepResult> {
  const reportType = config.type ?? "plan_results";

  try {
    let reportText = "";

    if (reportType === "plan_results") {
      // Construir reporte con los resultados de los steps anteriores
      const sections: string[] = [];
      for (const r of previousResults) {
        if (r.action === "prospect_research" && r.success && r.data) {
          const d = r.data as { leads: Array<{ name: string; score: number }>; industry: string; region: string };
          const hot = d.leads.filter((l) => l.score >= 70);
          const warm = d.leads.filter((l) => l.score >= 40 && l.score < 70);
          sections.push(
            `📊 <b>Prospección ${d.industry} / ${d.region}</b>\n` +
            `• ${d.leads.length} empresas investigadas\n` +
            `• 🔥 ${hot.length} calientes (score ≥70)\n` +
            `• 🌡 ${warm.length} tibias (40-69)\n` +
            (hot.length > 0 ? `\n🏆 Top lead: <b>${hot[0].name}</b> (score ${hot[0].score})` : "")
          );
        }
        if (r.action === "follow_up" && r.success) {
          sections.push(`📬 <b>Follow-ups</b>\n${r.summary}`);
        }
      }
      reportText = sections.join("\n\n");
    } else {
      // Resumen de DB
      const leadsRes = await env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN lead_score >= 70 THEN 1 ELSE 0 END) AS hot,
                SUM(CASE WHEN research_status = 'complete' THEN 1 ELSE 0 END) AS researched
         FROM leads WHERE company_id = ? AND created_at > datetime('now', '-7 days')`
      ).bind(String(companyId)).first<{ total: number; hot: number; researched: number }>();

      reportText =
        `📈 <b>Resumen ${reportType === "weekly_summary" ? "semanal" : "diario"}</b>\n` +
        `• ${leadsRes?.total ?? 0} leads nuevos\n` +
        `• ${leadsRes?.hot ?? 0} leads calientes\n` +
        `• ${leadsRes?.researched ?? 0} investigados con IA`;
    }

    if (!reportText.trim()) {
      reportText = "📋 Sin actividad significativa en este período.";
    }

    await sendCompanyMessage(env, companyId, reportText);
    return { action: "send_report", success: true, summary: "Reporte enviado por Telegram" };
  } catch (err) {
    return { action: "send_report", success: false, summary: String(err) };
  }
}

async function runFollowUp(
  env: Env,
  companyId: number,
  config: { days_after?: number; company_slug?: string }
): Promise<StepResult> {
  const daysAfter = config.days_after ?? 2;
  const companySlug = config.company_slug ?? String(companyId);

  try {
    // Buscar leads contactados hace X días sin respuesta
    const leads = await env.DB.prepare(
      `SELECT id, contact_name, contact_email, contact_company, brief_summary,
              suggested_email_subject, suggested_email_body
       FROM leads
       WHERE company_id = ?
         AND research_status = 'complete'
         AND response_sent = 0
         AND notification_sent = 1
         AND datetime(created_at) <= datetime('now', ? || ' days')
       LIMIT 10`
    ).bind(companySlug, `-${daysAfter}`).all<{
      id: string; contact_name: string; contact_email: string;
      contact_company: string | null; brief_summary: string | null;
      suggested_email_subject: string | null; suggested_email_body: string | null;
    }>();

    if (!leads.results || leads.results.length === 0) {
      return { action: "follow_up", success: true, summary: "No hay follow-ups pendientes" };
    }

    const followedUp: string[] = [];
    for (const lead of leads.results) {
      try {
        // Generar email de follow-up
        const prompt = `Genera un email de follow-up corto y directo para:
Empresa: ${lead.contact_company ?? "N/A"}
Contacto: ${lead.contact_name}
Contexto anterior: ${lead.brief_summary ?? "N/A"}

El email debe ser breve (3-4 líneas), recordarles que les enviamos información antes, y preguntar si tuvieron oportunidad de revisarla.`;

        const followUpEmail = await runLLM(env, "email_draft", "Eres un experto en ventas B2B.", prompt, companyId, []);

        // Notificar al dueño via Telegram para aprobación
        await sendCompanyMessage(
          env,
          companyId,
          `📬 <b>Follow-up pendiente:</b> ${lead.contact_name} (${lead.contact_company})\n\n${followUpEmail.text.substring(0, 500)}\n\n<i>Responde desde tu dashboard para enviar.</i>`
        );

        followedUp.push(lead.contact_name);
      } catch (err) {
        console.error(`[follow_up] Error con lead ${lead.id}:`, String(err));
      }
    }

    return {
      action: "follow_up",
      success: true,
      summary: `${followedUp.length} follow-ups generados y enviados a Telegram para aprobación`,
      data: { followed_up: followedUp },
    };
  } catch (err) {
    return { action: "follow_up", success: false, summary: String(err) };
  }
}

async function runKnowledgeRefresh(
  env: Env,
  companyId: number,
  config: { search_existing_leads?: boolean; company_slug?: string }
): Promise<StepResult> {
  const companySlug = config.company_slug ?? String(companyId);
  try {
    const leads = await listLeads(env, { company_id: companySlug, limit: 5 });
    if (leads.length === 0) {
      return { action: "knowledge_refresh", success: true, summary: "No hay leads para actualizar" };
    }

    const updated: string[] = [];
    for (const lead of leads) {
      if (!lead.contact_company) continue;
      try {
        const newsResp = await searchWeb(
          `${lead.contact_company} noticias recientes 2025 expansion producto`,
          env,
          { maxResults: 3, searchDepth: "basic" }
        );
        const newsText = newsResp.rawText ?? "";
        if (!newsText || newsText.includes("no disponible")) continue;

        // Actualizar el campo de noticias recientes
        await env.DB.prepare(
          `UPDATE leads SET company_recent_news = ? WHERE id = ?`
        ).bind(newsText.substring(0, 500), lead.id).run();
        updated.push(lead.contact_company);
      } catch {
        continue;
      }
    }

    return {
      action: "knowledge_refresh",
      success: true,
      summary: `${updated.length} leads actualizados con noticias recientes`,
      data: { updated },
    };
  } catch (err) {
    return { action: "knowledge_refresh", success: false, summary: String(err) };
  }
}

// ── Ejecución de un work plan ──────────────────────────────────────────────

export async function executeWorkPlan(env: Env, plan: WorkPlan): Promise<void> {
  const runId = await createWorkPlanRun(env, plan.id);
  const stepResults: StepResult[] = [];

  try {
    const steps = await getWorkPlanSteps(env, plan.id);

    // Obtener slug de la empresa para los steps que lo necesiten
    const companyRow = await env.DB.prepare(
      `SELECT slug FROM companies WHERE id = ?`
    ).bind(plan.company_id).first<{ slug: string | null }>();
    const companySlug = companyRow?.slug ?? String(plan.company_id);

    for (const step of steps) {
      let cfg: Record<string, unknown> = {};
      try { cfg = JSON.parse(step.config); } catch { cfg = {}; }
      // Inyectar slug siempre
      cfg.company_slug = companySlug;

      let result: StepResult;
      try {
        switch (step.action_type) {
          case "prospect_research":
            result = await runProspectResearch(env, plan.id, plan.company_id, cfg as { industry?: string; region?: string; count?: number; company_slug?: string });
            break;
          case "send_report":
            result = await runSendReport(env, plan.company_id, cfg as { type?: string }, stepResults);
            break;
          case "follow_up":
            result = await runFollowUp(env, plan.company_id, cfg as { days_after?: number; company_slug?: string });
            break;
          case "knowledge_refresh":
            result = await runKnowledgeRefresh(env, plan.company_id, cfg as { search_existing_leads?: boolean; company_slug?: string });
            break;
          case "morning_briefing":
            result = await runMorningBriefing(env, plan.company_id);
            break;
          default:
            result = { action: step.action_type, success: false, summary: `Tipo de acción desconocido: ${step.action_type}` };
        }
      } catch (stepErr) {
        result = { action: step.action_type, success: false, summary: `Error inesperado: ${String(stepErr)}` };
      }

      stepResults.push(result);
      console.log(`[work-plan:${plan.id}] step ${step.step_order} (${step.action_type}): ${result.success ? "✅" : "❌"} ${result.summary}`);
    }

    await updateWorkPlanRun(env, runId, "completed", stepResults);
    await markWorkPlanRan(env, plan.id);
  } catch (err) {
    const errorMsg = String(err);
    await updateWorkPlanRun(env, runId, "failed", stepResults, errorMsg);
    await markWorkPlanRan(env, plan.id);
    await sendCompanyMessage(
      env,
      plan.company_id,
      `❌ <b>Work Plan fallido: "${plan.name}"</b>\nError: ${errorMsg}`
    );
    console.error(`[work-plan:${plan.id}] FAILED:`, errorMsg);
  }
}

// ── Morning Briefing ──────────────────────────────────────────────────────

async function runMorningBriefing(env: Env, companyId: number): Promise<StepResult> {
  try {
    const sections: string[] = [];
    const today = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City", weekday: "long", year: "numeric", month: "long", day: "numeric" });

    sections.push(`🌅 <b>Buenos días — ${today}</b>`);

    // 1. Gmail (si conectado)
    const googleToken = await getValidGoogleToken(env, companyId).catch(() => null);
    if (googleToken) {
      try {
        const gmailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=is:unread`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        if (gmailRes.ok) {
          const gmail = await gmailRes.json() as { messages?: { id: string }[]; resultSizeEstimate?: number };
          const count = gmail.resultSizeEstimate ?? 0;
          if (count > 0) {
            const emails = await Promise.all((gmail.messages ?? []).slice(0, 3).map(async m => {
              const r = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
                { headers: { Authorization: `Bearer ${googleToken}` } }
              );
              if (!r.ok) return null;
              const msg = await r.json() as { payload?: { headers?: { name: string; value: string }[] }; snippet?: string };
              const h = msg.payload?.headers ?? [];
              const from = h.find(x => x.name === "From")?.value?.split("<")[0]?.trim() ?? "?";
              const subject = h.find(x => x.name === "Subject")?.value ?? "(sin asunto)";
              return `• <b>${from}</b>: ${subject}`;
            }));
            sections.push(`\n📧 <b>${count} email${count !== 1 ? "s" : ""} sin leer</b>\n${emails.filter(Boolean).join("\n")}`);
          } else {
            sections.push("\n📧 Inbox limpio ✅");
          }
        }
      } catch { /* Gmail opcional */ }

      // 2. Calendar
      try {
        const now = new Date();
        const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59);
        const calRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${endOfDay.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=8`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        if (calRes.ok) {
          const cal = await calRes.json() as { items?: { summary?: string; start?: { dateTime?: string; date?: string } }[] };
          const events = cal.items ?? [];
          if (events.length > 0) {
            const eventList = events.map(e => {
              const time = e.start?.dateTime
                ? new Date(e.start.dateTime).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" })
                : "Todo el día";
              return `• ${time} — ${e.summary ?? "Evento"}`;
            }).join("\n");
            sections.push(`\n📅 <b>Agenda de hoy</b>\n${eventList}`);
          } else {
            sections.push("\n📅 Sin eventos hoy");
          }
        }
      } catch { /* Calendar opcional */ }
    }

    // 3. Tareas pendientes urgentes
    try {
      const tasks = await env.DB.prepare(
        `SELECT title, priority FROM personal_tasks WHERE company_id = ? AND status != 'done' ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END LIMIT 5`
      ).bind(companyId).all<{ title: string; priority: string }>();
      if (tasks.results?.length) {
        const taskList = tasks.results.map(t => `• ${t.priority === "urgent" ? "🔴 " : t.priority === "high" ? "🟡 " : ""}${t.title}`).join("\n");
        sections.push(`\n📋 <b>Pendientes</b>\n${taskList}`);
      }
    } catch { /* Tasks opcional */ }

    // 4. LLM summary con Sonnet
    const briefingRaw = sections.join("\n");
    const summary = await runLLM(
      env,
      "summarize",
      `Eres Ailyn. Genera un briefing matutino conciso y motivador para el fundador. Formato: HTML de Telegram (bold con <b>, sin markdown). Sé directo. Max 300 palabras.`,
      `Datos del día:\n${briefingRaw}`,
      companyId
    );

    const finalMessage = summary.text || briefingRaw;
    await sendCompanyMessage(env, companyId, finalMessage);

    return { action: "morning_briefing", success: true, summary: "Briefing matutino enviado" };
  } catch (err) {
    return { action: "morning_briefing", success: false, summary: String(err) };
  }
}

/** Crea el Work Plan "Reporte Matutino" para una empresa */
export async function createMorningBriefingPlan(env: Env, companyId: number): Promise<number> {
  const existing = await env.DB.prepare(
    `SELECT id FROM work_plans WHERE company_id = ? AND name = 'Reporte Matutino' LIMIT 1`
  ).bind(companyId).first<{ id: number }>();
  if (existing) return existing.id;

  const planId = await createWorkPlan(env, companyId, {
    name: "Reporte Matutino",
    description: "Briefing diario a las 7am (L-V): emails no leídos, agenda del día y tareas pendientes.",
    cron_expression: "0 7 * * 1-5",
  });
  await replaceWorkPlanSteps(env, planId, [
    { action_type: "morning_briefing", config: {} },
  ]);
  return planId;
}

// ── Scheduler: evalúa y ejecuta los planes que correspondan ───────────────

export async function runDueWorkPlans(env: Env): Promise<void> {
  // 1. Procesar un item de la cola de prospección (si hay pendientes)
  //    Esto ocurre en CADA ciclo de 15 min, independientemente de los planes
  try {
    await processOneProspectQueueItem(env);
  } catch (qErr) {
    console.error("[work-plans] Error procesando prospect queue:", String(qErr));
  }

  // 2. Evaluar work plans con cron expressions
  const now = new Date();
  const plans = await getAllActivePlans(env);

  for (const plan of plans) {
    try {
      if (!cronMatches(plan.cron_expression, now)) continue;

      // Anti-duplicado: no re-ejecutar si corrió en los últimos 14 minutos
      if (plan.last_run_at) {
        const lastRun = new Date(plan.last_run_at + "Z");
        const diffMin = (now.getTime() - lastRun.getTime()) / 60_000;
        if (diffMin < 14) {
          console.log(`[work-plans] Plan ${plan.id} "${plan.name}" ya corrió hace ${diffMin.toFixed(1)} min, skip`);
          continue;
        }
      }

      // Verificar límite del plan antes de ejecutar
      const wpLimit = await checkUsageLimit(env, plan.company_id, "work_plans");
      if (!wpLimit.allowed) {
        console.log(`[work-plans] Plan ${plan.id} bloqueado por límite de plan (${wpLimit.used}/${wpLimit.limit})`);
        // Notificar via Telegram si está configurado
        const tgConfig = await getTelegramConfig(env, plan.company_id);
        if (tgConfig?.owner_chat_id && tgConfig?.bot_token) {
          await fetch(`https://api.telegram.org/bot${tgConfig.bot_token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: Number(tgConfig.owner_chat_id),
              text: `⚠️ Tu plan ${wpLimit.planName} permite ${wpLimit.limit} ejecución${wpLimit.limit !== 1 ? "es" : ""} de Work Plan por mes. Actualiza para automatizar más.`,
            }),
          }).catch(() => {});
        }
        continue;
      }

      console.log(`[work-plans] Ejecutando plan ${plan.id} "${plan.name}"...`);
      await executeWorkPlan(env, plan);
      await incrementUsage(env, plan.company_id, "work_plans");
    } catch (err) {
      console.error(`[work-plans] Error ejecutando plan ${plan.id}:`, String(err));
    }
  }
}

// ── Templates de setup: planes por defecto para empresa nueva ─────────────

export async function createDefaultWorkPlans(env: Env, companyId: number, industry = "tecnología"): Promise<void> {
  // Plan 1: Prospección Nocturna
  const plan1Id = await createWorkPlan(env, companyId, {
    name: "Prospección Nocturna",
    description: "Investiga empresas nuevas de tu industria cada noche y te manda los resultados.",
    cron_expression: "0 2 * * 1-5",
  });
  await replaceWorkPlanSteps(env, plan1Id, [
    { action_type: "prospect_research", config: { industry, region: "México", count: 5 } },
    { action_type: "send_report", config: { type: "plan_results" } },
  ]);

  // Plan 2: Follow-up Automático
  const plan2Id = await createWorkPlan(env, companyId, {
    name: "Follow-up Automático",
    description: "Revisa leads contactados hace 2+ días sin respuesta y genera follow-ups.",
    cron_expression: "0 9 * * 1-5",
  });
  await replaceWorkPlanSteps(env, plan2Id, [
    { action_type: "follow_up", config: { days_after: 2 } },
    { action_type: "send_report", config: { type: "plan_results" } },
  ]);

  // Plan 3: Reporte Semanal
  const plan3Id = await createWorkPlan(env, companyId, {
    name: "Reporte Semanal",
    description: "Resumen semanal completo cada lunes a las 8am.",
    cron_expression: "0 8 * * 1",
  });
  await replaceWorkPlanSteps(env, plan3Id, [
    { action_type: "send_report", config: { type: "weekly_summary" } },
  ]);

  console.log(`[work-plans] 3 planes creados para company ${companyId}: ${plan1Id}, ${plan2Id}, ${plan3Id}`);
}
