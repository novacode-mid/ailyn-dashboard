-- ── Historial de conversación multi-canal ─────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  user_id INTEGER,
  channel TEXT NOT NULL,          -- 'telegram' | 'webchat' | 'api'
  session_id TEXT NOT NULL,       -- telegram chat_id o webchat session_id
  role TEXT NOT NULL,             -- 'user' | 'assistant'
  content TEXT NOT NULL,
  model_used TEXT,                -- modelo que generó la respuesta
  tools_used TEXT,                -- JSON array de herramientas usadas
  complexity TEXT,                -- 'simple' | 'medium' | 'complex'
  cost_estimate REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_conv_session ON conversation_history(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conv_company ON conversation_history(company_id, channel, created_at);

-- ── Integraciones OAuth por empresa ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  provider TEXT NOT NULL,         -- 'google' | 'github' | 'slack'
  access_token TEXT,
  refresh_token TEXT,
  token_expiry DATETIME,
  scope TEXT,
  extra_data TEXT,                -- JSON: email, nombre, avatar, etc.
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, provider),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- ── Tareas personales ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personal_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',  -- 'pending' | 'in_progress' | 'done'
  priority TEXT DEFAULT 'normal', -- 'low' | 'normal' | 'high' | 'urgent'
  due_date TEXT,
  source TEXT,                    -- 'manual' | 'email' | 'telegram' | 'ai'
  source_ref TEXT,                -- email_id, message_id, etc.
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_personal_tasks_company ON personal_tasks(company_id, status);
