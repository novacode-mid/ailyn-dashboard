-- Fase 17: Multi-LLM — registrar qué modelo generó cada brief
ALTER TABLE leads ADD COLUMN llm_provider TEXT DEFAULT 'cloudflare';
ALTER TABLE leads ADD COLUMN llm_model TEXT DEFAULT 'llama-3.3-70b';
