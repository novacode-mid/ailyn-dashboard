"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getUser } from "@/shared/hooks/useAuth";

/* ─── Particle data (generated once, outside component) ─────────────────── */
const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id:       i,
  left:     `${(i * 5.73 + 3) % 93}%`,
  size:     2 + (i % 3),
  dur:      `${18 + (i * 2.13) % 14}s`,
  delay:    `-${(i * 1.87) % 16}s`,
  drift:    `${-20 + (i * 7.3) % 40}px`,
  color:    i % 3 === 0 ? "rgba(168,85,247,0.8)"
          : i % 3 === 1 ? "rgba(236,72,153,0.7)"
          :               "rgba(96,165,250,0.7)",
}));

/* ─── Custom CSS injected once ───────────────────────────────────────────── */
const CSS = `
/* Shimmer gradient text */
@keyframes shimmer {
  0%   { background-position: 0% center; }
  100% { background-position: 200% center; }
}
.txt-shimmer {
  background: linear-gradient(90deg, #a855f7, #ec4899, #60a5fa, #a855f7);
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: shimmer 3s linear infinite;
}

/* Mesh orb movement */
@keyframes orb1 {
  0%,100% { transform: translate(0,0)   scale(1);    }
  25%     { transform: translate(110px,-80px)  scale(1.15); }
  50%     { transform: translate(40px,130px)  scale(0.88); }
  75%     { transform: translate(-90px,60px)  scale(1.08); }
}
@keyframes orb2 {
  0%,100% { transform: translate(0,0)   scale(1);    }
  33%     { transform: translate(-120px,100px) scale(1.12); }
  66%     { transform: translate(100px,-100px) scale(0.92); }
}
@keyframes orb3 {
  0%,100% { transform: translate(0,0)   scale(1);    }
  40%     { transform: translate(90px,110px)  scale(1.2);  }
  80%     { transform: translate(-70px,-80px) scale(0.85); }
}
@keyframes orb4 {
  0%,100% { transform: translate(0,0)   scale(1);    }
  35%     { transform: translate(-90px,-100px) scale(1.1); }
  70%     { transform: translate(70px,80px)  scale(0.9);  }
}

/* Aurora hero pulse */
@keyframes aurora {
  0%,100% { opacity:.6; transform:scale(1);    }
  50%     { opacity:1;  transform:scale(1.06); }
}
.aurora { animation: aurora 6s ease-in-out infinite; }

/* Floating particles */
@keyframes floatUp {
  0%   { transform: translateY(100vh) translateX(0); opacity:0; }
  8%   { opacity:.4; }
  92%  { opacity:.25; }
  100% { transform: translateY(-12vh) translateX(var(--pdrift,20px)); opacity:0; }
}

/* CTA pulse ring */
@keyframes ctaPing {
  0%       { transform:scale(1);    opacity:.5; }
  70%,100% { transform:scale(1.75); opacity:0;  }
}
.cta-ring {
  position:absolute; inset:0; border-radius:16px;
  background: linear-gradient(135deg,#a855f7,#ec4899);
  animation: ctaPing 2.2s ease-out infinite;
  pointer-events:none;
}

/* Card hover glow */
.g-card { transition: transform .3s ease, box-shadow .3s ease; }
.g-card:hover {
  transform: translateY(-4px) scale(1.015);
  box-shadow:
    0 0 0 1px rgba(168,85,247,.4),
    0 20px 60px -15px rgba(168,85,247,.28),
    0  0  50px -12px rgba(236,72,153,.18);
}

/* Timeline time labels live blink */
@keyframes liveBlink {
  0%,100% { opacity:1; }
  50%     { opacity:.35; }
}
.t-live { animation: liveBlink 2.4s ease-in-out infinite; }

/* Mouse spotlight */
.mlight {
  position:fixed; pointer-events:none;
  width:700px; height:700px; border-radius:50%;
  background: radial-gradient(circle, rgba(168,85,247,.14) 0%, transparent 65%);
  transform: translate(-50%,-50%);
  left: var(--mx,-9999px);
  top:  var(--my,-9999px);
  z-index:4;
  transition: left .07s linear, top .07s linear;
}
`;

