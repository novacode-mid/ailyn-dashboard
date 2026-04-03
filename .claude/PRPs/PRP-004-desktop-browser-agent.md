# PRP-004: Desktop Browser Agent

> **Estado**: PENDIENTE
> **Fecha**: 2026-04-03
> **Proyecto**: OpenClaw / Ailyn

---

## Objetivo

Construir un cliente de escritorio en Node.js con Playwright que corre en la PC del usuario, hace polling al Worker por tareas pendientes, las ejecuta en un browser real (screenshot, scrape, fill_form, download, filesystem), y reporta resultados + screenshots de vuelta al Worker para que Ailyn notifique por Telegram/WhatsApp.

## Por Que

| Problema | Solucion |
|----------|----------|
| El Worker crea `desktop_tasks` en D1 pero nadie las ejecuta | El cliente de escritorio poll, ejecuta, y reporta |
| El usuario no puede automatizar acciones web desde Telegram/WhatsApp | El agente completa el ciclo: mensaje → tarea → ejecucion → resultado |
| Las acciones de filesystem (fs_write, fs_read, fs_list, fs_delete) no tienen ejecutor | El cliente maneja tanto browser como filesystem |

**Valor de negocio**: Cierra el loop completo del agente autonomo. Sin esto, el 50% de las capacidades de Ailyn (desktop_actions) son promesas vacias.

## Que

### Criterios de Exito
- [ ] `npm install -g @openclaw/desktop-agent` instala y configura el agente
- [ ] El agente hace poll cada 5s a `GET /api/desktop/tasks?status=pending`
- [ ] Ejecuta correctamente los 4 tipos de browser tasks: screenshot, scrape_data, fill_form, download_file
- [ ] Ejecuta correctamente los 4 tipos de filesystem tasks: fs_write, fs_read, fs_list, fs_delete
- [ ] Reporta resultado + screenshot via `POST /api/desktop/tasks/:id/complete`
- [ ] Reporta errores via `PUT /api/desktop/tasks/:id/status` con status=failed + mensaje de error
- [ ] Corre como servicio en background (se puede cerrar la terminal)
- [ ] Maneja errores gracefully: timeout de pagina, selector no existe, archivo no encontrado

### Comportamiento Esperado

```
1. Usuario instala: npm install -g @openclaw/desktop-agent
2. Configura: openclaw-agent setup (pide API URL + token)
3. Inicia: openclaw-agent start (o start --visible para debug)
4. El agente hace poll al Worker cada 5 segundos
5. Cuando encuentra task pendiente:
   a. PUT status=running
   b. Lanza Playwright (o fs operation) segun task_type
   c. Ejecuta la accion (navegar, screenshot, fill, scrape, download, fs)
   d. POST complete con resultado + screenshot base64
   e. Si falla: PUT status=failed con error message
6. El Worker notifica al usuario por Telegram/WhatsApp (ya implementado)
```

---

## Contexto

### Referencias
- `cloudflare-agent/src/desktop-tasks.ts` — API endpoints del Worker (GET tasks, PUT status, POST complete)
- `cloudflare-agent/src/agent-brain.ts` — Genera acciones desktop con tools: screenshot, scrape_data, fill_form, download_file, fs_write, fs_read, fs_list, fs_delete
- `cloudflare-agent/src/telegram-multi.ts` — Crea tasks via `createDesktopTask()` con batchId
- `cloudflare-agent/src/whatsapp.ts` — Mismo flujo de creacion de tasks
- `cloudflare-agent/migrations/0018_desktop_tasks.sql` — Schema de la tabla
- `cloudflare-agent/migrations/0019_desktop_tasks_batch.sql` — Agrega batch_id

### API existente del Worker

```
GET  /api/desktop/tasks?status=pending   → { tasks: DesktopTask[] }
PUT  /api/desktop/tasks/:id/status       → { status: "running"|"failed", error?: string }
POST /api/desktop/tasks/:id/complete     → { result: { screenshot?: string, data?: any, ... } }
```

Auth: Bearer token en header Authorization.

### Tipos de tareas (de agent-brain.ts)

| task_type | config esperado |
|-----------|----------------|
| screenshot | `{ url }` |
| scrape_data | `{ url, selectors: { campo: ".css-selector" } }` |
| fill_form | `{ url, fields: [{ selector, value }], submitSelector }` |
| download_file | `{ url, selector: ".download-btn" }` |
| fs_write | `{ path, content }` |
| fs_read | `{ path }` |
| fs_list | `{ path }` |
| fs_delete | `{ path }` |

### Arquitectura Propuesta

```
desktop-agent/                    # Nuevo paquete standalone
├── package.json                  # bin: { "openclaw-agent": "./dist/cli.js" }
├── tsconfig.json
├── src/
│   ├── cli.ts                   # Entry point CLI (setup, start, stop, status)
│   ├── config.ts                # Lee/escribe ~/.openclaw/config.json
│   ├── poller.ts                # Poll loop: GET tasks → ejecutar → reportar
│   ├── executor.ts              # Router: task_type → handler correcto
│   ├── handlers/
│   │   ├── screenshot.ts        # Playwright: navegar + page.screenshot()
│   │   ├── scrape.ts            # Playwright: navegar + evaluar selectors
│   │   ├── fill-form.ts         # Playwright: navegar + fill fields + submit
│   │   ├── download.ts          # Playwright: navegar + click download + guardar
│   │   ├── fs-write.ts          # Node fs: escribir archivo
│   │   ├── fs-read.ts           # Node fs: leer archivo
│   │   ├── fs-list.ts           # Node fs: listar directorio
│   │   └── fs-delete.ts         # Node fs: eliminar archivo/carpeta
│   ├── api-client.ts            # Wrapper HTTP para el Worker API
│   └── logger.ts                # Logging con timestamps
└── dist/                        # Compilado
```

