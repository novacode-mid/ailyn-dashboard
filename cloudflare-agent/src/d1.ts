import type { Env, Task, TaskStatus, User } from "./types";

// ── Tasks ─────────────────────────────────────────────────────────────────

export async function getNextPendingTask(env: Env): Promise<Task | null> {
  const result = await env.DB.prepare(
    `SELECT * FROM tasks WHERE status = 'pending' ORDER BY priority ASC, id ASC LIMIT 1`
  ).first<Task>();
  return result ?? null;
}

export async function updateTaskStatus(
  env: Env,
  taskId: number,
  status: TaskStatus,
  result?: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE tasks SET status = ?, result = ?, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(status, result ?? null, taskId)
    .run();
}

export async function createTask(
  env: Env,
  title: string,
  description: string,
  priority: number,
  createdBy: string
): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO tasks (title, description, priority, created_by) VALUES (?, ?, ?, ?)`
  )
    .bind(title, description, priority, createdBy)
    .run();
  return result.meta.last_row_id as number;
}

export async function logAudit(
  env: Env,
  event: string,
  payload: unknown
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (event, payload) VALUES (?, ?)`
  )
    .bind(event, JSON.stringify(payload))
    .run();
}

export interface AgentStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  pending_approval: number;
  recentTasks: Task[];
  system_status: "active" | "paused";
}

export async function getAgentStats(env: Env): Promise<AgentStats> {
  const [counts, recent, systemStatus] = await Promise.all([
    env.DB.prepare(
      `SELECT status, COUNT(*) as count FROM tasks GROUP BY status`
    ).all<{ status: string; count: number }>(),
    env.DB.prepare(
      `SELECT * FROM tasks ORDER BY id DESC LIMIT 15`
    ).all<Task>(),
    env.KV.get("SYSTEM_STATUS"),
  ]);

  const byStatus = Object.fromEntries(
    (counts.results ?? []).map((r) => [r.status, r.count])
  );

  return {
    pending: byStatus["pending"] ?? 0,
    processing: byStatus["processing"] ?? 0,
    completed: byStatus["completed"] ?? 0,
    failed: byStatus["failed"] ?? 0,
    pending_approval: byStatus["pending_approval"] ?? 0,
    recentTasks: recent.results ?? [],
    system_status: systemStatus === "paused" ? "paused" : "active",
  };
}

// ── Knowledge Base (RAG) ──────────────────────────────────────────────────

export interface KnowledgeDoc {
  id: number;
  company_id: number;
  title: string;
  vector_id: string;
  content_preview: string | null;
  created_at: string;
}

export async function insertKnowledgeDoc(
  env: Env,
  companyId: number,
  title: string,
  vectorId: string,
  contentPreview: string
): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO knowledge_docs (company_id, title, vector_id, content_preview)
     VALUES (?, ?, ?, ?)`
  )
    .bind(companyId, title, vectorId, contentPreview)
    .run();
  return result.meta.last_row_id as number;
}

export async function listKnowledgeDocs(
  env: Env,
  companyId: number
): Promise<KnowledgeDoc[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM knowledge_docs WHERE company_id = ? ORDER BY id DESC`
  )
    .bind(companyId)
    .all<KnowledgeDoc>();
  return res.results ?? [];
}

// ── Multi-Tenant CRUD ─────────────────────────────────────────────────────

export async function listCompanies(
  env: Env
): Promise<{ id: number; name: string }[]> {
  const res = await env.DB.prepare(
    `SELECT id, name FROM companies ORDER BY name ASC`
  ).all<{ id: number; name: string }>();
  return res.results ?? [];
}

export async function listSkills(
  env: Env
): Promise<{ id: number; name: string; description: string }[]> {
  const res = await env.DB.prepare(
    `SELECT id, name, description FROM skills ORDER BY name ASC`
  ).all<{ id: number; name: string; description: string }>();
  return res.results ?? [];
}

export interface AgentWithSkills {
  id: number;
  company_id: number;
  company_name: string;
  name: string;
  role_prompt: string;
  model_id: string;
  is_active: number;
  skill_ids: number[];
  skill_names: string[];
}

