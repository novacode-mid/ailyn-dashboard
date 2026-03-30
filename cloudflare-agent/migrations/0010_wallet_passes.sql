-- Fase 16: Smart Passes (Wallet Apple/Google)
CREATE TABLE IF NOT EXISTS wallet_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  serial_number TEXT NOT NULL UNIQUE,
  pass_type_id TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_email TEXT,
  role TEXT,
  install_url TEXT,
  installed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  installed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_wallet_passes_company ON wallet_passes(company_id);
CREATE INDEX IF NOT EXISTS idx_wallet_passes_serial ON wallet_passes(serial_number);
