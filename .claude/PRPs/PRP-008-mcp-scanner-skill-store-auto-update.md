# PRP-008: MCP Scanner + Skill Store + Auto-Update System

> **Estado**: PENDIENTE
> **Fecha**: 2026-04-03
> **Proyecto**: OpenClaw / Ailyn

---

## Objetivo

Cuando un usuario conecta un servidor MCP, Ailyn lo escanea una sola vez, convierte todas las tools en Skills persistentes (D1 + Vectorize), y desde entonces usa los Skills directamente sin volver a consultar el MCP para descubrir. Un cron semanal re-escanea para detectar cambios (tools nuevos, modificados o eliminados).

## Por Que

| Problema | Solucion |
|----------|----------|
| Skills hardcodeados en SKILL_CATALOG (16 fijos) — no escalable | Skills dinamicos desde cualquier MCP server, almacenados en D1 + Vectorize |
| Agregar una nueva herramienta requiere deploy del Worker | Conectar un MCP y las tools aparecen como Skills automaticamente |
| No hay forma de que empresas extiendan las capacidades de Ailyn | Cualquier empresa puede conectar sus propios MCPs con tools personalizados |
| Si un MCP cambia sus tools, Ailyn no se entera | Auto-update semanal detecta cambios, agrega nuevos, depreca eliminados |

**Valor de negocio**: Transforma Ailyn de un asistente con 16 skills fijos a una plataforma extensible. Cada MCP conectado multiplica las capacidades sin codigo adicional. Diferenciador competitivo clave.

## Que

### Criterios de Exito
- [ ] POST /api/settings/mcp/connect acepta una URL de MCP, escanea, y genera skills en D1 + Vectorize
- [ ] findRelevantSkills() encuentra MCP Skills con la misma precision que los skills nativos (busqueda semantica)
- [ ] El orchestrator ejecuta un MCP Skill llamando al servidor MCP correcto con los parametros correctos
- [ ] DELETE /api/settings/mcp/disconnect desactiva todos los skills de ese MCP (soft delete)
- [ ] El cron semanal re-escanea MCPs conectados y detecta: tools nuevos, tools modificados (version_hash), tools eliminados
- [ ] La UI en Settings muestra MCPs conectados, sus skills, y permite re-escanear manualmente

### Comportamiento Esperado (Happy Path)

1. Usuario va a Settings > Servidores MCP > "Conectar nuevo"
2. Ingresa URL del servidor MCP (ej: `https://my-tools.example.com/mcp`) y tipo de transporte (`streamable-http`)
3. Ailyn escanea el MCP en background: llama `tools/list`, obtiene 5 tools
4. Para cada tool: genera nombre legible, descripcion, synonyms (via Workers AI), calcula version_hash
5. Guarda 5 registros en `mcp_skills` + indexa 5 vectores en Vectorize con prefix `mcp-skill-`
6. Usuario ve los 5 skills nuevos listados bajo ese MCP
7. Cuando un usuario pregunta algo que matchea un MCP Skill, findRelevantSkills() lo encuentra
8. El tool-executor detecta que es un `mcp_skill` y hace la llamada HTTP al MCP server con los parametros
9. Cada domingo el cron re-escanea: si tool #3 cambio su descripcion, actualiza D1 + re-indexa Vectorize

---

## Contexto

### Referencias
- `cloudflare-agent/src/skill-layer.ts` — SKILL_CATALOG hardcodeado (16 skills), indexSkills(), findRelevantSkills()
- `cloudflare-agent/src/llm-smart-router.ts` — route() usa findRelevantSkills() para deteccion semantica
- `cloudflare-agent/src/tool-executor.ts` — executeTools() con handlers por tipo de tool
- `cloudflare-agent/src/integrations-hub.ts` — patron de integraciones: getIntegrationToken(), saveIntegration()
- `cloudflare-agent/src/index.ts` — endpoints de settings + handleScheduled() cron cada 15 min + morning report 14:00
- `cloudflare-agent/src/types.ts` — Env bindings (AI, DB, KV, KNOWLEDGE_BASE, DESKTOP_TUNNEL)
- `cloudflare-agent/wrangler.toml` — crons: `*/15 * * * *` y `0 14 * * *`
- MCP Spec: https://modelcontextprotocol.io/docs (tools/list, tool invocation via streamable-http)

