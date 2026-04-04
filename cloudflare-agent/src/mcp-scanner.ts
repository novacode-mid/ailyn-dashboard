// ── MCP Scanner: Escanea servidores MCP y convierte tools en Skills ───────
// Conecta a un MCP server via JSON-RPC, extrae tools, genera synonyms
// con Workers AI, y guarda como Skills en D1 + Vectorize.

import type { Env } from "./types";

// ── Types ────────────────────────────────────────────────────────────────

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpToolsListResponse {
  jsonrpc: string;
  id: number;
  result?: { tools: McpTool[] };
  error?: { code: number; message: string };
}

interface McpToolCallResponse {
  jsonrpc: string;
  id: number;
  result?: { content: { type: string; text?: string }[] };
  error?: { code: number; message: string };
}

export interface ScanResult {
  serverId: number;
  skillsCreated: number;
  skillsUpdated: number;
  skillsDeprecated: number;
  errors: string[];
}

// ── Hash de version ──────────────────────────────────────────────────────

async function computeVersionHash(description: string, schema: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${description}|${schema}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// ── Generar synonyms con Workers AI ──────────────────────────────────────

async function generateSynonyms(toolName: string, description: string, env: Env): Promise<string[]> {
  try {
    const result = await env.AI.run(
      "@cf/meta/llama-3.2-3b-instruct" as Parameters<typeof env.AI.run>[0],
      {
        messages: [{
          role: "user",
          content: `Genera 20 frases en español que un usuario diría cuando necesita esta herramienta. Incluye:
- 5 peticiones directas ("calcula esto", "dame el clima")
- 5 preguntas indirectas ("va a llover?", "cuánto sale?")
- 5 con jerga/coloquial ("qué onda con el clima", "hazme la cuenta")
- 5 con contexto implícito ("necesito paraguas hoy", "cuánto le cobro si son 3 a $50")

Solo las frases, una por línea, sin números ni categorías.

Herramienta: ${toolName}
Descripción: ${description}`,
        }],
        max_tokens: 500,
      }
    ) as { response?: string };

    const text = typeof result.response === "string" ? result.response : "";
    return text.split("\n")
      .map(s => s.replace(/^[\d.*\-•]+\s*/, "").trim())
      .filter(s => s.length > 3 && s.length < 100)
      .slice(0, 20);
  } catch {
    return [`usar ${toolName}`, description.slice(0, 60)];
  }
}

// ── Inicializar sesion MCP (JSON-RPC initialize) ─────────────────────────

async function mcpInitialize(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "OpenClaw", version: "1.0.0" },
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Listar tools del MCP server ──────────────────────────────────────────

async function mcpListTools(url: string): Promise<McpTool[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });

  if (!res.ok) throw new Error(`MCP tools/list failed: ${res.status}`);

  const data = await res.json() as McpToolsListResponse;
  if (data.error) throw new Error(`MCP error: ${data.error.message}`);

  return data.result?.tools ?? [];
}

// ── Ejecutar tool en MCP server ──────────────────────────────────────────

export async function mcpCallTool(
  url: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) throw new Error(`MCP tools/call failed: ${res.status}`);

  const data = await res.json() as McpToolCallResponse;
  if (data.error) throw new Error(`MCP call error: ${data.error.message}`);

  const content = data.result?.content ?? [];
  return content.map(c => c.text ?? "").join("\n");
}

// ── Scan completo de un MCP server ───────────────────────────────────────

