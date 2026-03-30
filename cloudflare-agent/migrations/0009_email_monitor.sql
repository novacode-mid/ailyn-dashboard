-- Fase 15: Tabla de Emails Monitoreados (Gmail)

CREATE TABLE IF NOT EXISTS monitored_emails (
  id                TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  company_id        TEXT    NOT NULL,

  -- Datos del email
  gmail_message_id  TEXT    UNIQUE,
  from_address      TEXT,
  from_name         TEXT,
  to_address        TEXT,
  subject           TEXT,
  body_preview      TEXT,
  received_at       TEXT,

  -- Análisis IA
  urgency           TEXT    NOT NULL DEFAULT 'medium',  -- high | medium | low
  category          TEXT,   -- prospecto | cliente | proveedor | spam | newsletter | personal | administrativo
  summary           TEXT,
  suggested_reply   TEXT,
  requires_action   INTEGER NOT NULL DEFAULT 0,

  -- Estado
  notified          INTEGER NOT NULL DEFAULT 0,
  replied           INTEGER NOT NULL DEFAULT 0,

  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emails_company   ON monitored_emails(company_id);
CREATE INDEX IF NOT EXISTS idx_emails_gmail_id  ON monitored_emails(gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_emails_urgency   ON monitored_emails(urgency);
CREATE INDEX IF NOT EXISTS idx_emails_notified  ON monitored_emails(notified);