### Arquitectura Propuesta

```
cloudflare-agent/src/
├── mcp-scanner.ts          # NUEVO: scanMcpServer(), generateSynonyms(), computeVersionHash()
├── mcp-executor.ts         # NUEVO: executeMcpTool() — llama al MCP server para ejecutar un tool
├── skill-layer.ts          # MODIFICAR: findRelevantSkills() ahora tambien busca mcp-skill-* en Vectorize
├── tool-executor.ts        # MODIFICAR: nuevo handler "mcp_skill" que usa mcp-executor
├── index.ts                # MODIFICAR: 4 endpoints nuevos + cron semanal
└── types.ts                # SIN CAMBIOS (Env ya tiene AI, DB, KNOWLEDGE_BASE)
```

```
dashboard/                  # Frontend (Next.js)
└── (pagina de settings)    # MODIFICAR: agregar seccion "Servidores MCP"
```

### Modelo de Datos

```sql
-- Nueva tabla: mcp_skills
CREATE TABLE mcp_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  mcp_server_url TEXT NOT NULL,
  mcp_transport_type TEXT NOT NULL DEFAULT 'streamable-http',
  mcp_tool_name TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  description TEXT NOT NULL,
  parameters_schema TEXT,          -- JSON Schema del inputSchema del tool
  synonyms TEXT,                   -- JSON array de sinonimos generados por Workers AI
  version_hash TEXT NOT NULL,      -- SHA-256 de (description + parameters_schema)
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deprecated_at TEXT,
  UNIQUE(company_id, mcp_server_url, mcp_tool_name)
);

-- Indice para queries frecuentes
CREATE INDEX idx_mcp_skills_company ON mcp_skills(company_id, is_active);
CREATE INDEX idx_mcp_skills_server ON mcp_skills(mcp_server_url, is_active);
```

### Decisiones de Arquitectura

1. **Solo HTTP transports desde el Worker**: Cloudflare Workers no pueden ejecutar procesos (`stdio`). Solo `streamable-http` y `sse` son viables. Para MCPs que solo soportan `stdio`, el Desktop Agent actuaria como bridge (fuera de scope de este PRP).

2. **Scan asincrono**: El scan puede tardar varios segundos. El endpoint retorna inmediatamente con status "scanning" y el scan corre via `ctx.waitUntil()`. El frontend puede polling GET /api/settings/mcp para ver cuando termina.

3. **Synonyms via Workers AI**: Para mejorar la busqueda semantica, se generan 5-7 sinonimos por tool usando Llama 3.2 3B (gratis, ya disponible como `env.AI`).

4. **Version hash**: SHA-256 de `description + JSON.stringify(inputSchema)`. Si cambia, el skill se actualiza. Si un tool desaparece, se marca `deprecated_at` (soft delete, no se borra).

5. **Vectorize namespace**: Los MCP Skills se indexan con prefix `mcp-skill-{company_id}-{tool_name}` para no colisionar con los skills nativos (`skill-*`). findRelevantSkills() ya filtra por prefix — hay que agregar `mcp-skill-` como prefix valido.

6. **Cron semanal**: Se agrega un tercer cron `0 3 * * 0` (domingos 3:00 UTC) o se reutiliza el morning report (0 14 * * *) con un check `if (esDomingo)`.

7. **MCP Protocol**: Para llamar tools/list se usa fetch con el formato JSON-RPC de MCP. Para ejecutar un tool, se envia `tools/call` con el name + arguments.

---

## Blueprint (Assembly Line)

> IMPORTANTE: Solo FASES. Las subtareas se generan al entrar a cada fase.

### Fase 1: Tabla D1 + Migracion
**Objetivo**: Crear la tabla `mcp_skills` en D1 con todos los campos necesarios
**Validacion**: Migracion aplicada exitosamente, tabla existe con los indices correctos

### Fase 2: MCP Scanner Core
**Objetivo**: Implementar `mcp-scanner.ts` con: scanMcpServer() que conecta a un MCP via streamable-http, llama tools/list, genera synonyms via Workers AI, computa version_hash, y guarda en D1 + Vectorize
**Validacion**: Funcion scanMcpServer() probada con un MCP mock/real que retorna tools correctamente parseados