export async function scanMcpServer(
  env: Env,
  companyId: number,
  serverUrl: string,
  serverName: string,
  transportType: string
): Promise<ScanResult> {
  const errors: string[] = [];
  let skillsCreated = 0;
  let skillsUpdated = 0;
  let skillsDeprecated = 0;

  // 1. Guardar/actualizar servidor
  await env.DB.prepare(
    `INSERT INTO mcp_servers (company_id, url, transport_type, name, is_active, updated_at)
     VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(company_id, url) DO UPDATE SET
       name = excluded.name, transport_type = excluded.transport_type,
       is_active = 1, updated_at = CURRENT_TIMESTAMP`
  ).bind(companyId, serverUrl, transportType, serverName).run();

  const server = await env.DB.prepare(
    `SELECT id FROM mcp_servers WHERE company_id = ? AND url = ?`
  ).bind(companyId, serverUrl).first<{ id: number }>();

  if (!server) { errors.push("No se pudo crear el servidor"); return { serverId: 0, skillsCreated, skillsUpdated, skillsDeprecated, errors }; }
  const serverId = server.id;

  // 2. Inicializar MCP
  const initialized = await mcpInitialize(serverUrl);
  if (!initialized) {
    errors.push("No se pudo inicializar el MCP server (puede no ser necesario)");
    // Continue anyway — some servers don't require initialize
  }

  // 3. Listar tools
  let tools: McpTool[];
  try {
    tools = await mcpListTools(serverUrl);
  } catch (err) {
    errors.push(`Error al listar tools: ${err instanceof Error ? err.message : String(err)}`);
    return { serverId, skillsCreated, skillsUpdated, skillsDeprecated, errors };
  }

  if (tools.length === 0) {
    errors.push("El servidor no tiene tools disponibles");
    return { serverId, skillsCreated, skillsUpdated, skillsDeprecated, errors };
  }

  // 4. Obtener skills existentes para comparar
  const existing = await env.DB.prepare(
    `SELECT id, mcp_tool_name, version_hash FROM mcp_skills WHERE server_id = ? AND company_id = ?`
  ).bind(serverId, companyId).all<{ id: number; mcp_tool_name: string; version_hash: string }>();

  const existingMap = new Map((existing.results ?? []).map(s => [s.mcp_tool_name, s]));
  const scannedTools = new Set<string>();

  // 5. Procesar cada tool
  for (const tool of tools) {
    scannedTools.add(tool.name);
    const description = tool.description ?? `Tool: ${tool.name}`;
    const schemaStr = JSON.stringify(tool.inputSchema ?? {});
    const versionHash = await computeVersionHash(description, schemaStr);

    const existingSkill = existingMap.get(tool.name);

    if (existingSkill && existingSkill.version_hash === versionHash) {
      // Sin cambios — skip
      continue;
    }

    // Generar synonyms con AI
    const synonyms = await generateSynonyms(tool.name, description, env);
    const skillName = `mcp_${tool.name}`;

    if (existingSkill) {
      // Actualizar skill existente
      await env.DB.prepare(
        `UPDATE mcp_skills SET description = ?, parameters_schema = ?, synonyms = ?,
         version_hash = ?, is_active = 1, deprecated_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(description, schemaStr, JSON.stringify(synonyms), versionHash, existingSkill.id).run();
      skillsUpdated++;
    } else {
      // Crear nuevo skill
      await env.DB.prepare(
        `INSERT INTO mcp_skills (company_id, server_id, mcp_tool_name, skill_name, description,
         parameters_schema, synonyms, version_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(companyId, serverId, tool.name, skillName, description, schemaStr, JSON.stringify(synonyms), versionHash).run();
      skillsCreated++;
    }

    // Indexar en Vectorize
    const embText = `${skillName}: ${description}. Un usuario diría: ${synonyms.slice(0, 10).join(". ")}. Palabras clave: ${description.split(/\s+/).filter(w => w.length > 3).join(", ")}`;
    try {
      const embRes = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [embText] }) as { data: number[][] };
      await env.KNOWLEDGE_BASE.upsert([{
        id: `mcp-skill-${companyId}-${tool.name}`,
        values: embRes.data[0],
        metadata: {
          skill_name: skillName,
          mcp_tool_name: tool.name,
          description,
          server_url: serverUrl,
          company_id: String(companyId),
          type: "mcp_skill",
        },
      }]);
    } catch (err) {
      errors.push(`Vectorize error for ${tool.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 6. Deprecar tools que ya no existen en el server
  for (const [toolName, skill] of existingMap) {
    if (!scannedTools.has(toolName)) {
      await env.DB.prepare(
        `UPDATE mcp_skills SET deprecated_at = CURRENT_TIMESTAMP, is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(skill.id).run();
      skillsDeprecated++;
    }
  }

  // 7. Actualizar metadata del servidor
  await env.DB.prepare(
    `UPDATE mcp_servers SET last_scan_at = CURRENT_TIMESTAMP, skills_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(tools.length, serverId).run();

  return { serverId, skillsCreated, skillsUpdated, skillsDeprecated, errors };
}

// ── Re-scan todos los MCPs de una empresa ────────────────────────────────

export async function rescanAllMcpServers(env: Env, companyId: number): Promise<ScanResult[]> {
  const servers = await env.DB.prepare(
    `SELECT id, url, name, transport_type FROM mcp_servers WHERE company_id = ? AND is_active = 1`
  ).bind(companyId).all<{ id: number; url: string; name: string; transport_type: string }>();

  const results: ScanResult[] = [];
  for (const server of servers.results ?? []) {
    const result = await scanMcpServer(env, companyId, server.url, server.name, server.transport_type);
    results.push(result);
  }
  return results;
}

// ── Re-scan global (para cron) ───────────────────────────────────────────

export async function rescanAllMcpServersCron(env: Env): Promise<void> {
  const servers = await env.DB.prepare(
    `SELECT DISTINCT company_id FROM mcp_servers WHERE is_active = 1`
  ).all<{ company_id: number }>();

  for (const row of servers.results ?? []) {
    try {
      await rescanAllMcpServers(env, row.company_id);
      console.log(`[mcp-scanner] Rescan complete for company ${row.company_id}`);
    } catch (err) {
      console.error(`[mcp-scanner] Rescan failed for company ${row.company_id}:`, String(err));
    }
  }
}
