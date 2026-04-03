# PRP-005: Robustez de Ailyn — Critico + Alto Impacto

> **Estado**: PENDIENTE
> **Fecha**: 2026-04-03
> **Proyecto**: OpenClaw Asistente (Ailyn)

---

## Objetivo

Llevar Ailyn de MVP a producto robusto implementando 8 features ordenadas por dependencia: onboarding mejorado, WhatsApp funcional, billing con Polar, tests automatizados, dashboard de desktop tasks, historial de chat, retry logic, y multi-step browser flows.

## Por Que

| Problema | Solucion |
|----------|----------|
| El onboarding actual es basico (2 pasos, no guia a conectar canales ni probar el agente) | Setup wizard de 4 pasos: negocio -> canal -> primera conversacion -> dashboard |
| WhatsApp tiene codigo backend completo pero no se puede conectar sin documentacion clara | UI en Settings ya existe, validar flujo end-to-end y agregar instrucciones paso a paso |
| La pagina de Billing dice "Proximamente disponible" — no se puede cobrar | Conectar Polar SDK (ya en package.json) con checkout, webhooks, y actualizacion de plan_slug |
| No hay tests — cualquier cambio puede romper endpoints criticos sin aviso | Tests automatizados para auth, chat, integrations, desktop-tasks |
| Las desktop tasks se ejecutan pero no hay forma de verlas en el dashboard | Pagina que muestre tareas ejecutadas, screenshots, status, errores (data ya en D1) |
| Las conversaciones solo se ven en Telegram/WhatsApp, no en el dashboard web | Pagina con historial completo desde conversation_history |
| Si un screenshot/scrape falla, la tarea se marca como failed sin reintentar | Retry logic (2 reintentos) en el Desktop Agent antes de marcar failed |
| El Agent Brain solo ejecuta acciones atomicas, no puede encadenar pasos | Multi-step flows donde cada paso depende del resultado anterior |

**Valor de negocio**: Pasar de demo a producto monetizable. Sin billing no hay revenue. Sin tests no hay confiabilidad. Sin onboarding los usuarios se pierden. Sin dashboard de tasks/chat el usuario no ve el valor.

## Que

### Criterios de Exito
- [ ] Setup wizard completo de 4 pasos con progress bar (negocio -> canal -> test conversacion -> dashboard)
- [ ] WhatsApp Business se puede conectar desde Settings y recibir/enviar mensajes end-to-end
- [ ] Checkout de Polar funciona: usuario paga -> webhook actualiza plan_slug -> limites se aplican
- [ ] Al menos 12 tests automatizados cubriendo auth, chat, integrations, desktop-tasks
- [ ] Pagina /desktop-tasks muestra tareas con status, screenshot preview, errores, filtros
- [ ] Pagina /conversations muestra historial de chat con filtros por canal y busqueda
- [ ] Desktop Agent reintenta 2 veces en screenshot/scrape antes de fallar
- [ ] Agent Brain puede generar y ejecutar secuencias de 2-5 pasos dependientes

### Comportamiento Esperado

**Onboarding**: Usuario se registra -> llega a /setup -> Paso 1: nombre + industria (existente) -> Paso 2: conectar canal (Telegram con tutorial inline O WhatsApp) -> Paso 3: enviar mensaje de prueba al bot -> Paso 4: ir al dashboard. Si omite pasos, puede completar desde Settings.

**WhatsApp**: En Settings, seccion WhatsApp Business -> ingresar Phone Number ID + Access Token + Verify Token -> click Conectar -> backend registra config -> se muestra Webhook URL para registrar en Meta -> mensajes entrantes se procesan via orchestrator igual que Telegram.

**Billing con Polar**: En /billing, click "Actualizar" en plan -> redirige a checkout de Polar -> usuario paga -> Polar envia webhook a /webhook/polar -> backend valida firma, extrae plan, actualiza plan_slug en companies -> billing_events se registra -> usuario ve plan actualizado.

**Tests**: `npm test` ejecuta suite de tests contra el worker (mock o staging). Cubren: POST /api/auth/login, POST /api/chat, GET /api/settings/integrations, GET /api/desktop/tasks, POST /api/desktop/tasks, PUT /api/desktop/tasks/:id/status.

**Desktop Tasks Dashboard**: En /desktop-tasks -> tabla con columnas: tipo, URL, status, fecha, accion. Click en fila -> modal con screenshot preview (si existe), resultado JSON, error. Filtros: pending, running, completed, failed.

