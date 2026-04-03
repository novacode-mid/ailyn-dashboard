CREATE TABLE IF NOT EXISTS telegram_configs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id            INTEGER UNIQUE NOT NULL,
  bot_token             TEXT    NOT NULL,
  bot_username          TEXT,
  webhook_secret        TEXT    NOT NULL,
  owner_chat_id         TEXT,
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_configs_company ON telegram_configs(company_id);