### Modelo de Datos

No requiere cambios en D1. La tabla `desktop_tasks` ya tiene todo lo necesario:

```sql
-- Ya existe (migracion 0018)
CREATE TABLE desktop_tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL,
  task_type        TEXT NOT NULL,
  instruction      TEXT,
  config           TEXT NOT NULL,        -- JSON
  status           TEXT NOT NULL DEFAULT 'pending',
  result           TEXT,                 -- JSON
  screenshot_b64   TEXT,
  error            TEXT,
  batch_id         TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at     DATETIME
);
```

---

## Blueprint (Assembly Line)

> Solo FASES. Las subtareas se generan al entrar a cada fase con contexto real.

### Fase 1: Scaffolding del paquete
**Objetivo**: Crear la estructura del proyecto desktop-agent con package.json, tsconfig, CLI entry point, y sistema de configuracion (~/.openclaw/config.json con apiUrl + token)
**Validacion**: `npx ts-node src/cli.ts setup` pide URL y token, los guarda en config. `npx ts-node src/cli.ts status` muestra la config.

### Fase 2: API Client + Poller
**Objetivo**: Implementar el cliente HTTP que habla con el Worker (get pending tasks, update status, post complete) y el poll loop que corre cada N segundos pidiendo tareas pendientes
**Validacion**: Con una task pendiente en D1, el poller la detecta, la marca running, y logea que la encontro.

### Fase 3: Handlers de Browser (Playwright)
**Objetivo**: Implementar los 4 handlers de browser: screenshot (navegar + captura base64), scrape_data (navegar + evaluar CSS selectors), fill_form (navegar + fill + submit), download_file (navegar + click + guardar)
**Validacion**: Crear task de screenshot manualmente en D1, el agente la ejecuta y reporta el screenshot base64 al Worker. Telegram recibe la notificacion con imagen.

### Fase 4: Handlers de Filesystem
**Objetivo**: Implementar los 4 handlers de filesystem: fs_write (crear/escribir archivo), fs_read (leer contenido), fs_list (listar directorio), fs_delete (eliminar). Resolver paths relativos (~/Desktop → ruta real del sistema).
**Validacion**: Crear task fs_write desde Telegram ("crea un archivo en el escritorio"), el agente lo crea y reporta exito.

### Fase 5: Error Handling + Background Service
**Objetivo**: Agregar manejo robusto de errores (timeout de pagina 30s, selector no existe, archivo no encontrado, network errors, retry logic). Implementar modo daemon/background para que el agente sobreviva al cerrar la terminal.
**Validacion**: Task con URL invalida → status=failed con error claro. Task con selector inexistente → falla gracefully. El agente corre en background despues de cerrar terminal.

### Fase 6: Validacion Final
**Objetivo**: Flujo end-to-end completo desde Telegram hasta resultado
**Validacion**:
- [ ] Desde Telegram: "toma screenshot de google.com" → screenshot llega como foto a Telegram
- [ ] Desde Telegram: "crea un archivo test.txt en el escritorio con Hola Mundo" → archivo aparece en Desktop
- [ ] Desde WhatsApp: "scrape el titulo de example.com" → datos llegan por WhatsApp
- [ ] `npm run typecheck` pasa (si aplica tsconfig)
- [ ] El agente se recupera de errores sin crashear
- [ ] Criterios de exito cumplidos

---

## Aprendizajes (Self-Annealing)

> Esta seccion CRECE con cada error encontrado durante la implementacion.

*(vacio — se llena durante el bucle agentico)*

---

## Gotchas

- [ ] Playwright necesita `npx playwright install chromium` la primera vez — el setup debe manejarlo
- [ ] En Windows, las rutas usan backslash pero el agent-brain envia con forward slash (~/Desktop) — normalizar
- [ ] Screenshots en base64 pueden ser muy grandes (>1MB) — considerar compresion o resize antes de enviar
- [ ] El Worker strip `screenshot_b64` del list endpoint para mantener payload ligero — el complete endpoint si lo acepta
- [ ] `fill_form` puede necesitar esperar a que la pagina cargue completamente antes de llenar — usar waitForSelector
- [ ] download_file necesita manejar el evento de descarga de Playwright (page.waitForEvent('download'))
- [ ] El config del usuario (~/.openclaw/) debe tener permisos restrictivos (600) para proteger el token

## Anti-Patrones

- NO guardar credenciales del usuario en el Worker — solo viajan en el config de cada task
- NO hacer poll mas frecuente de 3 segundos — innecesario y desperdicia requests
- NO usar `any` en TypeScript — tipar todo con interfaces claras
- NO hardcodear URLs del Worker — todo desde config
- NO ignorar errores de Playwright — siempre reportar al Worker como failed
- NO dejar el browser abierto entre tasks — cerrar contexto despues de cada ejecucion

---

*PRP pendiente aprobacion. No se ha modificado codigo.*