export async function listAgentsWithSkills(env: Env): Promise<AgentWithSkills[]> {
  const rows = await env.DB.prepare(
    `SELECT
       a.id, a.company_id, c.name AS company_name, a.name, a.role_prompt, a.model_id, a.is_active,
       s.id AS skill_id, s.name AS skill_name
     FROM agents a
     JOIN companies c ON a.company_id = c.id
     LEFT JOIN agent_skills ak ON a.id = ak.agent_id
     LEFT JOIN skills s ON ak.skill_id = s.id
     ORDER BY a.id ASC`
  ).all<{
    id: number; company_id: number; company_name: string; name: string;
    role_prompt: string; model_id: string; is_active: number;
    skill_id: number | null; skill_name: string | null;
  }>();

  const map = new Map<number, AgentWithSkills>();
  for (const r of rows.results ?? []) {
    if (!map.has(r.id)) {
      map.set(r.id, {
        id: r.id, company_id: r.company_id, company_name: r.company_name,
        name: r.name, role_prompt: r.role_prompt, model_id: r.model_id,
        is_active: r.is_active, skill_ids: [], skill_names: [],
      });
    }
    if (r.skill_id !== null) {
      const entry = map.get(r.id)!;
      entry.skill_ids.push(r.skill_id);
      entry.skill_names.push(r.skill_name!);
    }
  }
  return [...map.values()];
}

export async function upsertAgentWithSkills(
  env: Env,
  companyId: number,
  name: string,
  rolePrompt: string,
  modelId: string,
  skillIds: number[]
): Promise<number> {
  // Upsert agent
  await env.DB.prepare(
    `INSERT INTO agents (company_id, name, role_prompt, model_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(company_id, name) DO UPDATE SET
       role_prompt = excluded.role_prompt,
       model_id    = excluded.model_id`
  ).bind(companyId, name, rolePrompt, modelId).run();

  const row = await env.DB.prepare(
    `SELECT id FROM agents WHERE company_id = ? AND name = ?`
  ).bind(companyId, name).first<{ id: number }>();

  const agentId = row!.id;

  // Rebuild skills: delete old, batch insert new
  const stmts = [
    env.DB.prepare(`DELETE FROM agent_skills WHERE agent_id = ?`).bind(agentId),
    ...skillIds.map((sid) =>
      env.DB.prepare(`INSERT OR IGNORE INTO agent_skills (agent_id, skill_id) VALUES (?, ?)`).bind(agentId, sid)
    ),
  ];
  await env.DB.batch(stmts);

  return agentId;
}

// ── Agent Profiles (Multi-Tenant) ─────────────────────────────────────────

export async function getAgentProfileById(
  env: Env,
  agentId: number
): Promise<AgentProfile | null> {
  const rows = await env.DB.prepare(
    `SELECT
       a.id          AS agent_id,
       a.company_id,
       a.role_prompt,
       a.model_id,
       s.name        AS skill_name,
       s.description AS skill_description,
       s.schema_json
     FROM agents a
     LEFT JOIN agent_skills ak ON a.id = ak.agent_id
     LEFT JOIN skills s ON ak.skill_id = s.id
     WHERE a.id = ? AND a.is_active = 1`
  )
    .bind(agentId)
    .all<{
      agent_id: number;
      company_id: number;
      role_prompt: string;
      model_id: string;
      skill_name: string | null;
      skill_description: string | null;
      schema_json: string | null;
    }>();

  if (!rows.results || rows.results.length === 0) return null;

  const first = rows.results[0];
  const skills = rows.results
    .filter((r) => r.skill_name !== null)
    .map((r) => ({
      name: r.skill_name!,
      description: r.skill_description!,
      schema: r.schema_json ? JSON.parse(r.schema_json) : null,
    }));

  return {
    agent_id: first.agent_id,
    company_id: first.company_id,
    role_prompt: first.role_prompt,
    model_id: first.model_id,
    skills,
  };
}

export interface AgentProfile {
  agent_id: number;
  company_id: number;
  role_prompt: string;
  model_id: string;
  skills: Array<{ name: string; description: string; schema: unknown }>;
}

