// ── Feature Flags per Plan ─────────────────────────────────────────────────
// Verifica si una empresa tiene acceso a una feature según su plan.

import type { Env } from "./types";

export interface PlanFeatures {
  email: boolean;
  calendar: boolean;
  followup: boolean;
  crm: boolean;
  voice: boolean;
  notes: boolean;
  web_search: boolean;
  email_summary: boolean;
}

const DEFAULT_FEATURES: PlanFeatures = {
  email: true,
  calendar: false,
  followup: false,
  crm: false,
  voice: true,
  notes: false,
  web_search: false,
  email_summary: false,
};

// Cache por company para evitar queries repetidas (dura 1 request)
const featureCache = new Map<number, PlanFeatures>();

export async function getCompanyFeatures(env: Env, companyId: number): Promise<PlanFeatures> {
  if (featureCache.has(companyId)) return featureCache.get(companyId)!;

  const row = await env.DB.prepare(`
    SELECT p.features FROM plans p
    JOIN companies c ON c.plan_slug = p.slug
    WHERE c.id = ?
  `).bind(companyId).first<{ features: string }>();

  let features: PlanFeatures;
  try {
    features = row?.features ? { ...DEFAULT_FEATURES, ...JSON.parse(row.features) } : DEFAULT_FEATURES;
  } catch {
    features = DEFAULT_FEATURES;
  }

  featureCache.set(companyId, features);
  return features;
}

// Mapeo de tool → feature flag
const TOOL_FEATURE_MAP: Record<string, keyof PlanFeatures> = {
  send_email: "email",
  gmail_send: "email",
  calendar_write: "calendar",
  calendar_read: "calendar",
  schedule_followup: "followup",
  crm_lookup: "crm",
  web_search: "web_search",
  gmail_read: "email_summary",
  save_note: "notes",
  rag_search: "notes",
};

export function isToolAllowed(tool: string, features: PlanFeatures): boolean {
  const featureKey = TOOL_FEATURE_MAP[tool];
  if (!featureKey) return true; // Tools sin restricción (none, tasks_manage, action_control, etc.)
  return features[featureKey] ?? false;
}

export function getBlockedMessage(tool: string): string {
  const messages: Record<string, string> = {
    send_email: "El envío de emails no está disponible en tu plan actual. Actualiza a Starter para habilitarlo.",
    calendar_write: "Agendar reuniones no está disponible en tu plan actual. Actualiza a Starter.",
    calendar_read: "La lectura de calendario no está disponible en tu plan actual. Actualiza a Starter.",
    schedule_followup: "Los follow-ups automáticos no están en tu plan actual. Actualiza a Starter.",
    crm_lookup: "El CRM conversacional no está en tu plan actual. Actualiza a Starter.",
    web_search: "La búsqueda web no está en tu plan actual. Actualiza a Starter.",
    gmail_read: "El resumen de emails no está en tu plan actual. Actualiza a Starter.",
    save_note: "Las notas y Obsidian no están en tu plan actual. Actualiza a Pro.",
    rag_search: "La búsqueda de conocimiento no está en tu plan actual. Actualiza a Pro.",
  };
  return messages[tool] ?? "Esta función no está disponible en tu plan actual. Considera actualizar.";
}