**Historial Chat**: En /conversations -> lista de conversaciones agrupadas por session_id. Filtro por canal (telegram, whatsapp, webchat). Busqueda por contenido. Click en conversacion -> vista tipo chat con mensajes user/assistant.

**Retry Logic**: En executor.ts, si screenshot o scrape falla, esperar 2s y reintentar. Maximo 2 reintentos. Si todos fallan, marcar como failed con error del ultimo intento.

**Multi-step Flows**: Agent Brain detecta que una tarea requiere multiples pasos (ej: "entra a X, login con Y, descarga Z"). Genera array de actions con dependencias. El Desktop Agent ejecuta secuencialmente, pasando contexto del paso anterior al siguiente via batch_id.

---

## Contexto

### Referencias
- `src/app/setup/page.tsx` — Onboarding actual (2 pasos: negocio + canal)
- `src/app/(main)/settings/page.tsx` — Settings con Telegram, WhatsApp, integraciones
- `src/app/(main)/billing/page.tsx` — Billing page con "Proximamente disponible"
- `cloudflare-agent/src/whatsapp.ts` — WhatsApp Cloud API completo (connect, disconnect, status, webhook)
- `cloudflare-agent/src/desktop-tasks.ts` — CRUD de desktop tasks + notificaciones Telegram
- `cloudflare-agent/src/agent-brain.ts` — Evaluador de intenciones (desktop vs text_response)
- `cloudflare-agent/src/usage.ts` — Sistema de limites y usage tracking por plan
- `cloudflare-agent/src/orchestrator.ts` — Orquestador de conversaciones multi-canal
- `cloudflare-agent/migrations/0021_plans_usage.sql` — Schema de plans y usage_tracking
- `cloudflare-agent/migrations/0022_conversation_integrations.sql` — Schema de conversation_history
- `cloudflare-agent/migrations/0023_billing_events.sql` — Schema de billing_events
- `desktop-agent/src/executor.ts` — Ejecutor de tareas (sin retry logic)
- `desktop-agent/src/poller.ts` — Poll loop (sin retry)
- `package.json` — @polar-sh/sdk ^0.46.7 ya instalado

### Arquitectura Propuesta

No se crean nuevas features/ directories ya que la arquitectura es Worker (Cloudflare) + Dashboard (Next.js Pages) + Desktop Agent (Node). Los cambios van en los modulos existentes:

```
# Onboarding
src/app/setup/page.tsx                          # Ampliar de 2 a 4 pasos

# WhatsApp
cloudflare-agent/src/whatsapp.ts                # Ya funcional, validar e2e
src/app/(main)/settings/page.tsx                 # UI ya existe, mejorar instrucciones

# Billing
cloudflare-agent/src/index.ts                    # Nuevo endpoint /webhook/polar
cloudflare-agent/src/billing.ts                  # NUEVO: logica de Polar webhooks + checkout URLs
src/app/(main)/billing/page.tsx                  # Conectar checkout real con Polar

# Tests
cloudflare-agent/tests/                          # NUEVO: directorio de tests
cloudflare-agent/tests/auth.test.ts
cloudflare-agent/tests/chat.test.ts
cloudflare-agent/tests/integrations.test.ts
cloudflare-agent/tests/desktop-tasks.test.ts

# Desktop Tasks Dashboard
src/app/(main)/desktop-tasks/page.tsx            # NUEVO: pagina de tareas

# Historial Chat
src/app/(main)/conversations/page.tsx            # NUEVO: historial de conversaciones
cloudflare-agent/src/index.ts                    # Nuevo endpoint GET /api/conversations

# Retry Logic
desktop-agent/src/executor.ts                    # Agregar retry wrapper

# Multi-step Flows
cloudflare-agent/src/agent-brain.ts              # Ampliar para generar secuencias
desktop-agent/src/poller.ts                      # Ejecutar batches secuencialmente
```

### Modelo de Datos

Tablas existentes que se usan (NO se crean nuevas):
- `plans` — slug, name, price_cents, limits
- `companies` — plan_slug column
- `usage_tracking` — mensual por empresa
- `billing_events` — auditoria de pagos
- `conversation_history` — multi-canal con session_id
- `desktop_tasks` — con batch_id para multi-step
- `whatsapp_configs` — phone_number_id, access_token, verify_token

No se necesitan migraciones nuevas. Todo el schema ya existe.

---

## Blueprint (Assembly Line)

> IMPORTANTE: Solo definir FASES. Las subtareas se generan al entrar a cada fase
> siguiendo el bucle agentico (mapear contexto -> generar subtareas -> ejecutar)

