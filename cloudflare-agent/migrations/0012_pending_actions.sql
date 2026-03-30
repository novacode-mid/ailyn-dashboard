-- Fase 18: Motor de Autonomía — acciones pendientes de aprobación humana

-- Agregar status a leads (new | contacted | closed)
ALTER TABLE leads ADD COLUMN status TEXT NOT NULL DEFAULT 'new';

-- Tabla de acciones pendientes de aprobación
CREATE TABLE IF NOT EXISTS pending_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  agent_id INTEGER,
  lead_id TEXT,

  -- Qué acción
  action_type TEXT NOT NULL, -- 'send_email', 'send_followup', 'schedule_meeting', 'close_lead'

  -- Datos de la acción (JSON string)
  action_data TEXT NOT NULL DEFAULT '{}',

  -- Estado
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, executed, failed, scheduled, cancelled

  -- Telegram callback tracking
  telegram_chat_id TEXT,
  telegram_message_id INTEGER,

  -- Metadata
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  executed_at TEXT,
  execution_result TEXT,

  -- Follow-up tracking
  followup_number INTEGER NOT NULL DEFAULT 0,
  followup_scheduled_at TEXT,

  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_status    ON pending_actions(status);
CREATE INDEX IF NOT EXISTS idx_pending_actions_company   ON pending_actions(company_id);
CREATE INDEX IF NOT EXISTS idx_pending_actions_lead      ON pending_actions(lead_id);
CREATE INDEX IF NOT EXISTS idx_pending_actions_followup  ON pending_actions(followup_scheduled_at);
