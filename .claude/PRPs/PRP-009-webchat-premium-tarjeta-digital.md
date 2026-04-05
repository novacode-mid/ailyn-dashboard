# PRP-009: Perfeccionar Webchat + Tarjeta Digital — Diferenciadores para salir al mercado

> **Estado**: PENDIENTE
> **Fecha**: 2026-04-03
> **Proyecto**: OpenClaw / Ailyn

---

## Objetivo

Transformar el webchat publico y la tarjeta digital (Smart Pass) en experiencias premium, profesionales y memorables que funcionen como diferenciadores de producto al salir al mercado. Un cliente potencial ve ESTO primero — tiene que vender solo.

## Por Que

| Problema | Solucion |
|----------|----------|
| Webchat publico se ve generico (dark theme basico, avatar hardcodeado "A", sin branding) | Chat premium con colores, logo y avatar configurables por empresa |
| No hay forma de embeber el chat en sitios externos sin iframe manual | Widget JS drop-in tipo Intercom/Crisp (ya existe prototipo en `ailyn-landing/public/widget.js`) |
| Pagina /wallet parece admin panel interno, no producto profesional | Rediseno completo con preview visual de tarjeta, QR, estadisticas |
| No se puede previsualizar la tarjeta antes de crearla | Preview en tiempo real mientras se llena el formulario |

**Valor de negocio**: Primera impresion del producto. Si el webchat y la tarjeta no se ven premium, ningun cliente potencial avanza al demo. Directamente impacta conversion de prospects a trials.

## Que

### Criterios de Exito
- [ ] Webchat publico muestra logo/avatar, colores y nombre de la empresa del slug (no generico "A")
- [ ] Widget embebible funciona con `<script>` tag en cualquier sitio externo (cargar, abrir, cerrar, enviar mensaje)
- [ ] Pagina /wallet tiene preview visual de tarjeta Apple Wallet con datos en tiempo real
- [ ] Tarjeta digital muestra QR de instalacion copiable/descargable
- [ ] Estadisticas basicas visibles: tarjetas creadas, instaladas, tasa de instalacion
- [ ] Build pasa sin errores (`npm run build` + `npm run typecheck`)

### Comportamiento Esperado

**Happy Path — Webchat:**
1. Cliente potencial recibe link `ailyn.app/chat/mi-empresa`
2. Ve chat con logo de "Mi Empresa", colores de marca, nombre de la empresa
3. Escribe mensaje, recibe respuesta del agente con branding correcto
4. Badge "Powered by Ailyn" discreto en el footer

**Happy Path — Widget:**
1. Empresa agrega `<script src="..." data-company="mi-empresa" data-color="#FF6600">` en su sitio
2. Aparece boton flotante con el color configurado
3. Click abre panel con chat embebido apuntando al slug correcto
4. Funciona en mobile y desktop

**Happy Path — Tarjeta Digital:**
1. Desde /wallet, empresa llena formulario (nombre, email, telefono)
2. Preview en tiempo real muestra como se vera la tarjeta en Apple Wallet
3. Click "Crear" genera tarjeta y muestra QR de instalacion + link copiable
4. Dashboard muestra metricas: X creadas, Y instaladas, Z% tasa

---

## Contexto

### Referencias
- `src/app/chat/page.tsx` — Webchat publico actual (265 lineas, dark theme, avatar "A" hardcodeado)
- `src/features/wallet-chat/components/ChatInterface.tsx` — Chat WhatsApp-like para wallet (245 lineas)
- `src/app/(main)/wallet/page.tsx` — Pagina wallet actual (374 lineas, estilo admin panel)
- `ailyn-landing/public/widget.js` — Widget embebible prototipo (128 lineas, funcional, usa iframe)
- `cloudflare-agent/src/smartpass.ts` — API SmartPasses: createPass, emailPass, notifyViaPass, getPassUrl
- `cloudflare-agent/src/smartpasses.ts` — Push notifications via SmartPasses API
- `cloudflare-agent/migrations/0003_multi_tenant.sql` — Tabla `companies` (id, name, created_at — SIN campos de branding)
- `cloudflare-agent/migrations/0010_wallet_passes.sql` — Tabla `wallet_passes` (serial_number, install_url, installed, etc.)

### Arquitectura Propuesta

**No crear nuevas features/carpetas.** Mejorar los archivos existentes:

