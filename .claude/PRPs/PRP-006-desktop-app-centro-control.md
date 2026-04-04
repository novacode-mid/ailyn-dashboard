# PRP-006: Desktop App — Centro de Control de Ailyn

> **Estado**: PENDIENTE
> **Fecha**: 2026-04-03
> **Proyecto**: OpenClaw Asistente

---

## Objetivo

Convertir el desktop-agent/ de un CLI basico (Node.js puro) a una app de escritorio con UI completa usando Electron + React, que sirva como centro de control de Ailyn: login, dashboard, chat, monitor de tareas, logs en vivo, settings y system tray.

## Por Que

| Problema | Solucion |
|----------|----------|
| El agente desktop es un CLI sin UI — solo devs pueden usarlo | App visual con login, dashboard y chat accesible para cualquier usuario |
| No hay forma de monitorear tareas en tiempo real desde desktop | Monitor con estados (pending/running/completed/failed) y screenshots |
| No hay chat desktop — solo web dashboard o Telegram/WhatsApp | Chat directo con Ailyn desde la app nativa |
| El CLI no tiene presencia visual en el sistema (no tray, no notificaciones) | System tray + notificaciones nativas cuando completa tareas |

**Valor de negocio**: La app desktop es el punto de contacto principal para usuarios power-user. Aumenta engagement diario, reduce friccion de acceso vs. abrir browser, y habilita notificaciones nativas que mantienen al usuario informado sin tener Telegram.

## Que

### Criterios de Exito
- [ ] La app se instala y abre en Windows (y opcionalmente Mac/Linux)
- [ ] Login con email/password autentica contra el Worker y persiste la sesion
- [ ] Dashboard muestra: status del agente, tareas recientes, integraciones conectadas, uso del plan
- [ ] Chat con Ailyn envia mensajes y recibe respuestas via streaming
- [ ] Monitor de Desktop Tasks muestra tareas en tiempo real con filtros por status
- [ ] Logs en vivo muestran la actividad del agente (poll, ejecucion, errores)
- [ ] Settings permite cambiar: headless on/off, poll interval, ver integraciones
- [ ] System tray funciona: minimizar a tray, restaurar, notificacion nativa al completar task
- [ ] El agente (poller + handlers) corre como background process dentro de Electron

### Comportamiento Esperado (Happy Path)

1. Usuario abre la app por primera vez → ve pantalla de Login
2. Ingresa email y password → POST /api/auth/login → recibe token + user data
3. Se guarda el token en el store local (electron-store o similar)
4. Llega al Dashboard principal: ve status "Agente activo", ultimas 5 tareas, plan usage, integraciones
5. Navega a Chat → escribe mensaje → se envia a POST /api/chat/:slug → ve respuesta en streaming
6. Navega a Monitor → ve tabla de tareas en tiempo real, puede filtrar por status, hacer click para ver detalle/screenshot
7. Ve panel de Logs → log entries aparecen en tiempo real conforme el agente ejecuta tareas
8. Va a Settings → toggle headless mode, ajusta poll interval → cambios se aplican inmediatamente
9. Cierra la ventana → app se minimiza al system tray → sigue ejecutando tareas
10. Task se completa → notificacion nativa de Windows aparece

---

## Contexto

### Referencias
- `desktop-agent/src/` — Codigo actual del agente CLI (poller, executor, handlers, api-client, config, logger)
- `desktop-agent/src/poller.ts` — Loop de polling con batch support y retry logic
- `desktop-agent/src/api-client.ts` — Cliente HTTP con auth Bearer token
- `desktop-agent/src/executor.ts` — Router de task types a handlers
- `desktop-agent/src/handlers/` — 8 handlers: screenshot, scrape, fill_form, download, fs_write/read/list/delete
- `desktop-agent/src/config.ts` — Config en ~/.openclaw/config.json (apiUrl, token, pollInterval, headless)
- `cloudflare-agent/src/desktop-tasks.ts` — API del Worker para desktop tasks (CRUD + Telegram notifications)
- `cloudflare-agent/src/auth.ts` — handleLogin, handleRegister, authenticateUser
- `cloudflare-agent/src/index.ts` — Rutas del Worker: /api/auth/login, /api/chat/:slug, /api/dashboard/summary, /api/desktop/tasks, /api/settings/integrations, /api/conversations

### API Endpoints a consumir