### Fase 1: Onboarding Mejorado
**Objetivo**: Setup wizard de 4 pasos que guie desde crear negocio hasta primera conversacion exitosa
**Validacion**: Usuario nuevo llega a /setup, completa los 4 pasos, sale al dashboard con canal conectado y mensaje de prueba enviado

### Fase 2: WhatsApp Funcional E2E
**Objetivo**: Validar y completar el flujo completo de WhatsApp: conectar desde Settings, recibir webhook, responder con orchestrator
**Validacion**: Mensaje enviado desde WhatsApp real llega al worker, se procesa con el orchestrator, y la respuesta llega al telefono

### Fase 3: Billing con Polar
**Objetivo**: Checkout funcional donde pagar actualiza el plan y los limites se aplican inmediatamente
**Validacion**: Click "Actualizar" en /billing -> checkout Polar -> webhook recibido -> plan_slug actualizado -> /billing muestra nuevo plan

### Fase 4: Tests Automatizados
**Objetivo**: Suite de tests que cubra los endpoints criticos del worker (auth, chat, integrations, desktop-tasks)
**Validacion**: `npm test` en cloudflare-agent/ pasa 12+ tests sin errores

### Fase 5: Dashboard de Desktop Tasks
**Objetivo**: Pagina en el dashboard que muestre todas las tareas desktop con status, screenshots, errores y filtros
**Validacion**: /desktop-tasks muestra tareas reales de D1, con filtros funcionales y preview de screenshots

### Fase 6: Historial de Chat en Dashboard
**Objetivo**: Pagina con todas las conversaciones de la empresa agrupadas por sesion, con filtros por canal y busqueda
**Validacion**: /conversations muestra conversaciones reales de conversation_history con vista tipo chat

### Fase 7: Retry Logic en Desktop Agent
**Objetivo**: El Desktop Agent reintenta automaticamente tareas de screenshot/scrape que fallen, antes de marcar como failed
**Validacion**: Un scrape que falla la primera vez se reintenta 2 veces con delay. Si falla 3 veces, se marca failed con error del ultimo intento

### Fase 8: Multi-step Browser Flows
**Objetivo**: El Agent Brain genera secuencias de acciones dependientes y el Desktop Agent las ejecuta en orden, pasando contexto entre pasos
**Validacion**: Usuario pide "entra a X, haz login con Y, descarga Z" -> se crean 3 tareas con batch_id -> se ejecutan secuencialmente -> resumen LLM al final

### Fase 9: Validacion Final
**Objetivo**: Sistema funcionando end-to-end con todas las features integradas
**Validacion**:
- [ ] `npm run build` exitoso (dashboard)
- [ ] Worker desplegado sin errores
- [ ] Desktop Agent ejecuta con retry y multi-step
- [ ] Onboarding completo para usuario nuevo
- [ ] WhatsApp envia y recibe mensajes
- [ ] Checkout Polar actualiza plan
- [ ] Tests pasan en CI
- [ ] Criterios de exito cumplidos

---

## Aprendizajes (Self-Annealing)

> Esta seccion CRECE con cada error encontrado durante la implementacion.

---

## Gotchas

- [ ] Polar SDK v0.46 usa ESM — verificar compatibilidad con el worker de Cloudflare
- [ ] WhatsApp Cloud API requiere verificacion de webhook con hub.challenge ANTES de recibir mensajes
- [ ] El verify_token de WhatsApp es inventado por el usuario, debe coincidir en Meta y en Settings
- [ ] Desktop tasks con screenshot_b64 son pesadas — NO incluir en listados, solo en detalle individual
- [ ] conversation_history puede crecer rapido — paginar con LIMIT/OFFSET, no traer todo
- [ ] Multi-step flows necesitan que batch_id ya existe en desktop_tasks — no requiere migracion
- [ ] Los tests del worker necesitan mock de D1 o un entorno de staging — Miniflare es opcion
- [ ] El onboarding actual guarda setup_completed=1 en paso 1 — hay que diferir a paso 4

## Anti-Patrones

- NO crear nuevos patrones si los existentes funcionan
- NO ignorar errores de TypeScript
- NO hardcodear valores (usar constantes)
- NO omitir validacion Zod en inputs de usuario
- NO exponer Polar API keys en el frontend — todo via backend
- NO hacer polling infinito sin backoff en retry logic

---

*PRP pendiente aprobacion. No se ha modificado codigo.*
