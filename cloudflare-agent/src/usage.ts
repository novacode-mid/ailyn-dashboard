// ── Usage limits middleware ────────────────────────────────────────────────

import type { Env } from "./types";

export type LimitType = "chat" | "leads" | "work_plans";

interface Plan {
  slug: string;
  name: string;
  chat_messages_limit: number;
  leads_limit: number;
  work_plans_limit: number;
  agents_limit: number;
  llm_provider: string;
}

interface UsageRow {
  chat_messages_used: number;
  leads_used: number;
  work_plan_runs_used: number;
}

export interface LimitCheck {
  allowed: boolean;
  used: number;
  limit: number;
  message?: string;
  planName?: string;
  /** 0–100 percent of limit consumed */
  percent?: number;
}

export interface UsageSummary {
  plan: Plan;
  usage: UsageRow;
  period: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

async function getPlan(env: Env, slug: string): Promise<Plan> {
  const row = await env.DB.prepare(
    `SELECT slug, name, chat_messages_limit, leads_limit, work_plans_limit, agents_limit, llm_provider
     FROM plans WHERE slug = ?`
  ).bind(slug).first<Plan>();
  // Default to free if plan not found
  return row ?? {
    slug: "free",
    name: "Gratuito",
    chat_messages_limit: 20,
    leads_limit: 5,
    work_plans_limit: 1,
    agents_limit: 1,
    llm_provider: "cloudflare",
  };
}

async function getCompanyPlanSlug(env: Env, companyId: number): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT plan_slug FROM companies WHERE id = ?`
  ).bind(companyId).first<{ plan_slug: string | null }>();
  return row?.plan_slug ?? "free";
}

async function getOrCreateUsage(env: Env, companyId: number, period: string): Promise<UsageRow> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO usage_tracking (company_id, period) VALUES (?, ?)`
  ).bind(companyId, period).run();

  const row = await env.DB.prepare(
    `SELECT chat_messages_used, leads_used, work_plan_runs_used
     FROM usage_tracking WHERE company_id = ? AND period = ?`
  ).bind(companyId, period).first<UsageRow>();

  return row ?? { chat_messages_used: 0, leads_used: 0, work_plan_runs_used: 0 };
}

// ── Core functions ─────────────────────────────────────────────────────────

export async function checkUsageLimit(
  env: Env,
  companyId: number,
  limitType: LimitType
): Promise<LimitCheck> {
  const planSlug = await getCompanyPlanSlug(env, companyId);
  const plan = await getPlan(env, planSlug);
  const period = currentPeriod();
  const usage = await getOrCreateUsage(env, companyId, period);

  const limitMap: Record<LimitType, { used: number; limit: number; label: string }> = {
    chat:       { used: usage.chat_messages_used,  limit: plan.chat_messages_limit, label: "mensajes de chat" },
    leads:      { used: usage.leads_used,           limit: plan.leads_limit,         label: "leads" },
    work_plans: { used: usage.work_plan_runs_used,  limit: plan.work_plans_limit,    label: "ejecuciones de Work Plan" },
  };

  const check = limitMap[limitType];

  // -1 = unlimited
  if (check.limit === -1) {
    return { allowed: true, used: check.used, limit: -1, planName: plan.name };
  }

  const percent = Math.round((check.used / check.limit) * 100);

  if (check.used >= check.limit) {
    const upgradeMap: Record<string, string> = {
      free:    "Starter",
      starter: "Pro",
      pro:     "Enterprise",
    };
    const nextPlan = upgradeMap[planSlug] ?? "un plan superior";
    return {
      allowed: false,
      used: check.used,
      limit: check.limit,
      percent: 100,
      planName: plan.name,
      message: `Has alcanzado el límite de ${check.limit} ${check.label} de tu plan ${plan.name}. Actualiza a ${nextPlan} para continuar.`,
    };
  }

  return { allowed: true, used: check.used, limit: check.limit, percent, planName: plan.name };
}

export async function incrementUsage(
  env: Env,
  companyId: number,
  limitType: LimitType
): Promise<void> {
  const period = currentPeriod();
  const col = limitType === "chat"
    ? "chat_messages_used"
    : limitType === "leads"
    ? "leads_used"
    : "work_plan_runs_used";

  await env.DB.prepare(
    `INSERT INTO usage_tracking (company_id, period, ${col})
     VALUES (?, ?, 1)
     ON CONFLICT(company_id, period) DO UPDATE SET ${col} = ${col} + 1`
  ).bind(companyId, period).run();
}

export async function getUsageSummary(env: Env, companyId: number): Promise<UsageSummary> {
  const planSlug = await getCompanyPlanSlug(env, companyId);
  const plan = await getPlan(env, planSlug);
  const period = currentPeriod();
  const usage = await getOrCreateUsage(env, companyId, period);
  return { plan, usage, period };
}

/** Returns true when 80% or more of a limit is consumed (for warning notifications) */
export async function shouldWarn80(
  env: Env,
  companyId: number,
  limitType: LimitType
): Promise<boolean> {
  const check = await checkUsageLimit(env, companyId, limitType);
  if (check.limit === -1 || !check.percent) return false;
  return check.percent >= 80 && check.percent < 100;
}

/** Check agent count against plan limit */
export async function checkAgentsLimit(
  env: Env,
  companyId: number
): Promise<LimitCheck> {
  const planSlug = await getCompanyPlanSlug(env, companyId);
  const plan = await getPlan(env, planSlug);

  if (plan.agents_limit === -1) {
    return { allowed: true, used: 0, limit: -1, planName: plan.name };
  }

  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM agents WHERE company_id = ? AND is_active = 1`
  ).bind(companyId).first<{ cnt: number }>();
  const used = row?.cnt ?? 0;

  if (used >= plan.agents_limit) {
    return {
      allowed: false,
      used,
      limit: plan.agents_limit,
      percent: 100,
      planName: plan.name,
      message: `Tu plan ${plan.name} permite máximo ${plan.agents_limit} agente${plan.agents_limit !== 1 ? "s" : ""}. Actualiza para activar más.`,
    };
  }

  return { allowed: true, used, limit: plan.agents_limit, planName: plan.name };
}

/** Returns the llm_provider for a given company's plan */
export async function getPlanLLMProvider(
  env: Env,
  companyId: number
): Promise<"cloudflare" | "anthropic" | "gemini"> {
  const planSlug = await getCompanyPlanSlug(env, companyId);
  const plan = await getPlan(env, planSlug);
  if (plan.llm_provider === "anthropic") return "anthropic";
  if (plan.llm_provider === "gemini") return "gemini";
  return "cloudflare";
}
