CREATE TABLE IF NOT EXISTS whatsapp_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL UNIQUE,
  phone_number_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  verify_token TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_company ON whatsapp_configs(company_id);
