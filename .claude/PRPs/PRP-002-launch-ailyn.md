# PRP-002: Launch de Ailyn — Deploy + Landing + Onboarding Simplificado

> **Estado**: PENDIENTE
> **Fecha**: 2026-04-01
> **Proyecto**: OpenClawAsistente (Ailyn)

---

## Objetivo

Llevar Ailyn de "proyecto funcional en local" a "producto publicado y accesible": deploy del dashboard Next.js en Cloudflare Pages, landing page profesional en Astro (ailynlabs.com) con scroll animations y CTAs a signup, y onboarding simplificado para que una PyME active Ailyn en 5 minutos sin conocimiento tecnico.

## Por Que

| Problema | Solucion |
|----------|----------|
| El dashboard compila (`output: 'export'`) pero no esta publicado — nadie puede usarlo | Deploy a Cloudflare Pages con dominio propio, accesible 24/7 |
| No existe pagina publica que explique que es Ailyn ni como empezar | Landing page en Astro con features, pricing, testimonios y CTAs directos a signup |
| El setup wizard actual tiene 4 pasos tecnicos (empresa, agente, documentos) que intimidan a una PyME no-tecnica | Onboarding simplificado: menos pasos, defaults inteligentes, guia contextual, activacion en 5 min |

**Valor de negocio**: Sin deploy no hay producto. Sin landing no hay adquisicion. Sin onboarding simple no hay activacion. Estas 3 piezas son el embudo completo: descubrir Ailyn (landing) → registrarse (signup) → activar (onboarding) → usar (dashboard).

## Que

### Criterios de Exito
- [ ] Dashboard accesible en `https://ailyn-dashboard.pages.dev` (o dominio custom) con login funcional
- [ ] Landing page en `https://ailynlabs.com` con score Lighthouse > 90 en performance
- [ ] Landing tiene secciones: hero, features, pricing (3 planes), testimonios/social proof, CTA a signup
- [ ] Scroll animations fluidas (no scroll-jacking, respetan `prefers-reduced-motion`)
- [ ] Un usuario nuevo completa onboarding en < 5 minutos (medido: desde registro hasta primer mensaje de prueba)
- [ ] Onboarding tiene max 2 pasos obligatorios (nombre empresa + conectar canal), el resto son defaults inteligentes
- [ ] Build de Next.js pasa en CI de Cloudflare Pages sin errores
- [ ] Build de Astro pasa y se despliega correctamente

### Comportamiento Esperado (Happy Path)

1. Usuario llega a `ailynlabs.com` desde busqueda/referido/red social
2. Ve hero con propuesta de valor clara, scrollea por features y pricing
3. Hace clic en "Empezar gratis" → redirige a `ailyn-dashboard.pages.dev/signup`
4. Se registra con email/password
5. Entra a onboarding simplificado:
   - **Paso 1**: Nombre de la empresa + industria (dropdown con deteccion automatica)
   - **Paso 2**: Conectar primer canal (Telegram/WhatsApp/Webchat) con guia visual paso a paso
   - Defaults inteligentes: tono=Amigable, idioma=Espanol, nombre agente="Asistente de {empresa}"
6. Ailyn esta activa. Usuario ve dashboard con checklist de "proximos pasos" opcionales

---

## Contexto

### Referencias
- `next.config.ts` — Ya configurado con `output: 'export'`, `trailingSlash: true`, `images: { unoptimized: true }`
- `public/_redirects` — Reglas SPA para Cloudflare Pages (`/wallet-chat/*`, `/chat/*`)
- `cloudflare-agent/wrangler.toml` — Worker backend en `ailyn-agent.novacodepro.workers.dev`
- `src/app/setup/page.tsx` — Setup wizard actual (4 pasos: Empresa, Agente, Documentos, Listo)
- `src/app/(auth)/login/page.tsx`, `signup/page.tsx`, `register/` — Auth pages existentes
- `src/app/(main)/` — Dashboard con rutas: admin, automations, billing, dashboard, knowledge, leads, settings, wallet, wallet-chat
- `src/shared/hooks/useAuth.ts` — Hook de auth con `getUser()`, `saveAuth()`, `getToken()`
- `cloudflare-agent/src/setup.ts` — Endpoint `/api/setup/complete` en el worker

### Arquitectura Propuesta

```
Fase 1 — Deploy Dashboard (Cloudflare Pages)
├── Proyecto: cloudflare-agent/  (ya existe como Pages project "ailyn-dashboard")
├── Build: npm run build → out/
├── Deploy: wrangler pages deploy out/ --project-name ailyn-dashboard
├── _redirects para SPA routing
└── Variables de entorno en Cloudflare dashboard

Fase 2 — Landing Page (nuevo repo o carpeta)
landing/                          # Astro project
├── src/
│   ├── layouts/
│   │   └── BaseLayout.astro     # HTML base + meta tags + fonts
│   ├── pages/
│   │   └── index.astro          # Landing principal
│   ├── components/
│   │   ├── Hero.astro           # Hero section con CTA
│   │   ├── Features.astro       # Grid de features con iconos
│   │   ├── HowItWorks.astro     # 3 pasos visuales
│   │   ├── Pricing.astro        # 3 planes (Free/Starter/Pro)
│   │   ├── Testimonials.astro   # Social proof
│   │   ├── CTA.astro            # CTA final
│   │   └── Footer.astro
│   └── styles/
│       └── global.css           # Tailwind + custom animations
├── astro.config.mjs
├── tailwind.config.mjs
└── package.json

Fase 3 — Onboarding Simplificado
├── src/app/setup/page.tsx       # Refactor: 2 pasos obligatorios
├── cloudflare-agent/src/setup.ts # Endpoint acepta payload minimo
└── src/app/(main)/dashboard/    # Checklist post-onboarding
```