export async function getAgentProfile(
  env: Env,
  companyName: string,
  agentName: string
): Promise<AgentProfile | null> {
  const rows = await env.DB.prepare(
    `SELECT
       a.id          AS agent_id,
       a.company_id,
       a.role_prompt,
       a.model_id,
       s.name        AS skill_name,
       s.description AS skill_description,
       s.schema_json
     FROM agents a
     JOIN companies c ON a.company_id = c.id
     LEFT JOIN agent_skills ak ON a.id = ak.agent_id
     LEFT JOIN skills s ON ak.skill_id = s.id
     WHERE c.name = ? AND a.name = ? AND a.is_active = 1`
  )
    .bind(companyName, agentName)
    .all<{
      agent_id: number;
      company_id: number;
      role_prompt: string;
      model_id: string;
      skill_name: string | null;
      skill_description: string | null;
      schema_json: string | null;
    }>();

  if (!rows.results || rows.results.length === 0) return null;

  const first = rows.results[0];
  const skills = rows.results
    .filter((r) => r.skill_name !== null)
    .map((r) => ({
      name: r.skill_name!,
      description: r.skill_description!,
      schema: r.schema_json ? JSON.parse(r.schema_json) : null,
    }));

  return {
    agent_id: first.agent_id,
    company_id: first.company_id,
    role_prompt: first.role_prompt,
    model_id: first.model_id,
    skills,
  };
}

// ── Users ─────────────────────────────────────────────────────────────────

export async function getUserByTelegramId(
  env: Env,
  telegramId: string
): Promise<User | null> {
  const result = await env.DB.prepare(
    `SELECT * FROM users WHERE telegram_id = ?`
  )
    .bind(telegramId)
    .first<User>();
  return result ?? null;
}

export async function getUserBySmartpassId(
  env: Env,
  smartpassId: string
): Promise<User | null> {
  const result = await env.DB.prepare(
    `SELECT * FROM users WHERE smartpass_id = ? AND is_active = 1`
  )
    .bind(smartpassId)
    .first<User>();
  return result ?? null;
}

