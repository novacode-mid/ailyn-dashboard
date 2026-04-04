# PRP-007: Arquitectura Edge Avanzada — Skill Layer + Code Mode + WebSocket Tunnel

> **Estado**: PENDIENTE
> **Fecha**: 2026-04-03
> **Proyecto**: OpenClaw / Ailyn

---

## Objetivo

Evolucionar la arquitectura edge de Ailyn con 3 mejoras: (1) deteccion semantica de herramientas via Vectorize en vez de regex/keywords, (2) modo estructurado JSON para ejecucion de tools reduciendo ~60% tokens, y (3) conexion WebSocket persistente entre Desktop Agent y Worker eliminando el polling HTTP.

## Por Que

| Problema | Solucion |
|----------|----------|
| `preDetectTools()` usa ~200 lineas de regex que fallan con lenguaje natural ambiguo ("mandame un mensajito por el chat azul" no matchea "telegram") | Skill Layer: indexar herramientas como vectores en Vectorize, busqueda semantica para detectar intent |
| El orchestrator genera texto libre con marcadores (`---EMAIL_LISTO---`, `---EVENTO_LISTO---`) que el LLM tiene que "formatear", gastando tokens en conversacion | Code Mode: para tareas de herramientas, el LLM genera JSON estructurado con acciones, no prosa |
| Desktop Agent hace polling HTTP cada 3s (`setInterval(poll, config.pollInterval)`) — ineficiente, latencia de hasta 3s, requests vacios | WebSocket Tunnel: Durable Object mantiene conexion persistente, tareas se pushean instantaneamente |

**Valor de negocio**: Mejor comprension de intenciones (menos "no entendi"), menor costo por mensaje (-60% tokens en tool calls), y ejecucion de desktop tasks instantanea en vez de hasta 3s de delay.

## Que

### Criterios de Exito
- [ ] Mensaje "mandame un mensajito por el chat azul" detecta correctamente `slack` o `telegram` segun contexto
- [ ] Mensaje "anota eso en mi wiki" detecta `notion` sin que haya keyword "notion" explicito
- [ ] Code Mode reduce tokens de output en tool calls medibles (comparar antes/despues con mismo prompt)
- [ ] Desktop Agent conecta via WebSocket y recibe tareas en <100ms vs los 3s actuales de polling
- [ ] Fallback graceful: si Vectorize falla, usa preDetectTools() como hoy; si WebSocket cae, reconecta o fallback a polling

### Comportamiento Esperado

**Skill Layer (Happy Path)**:
1. Usuario envia "mandame un mensajito por el chat azul" desde Telegram
2. Smart router toma el mensaje, genera embedding con Workers AI
3. Busca en Vectorize los skills mas cercanos semanticamente
4. Vectorize retorna `[{id: "slack", score: 0.87}, {id: "telegram", score: 0.82}]`
5. Combina con contexto (canales conectados de la empresa) para decidir: `slack`
6. Orchestrator ejecuta la herramienta correcta

**Code Mode (Happy Path)**:
1. Router detecta que el mensaje requiere tool execution (no conversacion)
2. En vez del system prompt largo con marcadores, usa un prompt compacto de "code mode"
3. LLM responde con JSON: `{"action": "send_email", "params": {"to": "pedro@x.com", "subject": "Seguimiento", "body": "..."}, "reply": "Listo, email enviado a Pedro."}`
4. Orchestrator parsea el JSON, ejecuta la accion, y retorna solo el `reply` al usuario
5. Si el JSON es invalido, fallback al modo conversacional actual

**WebSocket Tunnel (Happy Path)**:
1. Desktop Agent inicia y abre WebSocket a `wss://ailyn-agent.workers.dev/ws/desktop/{companyId}`
2. Durable Object `DesktopTunnel` acepta la conexion y la mantiene viva
3. Cuando el orchestrator crea una desktop_task, notifica al DO
4. DO pushea la tarea al Desktop Agent via WebSocket instantaneamente
5. Agent ejecuta y reporta resultado via WebSocket
6. Si la conexion cae, Agent reconecta con backoff exponencial; si falla 3 veces, fallback a polling

