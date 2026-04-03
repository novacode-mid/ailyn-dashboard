# PRP-001: MVP Lanzable de Ailyn

> **Estado**: PENDIENTE
> **Fecha**: 2026-04-01
> **Proyecto**: OpenClawAsistente (Ailyn)

---

## Objetivo

Completar las 4 piezas faltantes del dashboard Next.js (Dashboard funcional, Onboarding guiado, Billing con Polar, WhatsApp Business) para que Ailyn sea un producto SaaS real vendible a PyMEs en LATAM, conectado al worker de Cloudflare que ya maneja chat, emails, calendario, follow-ups, Telegram y knowledge base.

## Por Que

| Problema | Solucion |
|----------|----------|
| El dashboard esta vacio (placeholder `<h1>Dashboard</h1>`) | Construir dashboard funcional con metricas, actividad reciente, y accesos rapidos |
| El onboarding existe pero no guia al "aha moment" | Mejorar flujo post-setup con checklist progresivo que lleve a activar Telegram/WhatsApp/webchat |
| No hay forma de cobrar — los planes existen en D1 pero no hay checkout | Integrar Polar como Merchant of Record con checkout, webhooks y upgrade/downgrade |
| No hay canal WhatsApp — solo Telegram y webchat | Integrar WhatsApp Business API via Meta Cloud API con el mismo patron multi-tenant de Telegram |

**Valor de negocio**: Pasar de "proyecto interno" a "producto que genera revenue". Sin billing no hay negocio. Sin WhatsApp no hay traccion en LATAM (95% de PyMEs usan WhatsApp). Sin dashboard funcional no hay retencion. Sin onboarding guiado no hay activacion.

## Que

### Criterios de Exito
- [ ] Dashboard muestra metricas reales: mensajes hoy, leads activos, uso del plan, y actividad reciente
- [ ] Onboarding post-registro lleva al usuario a completar al menos 1 canal (Telegram o WhatsApp) en < 5 min
- [ ] Un usuario puede hacer upgrade de plan Free a Starter/Pro via checkout de Polar y el worker reconoce el nuevo plan
- [ ] Un mensaje de WhatsApp Business llega al worker, se procesa con el orchestrator, y la respuesta se envia de vuelta
- [ ] `npm run build` pasa sin errores de TypeScript
- [ ] Flujo completo end-to-end: registro → setup → dashboard → upgrade → WhatsApp funcional

### Comportamiento Esperado (Happy Path)

1. **Registro**: Usuario PyME se registra en `/signup`, crea su empresa
2. **Onboarding (Setup)**: Wizard de 4 pasos existente (empresa → agente → docs → listo) se mantiene, pero al terminar redirige a un **checklist de activacion** en el dashboard
3. **Dashboard**: Al llegar a `/dashboard` (o `/leads` que es la ruta actual post-setup), ve:
   - Card de metricas: mensajes hoy, leads este mes, uso del plan (barra de progreso)
   - Checklist de activacion: "Conecta Telegram", "Conecta WhatsApp", "Sube docs al knowledge base", "Comparte tu webchat"
   - Timeline de actividad reciente (ultimos mensajes de todos los canales)
4. **Billing**: Desde Settings o desde el dashboard (cuando alcanza limite), hace clic en "Upgrade" → Polar checkout → webhook actualiza `plan_slug` en D1 → el worker usa LLM correspondiente al plan
5. **WhatsApp**: Desde Settings → "Conectar WhatsApp" → ingresa Phone Number ID + token de Meta → el worker registra webhook → mensajes de WhatsApp se procesan igual que Telegram

---

## Contexto

### Referencias Existentes

