/**
 * agents-marketplace.ts — API para el Marketplace de Agentes
 *
 * Routes (todas con Bearer auth):
 *   GET    /api/agents/marketplace       → templates + agentes activos de la empresa
 *   POST   /api/agents/activate          → activar un agente template
 *   DELETE /api/agents/:id/deactivate    → desactivar un agente
 */

import type { Env } from "./types";
import { authenticateUser } from "./auth";
import { checkAgentsLimit } from "./usage";

/** Auth helper: acepta Bearer session O X-CF-Token admin.
 *  Retorna company_id o null si no autorizado. */
async function resolveCompanyId(request: Request, env: Env): Promise<number | null> {
  // 1) Intentar session Bearer
  const user = await authenticateUser(request, env);
  if (user) return user.company_id;

  // 2) Fallback a X-CF-Token (admin token → primera empresa)
  const cfToken = request.headers.get("X-CF-Token") ?? "";
  if (cfToken && cfToken === env.CLOUDFLARE_ADMIN_TOKEN) {
    const row = await env.DB.prepare(
      `SELECT id FROM companies ORDER BY id ASC LIMIT 1`
    ).first<{ id: number }>();
    return row?.id ?? null;
  }
  return null;
}

// ── CORS ──────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ── Tier access map ────────────────────────────────────────────────────────

const TIER_LEVELS: Record<string, number> = { starter: 1, pro: 2, enterprise: 3 };

function canAccessTier(companyPlan: string, templateTier: string): boolean {
  const planLevel = TIER_LEVELS[companyPlan] ?? 2;
  const tierLevel = TIER_LEVELS[templateTier] ?? 1;
  return planLevel >= tierLevel;
}

// ── Types ─────────────────────────────────────────────────────────────────

interface AgentTemplate {
  id: number;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tier: string;
  is_available: number;
  default_work_plans: string | null;
}