export async function upsertUser(
  env: Env,
  telegramId: string,
  username: string | undefined
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (telegram_id, username)
     VALUES (?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username`
  )
    .bind(telegramId, username ?? null)
    .run();
}

// ── Leads — Inteligencia Comercial ───────────────────────────────────────

export interface Lead {
  id: string;
  company_id: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  contact_company: string | null;
  contact_message: string | null;
  source: string;
  research_status: string;
  company_website: string | null;
  company_industry: string | null;
  company_size: string | null;
  company_location: string | null;
  company_description: string | null;
  company_tech_stack: string | null;
  company_recent_news: string | null;
  contact_role: string | null;
  contact_seniority: string | null;
  contact_linkedin_url: string | null;
  contact_linkedin_insights: string | null;
  recommended_unit: string | null;
  secondary_units: string | null;
  urgency: string;
  lead_score: number;
  brief_summary: string | null;
  brief_full: string | null;
  suggested_email_subject: string | null;
  suggested_email_body: string | null;
  talking_points: string | null;
  estimated_value: string | null;
  next_step: string | null;
  follow_up_date: string | null;
  notification_sent: number;
  response_sent: number;
  created_at: string;
  researched_at: string | null;
}

export async function saveLead(
  env: Env,
  companyId: string,
  input: {
    contact_name: string;
    contact_email: string;
    contact_phone?: string | null;
    contact_company?: string | null;
    contact_message?: string | null;
    source?: string;
    research_status?: string;
    company_website?: string | null;
    company_industry?: string | null;
    company_size?: string | null;
    company_location?: string | null;
    company_description?: string | null;
    company_tech_stack?: string | null;
    company_recent_news?: string | null;
    contact_role?: string | null;
    contact_seniority?: string | null;
    contact_linkedin_url?: string | null;
    contact_linkedin_insights?: string | null;
    recommended_unit?: string | null;
    secondary_units?: string | null;
    urgency?: string;
    lead_score?: number;
    brief_summary?: string | null;
    brief_full?: string | null;
    suggested_email_subject?: string | null;
    suggested_email_body?: string | null;
    talking_points?: string | null;
    estimated_value?: string | null;
    next_step?: string | null;
    follow_up_date?: string | null;
    llm_provider?: string | null;
    llm_model?: string | null;
  }
): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").substring(0, 16);
  await env.DB.prepare(`
    INSERT INTO leads (
      id, company_id, contact_name, contact_email, contact_phone,
      contact_company, contact_message, source, research_status,
      company_website, company_industry, company_size, company_location,
      company_description, company_tech_stack, company_recent_news,
      contact_role, contact_seniority, contact_linkedin_url, contact_linkedin_insights,
      recommended_unit, secondary_units, urgency, lead_score,
      brief_summary, brief_full, suggested_email_subject, suggested_email_body,
      talking_points, estimated_value, next_step, follow_up_date,
      llm_provider, llm_model,
      researched_at
    ) VALUES (
      ?,?,?,?,?, ?,?,?,?,
      ?,?,?,?, ?,?,?,
      ?,?,?,?, ?,?,?,?,
      ?,?,?,?, ?,?,?,?,
      ?,?,
      ${input.research_status === "complete" ? "datetime('now')" : "NULL"}
    )
  `).bind(
    id, companyId, input.contact_name, input.contact_email, input.contact_phone ?? null,
    input.contact_company ?? null, input.contact_message ?? null, input.source ?? "api", input.research_status ?? "complete",
    input.company_website ?? null, input.company_industry ?? null, input.company_size ?? null, input.company_location ?? null,
    input.company_description ?? null, input.company_tech_stack ?? null, input.company_recent_news ?? null,
    input.contact_role ?? null, input.contact_seniority ?? null, input.contact_linkedin_url ?? null, input.contact_linkedin_insights ?? null,
    input.recommended_unit ?? null, input.secondary_units ?? null, input.urgency ?? "medium", input.lead_score ?? 0,
    input.brief_summary ?? null, input.brief_full ?? null, input.suggested_email_subject ?? null, input.suggested_email_body ?? null,
    input.talking_points ?? null, input.estimated_value ?? null, input.next_step ?? null, input.follow_up_date ?? null,
    input.llm_provider ?? "cloudflare", input.llm_model ?? "llama-3.3-70b"
  ).run();
  return id;
}

export async function listLeads(
  env: Env,
  filters?: {
    company_id?: string;
    urgency?: string;
    research_status?: string;
    recommended_unit?: string;
    limit?: number;
  }
): Promise<Lead[]> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (filters?.company_id) { conditions.push("company_id = ?"); bindings.push(filters.company_id); }
  if (filters?.urgency) { conditions.push("urgency = ?"); bindings.push(filters.urgency); }
  if (filters?.research_status) { conditions.push("research_status = ?"); bindings.push(filters.research_status); }
  if (filters?.recommended_unit) { conditions.push("recommended_unit = ?"); bindings.push(filters.recommended_unit); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters?.limit ?? 20, 100);

  const result = await env.DB.prepare(
    `SELECT * FROM leads ${where} ORDER BY lead_score DESC, created_at DESC LIMIT ?`
  ).bind(...bindings, limit).all<Lead>();
  return result.results ?? [];
}

export async function getLeadById(env: Env, id: string): Promise<Lead | null> {
  const result = await env.DB.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first<Lead>();
  return result ?? null;
}

export async function getUnattendedLeads(env: Env, companyId: string): Promise<Lead[]> {
  const result = await env.DB.prepare(`
    SELECT id, contact_name, contact_company, lead_score, urgency FROM leads
    WHERE company_id = ?
      AND research_status = 'complete'
      AND response_sent = 0
      AND datetime(created_at) < datetime('now', '-24 hours')
    ORDER BY lead_score DESC LIMIT 10
  `).bind(companyId).all<Lead>();
  return result.results ?? [];
}

export async function markLeadNotified(env: Env, id: string): Promise<void> {
  await env.DB.prepare("UPDATE leads SET notification_sent = 1 WHERE id = ?").bind(id).run();
}

// ── Monitored Emails ──────────────────────────────────────────────────────

export interface MonitoredEmail {
  id: string;
  company_id: string;
  gmail_message_id: string | null;
  from_address: string | null;
  from_name: string | null;
  to_address: string | null;
  subject: string | null;
  body_preview: string | null;
  received_at: string | null;
  urgency: string;
  category: string | null;
  summary: string | null;
  suggested_reply: string | null;
  requires_action: number;
  notified: number;
  replied: number;
  created_at: string;
}

export async function saveMonitoredEmail(
  env: Env,
  companyId: string,
  gmailMessageId: string,
  data: {
    from_address: string;
    from_name: string;
    to_address: string;
    subject: string;
    body_preview: string;
    received_at: string;
    urgency: string;
    category: string;
    summary: string;
    suggested_reply: string;
    requires_action: boolean;
  }
): Promise<boolean> {
  try {
    const id = crypto.randomUUID().replace(/-/g, "").substring(0, 16);
    await env.DB.prepare(`
      INSERT OR IGNORE INTO monitored_emails (
        id, company_id, gmail_message_id, from_address, from_name,
        to_address, subject, body_preview, received_at,
        urgency, category, summary, suggested_reply, requires_action
      ) VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?,?)
    `).bind(
      id, companyId, gmailMessageId, data.from_address, data.from_name,
      data.to_address, data.subject, data.body_preview, data.received_at,
      data.urgency, data.category, data.summary, data.suggested_reply, data.requires_action ? 1 : 0
    ).run();
    return true;
  } catch {
    return false;
  }
}

export async function isEmailAlreadySaved(env: Env, gmailMessageId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    "SELECT id FROM monitored_emails WHERE gmail_message_id = ?"
  ).bind(gmailMessageId).first<{ id: string }>();
  return result !== null;
}

export async function listMonitoredEmails(
  env: Env,
  filters?: { company_id?: string; urgency?: string; requires_action?: boolean; limit?: number }
): Promise<MonitoredEmail[]> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (filters?.company_id) { conditions.push("company_id = ?"); bindings.push(filters.company_id); }
  if (filters?.urgency) { conditions.push("urgency = ?"); bindings.push(filters.urgency); }
  if (filters?.requires_action !== undefined) { conditions.push("requires_action = ?"); bindings.push(filters.requires_action ? 1 : 0); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters?.limit ?? 20, 100);

  const result = await env.DB.prepare(
    `SELECT * FROM monitored_emails ${where} ORDER BY received_at DESC LIMIT ?`
  ).bind(...bindings, limit).all<MonitoredEmail>();
  return result.results ?? [];
}

export async function markEmailNotified(env: Env, id: string): Promise<void> {
  await env.DB.prepare("UPDATE monitored_emails SET notified = 1 WHERE id = ?").bind(id).run();
}

// ── Wallet Passes (Smart Passes) ──────────────────────────────────────────

export interface WalletPass {
  id: number;
  company_id: number;
  serial_number: string;
  pass_type_id: string;
  owner_name: string;
  owner_email: string | null;
  role: string | null;
  install_url: string | null;
  installed: number;
  created_at: string;
  installed_at: string | null;
}

export async function createWalletPass(
  env: Env,
  companyId: number,
  data: {
    serial_number: string;
    pass_type_id: string;
    owner_name: string;
    owner_email?: string | null;
    role?: string | null;
    install_url?: string | null;
  }
): Promise<number> {
  const result = await env.DB.prepare(`
    INSERT INTO wallet_passes (company_id, serial_number, pass_type_id, owner_name, owner_email, role, install_url)
    VALUES (?,?,?,?,?,?,?)
  `).bind(
    companyId, data.serial_number, data.pass_type_id, data.owner_name,
    data.owner_email ?? null, data.role ?? null, data.install_url ?? null
  ).run();
  return result.meta.last_row_id as number;
}

export async function listWalletPasses(
  env: Env,
  companyId: number,
  limit = 20
): Promise<WalletPass[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM wallet_passes WHERE company_id = ? ORDER BY created_at DESC LIMIT ?"
  ).bind(companyId, Math.min(limit, 100)).all<WalletPass>();
  return result.results ?? [];
}

export async function getWalletPassBySerial(
  env: Env,
  serialNumber: string
): Promise<WalletPass | null> {
  const result = await env.DB.prepare(
    "SELECT * FROM wallet_passes WHERE serial_number = ?"
  ).bind(serialNumber).first<WalletPass>();
  return result ?? null;
}

export async function updateWalletPassInstalled(
  env: Env,
  serialNumber: string
): Promise<void> {
  await env.DB.prepare(
    "UPDATE wallet_passes SET installed = 1, installed_at = datetime('now') WHERE serial_number = ?"
  ).bind(serialNumber).run();
}

export async function updateWalletPassUrl(
  env: Env,
  serialNumber: string,
  installUrl: string
): Promise<void> {
  await env.DB.prepare(
    "UPDATE wallet_passes SET install_url = ? WHERE serial_number = ?"
  ).bind(installUrl, serialNumber).run();
}