| Endpoint | Metodo | Uso |
|----------|--------|-----|
| `/api/auth/login` | POST | Login con email/password → token + user |
| `/api/auth/me` | GET | Verificar sesion activa |
| `/api/dashboard/summary` | GET | Plan, usage, stats para dashboard |
| `/api/desktop/tasks` | GET | Listar tareas (con filtro ?status=) |
| `/api/desktop/tasks/:id` | GET | Detalle de tarea (incluye screenshot_b64) |
| `/api/chat/:slug` | POST | Enviar mensaje al chat de Ailyn |
| `/api/settings/integrations` | GET | Listar integraciones conectadas |
| `/api/conversations` | GET | Historial de conversaciones |

### Arquitectura Propuesta

```
desktop-agent/
├── electron/                    # Electron main process
│   ├── main.ts                 # Entry point, window management, tray
│   ├── preload.ts              # Preload script (contextBridge)
│   ├── ipc-handlers.ts         # IPC handlers: agent control, config, auth
│   └── tray.ts                 # System tray setup + notifications
│
├── src/                        # React renderer (UI)
│   ├── App.tsx                 # Root con router
│   ├── pages/
│   │   ├── LoginPage.tsx       # Login form
│   │   ├── DashboardPage.tsx   # Vista resumen
│   │   ├── ChatPage.tsx        # Chat con Ailyn
│   │   ├── MonitorPage.tsx     # Monitor de tasks
│   │   ├── LogsPage.tsx        # Logs en vivo
│   │   └── SettingsPage.tsx    # Configuracion
│   ├── components/
│   │   ├── Sidebar.tsx         # Navegacion lateral
│   │   ├── TaskCard.tsx        # Card de tarea individual
│   │   ├── LogEntry.tsx        # Linea de log
│   │   ├── ChatMessage.tsx     # Mensaje de chat
│   │   └── StatusBadge.tsx     # Badge de status (pending/running/etc)
│   ├── hooks/
│   │   ├── useAuth.ts          # Auth state + login/logout
│   │   ├── useAgent.ts         # Agent status + control (start/stop)
│   │   ├── useTasks.ts         # Polling de tasks
│   │   └── useLogs.ts          # Log stream
│   ├── store/
│   │   └── app-store.ts        # Zustand store (auth, config, agent status)
│   └── lib/
│       ├── api.ts              # API client para el renderer
│       └── ipc.ts              # Typed IPC bridge
│
├── agent/                      # Agente refactorizado (se mueve de src/)
│   ├── poller.ts               # Poller existente (adaptado para IPC)
│   ├── executor.ts             # Executor existente
│   ├── api-client.ts           # API client existente
│   ├── config.ts               # Config manager
│   ├── logger.ts               # Logger que emite eventos via IPC
│   └── handlers/               # Todos los handlers existentes sin cambios
│
├── assets/                     # Iconos, tray icon
├── package.json                # Electron + React deps
├── electron-builder.yml        # Config de empaquetado
├── vite.config.ts              # Vite para el renderer
└── tsconfig.json
```

### Decisiones Clave

1. **Electron Forge o electron-builder**: Usar electron-builder por ser mas maduro para packaging cross-platform
2. **Vite para renderer**: Mas rapido que webpack, buen soporte para React + Tailwind
3. **IPC pattern**: El agente corre en main process. Emite eventos (task-started, task-completed, log) via IPC al renderer. El renderer envia comandos (start-agent, stop-agent, update-config) via IPC al main
4. **Logger refactorizado**: En vez de console.log, emite eventos que tanto la consola como el renderer pueden consumir
5. **Auth flow**: Login en renderer → token se guarda en electron-store → main process lo lee para el agente
6. **Handlers sin cambios**: Los 8 handlers existentes (screenshot, scrape, fill_form, download, fs_*) se mueven a agent/handlers/ sin modificaciones

---

## Blueprint (Assembly Line)

> IMPORTANTE: Solo definir FASES. Las subtareas se generan al entrar a cada fase
> siguiendo el bucle agentico (mapear contexto -> generar subtareas -> ejecutar)

### Fase 1: Scaffold Electron + React + Vite
**Objetivo**: Proyecto Electron funcional que abre una ventana con React renderizado por Vite. Hot reload funcionando. Tailwind configurado. Sin logica de negocio aun.
**Validacion**: `npm run dev` abre ventana de Electron con un "Hello World" de React + Tailwind estilizado.

### Fase 2: Migrar agente al main process + IPC
**Objetivo**: Mover el agente existente (poller, executor, handlers, api-client, config, logger) a electron/main process. Refactorizar logger para emitir eventos IPC. Crear preload con contextBridge. El agente se inicia/detiene via IPC desde el renderer.
**Validacion**: El agente corre dentro de Electron, el renderer puede enviar start/stop y recibir logs en tiempo real via IPC.

