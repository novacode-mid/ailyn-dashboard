ALTER TABLE desktop_tasks ADD COLUMN batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_desktop_tasks_batch ON desktop_tasks(batch_id, company_id);