1. **BD**: Agregar campos de branding a `companies` (logo_url, primary_color, welcome_message)
2. **Worker**: Nuevo endpoint `GET /api/company/:slug/branding` que retorna config de branding
3. **Webchat**: Refactorizar `src/app/chat/page.tsx` para consumir branding del slug
4. **Widget**: Mover widget.js al dashboard (o mantener en landing) y conectar con branding API
5. **Wallet**: Refactorizar `src/app/(main)/wallet/page.tsx` con preview visual + QR + stats

### Modelo de Datos

```sql
-- Agregar branding a companies (migracion nueva)
ALTER TABLE companies ADD COLUMN slug TEXT UNIQUE;
ALTER TABLE companies ADD COLUMN logo_url TEXT;
ALTER TABLE companies ADD COLUMN primary_color TEXT DEFAULT '#6366f1';
ALTER TABLE companies ADD COLUMN welcome_message TEXT;
ALTER TABLE companies ADD COLUMN website_url TEXT;

-- Nota: slug ya se deriva del name actualmente, pero conviene tenerlo explicito
-- para lookups rapidos en el endpoint publico de branding
```

---

## Blueprint (Assembly Line)

> IMPORTANTE: Solo definir FASES. Las subtareas se generan al entrar a cada fase
> siguiendo el bucle agentico (mapear contexto -> generar subtareas -> ejecutar)

### Fase 1: Branding API + Migracion BD
**Objetivo**: Tabla companies tiene campos de branding. Worker expone endpoint publico `GET /api/company/:slug/branding` que retorna nombre, logo, color, welcome_message.
**Validacion**: curl al endpoint retorna JSON con branding de NovaCode (seed con datos de ejemplo).

### Fase 2: Webchat Premium
**Objetivo**: `/chat/[slug]` consume la API de branding y renderiza chat con logo, colores y welcome message de la empresa. Powered-by badge de Ailyn. Markdown rendering basico en respuestas.
**Validacion**: Navegar a `/chat/novacode` muestra branding de NovaCode (logo, colores). Screenshot confirma UI premium.

### Fase 3: Widget Embebible Pulido
**Objetivo**: widget.js conecta con branding API para obtener colores/logo automaticamente (sin necesidad de data-color manual). Funciona como drop-in script. Documentacion de uso minima.
**Validacion**: Cargar widget en HTML de prueba, se abre chat con branding correcto del slug.

### Fase 4: Wallet Profesional — Preview + QR + Stats
**Objetivo**: Pagina /wallet rediseñada con: (1) preview visual de tarjeta tipo Apple Wallet en tiempo real, (2) QR code generado para cada tarjeta, (3) seccion de metricas (creadas/instaladas/tasa). Dejar de parecer admin panel.
**Validacion**: Screenshot de /wallet muestra preview de tarjeta, QR visible, metricas en cards. Build pasa.

### Fase 5: Validacion Final
**Objetivo**: Sistema funcionando end-to-end
**Validacion**:
- [ ] `npm run typecheck` pasa
- [ ] `npm run build` exitoso
- [ ] Webchat con branding correcto (screenshot)
- [ ] Widget funciona en HTML externo
- [ ] Wallet muestra preview + QR + stats (screenshot)
- [ ] Criterios de exito cumplidos

---

## Aprendizajes (Self-Annealing)

> Esta seccion CRECE con cada error encontrado durante la implementacion.

*(vacio — se llena durante implementacion)*

---

## Gotchas

- [ ] La tabla `companies` actual solo tiene `id`, `name`, `created_at` — NO tiene slug ni branding. La migracion debe ser ALTER TABLE (D1 SQLite), no recrear tabla
- [ ] D1 SQLite no soporta ALTER TABLE ADD COLUMN con constraints complejas — mantener simples los ALTERs
- [ ] El widget.js existente en `ailyn-landing/public/` apunta a `ailyn-dashboard.pages.dev` — verificar que la URL sea correcta o parametrizable
- [ ] El webchat actual usa `window.location.pathname` para extraer el slug — funciona pero es fragil en SSR
- [ ] SmartPasses API tiene rate limits — el QR code debe generarse client-side (libreria qrcode), no llamar API extra
- [ ] El chat publico NO requiere auth — el endpoint de branding tampoco debe requerir auth

## Anti-Patrones

- NO crear nuevos patrones si los existentes funcionan
- NO ignorar errores de TypeScript
- NO hardcodear valores (usar constantes)
- NO omitir validacion Zod en inputs de usuario
- NO recrear componentes que ya existen (reusar ChatInterface patterns)
- NO agregar dependencias pesadas para el preview de tarjeta (CSS puro)

---

*PRP pendiente aprobacion. No se ha modificado codigo.*