**Worker Cloudflare (backend completo):**
- `cloudflare-agent/src/index.ts` — Router principal con 60+ endpoints
- `cloudflare-agent/src/auth.ts` — Auth con PBKDF2 + sessions en D1
- `cloudflare-agent/src/setup.ts` — Onboarding: genera system prompt + indexa docs + crea work plans
- `cloudflare-agent/src/orchestrator.ts` — Orquestador central: routing → tools → LLM → respuesta
- `cloudflare-agent/src/usage.ts` — Sistema de limites por plan (free/starter/pro/enterprise)
- `cloudflare-agent/src/telegram-multi.ts` — Patron multi-tenant para Telegram (replicar para WhatsApp)
- `cloudflare-agent/src/tool-executor.ts` — Ejecutor de herramientas (email, calendar, search, etc.)
- `cloudflare-agent/src/llm-smart-router.ts` — Router inteligente de modelos por complejidad

**Dashboard Next.js (frontend a medias):**
- `src/app/(auth)/login/page.tsx` — Login funcional
- `src/app/(auth)/signup/page.tsx` — Registro funcional
- `src/app/setup/page.tsx` — Wizard de onboarding 4 pasos (funcional)
- `src/app/(main)/dashboard/page.tsx` — **PLACEHOLDER VACIO**
- `src/app/(main)/leads/page.tsx` — Existe
- `src/app/(main)/settings/page.tsx` — Existe
- `src/app/(main)/automations/page.tsx` — Existe
- `src/shared/components/DashboardShell.tsx` — Sidebar con navegacion
- `src/shared/hooks/useAuth.ts` — Auth state en sessionStorage

**Migraciones D1 existentes:**
- `0010_auth_tables.sql` — users + sessions
- `0014_setup.sql` — setup_completed, industry, description, website en companies
- `0015_telegram_configs.sql` — Configuracion multi-tenant de Telegram
- `0021_plans_usage.sql` — plans (free/starter/pro/enterprise) + usage_tracking + plan_slug en companies

### Arquitectura Propuesta

```
cloudflare-agent/src/
├── whatsapp-multi.ts         # NUEVO: WhatsApp Business multi-tenant (patron de telegram-multi.ts)
├── billing.ts                # NUEVO: Webhooks de Polar + upgrade/downgrade
├── index.ts                  # MODIFICAR: agregar rutas WhatsApp + billing

cloudflare-agent/migrations/
├── 0023_whatsapp_configs.sql # NUEVO: tabla whatsapp_configs
├── 0024_billing_events.sql   # NUEVO: tabla billing_events (log de pagos)

src/app/(main)/
├── dashboard/page.tsx        # REESCRIBIR: metricas + checklist + actividad
├── settings/page.tsx         # MODIFICAR: agregar tabs Billing + WhatsApp

src/shared/components/
├── DashboardShell.tsx        # MODIFICAR: agregar Dashboard al nav
```

### Modelo de Datos

```sql
-- 0023: WhatsApp configs (misma estructura que telegram_configs)
CREATE TABLE IF NOT EXISTS whatsapp_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL UNIQUE,
  phone_number_id TEXT NOT NULL,
  waba_id TEXT,
  access_token TEXT NOT NULL,
  verify_token TEXT NOT NULL,
  webhook_registered INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- 0024: Billing events (log de pagos para auditing)
CREATE TABLE IF NOT EXISTS billing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,         -- 'checkout.completed', 'subscription.updated', etc.
  polar_subscription_id TEXT,
  plan_slug TEXT NOT NULL,
  amount_cents INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  raw_payload TEXT,                 -- JSON del webhook
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- Agregar a companies
ALTER TABLE companies ADD COLUMN polar_customer_id TEXT;
ALTER TABLE companies ADD COLUMN polar_subscription_id TEXT;
```

---

## Blueprint (Assembly Line)

> IMPORTANTE: Solo FASES. Las subtareas se generan al entrar a cada fase con el bucle agentico.

### Fase 1: Dashboard Funcional
**Objetivo**: Reemplazar el placeholder de `/dashboard` con un dashboard real que muestre metricas del worker, estado del plan, checklist de activacion, y actividad reciente. Agregar endpoint `/api/dashboard/summary` al worker que retorne datos consolidados.
**Validacion**: Dashboard muestra datos reales del worker. Metricas de uso coinciden con `usage_tracking`. Checklist refleja estado real (Telegram conectado si/no, docs subidos si/no).

