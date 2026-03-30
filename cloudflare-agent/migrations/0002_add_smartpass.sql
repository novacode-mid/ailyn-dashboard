-- Smart Passes integration
-- Apply with: wrangler d1 migrations apply enterprise-agent-db

-- Asocia cada usuario con su Smart Pass ID para notificaciones push
ALTER TABLE users ADD COLUMN smartpass_id TEXT;

-- Index para lookup rápido desde el webchat por token de wallet
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_smartpass_id
  ON users (smartpass_id)
  WHERE smartpass_id IS NOT NULL;