/* ─── Reusable glass card ─────────────────────────────────────────────────── */
function GCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`g-card relative bg-gradient-to-br from-white/15 to-white/5 backdrop-blur-xl
      border border-white/20 rounded-3xl shadow-2xl overflow-hidden ${className}`}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
      {children}
    </div>
  );
}

/* ─── Section gradient divider ───────────────────────────────────────────── */
function SDivider() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-1">
      <div style={{ height: "1px", background: "linear-gradient(90deg,transparent,rgba(168,85,247,.35),rgba(236,72,153,.25),transparent)" }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  /* Parallax refs */
  const o1 = useRef<HTMLDivElement>(null);
  const o2 = useRef<HTMLDivElement>(null);
  const o3 = useRef<HTMLDivElement>(null);
  const o4 = useRef<HTMLDivElement>(null);

  /* Auth guard */
  useEffect(() => {
    if (getUser()) router.replace("/leads");
    else setReady(true);
  }, [router]);

  /* Mouse spotlight → CSS custom properties on :root */
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      document.documentElement.style.setProperty("--mx", `${e.clientX}px`);
      document.documentElement.style.setProperty("--my", `${e.clientY}px`);
    };
    window.addEventListener("mousemove", fn);
    return () => window.removeEventListener("mousemove", fn);
  }, []);

  /* Parallax scroll — orbs move slower than page */
  useEffect(() => {
    const fn = () => {
      const y = window.scrollY;
      o1.current && (o1.current.style.transform = `translateY(${y * 0.22}px)`);
      o2.current && (o2.current.style.transform = `translateY(${y * 0.13}px)`);
      o3.current && (o3.current.style.transform = `translateY(${y * 0.28}px)`);
      o4.current && (o4.current.style.transform = `translateY(${y * 0.17}px)`);
    };
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  if (!ready) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ══════════════════════════════════════════════════════════════
          BACKGROUND LAYER — fully isolated fixed container
          (Keeps fixed children free from any parent overflow clipping)
      ══════════════════════════════════════════════════════════════ */}
      <div
        aria-hidden
        style={{
          position: "fixed", inset: 0, zIndex: 0,
          overflow: "hidden", pointerEvents: "none",
          background: "rgb(2 6 23)",           /* slate-950 */
        }}
      >
        {/* Mouse spotlight */}
        <div className="mlight" />

        {/* Fine tech grid */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M 60 0 L 0 0 0 60' fill='none' stroke='%23ffffff' stroke-width='0.4'/%3E%3C/svg%3E")`,
          opacity: .04,
        }} />

        {/* Perspective grid horizon */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: "260px", overflow: "hidden",
        }}>
          <div style={{
            width: "100%", height: "100%",
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='80' height='80' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='80' height='80' fill='none' stroke='%23a855f7' stroke-width='0.7'/%3E%3C/svg%3E")`,
            opacity: .07,
            transform: "perspective(300px) rotateX(40deg)",
            transformOrigin: "bottom center",
          }} />
        </div>

        {/* ── ANIMATED MESH ORBS (solid color + heavy blur = clean glow) ── */}
        <div ref={o1} style={{
          position: "absolute", top: "-120px", left: "-100px",
          width: "650px", height: "650px", borderRadius: "50%",
          background: "rgba(147, 51, 234, 0.55)",   /* purple-600 */
          filter: "blur(100px)",
          animation: "orb1 28s ease-in-out infinite",
        }} />
        <div ref={o2} style={{
          position: "absolute", top: "10%", right: "-150px",
          width: "600px", height: "600px", borderRadius: "50%",
          background: "rgba(219, 39, 119, 0.45)",   /* pink-600 */
          filter: "blur(110px)",
          animation: "orb2 35s ease-in-out infinite",
        }} />
        <div ref={o3} style={{
          position: "absolute", bottom: "-120px", left: "10%",
          width: "580px", height: "580px", borderRadius: "50%",
          background: "rgba(37, 99, 235, 0.45)",    /* blue-600 */
          filter: "blur(100px)",
          animation: "orb3 25s ease-in-out infinite",
        }} />
        <div ref={o4} style={{
          position: "absolute", top: "50%", left: "38%",
          width: "420px", height: "420px", borderRadius: "50%",
          background: "rgba(6, 182, 212, 0.30)",    /* cyan-500 */
          filter: "blur(120px)",
          animation: "orb4 32s ease-in-out infinite",
        }} />

        {/* ── FLOATING PARTICLES ── */}
        {PARTICLES.map((p) => (
          <div key={p.id} style={{
            position: "absolute",
            left: p.left, bottom: "-10px",
            width:  `${p.size}px`,
            height: `${p.size}px`,
            borderRadius: "50%",
            background: p.color,
            filter: p.id % 4 === 0 ? "blur(1px)" : "none",
            ["--pdrift" as string]: p.drift,
            animationName: "floatUp",
            animationDuration: p.dur,
            animationDelay: p.delay,
            animationTimingFunction: "linear",
            animationIterationCount: "infinite",
          }} />
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          CONTENT LAYER — sits above background
      ══════════════════════════════════════════════════════════════ */}
      <div className="relative min-h-screen text-white" style={{ zIndex: 10 }}>

        {/* ── NAVBAR ──────────────────────────────────────────────── */}
        <nav className="fixed top-0 inset-x-0 bg-black/25 backdrop-blur-xl border-b border-white/10" style={{ zIndex: 50 }}>
          <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
                <span className="text-white font-bold text-xs">A</span>
              </div>
              <span className="font-semibold text-white text-lg tracking-tight">Ailyn</span>
            </div>

            <div className="hidden md:flex items-center gap-8 text-sm text-white/60">
              <a href="#features" className="hover:text-white transition-colors">Funciones</a>
              <a href="#how"      className="hover:text-white transition-colors">Cómo funciona</a>
              <a href="#pricing"  className="hover:text-white transition-colors">Precios</a>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <Link href="/login" className="text-xs sm:text-sm text-white/60 hover:text-white transition-colors px-2 sm:px-3 py-2">
                Entrar
              </Link>
              <Link href="/signup"
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600
                  rounded-xl px-3 sm:px-5 py-2 text-xs sm:text-sm text-white font-semibold
                  shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40
                  transition-all duration-300 hover:scale-105"
              >
                Crear cuenta
              </Link>
            </div>
          </div>
        </nav>

        {/* ── HERO ────────────────────────────────────────────────── */}
        <section className="relative pt-28 sm:pt-44 pb-16 sm:pb-32 px-4 sm:px-6 text-center overflow-hidden">
          <div className="aurora absolute inset-x-0 top-20 h-80 bg-gradient-to-r from-purple-500/25 via-pink-500/15 to-cyan-500/20 blur-3xl pointer-events-none" />

          <div className="relative mx-auto max-w-4xl">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 text-white/80 text-xs font-semibold px-4 py-2 rounded-full mb-10">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              Agente de ventas autónomo con IA
            </div>

            <h1 className="text-5xl md:text-7xl font-bold leading-[1.1] tracking-tight mb-6">
              Tu equipo de ventas
              <br />
              <span className="txt-shimmer">trabaja mientras duermes</span>
            </h1>

            <p className="text-xl text-white/50 max-w-2xl mx-auto mb-12 leading-relaxed">
              Ailyn investiga prospectos, envía seguimientos, responde preguntas
              y genera reportes — todo de forma autónoma. Sin contratar, sin entrenar.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
              <div className="relative">
                <span className="cta-ring" />
                <Link href="/signup"
                  className="relative inline-block bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600
                    rounded-2xl px-8 py-4 text-white font-semibold text-lg
                    shadow-xl shadow-purple-500/30 hover:shadow-2xl hover:shadow-purple-500/40
                    transition-all duration-300 hover:scale-105"
                >
                  Empezar gratis →
                </Link>
              </div>
              <a href="#how"
                className="bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 rounded-2xl px-8 py-4 text-white font-medium text-lg transition-all duration-300"
              >
                Ver cómo funciona
              </a>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg mx-auto">
              {[
                { v: "4.2x", l: "más leads calificados" },
                { v: "24/7", l: "operación autónoma" },
                { v: "85%",  l: "menos trabajo manual" },
              ].map((s) => (
                <GCard key={s.l} className="p-5 text-center">
                  <div className="text-3xl font-bold">{s.v}</div>
                  <div className="text-xs text-white/40 mt-1">{s.l}</div>
                </GCard>
              ))}
            </div>
          </div>
        </section>

        <SDivider />

        {/* ── PROBLEMA ────────────────────────────────────────────── */}
        <section className="py-24 md:py-32 px-6">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">¿Qué pasa sin Ailyn?</h2>
              <p className="text-white/40 text-lg">Los equipos de ventas pierden tiempo y oportunidades todos los días</p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { icon: "⏰", t: "Horas perdidas investigando", d: "Tu equipo gasta 3–4h diarias buscando información de prospectos manualmente antes de poder hacer una sola llamada." },
                { icon: "🕳️", t: "Leads que se enfrían",        d: "El 78% de los compradores elige al proveedor que responde primero. Sin automatización, siempre llegas tarde." },
                { icon: "📊", t: "Sin visibilidad del pipeline", d: "Sin reportes automáticos, nadie sabe qué prospectos están listos, cuáles necesitan seguimiento y cuáles se perdieron." },
              ].map((p) => (
                <GCard key={p.t} className="p-7">
                  <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 to-transparent pointer-events-none" />
                  <div className="text-4xl mb-4">{p.icon}</div>
                  <h3 className="font-semibold text-white text-lg mb-2">{p.t}</h3>
                  <p className="text-sm text-white/50 leading-relaxed">{p.d}</p>
                </GCard>
              ))}
            </div>
          </div>
        </section>

        <SDivider />

        {/* ── CÓMO FUNCIONA ───────────────────────────────────────── */}
        <section id="how" className="py-24 md:py-32 px-6">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">Cómo funciona</h2>
              <p className="text-white/40 text-lg">Configura una vez, déjalo operar solo</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { n: "01", t: "Define tus objetivos", d: "Cuéntale a Ailyn sobre tu empresa, industria y el perfil de cliente ideal. El wizard de configuración tarda 5 minutos." },
                { n: "02", t: "Ailyn entra en acción",  d: "El agente investiga prospectos, analiza su fit, califica leads y programa seguimientos automáticos." },
                { n: "03", t: "Tú cierras negocios",    d: "Recibes reportes con leads calificados, contexto de cada empresa y el próximo paso recomendado. Solo cierra." },
              ].map((s) => (
                <GCard key={s.n} className="p-7">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/30 to-pink-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300 font-bold text-sm mb-5">
                    {s.n}
                  </div>
                  <h3 className="font-semibold text-white text-lg mb-2">{s.t}</h3>
                  <p className="text-sm text-white/50 leading-relaxed">{s.d}</p>
                </GCard>
              ))}
            </div>
          </div>
        </section>

        <SDivider />

        {/* ── FEATURES ────────────────────────────────────────────── */}
        <section id="features" className="py-24 md:py-32 px-6">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">Todo lo que necesitas</h2>
              <p className="text-white/40 text-lg">Un agente completo, no una herramienta puntual</p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { icon: "🔍", t: "Investigación de prospectos", d: "Analiza empresas: tamaño, tecnología, noticias recientes, señales de compra y score de fit." },
                { icon: "📬", t: "Seguimiento automático",      d: "Envía mensajes personalizados en el momento correcto basados en el comportamiento del prospecto." },
                { icon: "💬", t: "Chat en tu sitio web",        d: "Widget con IA entrenada con tu base de conocimiento. Responde 24/7 y captura leads." },
                { icon: "📋", t: "Planes de trabajo autónomos", d: "Define tareas recurrentes: prospección nocturna, reportes semanales, refreshes de conocimiento." },
                { icon: "📊", t: "Reportes automáticos",        d: "Recibe por Telegram o email un resumen de leads, oportunidades y métricas sin hacer nada." },
                { icon: "🤖", t: "Agente por Telegram",         d: "Controla a Ailyn desde Telegram: pide investigaciones, consulta leads, dispara acciones." },
              ].map((f) => (
                <GCard key={f.t} className="p-7">
                  <div className="text-4xl mb-4">{f.icon}</div>
                  <h3 className="font-semibold text-white text-lg mb-2">{f.t}</h3>
                  <p className="text-sm text-white/50 leading-relaxed">{f.d}</p>
                </GCard>
              ))}
            </div>
          </div>
        </section>

        <SDivider />

        {/* ── AUTONOMÍA TIMELINE ──────────────────────────────────── */}
        <section className="py-24 md:py-32 px-6">
          <div className="mx-auto max-w-3xl">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">
                Mientras tú descansas,
                <br />
                <span className="txt-shimmer">Ailyn trabaja</span>
              </h2>
              <p className="text-white/40 text-lg">Un día típico de tu agente autónomo</p>
            </div>

            <GCard className="p-8 md:p-10">
              <div className="relative">
                <div className="absolute left-[94px] top-3 bottom-3 w-px bg-gradient-to-b from-purple-500/60 via-pink-400/40 to-blue-500/50" />
                <div className="space-y-7">
                  {[
                    { time: "02:00 AM", icon: "🔍", ev: "Prospección nocturna",         d: "Investiga 5 empresas objetivo, califica su fit y prepara briefings" },
                    { time: "08:00 AM", icon: "📊", ev: "Reporte matutino",              d: "Envía resumen semanal con oportunidades calificadas vía Telegram" },
                    { time: "09:30 AM", icon: "📬", ev: "Follow-up automático",          d: "Identifica leads sin respuesta en 48h y programa mensajes de seguimiento" },
                    { time: "Todo el día",icon:"💬", ev: "Chat activo",                  d: "Responde preguntas de visitantes en tu sitio web con contexto de tu empresa" },
                    { time: "11:00 PM", icon: "🧠", ev: "Actualización de conocimiento", d: "Indexa nuevos documentos y actualiza la base de conocimiento del agente" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-5">
                      <div className="w-[78px] shrink-0 text-right pt-2.5">
                        <span className="t-live text-[11px] text-purple-300 font-mono">{item.time}</span>
                      </div>
                      <div className="relative shrink-0 mt-2.5 z-10">
                        <div className="w-3 h-3 rounded-full bg-gradient-to-br from-purple-400 to-pink-400"
                          style={{ boxShadow: "0 0 8px 3px rgba(168,85,247,.55), 0 0 20px 6px rgba(168,85,247,.2)" }} />
                      </div>
                      <div className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl px-5 py-4 transition-colors">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl">{item.icon}</span>
                          <span className="font-semibold text-white text-sm">{item.ev}</span>
                        </div>
                        <p className="text-xs text-white/40 leading-relaxed">{item.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </GCard>
          </div>
        </section>

        <SDivider />

        {/* ── COMPARACIÓN ─────────────────────────────────────────── */}
        <section className="py-24 md:py-32 px-6">
          <div className="mx-auto max-w-4xl">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">Ailyn vs el resto</h2>
            </div>
            <GCard>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-5 px-7 text-white/40 font-medium text-sm w-2/5">Capacidad</th>
                    <th className="py-5 px-4 text-center"><span className="txt-shimmer font-bold text-base">Ailyn</span></th>
                    <th className="py-5 px-4 text-center text-white/40 font-medium text-sm">Manual</th>
                    <th className="py-5 px-4 text-center text-white/40 font-medium text-sm">Otras herramientas</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Investigación automática de prospectos", true, false, false],
                    ["Operación 24/7 sin supervisión",         true, false, "~"],
                    ["Integración con Telegram",               true, false, false],
                    ["Chat web con IA entrenada",              true, false, true],
                    ["Planes de trabajo autónomos",            true, false, false],
                    ["Reportes automáticos",                   true, false, "~"],
                    ["Setup en 5 minutos",                     true, false, false],
                  ].map(([feat, a, b, c], i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-4 px-7 text-sm text-white/60">{feat as string}</td>
                      <td className="py-4 px-4 text-center">{a === true ? <span className="text-green-400 font-bold text-lg">✓</span> : <span className="text-red-400/60">✗</span>}</td>
                      <td className="py-4 px-4 text-center">{b === true ? <span className="text-green-400 font-bold">✓</span> : <span className="text-red-400/60">✗</span>}</td>
                      <td className="py-4 px-4 text-center">{c === true ? <span className="text-green-400 font-bold">✓</span> : c === "~" ? <span className="text-yellow-400 font-bold">~</span> : <span className="text-red-400/60">✗</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </GCard>
          </div>
        </section>

        <SDivider />

        {/* ── PRICING ─────────────────────────────────────────────── */}
        <section id="pricing" className="py-24 md:py-32 px-6">
          <div className="mx-auto max-w-4xl">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">Precios simples</h2>
              <p className="text-white/40 text-lg">Sin sorpresas, sin contratos anuales obligatorios</p>
            </div>
            <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">

              {/* Starter */}
              <GCard className="p-8 flex flex-col">
                <div className="mb-7">
                  <h3 className="font-bold text-2xl mb-1">Starter</h3>
                  <p className="text-white/40 text-sm mb-5">Para equipos que están arrancando</p>
                  <div className="flex items-end gap-1">
                    <span className="text-5xl font-bold">$49</span>
                    <span className="text-white/40 mb-2 text-lg">/mes</span>
                  </div>
                </div>
                <ul className="space-y-3.5 mb-8 flex-1">
                  {["1 agente de IA","Chat web ilimitado","100 prospectos/mes","Reportes semanales","Soporte por email"].map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-white/60">
                      <span className="text-purple-400 font-bold">✓</span>{f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className="w-full text-center bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl text-white font-semibold py-3.5 transition-all block">
                  Empezar gratis
                </Link>
              </GCard>

              {/* Pro */}
              <div className="relative bg-gradient-to-br from-white/20 to-white/5 backdrop-blur-xl border-2 border-purple-500/50 rounded-3xl shadow-2xl shadow-purple-500/20 p-8 flex flex-col overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-purple-400/80 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/8 to-pink-500/6 pointer-events-none" />
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                  <span className="bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-lg shadow-purple-500/40">
                    Más popular
                  </span>
                </div>
                <div className="relative mb-7 mt-2">
                  <h3 className="font-bold text-2xl mb-1">Pro</h3>
                  <p className="text-white/40 text-sm mb-5">Para equipos que quieren escalar</p>
                  <div className="flex items-end gap-1">
                    <span className="text-5xl font-bold">$149</span>
                    <span className="text-white/40 mb-2 text-lg">/mes</span>
                  </div>
                </div>
                <ul className="relative space-y-3.5 mb-8 flex-1">
                  {["3 agentes de IA","Chat web + Telegram bot","500 prospectos/mes","Planes de trabajo autónomos","Reportes diarios","Soporte prioritario"].map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-white/70">
                      <span className="text-purple-400 font-bold">✓</span>{f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup"
                  className="relative w-full text-center bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-2xl text-white font-semibold py-3.5 shadow-xl shadow-purple-500/30 hover:shadow-2xl hover:shadow-purple-500/40 transition-all hover:scale-105 block"
                >
                  Empezar con Pro →
                </Link>
              </div>
            </div>
          </div>
        </section>

        <SDivider />

        {/* ── CTA FINAL ───────────────────────────────────────────── */}
        <section className="py-24 md:py-32 px-6">
          <div className="mx-auto max-w-3xl text-center">
            <div className="relative bg-gradient-to-br from-purple-500/20 via-pink-500/10 to-blue-500/20 backdrop-blur-xl border border-purple-500/30 rounded-3xl p-14 overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-purple-400/70 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-b from-purple-500/8 to-pink-500/8 pointer-events-none" />
              <div className="relative">
                <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight leading-tight">
                  Empieza hoy, cierra tu
                  <br />
                  <span className="txt-shimmer">próximo cliente</span> mañana
                </h2>
                <p className="text-white/40 text-lg mb-10">Configura Ailyn en 5 minutos. Sin tarjeta de crédito.</p>
                <div className="relative inline-block">
                  <span className="cta-ring" />
                  <Link href="/signup"
                    className="relative inline-block bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold px-10 py-4 rounded-2xl text-lg shadow-xl shadow-purple-500/30 hover:shadow-2xl hover:shadow-purple-500/40 transition-all hover:scale-105"
                  >
                    Crear mi cuenta gratis →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── FOOTER ──────────────────────────────────────────────── */}
        <footer className="border-t border-white/10 py-12 px-6">
          <div className="mx-auto max-w-5xl flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <span className="text-white font-bold text-[10px]">A</span>
              </div>
              <span className="text-white font-semibold">Ailyn</span>
              <span className="text-white/20 text-sm ml-2">© 2026</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-white/30">
              <a href="#features" className="hover:text-white/70 transition-colors">Funciones</a>
              <a href="#pricing"  className="hover:text-white/70 transition-colors">Precios</a>
              <Link href="/login"  className="hover:text-white/70 transition-colors">Iniciar sesión</Link>
              <Link href="/signup" className="hover:text-white/70 transition-colors">Registrarse</Link>
            </div>
          </div>
        </footer>

      </div>{/* end content layer */}
    </>
  );
}
