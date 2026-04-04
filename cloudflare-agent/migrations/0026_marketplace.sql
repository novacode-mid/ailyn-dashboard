-- ── Skill Marketplace ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publisher_company_id INTEGER NOT NULL,
  skill_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  icon TEXT DEFAULT '⚡',
  price_cents INTEGER DEFAULT 0,        -- 0 = gratis
  currency TEXT DEFAULT 'usd',
  installs INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  ratings_count INTEGER DEFAULT 0,
  mcp_server_url TEXT,                   -- URL del MCP server (si aplica)
  parameters_schema TEXT,                -- JSON Schema
  synonyms TEXT,                         -- JSON array
  is_public INTEGER DEFAULT 1,
  is_approved INTEGER DEFAULT 0,         -- requiere aprobacion admin
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (publisher_company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS marketplace_installs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace_skill_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(marketplace_skill_id, company_id),
  FOREIGN KEY (marketplace_skill_id) REFERENCES marketplace_skills(id),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_public ON marketplace_skills(is_public, is_approved, category);
CREATE INDEX IF NOT EXISTS idx_marketplace_installs ON marketplace_installs(company_id);