interface ActiveAgent {
  id: number;
  template_slug: string | null;
  name: string;
  is_active: number;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function getCompanyPlan(env: Env, companyId: number): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT plan, industry, name FROM companies WHERE id = ?`
  ).bind(companyId).first<{ plan: string | null; industry: string | null; name: string }>();
  return row?.plan ?? "pro";
}

async function createWorkPlansFromTemplate(
  env: Env,
  companyId: number,
  defaultWorkPlans: string
): Promise<void> {
  let plans: Array<{
    name: string;
    cron: string;
    steps: Array<{ action_type: string; config: Record<string, unknown> }>;
  }>;
  try {
    plans = JSON.parse(defaultWorkPlans);
  } catch {
    return;
  }
  if (!Array.isArray(plans) || plans.length === 0) return;

  for (const plan of plans) {
    if (!plan.name || !plan.cron) continue;

    const planResult = await env.DB.prepare(
      `INSERT INTO work_plans (company_id, name, cron_expression, is_active)
       VALUES (?, ?, ?, 1)
       RETURNING id`
    ).bind(companyId, plan.name, plan.cron).first<{ id: number }>();

    const planId = planResult?.id;
    if (!planId || !Array.isArray(plan.steps)) continue;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      if (!step.action_type) continue;
      await env.DB.prepare(
        `INSERT INTO work_plan_steps (work_plan_id, step_order, action_type, config)
         VALUES (?, ?, ?, ?)`
      ).bind(planId, i + 1, step.action_type, JSON.stringify(step.config ?? {})).run();
    }
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────

export async function handleMarketplace(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const companyId = await resolveCompanyId(request, env);
  if (!companyId) return json({ error: "No autorizado" }, 401);

  // ── GET /api/agents/marketplace ─────────────────────────────────────────
  if (request.method === "GET" && pathname === "/api/agents/marketplace") {
    const [templatesResult, activeAgentsResult, companyRow] = await Promise.all([
      env.DB.prepare(
        `SELECT id, slug, name, description, icon, category, tier, is_available, default_work_plans
         FROM agent_templates WHERE is_available = 1 ORDER BY tier ASC, name ASC`
      ).all<AgentTemplate>(),
      env.DB.prepare(
        `SELECT id, template_slug, name, is_active, created_at
         FROM agents WHERE company_id = ? AND template_slug IS NOT NULL`
      ).bind(companyId).all<ActiveAgent>(),
      env.DB.prepare(
        `SELECT plan, industry, name FROM companies WHERE id = ?`
      ).bind(companyId).first<{ plan: string | null; industry: string | null; name: string }>(),
    ]);

    const companyPlan = companyRow?.plan ?? "pro";

    return json({
      templates: templatesResult.results ?? [],
      active_agents: activeAgentsResult.results ?? [],
      company_plan: companyPlan,
    });
  }

  // ── POST /api/agents/activate ───────────────────────────────────────────
  if (request.method === "POST" && pathname === "/api/agents/activate") {
    let body: { template_slug?: string };
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!body.template_slug) return json({ error: "template_slug requerido" }, 400);

    const template = await env.DB.prepare(
      `SELECT id, slug, name, description, system_prompt, tier, is_available, default_work_plans
       FROM agent_templates WHERE slug = ?`
    ).bind(body.template_slug).first<AgentTemplate & { system_prompt: string }>();

    if (!template || !template.is_available) {
      return json({ error: "Template no encontrado o no disponible" }, 404);
    }

    // Verificar tier vs plan de la empresa
    const companyPlan = await getCompanyPlan(env, companyId);
    if (!canAccessTier(companyPlan, template.tier)) {
      return json({
        error: `Este agente requiere plan ${template.tier}. Tu plan actual es ${companyPlan}.`,
        upgrade_required: true,
      }, 403);
    }

    // Verificar límite de agentes del plan
    const agentsLimit = await checkAgentsLimit(env, companyId);
    if (!agentsLimit.allowed) {
      return json({
        error: agentsLimit.message ?? "Límite de agentes alcanzado",
        upgrade_required: true,
      }, 403);
    }

    // Verificar que no esté ya activado
    const existing = await env.DB.prepare(
      `SELECT id FROM agents WHERE company_id = ? AND template_slug = ? AND is_active = 1`
    ).bind(companyId, body.template_slug).first<{ id: number }>();
    if (existing) {
      return json({ error: "Este agente ya está activo para tu empresa" }, 409);
    }

    // Obtener datos de la empresa para personalizar el system_prompt
    const companyRow = await env.DB.prepare(
      `SELECT name, industry FROM companies WHERE id = ?`
    ).bind(companyId).first<{ name: string; industry: string | null }>();

    const companyName = companyRow?.name ?? "tu empresa";
    const industry = companyRow?.industry ?? "tu industria";
    const personalizedPrompt = template.system_prompt
      .replace(/{company_name}/g, companyName)
      .replace(/{industry}/g, industry);

    // Crear el agente
    const agentResult = await env.DB.prepare(
      `INSERT INTO agents (company_id, name, role_prompt, model_id, is_active, template_slug)
       VALUES (?, ?, ?, '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 1, ?)
       RETURNING id`
    ).bind(companyId, template.name, personalizedPrompt, template.slug)
      .first<{ id: number }>();

    const agentId = agentResult?.id;
    if (!agentId) return json({ error: "Error al crear el agente" }, 500);

    // Crear Work Plans por defecto
    if (template.default_work_plans && template.default_work_plans !== "[]") {
      await createWorkPlansFromTemplate(env, companyId, template.default_work_plans);
    }

    return json({ success: true, agent_id: agentId, name: template.name }, 201);
  }

  // ── DELETE /api/agents/:id/deactivate ───────────────────────────────────
  const deactivateMatch = pathname.match(/^\/api\/agents\/(\d+)\/deactivate$/);
  if (request.method === "DELETE" && deactivateMatch) {
    const agentId = Number(deactivateMatch[1]);

    // Verificar que el agente pertenece a la empresa
    const agent = await env.DB.prepare(
      `SELECT id FROM agents WHERE id = ? AND company_id = ? AND template_slug IS NOT NULL`
    ).bind(agentId, companyId).first<{ id: number }>();

    if (!agent) return json({ error: "Agente no encontrado" }, 404);

    // Desactivar el agente
    await env.DB.prepare(
      `UPDATE agents SET is_active = 0 WHERE id = ?`
    ).bind(agentId).run();

    // Pausar sus Work Plans
    await env.DB.prepare(
      `UPDATE work_plans SET is_active = 0 WHERE company_id = ?
       AND id IN (
         SELECT wp.id FROM work_plans wp WHERE wp.company_id = ?
         AND wp.created_at >= (SELECT created_at FROM agents WHERE id = ?)
       )`
    ).bind(companyId, companyId, agentId).run();

    return json({ success: true });
  }

  return json({ error: "Not Found" }, 404);
}
