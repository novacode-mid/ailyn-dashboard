-- Enterprise Agent Schema
-- Apply with: wrangler d1 migrations apply enterprise-agent-db

-- ── Users: control de acceso por chat_id de Telegram ─────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id  TEXT    NOT NULL UNIQUE,
  username     TEXT,
  role         TEXT    NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
  is_active    INTEGER NOT NULL DEFAULT 1,        -- 1 = active, 0 = blocked
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Tasks: cola de trabajo proactivo del agente ───────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'completed' | 'failed'
  priority     INTEGER NOT NULL DEFAULT 5,         -- 1 (alta) → 10 (baja)
  result       TEXT,
  created_by   TEXT,                               -- telegram_id del creador
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Index para el bucle proactivo: tareas pending ordenadas por prioridad
CREATE INDEX IF NOT EXISTS idx_tasks_status_priority
  ON tasks (status, priority ASC);

-- ── Audit log: trazabilidad de acciones del agente ───────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event      TEXT NOT NULL,  -- 'task_completed' | 'task_failed' | 'message_received'
  payload    TEXT,           -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