---

## Contexto

### Referencias
- `cloudflare-agent/src/llm-smart-router.ts` — `preDetectTools()` (lineas 86-200) y `classifyWithLlama()` (lineas 255-292). Estas dos funciones serian reemplazadas/complementadas por la busqueda semantica
- `cloudflare-agent/src/orchestrator.ts` — System prompt con marcadores (lineas 219-361) y post-procesamiento de marcadores (lineas 532-650). Code Mode reemplazaria este flujo para tool calls
- `cloudflare-agent/src/tool-executor.ts` — `executeTools()` y `formatToolResults()`. No cambia, pero Code Mode cambia como se invoca
- `desktop-agent/src/poller.ts` — `startPoller()` con `setInterval(poll, config.pollInterval)`. Se reemplaza con WebSocket
- `desktop-app/electron/agent/runner.ts` — `AgentRunner` con polling identico. Se reemplaza con WebSocket
- `cloudflare-agent/wrangler.toml` — Vectorize binding `KNOWLEDGE_BASE` ya existe, D1 tabla `skills` ya existe
- `cloudflare-agent/migrations/0003_multi_tenant.sql` — Schema de `skills` (id, name, description, is_active) y `agent_skills`

### Arquitectura Propuesta

```
cloudflare-agent/src/
├── skill-layer.ts          # NUEVO: busqueda semantica de skills en Vectorize
├── code-mode.ts            # NUEVO: prompt compacto + parser JSON para tool calls
├── desktop-tunnel.ts       # NUEVO: Durable Object para WebSocket persistente
├── llm-smart-router.ts     # MODIFICAR: integrar skill-layer como alternativa a preDetectTools
├── orchestrator.ts         # MODIFICAR: detectar cuando usar code-mode vs conversacional
└── types.ts                # MODIFICAR: agregar tipos para code-mode y tunnel

desktop-agent/src/
├── ws-client.ts            # NUEVO: cliente WebSocket con reconnect
├── poller.ts               # MANTENER: fallback si WebSocket no disponible

desktop-app/electron/agent/
├── ws-runner.ts            # NUEVO: AgentRunner con WebSocket
├── runner.ts               # MANTENER: fallback
```

### Modelo de Datos

```sql
-- Extender tabla skills con campo para embedding y metadata semantica
ALTER TABLE skills ADD COLUMN synonyms TEXT DEFAULT '[]';
-- synonyms: JSON array de frases alternativas para indexar
-- Ejemplo: ["chat azul", "mensajeria", "canal de equipo"] para Slack

-- Vectorize index KNOWLEDGE_BASE ya existe con dimension 768
-- Se reutiliza para indexar skills ademas de knowledge docs
-- Namespace: "skill:" prefix para diferenciar de docs
```

```
// Vectorize vector format para skills:
{
  id: "skill:slack",
  values: float[768],  // embedding de description + synonyms
  metadata: {
    type: "skill",
    name: "slack",
    description: "Enviar mensajes a canales de Slack",
    synonyms: ["chat azul", "mensajeria equipo", "canal"]
  }
}
```

---

## Blueprint (Assembly Line)

> IMPORTANTE: Solo definir FASES. Las subtareas se generan al entrar a cada fase
> siguiendo el bucle agentico (mapear contexto -> generar subtareas -> ejecutar)

### Fase 1: Skill Layer — Indexacion y Busqueda Semantica
**Objetivo**: Crear `skill-layer.ts` que indexe todas las herramientas en Vectorize y exponga una funcion `semanticDetectTools(message, env)` que retorne las herramientas mas relevantes con score de confianza. Integrar en el smart router como complemento/reemplazo de `preDetectTools()`.
**Validacion**: Test con mensajes ambiguos ("mandame un mensajito por el chat azul", "anota eso en mi wiki", "buscame lo que dijo Pedro") retornan la herramienta correcta con score > 0.75.