### Fase 3: Login + Auth + Persistencia
**Objetivo**: Pantalla de login funcional. POST a /api/auth/login. Token persistido con electron-store. Auto-login si hay token valido. Logout limpia sesion. Rutas protegidas.
**Validacion**: Login con credenciales reales contra el Worker funciona. Cerrar y reabrir la app mantiene sesion.

### Fase 4: Dashboard principal
**Objetivo**: Vista resumen con: status del agente (activo/inactivo), ultimas tareas, integraciones conectadas, uso del plan. Consume /api/dashboard/summary y /api/settings/integrations.
**Validacion**: Dashboard muestra datos reales del Worker. Sidebar de navegacion funciona entre todas las paginas.

### Fase 5: Chat con Ailyn
**Objetivo**: Chat funcional que envia mensajes a /api/chat/:slug y muestra respuestas. Historial de conversacion. Input con Enter para enviar.
**Validacion**: Enviar mensaje y recibir respuesta de Ailyn funcionando end-to-end.

### Fase 6: Monitor de Desktop Tasks
**Objetivo**: Tabla/lista de tareas con filtros por status (all, pending, running, completed, failed). Click en tarea muestra detalle con screenshot si hay. Auto-refresh cada poll interval.
**Validacion**: Crear tarea desde otro canal (Telegram/web), verla aparecer en el monitor, ver su progreso y resultado.

### Fase 7: Logs en vivo
**Objetivo**: Panel que muestra los eventos del agente en tiempo real: poll, task picked up, execution start/end, errors. Scroll automatico. Filtro por nivel (info, warn, error).
**Validacion**: Iniciar el agente, ver logs aparecer en tiempo real. Si una task falla, ver el error en rojo.

### Fase 8: Settings
**Objetivo**: Pagina de configuracion: toggle headless on/off, slider/input para poll interval, lista de integraciones (read-only por ahora), boton de logout. Los cambios se aplican al agente en tiempo real via IPC.
**Validacion**: Cambiar headless mode, verificar que el agente respeta el cambio en la proxima task.

### Fase 9: System Tray + Notificaciones nativas
**Objetivo**: Minimizar a system tray al cerrar ventana. Icono en tray con menu (Open, Status, Quit). Notificaciones nativas de Windows cuando una task se completa o falla.
**Validacion**: Cerrar ventana -> icono aparece en tray. Task se completa -> notificacion de Windows aparece. Click en tray icon -> ventana se restaura.

### Fase 10: Packaging + Validacion Final
**Objetivo**: Configurar electron-builder para generar instalador de Windows (.exe). Build de produccion. Verificar que todo funciona empaquetado.
**Validacion**:
- [ ] `npm run build` exitoso
- [ ] Instalador .exe se genera
- [ ] App instalada funciona: login, dashboard, chat, monitor, logs, settings, tray
- [ ] Criterios de exito cumplidos

---

## Aprendizajes (Self-Annealing)

> Esta seccion CRECE con cada error encontrado durante la implementacion.

_(Vacio — se llena durante la implementacion)_

---

## Gotchas

- [ ] Playwright en Electron: el browser de Playwright es independiente del renderer de Electron. No hay conflicto, pero hay que asegurar que `chromium.launch()` funcione dentro del contexto de Electron main process
- [ ] electron-builder y Playwright: los binarios de Playwright (chromium) pesan ~200MB. Hay que configurar asar unpack o external binaries para que no se empaqueten dentro del asar
- [ ] IPC security: usar contextBridge + preload para no exponer `ipcRenderer` directamente al renderer. Nunca `nodeIntegration: true`
- [ ] Hot reload en Electron + Vite: necesita configuracion especial (vite-plugin-electron o similar)
- [ ] Windows code signing: sin firma, Windows SmartScreen bloqueara la instalacion. Considerar firma para distribucion
- [ ] Token storage: electron-store usa el filesystem del usuario. En Windows, se guarda en AppData. Asegurar que la ruta exista
- [ ] Chat streaming: el endpoint /api/chat/:slug puede devolver streaming (SSE/ReadableStream). El renderer debe manejar fetch con ReadableStream o EventSource

## Anti-Patrones

- NO poner logica de negocio (polling, tasks) en el renderer process
- NO usar `nodeIntegration: true` en el renderer
- NO empaquetar los binarios de Playwright dentro del asar
- NO hacer polling desde el renderer — todo va por IPC desde el main process
- NO duplicar el api-client en renderer y main — el renderer pide al main via IPC, o usa su propio client ligero solo para UI data
- NO hardcodear URLs del Worker — reutilizar config existente

---

*PRP pendiente aprobacion. No se ha modificado codigo.*
