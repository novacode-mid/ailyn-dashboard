# PRP-003: POST /api/settings/integrations generico + UI de integraciones en Settings

> **Estado**: PENDIENTE
> **Fecha**: 2026-04-03
> **Proyecto**: OpenClaw Asistente (Ailyn)

---

## Objetivo

Crear un endpoint generico `POST /api/settings/integrations` que permita conectar cualquier integracion (Make.com, Slack, Notion, HubSpot, Shopify) usando `saveIntegration()`, y construir la UI en la pagina de Settings para que el usuario gestione (conectar/desconectar) cada integracion desde el dashboard.

## Por Que

| Problema | Solucion |
|----------|----------|
| Cada integracion (Telegram, WhatsApp, GitHub) tiene su propio endpoint POST hardcodeado con logica duplicada | Un solo endpoint generico `POST /api/settings/integrations` que recibe `{ provider, credentials }` y reutiliza `saveIntegration()` |
| Las 5 integraciones del integrations-hub (Slack, Notion, HubSpot, Shopify, Make.com) no se pueden conectar desde la UI | Tarjetas en Settings para cada integracion con formulario de credenciales y estado conectado/desconectado |
| El GET ya existe pero no hay forma de guardar credenciales desde el frontend | POST + DELETE completan el CRUD de integraciones |

**Valor de negocio**: Desbloquea las 5 integraciones de productividad para los usuarios. Sin esto, las tools de Slack/Notion/HubSpot/Shopify/Make.com son inutilizables porque no hay forma de guardar los tokens de acceso.

## Que

### Criterios de Exito
- [ ] `POST /api/settings/integrations` acepta `{ provider, access_token, extra_data? }` y guarda via `saveIntegration()`
- [ ] `DELETE /api/settings/integrations` acepta `{ provider }` y desactiva la integracion (is_active = 0)
- [ ] La pagina de Settings muestra tarjetas para las 5 integraciones con estado conectado/desconectado
- [ ] Cada tarjeta tiene formulario con los campos necesarios segun el provider (ej: Shopify pide shop name + token)
- [ ] Conectar y desconectar funciona end-to-end desde la UI
- [ ] El GET existente sigue funcionando sin cambios

### Comportamiento Esperado

**Happy Path — Conectar Slack:**
1. Usuario va a Settings
2. Ve la tarjeta de Slack con estado "No conectado"
3. Expande la tarjeta, ve instrucciones y campo de Bot Token
4. Pega su Slack Bot Token y hace click en "Conectar"
5. El frontend hace POST a `/api/settings/integrations` con `{ provider: "slack", access_token: "xoxb-..." }`
6. El backend valida auth, llama a `saveIntegration()`, responde `{ ok: true }`
7. La tarjeta cambia a estado "Conectado"
8. Ahora las tools de Slack (enviar mensaje, listar canales) funcionan automaticamente

**Happy Path — Desconectar:**
1. Usuario ve tarjeta de Slack con estado "Conectado"
2. Hace click en "Desconectar", confirma
3. DELETE a `/api/settings/integrations` con `{ provider: "slack" }`
4. Backend pone `is_active = 0`
5. Tarjeta vuelve a estado "No conectado"

---

## Contexto

### Referencias
- `cloudflare-agent/src/integrations-hub.ts` — `saveIntegration()` y `getIntegrationToken()` ya existen
- `cloudflare-agent/src/index.ts:1297-1311` — GET /api/settings/integrations ya existe
- `cloudflare-agent/src/index.ts:1272-1295` — Patron existente de POST/DELETE para GitHub (referencia para el nuevo endpoint)
- `cloudflare-agent/migrations/0022_conversation_integrations.sql` — Schema de tabla `integrations`
- `src/app/(main)/settings/page.tsx` — Pagina actual de Settings (Telegram + WhatsApp + cuenta)

### Arquitectura Propuesta

**Backend (cloudflare-agent/src/index.ts):**
Agregar 2 endpoints junto a los existentes de settings:

```
POST   /api/settings/integrations     → saveIntegration() generico
DELETE /api/settings/integrations     → UPDATE is_active = 0
```