### Fase 2: Code Mode — Prompt Estructurado para Tool Calls
**Objetivo**: Crear `code-mode.ts` con un prompt compacto que le pida al LLM generar JSON de acciones en vez de texto con marcadores. Modificar `orchestrator.ts` para detectar cuando usar code-mode (tool detected + no conversacion compleja) y parsear el JSON response. Mantener fallback al modo conversacional.
**Validacion**: Mismo mensaje "enviame un email a pedro@x.com diciendole que nos vemos manana" genera la misma accion pero con ~60% menos tokens de output. El fallback funciona si el JSON es invalido.

### Fase 3: WebSocket Tunnel — Durable Object + Desktop Client
**Objetivo**: Crear Durable Object `DesktopTunnel` que mantenga conexiones WebSocket por empresa. Crear `ws-client.ts` en desktop-agent y `ws-runner.ts` en desktop-app con reconnect automatico. Modificar el orchestrator para notificar al DO cuando crea desktop tasks. Configurar wrangler.toml con el DO.
**Validacion**: Desktop Agent conecta via WebSocket, recibe tarea en <100ms cuando se crea desde Telegram. Si se mata el WebSocket, reconecta en <5s. Si WebSocket no disponible, usa polling como antes.

### Fase 4: Validacion Final e Integracion
**Objetivo**: Sistema completo funcionando end-to-end con las 3 mejoras integradas
**Validacion**:
- [ ] `npm run typecheck` pasa en cloudflare-agent
- [ ] `wrangler deploy` exitoso (Durable Object + Vectorize + D1)
- [ ] Skill Layer: 5 mensajes ambiguos detectan herramienta correcta
- [ ] Code Mode: token reduction verificable en logs
- [ ] WebSocket: Desktop Agent conecta y recibe tareas instantaneamente
- [ ] Fallbacks: cada mejora degrada gracefully al comportamiento anterior
- [ ] Criterios de exito cumplidos

---

## Aprendizajes (Self-Annealing / Neural Network)

> Esta seccion CRECE con cada error encontrado durante la implementacion.
> El conocimiento persiste para futuros PRPs. El mismo error NUNCA ocurre dos veces.

*(Vacio — se llena durante implementacion)*

---

## Gotchas

- [ ] Vectorize tiene un limite de dimensiones por index — verificar que KNOWLEDGE_BASE soporta namespace mixing (skills + docs) o si necesitamos un index separado
- [ ] Workers AI embedding model debe ser el mismo que se uso para indexar knowledge docs (consistencia de dimensiones)
- [ ] Durable Objects requieren configuracion en wrangler.toml (`[durable_objects]` + `[[migrations]]`) — no olvidar
- [ ] WebSocket en Cloudflare Workers tiene limite de 30s idle — necesita heartbeat/ping para mantener conexion viva
- [ ] Code Mode: el JSON del LLM puede venir con markdown fences (```json ... ```) — el parser debe tolerarlo
- [ ] `preDetectTools()` tiene logica especial para `connectedProviders` — Skill Layer debe respetar que solo sugiera herramientas de integraciones activas
- [ ] Desktop App (Electron) usa su propio `runner.ts` duplicado del CLI — ambos deben migrar a WebSocket

## Anti-Patrones

- NO eliminar `preDetectTools()` — mantener como fallback si Vectorize falla o score es bajo
- NO eliminar el modo conversacional con marcadores — mantener como fallback si code-mode falla
- NO eliminar el polling — mantener como fallback si WebSocket no disponible
- NO hardcodear embeddings — siempre generarlos con Workers AI en runtime o al indexar
- NO asumir que el LLM siempre retorna JSON valido — siempre parsear con try/catch y fallback

---

*PRP pendiente aprobacion. No se ha modificado codigo.*
