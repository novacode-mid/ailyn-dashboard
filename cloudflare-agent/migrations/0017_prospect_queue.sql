CREATE TABLE IF NOT EXISTS prospect_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  work_plan_id    INTEGER NOT NULL,
  company_id      INTEGER NOT NULL,
  company_name    TEXT    NOT NULL,
  industry        TEXT,
  region          TEXT,
  company_slug    TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending',
  result_lead_id  TEXT,
  error           TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at    DATETIME,
  FOREIGN KEY (work_plan_id) REFERENCES work_plans(id)
);

CREATE INDEX IF NOT EXISTS idx_prospect_queue_status  ON prospect_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_prospect_queue_plan    ON prospect_queue(work_plan_id, status);
