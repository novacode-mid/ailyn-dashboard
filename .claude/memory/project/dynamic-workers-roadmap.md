---
name: Dynamic Workers Roadmap
description: Plan para migrar a Cloudflare Dynamic Workers cuando salga de beta — Code Mode real con TypeScript generado por LLM
type: project
---

## Decision (2026-04-04): Esperar a que Dynamic Workers salga de beta

**Por qué**: Está en beta, las librerías (@cloudflare/codemode, @cloudflare/worker-bundler, @cloudflare/shell) son nuevas y pueden cambiar. No meter tecnología inestable sobre lo que ya funciona.

**Qué tenemos hoy como preparación**:
- Code Mode con JSON Actions (code-mode.ts) — el LLM genera JSON estructurado
- Skill Layer con Vectorize (skill-layer.ts) — detección semántica de herramientas
- MCP Scanner (mcp-scanner.ts) — escanea MCPs y genera Skills automáticamente

**Cuándo migrar**: Cuando Dynamic Workers salga de beta Y las librerías estén estables.

**Qué cambiaría**:
1. Code Mode: de JSON actions → TypeScript generado que se ejecuta en isolate
2. MCP Skills: generar SDK tipado para cada MCP en vez de solo JSON Schema
3. Desktop Tasks: pre-procesar en Dynamic Worker antes de enviar a PC
4. Modelo económico: Workers desechables por tarea (solo CPU + invocaciones)

**Cómo aplicar**: La migración sería en code-mode.ts y tool-executor.ts — el resto (smart router, skill layer, UI) no cambia.

**Fuente**: https://ecosistemastartup.com/cloudflare-dynamic-workers-ejecuta-agentes-ai-100x-mas-rapido/
