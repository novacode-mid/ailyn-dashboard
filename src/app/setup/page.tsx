"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser, saveAuth, getToken } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

const INDUSTRIES = [
  { value: "Restaurantes", icon: "🍽️" },
  { value: "Retail", icon: "🛍️" },
  { value: "Servicios", icon: "🔧" },
  { value: "Tecnología", icon: "💻" },
  { value: "Salud", icon: "🏥" },
  { value: "Educación", icon: "📚" },
  { value: "Finanzas", icon: "💰" },
  { value: "Manufactura", icon: "🏭" },
  { value: "Otro", icon: "✨" },
];

const INDUSTRY_DESCRIPTIONS: Record<string, string> = {
  "Restaurantes": "Restaurante que ofrece experiencias gastronómicas a sus clientes",
  "Retail": "Tienda que ofrece productos de calidad a sus clientes",
  "Servicios": "Empresa de servicios profesionales para empresas y personas",
  "Tecnología": "Empresa de tecnología que desarrolla soluciones innovadoras",
  "Salud": "Clínica/consultorio que ofrece servicios de salud",
  "Educación": "Institución educativa comprometida con la formación",
  "Finanzas": "Empresa de servicios financieros y consultoría",
  "Manufactura": "Empresa manufacturera de productos de calidad",
  "Otro": "Empresa comprometida con ofrecer el mejor servicio",
};

function Stepper({ step }: { step: number }) {
  const steps = ["Tu negocio", "Conectar canal"];
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        return (
          <div key={n} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                done ? "bg-ailyn-400 text-white" : active ? "bg-ailyn-400 text-white ring-2 ring-ailyn-400 ring-offset-2 ring-offset-gray-950" : "bg-gray-800 text-gray-500"
              }`}>
                {done ? "✓" : n}
              </div>
              <span className={`text-xs mt-1 transition-colors ${active ? "text-white" : done ? "text-ailyn-400" : "text-gray-600"}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-16 sm:w-24 h-px mx-2 mb-4 transition-colors ${done ? "bg-ailyn-400" : "bg-gray-800"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const user = getUser();

  useEffect(() => {
    if (!user) { router.replace("/login"); return; }
    if (user.setup_completed) { router.replace("/dashboard"); }
  }, [user, router]);

  const [step, setStep] = useState(1);
  const [companyName, setCompanyName] = useState(user?.company_name ?? "");
  const [industry, setIndustry] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [setupDone, setSetupDone] = useState(false);

  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => { topRef.current?.scrollIntoView({ behavior: "smooth" }); }, [step]);

  if (!user) return null;

  async function handleStep1() {
    setError("");
    if (!companyName.trim()) { setError("Ingresa el nombre de tu negocio"); return; }
    if (!industry) { setError("Selecciona tu industria"); return; }

    setSaving(true);
    try {
      const token = getToken();
      const description = `${companyName.trim()} es una empresa de ${industry}. ${INDUSTRY_DESCRIPTIONS[industry] ?? ""}`;

      const res = await fetch(`${WORKER_URL}/api/setup/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company: {
            name: companyName.trim(),
            industry,
            description,
          },
          agent: {
            name: `Ailyn de ${companyName.trim()}`,
            tone: "Amigable",
            language: "Español",
          },
          documents: [],
        }),
      });

      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      // Actualizar user
      const currentUser = getUser();
      if (currentUser) {
        saveAuth(token, { ...currentUser, setup_completed: 1 });
      }

      setSetupDone(true);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  function goToDashboard() {
    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-start p-4 pt-12" ref={topRef}>
      <div className="w-full max-w-lg">

        {/* Logo */}
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="w-8 h-8 rounded-lg bg-ailyn-400 flex items-center justify-center">
            <span className="text-white font-bold text-sm">A</span>
          </div>
          <span className="text-white text-xl font-semibold">Ailyn</span>
        </div>

        <Stepper step={step} />

        {/* ── Paso 1: Tu negocio ── */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="text-center mb-6">
              <h1 className="text-white text-2xl font-bold">¿Cómo se llama tu negocio?</h1>
              <p className="text-gray-400 text-sm mt-1">Solo 2 datos y tu asistente está listo</p>
            </div>

            <div>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Nombre de tu negocio"
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-ailyn-400 transition-colors"
              />
            </div>

            <div>
              <label className="text-xs text-gray-400 mb-2 block">¿En qué industria estás?</label>
              <div className="grid grid-cols-3 gap-2">
                {INDUSTRIES.map((ind) => (
                  <button
                    key={ind.value}
                    type="button"
                    onClick={() => setIndustry(ind.value)}
                    className={`py-3 px-2 rounded-lg text-xs font-medium border transition-all ${
                      industry === ind.value
                        ? "bg-ailyn-400 border-ailyn-400 text-white scale-105"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                    }`}
                  >
                    <span className="text-lg block mb-1">{ind.icon}</span>
                    {ind.value}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-red-400 text-sm text-center">{error}</p>}

            <button
              type="button"
              onClick={handleStep1}
              disabled={saving}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 disabled:opacity-50 text-white py-3.5 rounded-lg text-sm font-semibold transition-all"
            >
              {saving ? "Configurando tu asistente..." : "Crear mi asistente →"}
            </button>

            <p className="text-gray-600 text-xs text-center">
              Podrás personalizar todo después desde el dashboard
            </p>
          </div>
        )}

        {/* ── Paso 2: Conectar canal ── */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">🎉</div>
              <h1 className="text-white text-2xl font-bold">¡Tu asistente está listo!</h1>
              <p className="text-gray-400 text-sm mt-1">Ahora conecta un canal para empezar a usarlo</p>
            </div>

            {/* Canal options */}
            <div className="space-y-3">
              <a
                href="https://t.me/botfather"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-blue-500/50 transition-colors group"
              >
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-2xl shrink-0">💬</div>
                <div className="flex-1">
                  <p className="text-white font-medium text-sm group-hover:text-blue-400 transition-colors">Telegram</p>
                  <p className="text-gray-500 text-xs mt-0.5">Crea un bot con @BotFather y conéctalo en Settings</p>
                </div>
                <span className="text-gray-600 text-sm">→</span>
              </a>

              <div className="flex items-center gap-4 bg-gray-900 border border-gray-800 rounded-xl p-4 opacity-80">
                <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center text-2xl shrink-0">📱</div>
                <div className="flex-1">
                  <p className="text-white font-medium text-sm">WhatsApp Business</p>
                  <p className="text-gray-500 text-xs mt-0.5">Configúralo desde Settings después del setup</p>
                </div>
                <span className="text-xs text-gray-600 bg-gray-800 px-2 py-1 rounded">Avanzado</span>
              </div>

              <div className="flex items-center gap-4 bg-gray-900 border border-gray-800 rounded-xl p-4 opacity-80">
                <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center text-2xl shrink-0">🖥️</div>
                <div className="flex-1">
                  <p className="text-white font-medium text-sm">App de Escritorio</p>
                  <p className="text-gray-500 text-xs mt-0.5">Descarga Ailyn Desktop para chat + automatización</p>
                </div>
                <span className="text-xs text-gray-600 bg-gray-800 px-2 py-1 rounded">Pronto</span>
              </div>
            </div>

            <div className="pt-4 space-y-3">
              <button
                onClick={goToDashboard}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 text-white py-3.5 rounded-lg text-sm font-semibold transition-all"
              >
                Ir al Dashboard →
              </button>
              <p className="text-gray-600 text-xs text-center">
                Puedes conectar canales cuando quieras desde Settings
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
