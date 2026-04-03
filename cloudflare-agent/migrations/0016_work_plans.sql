CREATE TABLE IF NOT EXISTS work_plans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL,
  name             TEXT    NOT NULL,
  description      TEXT,
  cron_expression  TEXT    NOT NULL,
  is_active        INTEGER NOT NULL DEFAULT 1,
  last_run_at      DATETIME,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS work_plan_steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  work_plan_id  INTEGER NOT NULL,
  step_order    INTEGER NOT NULL,
  action_type   TEXT    NOT NULL,
  config        TEXT    NOT NULL DEFAULT '{}',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (work_plan_id) REFERENCES work_plans(id)
);

CREATE TABLE IF NOT EXISTS work_plan_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  work_plan_id   INTEGER NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'running',
  started_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at   DATETIME,
  results        TEXT,
  error          TEXT,
  FOREIGN KEY (work_plan_id) REFERENCES work_plans(id)
);

CREATE INDEX IF NOT EXISTS idx_work_plans_company   ON work_plans(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_work_plan_steps_plan ON work_plan_steps(work_plan_id, step_order);
CREATE INDEX IF NOT EXISTS idx_work_plan_runs_plan  ON work_plan_runs(work_plan_id, started_at);
