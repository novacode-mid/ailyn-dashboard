-- Fase 10: Base de Conocimiento RAG

CREATE TABLE IF NOT EXISTS knowledge_docs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  title           TEXT    NOT NULL,
  vector_id       TEXT    NOT NULL UNIQUE,  -- ID usado en Vectorize
  content_preview TEXT,                     -- Primeros 300 chars del contenido
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_company
  ON knowledge_docs (company_id);
