-- Fase 15: Tabla de Leads con Inteligencia Comercial

CREATE TABLE IF NOT EXISTS leads (
  id                      TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  company_id              TEXT    NOT NULL,

  -- Datos del formulario / entrada
  contact_name            TEXT    NOT NULL,
  contact_email           TEXT    NOT NULL,
  contact_phone           TEXT,
  contact_company         TEXT,
  contact_message         TEXT,
  source                  TEXT    NOT NULL DEFAULT 'manual',

  -- Status del research
  research_status         TEXT    NOT NULL DEFAULT 'pending',  -- pending | processing | complete | failed

  -- Empresa investigada
  company_website         TEXT,
  company_industry        TEXT,
  company_size            TEXT,
  company_location        TEXT,
  company_description     TEXT,
  company_tech_stack      TEXT,   -- JSON array
  company_recent_news     TEXT,   -- JSON array

  -- Contacto investigado
  contact_role            TEXT,
  contact_seniority       TEXT,   -- c_level | director | manager | specialist | unknown
  contact_linkedin_url    TEXT,
  contact_linkedin_insights TEXT, -- JSON array

  -- Clasificación
  recommended_unit        TEXT,
  secondary_units         TEXT,   -- JSON array
  urgency                 TEXT    NOT NULL DEFAULT 'medium',  -- high | medium | low
  lead_score              INTEGER NOT NULL DEFAULT 0,

  -- Contenido generado por IA
  brief_summary           TEXT,
  brief_full              TEXT,
  suggested_email_subject TEXT,
  suggested_email_body    TEXT,
  talking_points          TEXT,   -- JSON array
  estimated_value         TEXT,
  next_step               TEXT,
  follow_up_date          TEXT,   -- YYYY-MM-DD

  -- Estado
  notification_sent       INTEGER NOT NULL DEFAULT 0,
  response_sent           INTEGER NOT NULL DEFAULT 0,

  created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  researched_at           TEXT,
  updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_company  ON leads(company_id);
CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(research_status);
CREATE INDEX IF NOT EXISTS idx_leads_urgency  ON leads(urgency);
CREATE INDEX IF NOT EXISTS idx_leads_score    ON leads(lead_score DESC);
