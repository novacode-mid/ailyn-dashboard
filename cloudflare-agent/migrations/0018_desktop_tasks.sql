CREATE TABLE IF NOT EXISTS desktop_tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL,
  task_type        TEXT    NOT NULL,           -- 'screenshot' | 'download_file' | 'fill_form' | 'scrape_data'
  instruction      TEXT,                       -- descripción humana (ej: "tomar screenshot del competidor")
  config           TEXT    NOT NULL,           -- JSON con parámetros (url, selector, fields, etc.)
  status           TEXT    NOT NULL DEFAULT 'pending',  -- pending | running | completed | failed
  result           TEXT,                       -- JSON con resultado de la tarea
  screenshot_b64   TEXT,                       -- screenshot en base64 (si aplica)
  error            TEXT,                       -- mensaje de error (si status=failed)
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at     DATETIME,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_desktop_tasks_company_status
  ON desktop_tasks(company_id, status, created_at);
