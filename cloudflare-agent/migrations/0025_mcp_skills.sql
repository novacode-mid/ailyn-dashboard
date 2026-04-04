-- ── MCP Servers: servidores MCP conectados por empresa ────────────────────
CREATE TABLE IF NOT EXISTS mcp_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  transport_type TEXT NOT NULL DEFAULT 'streamable-http',  -- 'streamable-http' | 'sse'
  name TEXT NOT NULL,
  last_scan_at DATETIME,
  last_scan_hash TEXT,           -- hash de la lista completa de tools
  skills_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, url),
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- ── MCP Skills: tools convertidos a skills ───────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  server_id INTEGER NOT NULL,
  mcp_tool_name TEXT NOT NULL,       -- nombre original en el MCP server
  skill_name TEXT NOT NULL,          -- nombre normalizado para Ailyn
  description TEXT NOT NULL,
  parameters_schema TEXT,            -- JSON Schema de inputSchema del MCP tool
  synonyms TEXT,                     -- JSON array de frases sinonimas (auto-generado)
  version_hash TEXT,                 -- SHA-256 de description + parameters
  is_active INTEGER DEFAULT 1,
  deprecated_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, server_id, mcp_tool_name),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (server_id) REFERENCES mcp_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_skills_company ON mcp_skills(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_company ON mcp_servers(company_id, is_active);