### Modelo de Datos

No requiere nuevas tablas. El setup actual ya guarda en D1 via `/api/setup/complete`. Solo se simplifica el payload minimo requerido (company_name + industry obligatorios, resto opcional con defaults).

---

## Blueprint (Assembly Line)

> IMPORTANTE: Solo FASES. Las subtareas se generan al entrar a cada fase con el bucle agentico.

### Fase 1: Deploy Dashboard a Cloudflare Pages
**Objetivo**: Dashboard Next.js publicado y accesible en internet con auth funcional conectada al worker backend.
**Validacion**:
- [ ] `npm run build` exitoso en local
- [ ] `wrangler pages deploy out/` exitoso
- [ ] `https://ailyn-dashboard.pages.dev` carga la pagina de login
- [ ] Login con credenciales existentes funciona y redirige al dashboard
- [ ] `_redirects` maneja correctamente las rutas SPA (no 404 en refresh)
- [ ] Variables de entorno (WORKER_URL) configuradas en Cloudflare Pages

### Fase 2: Landing Page con Astro
**Objetivo**: Landing page profesional con copy de alta conversion, scroll animations, pricing y CTAs que redirijan a signup del dashboard.
**Validacion**:
- [ ] Proyecto Astro + Tailwind compila sin errores
- [ ] Hero section con propuesta de valor clara y CTA "Empezar gratis"
- [ ] Features section con 6+ features de Ailyn (chat IA, multichannel, leads, knowledge base, automations, analytics)
- [ ] Pricing section con 3 planes alineados al billing existente
- [ ] Scroll animations CSS-native (IntersectionObserver, no libreria pesada)
- [ ] Responsive: mobile-first, se ve bien en 375px-1440px
- [ ] Lighthouse performance > 90
- [ ] CTAs apuntan a `https://ailyn-dashboard.pages.dev/signup`
- [ ] Deploy en Cloudflare Pages o dominio ailynlabs.com

### Fase 3: Onboarding Simplificado
**Objetivo**: Reducir el setup wizard de 4 pasos a 2 obligatorios + defaults inteligentes, para que una PyME active Ailyn en 5 minutos.
**Validacion**:
- [ ] Setup wizard tiene solo 2 pasos obligatorios: (1) Empresa + industria, (2) Conectar canal
- [ ] Defaults inteligentes aplicados automaticamente: tono=Amigable, idioma=Espanol, nombre agente=auto-generado
- [ ] Worker acepta payload minimo (company_name + industry) y rellena defaults server-side
- [ ] Documentos son opcionales (se pueden agregar despues desde Knowledge)
- [ ] Post-onboarding: dashboard muestra checklist de "proximos pasos" (agregar docs, personalizar agente, invitar equipo)
- [ ] Flujo completo registro→onboarding→dashboard en < 5 minutos
- [ ] `npm run build` exitoso con los cambios

### Fase 4: Validacion Final
**Objetivo**: Sistema completo funcionando end-to-end: landing → signup → onboarding → dashboard.
**Validacion**:
- [ ] `npm run build` pasa sin errores
- [ ] Landing page carga y CTAs redirigen correctamente al signup
- [ ] Registro nuevo usuario → onboarding simplificado → dashboard funcional
- [ ] Dashboard desplegado con todas las rutas funcionando (no 404)
- [ ] Worker backend responde correctamente desde el dashboard desplegado
- [ ] Criterios de exito del PRP cumplidos

---

## Aprendizajes (Self-Annealing)

> Esta seccion CRECE con cada error encontrado durante la implementacion.

_(Vacio — se llena durante la ejecucion)_

---

## Gotchas

- [ ] Next.js static export no soporta API routes ni middleware — toda la logica server esta en el Cloudflare Worker
- [ ] `_redirects` de Cloudflare Pages necesita cubrir TODAS las rutas SPA, no solo las actuales (wallet-chat, chat) — agregar wildcard `/* /index.html 200`
- [ ] CORS: el dashboard en `ailyn-dashboard.pages.dev` hace fetch al worker en `ailyn-agent.novacodepro.workers.dev` — verificar headers CORS en el worker
- [ ] Astro con Tailwind requiere `@astrojs/tailwind` integration — no instalar Tailwind manual
- [ ] Las scroll animations deben respetar `prefers-reduced-motion: reduce` para accesibilidad
- [ ] El setup actual hardcodea `WORKER_URL` y `DASHBOARD_URL` en el componente — mover a env vars o config
- [ ] Cloudflare Pages tiene limite de 20,000 archivos y 25 MiB por archivo en el build output

## Anti-Patrones

- NO crear un backend en Astro — la landing es 100% estatica, los datos estan en el worker
- NO duplicar logica de auth en la landing — la landing solo tiene links al dashboard
- NO agregar frameworks de animacion pesados (GSAP, Framer Motion) en la landing — CSS animations + IntersectionObserver
- NO romper el setup wizard existente sin verificar que el worker endpoint sigue compatible
- NO hardcodear URLs de produccion en el codigo — usar variables de entorno/config

---

*PRP pendiente aprobacion. No se ha modificado codigo.*