### Fase 2: Onboarding Guiado Post-Setup
**Objetivo**: Despues del wizard de setup (que ya funciona), redirigir al dashboard con un checklist de activacion visible y persistente. Items: conectar al menos 1 canal, subir al menos 1 doc, compartir webchat. Marcar como completados conforme el usuario avanza.
**Validacion**: Nuevo usuario registrado ve checklist con 0/4 items. Al conectar Telegram, se marca automaticamente. El checklist desaparece cuando se completan todos.

### Fase 3: Billing con Polar
**Objetivo**: Integrar Polar como MoR. Crear pagina de pricing/upgrade en Settings. Implementar webhook que reciba eventos de Polar y actualice `plan_slug` + `polar_subscription_id` en D1. El usuario puede hacer upgrade y el worker lo reconoce inmediatamente.
**Validacion**: Click en "Upgrade a Starter" → Polar checkout → webhook llega → plan_slug cambia a "starter" → el orchestrator usa Anthropic en vez de Llama. Downgrade y cancelacion tambien funcionan.

### Fase 4: WhatsApp Business Integration
**Objetivo**: Replicar el patron de `telegram-multi.ts` para WhatsApp Business Cloud API. Crear `whatsapp-multi.ts` con endpoints de connect/disconnect/status y webhook receiver. Los mensajes de WhatsApp pasan por el orchestrator igual que Telegram.
**Validacion**: Configurar WhatsApp desde Settings → enviar mensaje desde WhatsApp → respuesta automatica del agente Ailyn. Historial guardado en `conversation_history`. Uso tracked en `usage_tracking`.

### Fase 5: Integracion y Validacion Final
**Objetivo**: Conectar todas las piezas. Verificar flujo end-to-end completo. Agregar "Dashboard" al nav del sidebar. Asegurar que el dashboard refleja datos de WhatsApp + Telegram + webchat. Build limpio.
**Validacion**:
- [ ] `npm run typecheck` pasa
- [ ] `npm run build` exitoso
- [ ] Flujo completo: signup → setup → dashboard (metricas) → upgrade (Polar) → WhatsApp funcional
- [ ] Criterios de exito cumplidos

---

## Aprendizajes (Self-Annealing)

> Esta seccion CRECE con cada error encontrado durante la implementacion.

---

## Gotchas

- [ ] Next.js esta en modo `output: "export"` (static) para Cloudflare Pages — NO hay API routes en el frontend; todo pasa por el worker
- [ ] CORS: el worker tiene allowlist de origins (`ailyn-dashboard.pages.dev` + localhost) — mantener sincronizado
- [ ] Auth usa sessionStorage (no cookies) — cada tab es una sesion independiente
- [ ] Los planes usan LLM providers distintos: free=cloudflare(Llama), starter/pro/enterprise=anthropic(Sonnet) — Polar webhook debe actualizar `plan_slug` para que esto se active
- [ ] WhatsApp Cloud API requiere verificacion de webhook con GET + hub.verify_token — diferente a Telegram que usa secret_token
- [ ] Polar webhooks llegan con firma HMAC — validar para seguridad
- [ ] D1 tiene migraciones numeradas secuenciales — no saltar numeros

## Anti-Patrones

- NO crear API routes en Next.js (es static export)
- NO usar `any` en TypeScript (usar `unknown`)
- NO hardcodear WORKER_URL — ya esta como constante en los archivos existentes
- NO duplicar logica del orchestrator — WhatsApp debe llamar al mismo `orchestrate()` que Telegram
- NO crear tablas sin FOREIGN KEY a companies (todo es multi-tenant)
- NO omitir rate limiting en endpoints publicos (WhatsApp webhook)

---

*PRP pendiente aprobacion. No se ha modificado codigo.*