El POST valida:
- Auth (Bearer token, `authenticateUser()`)
- Body: `{ provider: string, access_token: string, extra_data?: Record<string, unknown> }`
- Provider debe ser uno de: `slack`, `notion`, `hubspot`, `shopify`, `make`

**Frontend (src/app/(main)/settings/page.tsx):**
Agregar seccion de "Integraciones" debajo de WhatsApp con tarjetas para cada provider.

### Modelo de Datos

La tabla `integrations` ya existe con este schema:

```sql
CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  provider TEXT NOT NULL,         -- 'slack' | 'notion' | 'hubspot' | 'shopify' | 'make'
  access_token TEXT,
  refresh_token TEXT,
  token_expiry DATETIME,
  scope TEXT,
  extra_data TEXT,                -- JSON: datos adicionales por provider
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, provider)
);
```

No se necesitan cambios en la BD.

### Campos por Provider

| Provider | access_token | extra_data necesaria |
|----------|-------------|---------------------|
| Slack | Bot OAuth Token (`xoxb-...`) | — |
| Notion | Integration Token (`secret_...`) | — |
| HubSpot | Private App Access Token | — |
| Shopify | Admin API Access Token | `{ shop: "mi-tienda" }` (shop name sin .myshopify.com) |
| Make.com | — (no usa token) | `{ webhook_url: "https://hook.make.com/..." }` |

---

## Blueprint (Assembly Line)

> IMPORTANTE: Solo definir FASES. Las subtareas se generan al entrar a cada fase.

### Fase 1: Endpoint POST + DELETE generico
**Objetivo**: Crear `POST /api/settings/integrations` y `DELETE /api/settings/integrations` en index.ts usando `saveIntegration()` de integrations-hub.ts. Validar provider, auth, y body.
**Validacion**: curl/fetch a POST con credenciales validas guarda en D1; DELETE desactiva; GET refleja el cambio.

### Fase 2: UI de integraciones en Settings
**Objetivo**: Agregar seccion de integraciones en `settings/page.tsx` con tarjetas para Slack, Notion, HubSpot, Shopify y Make.com. Cada tarjeta muestra estado (conectado/no), formulario de credenciales, y boton conectar/desconectar. Cargar estado inicial desde GET /api/settings/integrations.
**Validacion**: Las 5 tarjetas se renderizan, muestran el estado correcto, y los formularios tienen los campos correctos por provider.

### Fase 3: Validacion Final
**Objetivo**: Sistema funcionando end-to-end — conectar y desconectar integraciones desde la UI.
**Validacion**:
- [ ] POST guarda credenciales correctamente
- [ ] DELETE desactiva la integracion
- [ ] GET refleja el estado actualizado
- [ ] UI muestra estado correcto despues de conectar/desconectar
- [ ] Build sin errores de TypeScript

---

## Aprendizajes (Self-Annealing)

> Esta seccion CRECE con cada error encontrado durante la implementacion.

*(Vacio — se llena durante la implementacion)*

---

## Gotchas

- [ ] Make.com no usa access_token, usa webhook_url en extra_data — el POST debe aceptar access_token opcional cuando provider es "make"
- [ ] Shopify requiere el shop name ademas del token — guardarlo en extra_data como `{ shop: "nombre" }`
- [ ] La pagina de Settings ya es grande (~350 lineas) con Telegram + WhatsApp — considerar extraer las tarjetas de integraciones a un componente separado si supera 500 lineas
- [ ] El endpoint GitHub existente (`/api/settings/github/connect`) seguira funcionando por separado — no migrar para no romper nada

## Anti-Patrones

- NO crear endpoints separados por provider (el punto es tener uno generico)
- NO duplicar la logica de `saveIntegration()` en el endpoint
- NO hardcodear la lista de providers en el frontend — usar un array de configuracion
- NO omitir validacion del provider en el backend (whitelist de providers permitidos)
- NO guardar tokens en localStorage — solo en D1 via el endpoint

---

*PRP pendiente aprobacion. No se ha modificado codigo.*
