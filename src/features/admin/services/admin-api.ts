const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

function getToken(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem("ailyn_admin_token") ?? "";
}

function headers(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-CF-Token": getToken(),
  };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface CompanyWithStats {
  id: number;
  name: string;
  created_at: string;
  agent_count: number;
  lead_count: number;
  email_count: number;
  followup_count: number;
}

export interface AgentWithSkills {
  id: number;
  name: string;
  role_prompt: string;
  model_id: string;
  is_active: number;
  skills: { id: number; name: string }[];
}

export interface CompanyDetail {
  id: number;
  name: string;
  created_at: string;
  agents: AgentWithSkills[];
}

export interface KnowledgeDoc {
  id: number;
  title: string;
  content_preview: string;
  created_at: string;
}

export interface CompanyMetrics {
  total_leads: number;
  leads_high_score: number;
  emails_sent: number;
  followups_pending: number;
  followups_executed: number;
  leads_by_urgency: { urgency: string; count: number }[];
  recent_leads: { contact_name: string; contact_company: string; lead_score: number; created_at: string }[];
}

export interface GlobalMetrics {
  total_companies: number;
  total_leads: number;
  total_emails_sent: number;
  total_followups: number;
  leads_last_30d: number;
  top_companies: { name: string; lead_count: number }[];
}

// ── Companies ──────────────────────────────────────────────────────────────

export const listCompanies = () =>
  req<CompanyWithStats[]>("/api/admin/companies");

export const createCompany = (name: string) =>
  req<{ ok: boolean; id: number }>("/api/admin/companies", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const updateCompany = (id: number, name: string) =>
  req<{ ok: boolean }>(`/api/admin/companies/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });

export const deleteCompany = (id: number) =>
  req<{ ok: boolean }>(`/api/admin/companies/${id}`, { method: "DELETE" });

export const getCompanyDetail = (id: number) =>
  req<CompanyDetail>(`/api/admin/companies/${id}`);

export const getCompanyMetrics = (id: number) =>
  req<CompanyMetrics>(`/api/admin/companies/${id}/metrics`);

// ── Agents ─────────────────────────────────────────────────────────────────

export const updateAgent = (
  id: number,
  data: { name?: string; role_prompt?: string; model_id?: string; is_active?: number }
) =>
  req<{ ok: boolean }>(`/api/admin/agents/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const deleteAgent = (id: number) =>
  req<{ ok: boolean }>(`/api/admin/agents/${id}`, { method: "DELETE" });

// ── Knowledge ──────────────────────────────────────────────────────────────

export const listKnowledgeDocs = (companyId: number) =>
  req<KnowledgeDoc[]>(`/api/admin/knowledge/docs?company_id=${companyId}`);

export const deleteKnowledgeDoc = (id: number) =>
  req<{ ok: boolean }>(`/api/admin/knowledge/${id}`, { method: "DELETE" });

// ── Metrics ────────────────────────────────────────────────────────────────

export const getGlobalMetrics = () =>
  req<GlobalMetrics>("/api/admin/metrics");
