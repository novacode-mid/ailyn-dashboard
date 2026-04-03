"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser, saveAuth, getToken, authHeaders } from "@/shared/hooks/useAuth";

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
  const steps = ["Tu negocio", "Conectar canal", "Probar agente", "¡Listo!"];
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
                done ? "bg-purple-500 text-white" : active ? "bg-purple-500 text-white ring-2 ring-purple-400 ring-offset-2 ring-offset-gray-950" : "bg-gray-800 text-gray-500"
              }`}>
                {done ? "✓" : n}
              </div>
              <span className={`text-[10px] mt-1 transition-colors whitespace-nowrap ${active ? "text-white" : done ? "text-purple-400" : "text-gray-600"}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-8 sm:w-16 h-px mx-1 mb-4 transition-colors ${done ? "bg-purple-500" : "bg-gray-800"}`} />
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

  // Step 2: canal
  const [selectedChannel, setSelectedChannel] = useState<"telegram" | "whatsapp" | "skip" | null>(null);
  const [tgToken, setTgToken] = useState("");
  const [tgLoading, setTgLoading] = useState(false);
  const [tgSuccess, setTgSuccess] = useState(false);
  const [tgBotName, setTgBotName] = useState("");
  const [waPhoneId, setWaPhoneId] = useState("");
  const [waToken, setWaToken] = useState("");
  const [waVerify, setWaVerify] = useState("");
  const [waLoading, setWaLoading] = useState(false);
  const [waSuccess, setWaSuccess] = useState(false);

  // Step 3: test
  const [testMsg, setTestMsg] = useState("");
  const [testReply, setTestReply] = useState("");
  const [testLoading, setTestLoading] = useState(false);

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
          company: { name: companyName.trim(), industry, description },
          agent: { name: `Ailyn de ${companyName.trim()}`, tone: "Amigable", language: "Español" },
          documents: [],
        }),
      });

      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      const currentUser = getUser();
      if (currentUser) saveAuth(token, { ...currentUser, setup_completed: 1 });

      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleTelegramConnect(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setTgLoading(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/settings/telegram/connect`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ bot_token: tgToken.trim() }),
      });
      const data = await res.json() as { success?: boolean; bot_username?: string; error?: string };
      if (!res.ok) { setError(data.error ?? "Error al conectar"); return; }
      setTgSuccess(true);
      setTgBotName(data.bot_username ?? "tu bot");
    } catch {
      setError("No se pudo conectar al servidor.");
    } finally {
      setTgLoading(false);
    }
  }

  async function handleWhatsAppConnect(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setWaLoading(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/settings/whatsapp/connect`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          phone_number_id: waPhoneId.trim(),
          access_token: waToken.trim(),
          verify_token: waVerify.trim(),
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) { setError(data.error ?? "Error al conectar"); return; }
      setWaSuccess(true);
    } catch {
      setError("No se pudo conectar al servidor.");
    } finally {
      setWaLoading(false);
    }
  }

  async function handleTestMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!testMsg.trim()) return;
    setTestLoading(true);
    setTestReply("");
    try {
      const slug = companyName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const res = await fetch(`${WORKER_URL}/api/chat/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        body: JSON.stringify({ message: testMsg.trim(), session_id: `setup-test-${Date.now()}` }),
      });
      const data = await res.json() as { reply?: string; error?: string };
      setTestReply(data.reply ?? data.error ?? "Sin respuesta");
    } catch {
      setTestReply("Error al conectar con el agente.");
    } finally {
      setTestLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-start p-4 pt-12" ref={topRef}>
      <div className="w-full max-w-lg">

        {/* Logo */}
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="w-8 h-8 rounded-lg bg-purple-500 flex items-center justify-center">
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
              <p className="text-gray-400 text-sm mt-1">Configura tu asistente en menos de 2 minutos</p>
            </div>

            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Nombre de tu negocio"
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-400 transition-colors"
            />

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
                        ? "bg-purple-500 border-purple-400 text-white scale-105"
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
          </div>
        )}

        {/* ── Paso 2: Conectar canal ── */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="text-center mb-4">
              <h1 className="text-white text-2xl font-bold">Conecta un canal</h1>
              <p className="text-gray-400 text-sm mt-1">Tu agente puede responder por Telegram, WhatsApp o Web</p>
            </div>

            {!selectedChannel && (
              <div className="space-y-3">
                <button
                  onClick={() => setSelectedChannel("telegram")}
                  className="flex items-center gap-4 w-full bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-blue-500/50 transition-colors text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-2xl shrink-0">💬</div>
                  <div className="flex-1">
                    <p className="text-white font-medium text-sm">Telegram</p>
                    <p className="text-gray-500 text-xs mt-0.5">Recomendado — facil y rapido de configurar</p>
                  </div>
                </button>

                <button
                  onClick={() => setSelectedChannel("whatsapp")}
                  className="flex items-center gap-4 w-full bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-green-500/50 transition-colors text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center text-2xl shrink-0">📱</div>
                  <div className="flex-1">
                    <p className="text-white font-medium text-sm">WhatsApp Business</p>
                    <p className="text-gray-500 text-xs mt-0.5">Requiere cuenta de Meta Business</p>
                  </div>
                </button>

                <button
                  onClick={() => setStep(3)}
                  className="text-gray-500 hover:text-gray-300 text-xs text-center w-full py-2 transition-colors"
                >
                  Omitir por ahora — usar solo el chat web
                </button>
              </div>
            )}

            {/* Telegram form */}
            {selectedChannel === "telegram" && !tgSuccess && (
              <div className="space-y-4">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                  <p className="text-white text-sm font-medium">Conectar Telegram</p>
                  <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
                    <li>Abre Telegram y busca <span className="text-gray-300 font-mono">@BotFather</span></li>
                    <li>Envia <span className="text-gray-300 font-mono">/newbot</span> y sigue las instrucciones</li>
                    <li>Copia el token y pegalo aqui</li>
                  </ol>
                  <form onSubmit={handleTelegramConnect} className="flex gap-2">
                    <input
                      type="text"
                      value={tgToken}
                      onChange={(e) => setTgToken(e.target.value)}
                      placeholder="123456:AAExxxxxx..."
                      required
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 transition-colors font-mono"
                    />
                    <button
                      type="submit"
                      disabled={tgLoading || !tgToken.trim()}
                      className="bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                    >
                      {tgLoading ? "..." : "Conectar"}
                    </button>
                  </form>
                </div>
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <button onClick={() => setSelectedChannel(null)} className="text-gray-500 hover:text-gray-300 text-xs">← Volver</button>
              </div>
            )}

            {selectedChannel === "telegram" && tgSuccess && (
              <div className="space-y-4">
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-center">
                  <p className="text-green-400 font-medium">Telegram conectado</p>
                  <p className="text-gray-400 text-sm mt-1">Bot: @{tgBotName}</p>
                </div>
                <button onClick={() => setStep(3)} className="w-full bg-gradient-to-r from-purple-600 to-pink-500 text-white py-3 rounded-lg text-sm font-semibold">
                  Siguiente: Probar el agente →
                </button>
              </div>
            )}

            {/* WhatsApp form */}
            {selectedChannel === "whatsapp" && !waSuccess && (
              <div className="space-y-4">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                  <p className="text-white text-sm font-medium">Conectar WhatsApp Business</p>
                  <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
                    <li>Ve a <span className="text-gray-300">developers.facebook.com</span> y crea una App de WhatsApp</li>
                    <li>Copia el Phone Number ID y Access Token</li>
                    <li>Inventa un Verify Token secreto</li>
                  </ol>
                  <form onSubmit={handleWhatsAppConnect} className="space-y-2">
                    <input type="text" value={waPhoneId} onChange={(e) => setWaPhoneId(e.target.value)} placeholder="Phone Number ID" required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 font-mono" />
                    <input type="text" value={waToken} onChange={(e) => setWaToken(e.target.value)} placeholder="Access Token" required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 font-mono" />
                    <input type="text" value={waVerify} onChange={(e) => setWaVerify(e.target.value)} placeholder="Verify Token (tu secreto)" required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 font-mono" />
                    <button type="submit" disabled={waLoading} className="w-full bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg">
                      {waLoading ? "Conectando..." : "Conectar WhatsApp"}
                    </button>
                  </form>
                </div>
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <button onClick={() => setSelectedChannel(null)} className="text-gray-500 hover:text-gray-300 text-xs">← Volver</button>
              </div>
            )}

            {selectedChannel === "whatsapp" && waSuccess && (
              <div className="space-y-4">
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-center">
                  <p className="text-green-400 font-medium">WhatsApp conectado</p>
                </div>
                <button onClick={() => setStep(3)} className="w-full bg-gradient-to-r from-purple-600 to-pink-500 text-white py-3 rounded-lg text-sm font-semibold">
                  Siguiente: Probar el agente →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Paso 3: Probar agente ── */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="text-center mb-4">
              <h1 className="text-white text-2xl font-bold">Prueba tu agente</h1>
              <p className="text-gray-400 text-sm mt-1">Escribe algo para ver como responde Ailyn</p>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3 min-h-[200px]">
              {testReply && (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <div className="bg-purple-500/20 border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-white max-w-[80%]">
                      {testMsg}
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 max-w-[80%]">
                      {testReply}
                    </div>
                  </div>
                </div>
              )}
              {!testReply && !testLoading && (
                <div className="flex items-center justify-center h-[150px] text-gray-600 text-sm">
                  Escribe un mensaje para probar
                </div>
              )}
              {testLoading && (
                <div className="flex items-center justify-center h-[150px] text-gray-400 text-sm">
                  Pensando...
                </div>
              )}
            </div>

            <form onSubmit={handleTestMessage} className="flex gap-2">
              <input
                type="text"
                value={testMsg}
                onChange={(e) => setTestMsg(e.target.value)}
                placeholder={`Ej: "Hola, que puedes hacer por ${companyName}?"`}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400"
              />
              <button
                type="submit"
                disabled={testLoading || !testMsg.trim()}
                className="bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
              >
                Enviar
              </button>
            </form>

            <button
              onClick={() => setStep(4)}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-500 text-white py-3 rounded-lg text-sm font-semibold"
            >
              {testReply ? "Todo listo, ir al dashboard →" : "Omitir y ir al dashboard →"}
            </button>
          </div>
        )}

        {/* ── Paso 4: Listo ── */}
        {step === 4 && (
          <div className="space-y-5 text-center">
            <div className="text-6xl mb-4">🚀</div>
            <h1 className="text-white text-2xl font-bold">¡Tu asistente está activo!</h1>
            <p className="text-gray-400 text-sm">Ailyn de {companyName} esta listo para trabajar</p>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2 text-left">
              <p className="text-white text-sm font-medium mb-3">Lo que puedes hacer ahora:</p>
              <div className="flex items-center gap-3 text-sm text-gray-300">
                <span className="text-purple-400">✓</span> Chatear con tu agente desde Telegram o el dashboard
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-300">
                <span className="text-purple-400">✓</span> Conectar integraciones (Make, Slack, Notion)
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-300">
                <span className="text-purple-400">✓</span> Configurar automatizaciones y work plans
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-300">
                <span className="text-purple-400">✓</span> Subir documentos a la knowledge base
              </div>
            </div>

            <button
              onClick={() => router.push("/dashboard")}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-500 hover:to-pink-400 text-white py-3.5 rounded-lg text-sm font-semibold transition-all"
            >
              Ir al Dashboard →
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