### Fase 3: MCP Executor
**Objetivo**: Implementar `mcp-executor.ts` con: executeMcpTool() que llama a un MCP server para ejecutar un tool especifico con parametros dados
**Validacion**: Funcion executeMcpTool() puede invocar un tool remoto y retornar el resultado

### Fase 4: Integracion con Skill Layer + Tool Executor
**Objetivo**: Modificar `skill-layer.ts` para que findRelevantSkills() tambien busque MCP Skills en Vectorize. Modificar `tool-executor.ts` para que tenga un handler "mcp_skill" que use mcp-executor. Modificar `llm-smart-router.ts` para incluir MCP Skills como AvailableTool
**Validacion**: Un mensaje del usuario que matchea un MCP Skill es detectado por findRelevantSkills(), ruteado correctamente, y ejecutado via el MCP server

### Fase 5: Endpoints API
**Objetivo**: Implementar 4 endpoints en index.ts: POST connect, DELETE disconnect, GET list, POST rescan
**Validacion**: Los 4 endpoints funcionan: connect escanea y genera skills, disconnect desactiva, list retorna MCPs con skills, rescan re-escanea

### Fase 6: Auto-Update Cron
**Objetivo**: Agregar logica al cron para re-escanear MCPs semanalmente. Comparar version_hash, actualizar skills modificados, crear nuevos, deprecar eliminados
**Validacion**: El cron detecta correctamente: tool nuevo (crea skill), tool modificado (actualiza), tool eliminado (marca deprecated)

### Fase 7: UI en Dashboard Settings
**Objetivo**: Agregar seccion "Servidores MCP" en la pagina de Settings del dashboard con: formulario de conexion, lista de MCPs con sus skills, boton re-escanear
**Validacion**: El flujo completo funciona desde la UI: conectar MCP > ver skills > desconectar

### Fase 8: Validacion Final
**Objetivo**: Sistema funcionando end-to-end
**Validacion**:
- [ ] `npm run typecheck` pasa (en cloudflare-agent)
- [ ] Build del Worker exitoso
- [ ] Conectar un MCP via UI genera skills en D1 + Vectorize
- [ ] Un mensaje del usuario matchea un MCP Skill y se ejecuta correctamente
- [ ] Re-escaneo detecta cambios
- [ ] Desconectar un MCP desactiva sus skills
- [ ] Criterios de exito cumplidos

---

## Aprendizajes (Self-Annealing)

> Esta seccion CRECE con cada error encontrado durante la implementacion.

---

## Gotchas

- [ ] Cloudflare Workers NO soportan `stdio` — solo HTTP transports (streamable-http, sse)
- [ ] Workers AI embedding model `@cf/baai/bge-base-en-v1.5` tiene limite de texto — truncar descripciones largas
- [ ] Vectorize tiene limite de dimensiones por vector — verificar que el modelo de embeddings sea compatible
- [ ] El scan de un MCP puede fallar (server caido, timeout, formato invalido) — manejar todos los errores gracefully
- [ ] MCP tools/list puede retornar 0 tools — manejar caso vacio
- [ ] El `ctx.waitUntil()` tiene un timeout de 30s en Workers free tier — scans de MCPs grandes pueden necesitar chunking
- [ ] Los synonyms generados por Llama pueden ser de baja calidad — considerar un prompt muy especifico
- [ ] `AvailableTool` en llm-smart-router.ts es un union type literal — los MCP Skills necesitan ser manejados como tipo dinamico, no como literal

## Anti-Patrones

- NO duplicar la logica de embeddings — reusar el patron de indexSkills() en skill-layer.ts
- NO hacer scan sincrono en el endpoint — siempre async con waitUntil
- NO borrar skills cuando un MCP se desconecta — soft delete con deprecated_at
- NO llamar al MCP para descubrir tools en cada request — solo para EJECUTAR
- NO hardcodear MCP tool names en AvailableTool union type — usar un mecanismo dinamico
- NO ignorar errores de MCP en el cron — loguear y continuar con el siguiente

---

*PRP pendiente aprobacion. No se ha modificado codigo.*
