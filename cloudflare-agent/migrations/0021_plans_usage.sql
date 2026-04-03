-- ── Planes de suscripción ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER DEFAULT 0,
  chat_messages_limit INTEGER NOT NULL,
  leads_limit INTEGER NOT NULL,
  work_plans_limit INTEGER NOT NULL,
  agents_limit INTEGER NOT NULL,
  llm_provider TEXT DEFAULT 'cloudflare',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO plans (slug, name, price_cents, chat_messages_limit, leads_limit, work_plans_limit, agents_limit, llm_provider) VALUES
  ('free',       'Gratuito',    0,     20,    5,    1,  1, 'cloudflare'),
  ('starter',    'Starter',     4900,  500,   100,  3,  2, 'anthropic'),
  ('pro',        'Pro',         14900, 2000,  500,  10, 4, 'anthropic'),
  ('enterprise', 'Enterprise',  29900, 10000, 2000, -1, 6, 'anthropic');

-- ── Tracking de uso mensual por empresa ───────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  period TEXT NOT NULL,          -- formato YYYY-MM
  chat_messages_used INTEGER DEFAULT 0,
  leads_used INTEGER DEFAULT 0,
  work_plan_runs_used INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, period),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- ── plan_slug en companies ────────────────────────────────────────────────
ALTER TABLE companies ADD COLUMN plan_slug TEXT DEFAULT 'free';
