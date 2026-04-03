-- Billing events: auditoría de pagos Polar
CREATE TABLE IF NOT EXISTS billing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER,
  event_type TEXT NOT NULL,
  polar_subscription_id TEXT,
  polar_customer_id TEXT,
  plan_slug TEXT,
  amount_cents INTEGER,
  currency TEXT DEFAULT 'usd',
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_billing_events_company ON billing_events(company_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_type ON billing_events(event_type);
