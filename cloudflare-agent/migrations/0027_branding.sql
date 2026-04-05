-- ── Branding: personalización visual por empresa ─────────────────────────
ALTER TABLE companies ADD COLUMN logo_url TEXT;
ALTER TABLE companies ADD COLUMN brand_color TEXT DEFAULT '#6366f1';
ALTER TABLE companies ADD COLUMN welcome_message TEXT;
ALTER TABLE companies ADD COLUMN chat_avatar_url TEXT;
