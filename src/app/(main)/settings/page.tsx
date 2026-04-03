"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardShell from "@/shared/components/DashboardShell";
import { clearAuth, getUser, authHeaders } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

export default function SettingsPage() {
  const router = useRouter();
  const user = getUser();

  // ── Telegram state ──────────────────────────────────────────────────────
  const [tgConnected, setTgConnected] = useState<boolean | null>(null);
  const [tgUsername, setTgUsername] = useState<string | null>(null);
  const [tgToken, setTgToken] = useState("");
  const [tgLoading, setTgLoading] = useState(false);
  const [tgError, setTgError] = useState("");

  // ── WhatsApp state ─────────────────────────────────────────────────────
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  const [waPhoneId, setWaPhoneId] = useState<string | null>(null);
  const [waPhoneNumberId, setWaPhoneNumberId] = useState("");
  const [waAccessToken, setWaAccessToken] = useState("");
  const [waVerifyToken, setWaVerifyToken] = useState("");
  const [waLoading, setWaLoading] = useState(false);
  const [waError, setWaError] = useState("");
  const [waWebhookUrl, setWaWebhookUrl] = useState("");

  useEffect(() => {
    // Telegram status
    fetch(`${WORKER_URL}/api/settings/telegram/status`, {
      headers: authHeaders(),
    })
      .then((r) => r.json())
      .then((data: { connected: boolean; bot_username?: string }) => {
        setTgConnected(data.connected);
        setTgUsername(data.bot_username ?? null);
      })
      .catch(() => setTgConnected(false));

    // WhatsApp status
    fetch(`${WORKER_URL}/api/settings/whatsapp/status`, {
      headers: authHeaders(),
    })
      .then((r) => r.json())
      .then((data: { connected: boolean; phone_number_id?: string }) => {
        setWaConnected(data.connected);
        setWaPhoneId(data.phone_number_id ?? null);
      })
      .catch(() => setWaConnected(false));
  }, []);

  async function handleTelegramConnect(e: React.FormEvent) {
    e.preventDefault();
    setTgError("");
    setTgLoading(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/settings/telegram/connect`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ bot_token: tgToken.trim() }),
      });
      const data = await res.json() as { success?: boolean; bot_username?: string; error?: string };
      if (!res.ok) { setTgError(data.error ?? "Error al conectar"); return; }
      setTgConnected(true);
      setTgUsername(data.bot_username ?? null);
      setTgToken("");
    } catch {
      setTgError("No se pudo conectar al servidor.");
    } finally {
      setTgLoading(false);
    }
  }

  async function handleTelegramDisconnect() {
    if (!confirm("¿Desconectar el bot de Telegram?")) return;
    setTgLoading(true);
    try {
      await fetch(`${WORKER_URL}/api/settings/telegram/disconnect`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      setTgConnected(false);
      setTgUsername(null);
    } catch {
      setTgError("No se pudo desconectar.");
    } finally {
      setTgLoading(false);
    }
  }

  async function handleWhatsAppConnect(e: React.FormEvent) {
    e.preventDefault();
    setWaError("");
    setWaLoading(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/settings/whatsapp/connect`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          phone_number_id: waPhoneNumberId.trim(),
          access_token: waAccessToken.trim(),
          verify_token: waVerifyToken.trim(),
        }),
      });
      const data = await res.json() as {
        success?: boolean;
        phone_number_id?: string;
        webhook_url?: string;
        error?: string;
      };
      if (!res.ok) { setWaError(data.error ?? "Error al conectar"); return; }
      setWaConnected(true);
      setWaPhoneId(data.phone_number_id ?? null);
      setWaWebhookUrl(data.webhook_url ?? "");
      setWaPhoneNumberId("");
      setWaAccessToken("");
      setWaVerifyToken("");
    } catch {
      setWaError("No se pudo conectar al servidor.");
    } finally {
      setWaLoading(false);
    }
  }

  async function handleWhatsAppDisconnect() {
    if (!confirm("Desconectar WhatsApp Business?")) return;
    setWaLoading(true);
    try {
      await fetch(`${WORKER_URL}/api/settings/whatsapp/disconnect`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      setWaConnected(false);
      setWaPhoneId(null);
      setWaWebhookUrl("");
    } catch {
      setWaError("No se pudo desconectar.");
    } finally {
      setWaLoading(false);
    }
  }

  function handleLogout() {
    clearAuth();
    router.replace("/login");
  }

  return (
    <DashboardShell>
      <div className="p-6 max-w-xl space-y-6">
        <h1 className="text-xl font-bold text-white">Configuración</h1>

        {/* Cuenta */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium text-white">Mi cuenta</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Nombre</span>
              <span className="text-gray-300">{user?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Email</span>
              <span className="text-gray-300">{user?.email ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Empresa</span>
              <span className="text-gray-300">{user?.company_name ?? "—"}</span>
            </div>
          </div>
        </div>

        {/* Conectar Telegram */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-white">Conectar Telegram</h2>
            {tgConnected === null && (
              <span className="text-xs text-gray-500">Verificando...</span>
            )}
            {tgConnected === true && (
              <span className="text-xs text-green-400 flex items-center gap-1">
                ✅ Conectado {tgUsername ? `(@${tgUsername})` : ""}
              </span>
            )}
            {tgConnected === false && (
              <span className="text-xs text-gray-500">❌ No conectado</span>
            )}
          </div>

          {tgConnected === false && (
            <>
              {/* Instrucciones */}
              <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
                <li>Abre Telegram y busca <span className="text-gray-300 font-mono">@BotFather</span></li>
                <li>Envía <span className="text-gray-300 font-mono">/newbot</span> y sigue las instrucciones</li>
                <li>Copia el token que te da BotFather y pégalo aquí</li>
              </ol>

              <form onSubmit={handleTelegramConnect} className="flex gap-2">
                <input
                  type="text"
                  value={tgToken}
                  onChange={(e) => setTgToken(e.target.value)}
                  placeholder="123456:AAExxxxxx..."
                  required
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400 transition-colors font-mono"
                />
                <button
                  type="submit"
                  disabled={tgLoading || !tgToken.trim()}
                  className="bg-ailyn-400 hover:bg-ailyn-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                >
                  {tgLoading ? "Conectando..." : "Conectar"}
                </button>
              </form>

              {tgError && <p className="text-red-400 text-xs">{tgError}</p>}
            </>
          )}

          {tgConnected === true && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">
                Tu bot responde mensajes de Telegram con IA usando tu knowledge base.
              </p>
              <button
                onClick={handleTelegramDisconnect}
                disabled={tgLoading}
                className="text-xs text-red-500 hover:text-red-300 transition-colors disabled:opacity-50 whitespace-nowrap ml-4"
              >
                {tgLoading ? "..." : "Desconectar"}
              </button>
            </div>
          )}
        </div>

        {/* Conectar WhatsApp */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-white">Conectar WhatsApp Business</h2>
            {waConnected === null && (
              <span className="text-xs text-gray-500">Verificando...</span>
            )}
            {waConnected === true && (
              <span className="text-xs text-green-400 flex items-center gap-1">
                Conectado {waPhoneId ? `(${waPhoneId})` : ""}
              </span>
            )}
            {waConnected === false && (
              <span className="text-xs text-gray-500">No conectado</span>
            )}
          </div>

          {waConnected === false && (
            <>
              <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
                <li>Ve a <span className="text-gray-300 font-mono">developers.facebook.com</span> y crea una App de WhatsApp Business</li>
                <li>En WhatsApp {'>'} API Setup, copia el <span className="text-gray-300">Phone Number ID</span> y el <span className="text-gray-300">Access Token</span></li>
                <li>Inventa un <span className="text-gray-300">Verify Token</span> (cualquier texto secreto)</li>
                <li>Conecta aqui y luego registra el webhook URL en Meta</li>
              </ol>

              <form onSubmit={handleWhatsAppConnect} className="space-y-2">
                <input
                  type="text"
                  value={waPhoneNumberId}
                  onChange={(e) => setWaPhoneNumberId(e.target.value)}
                  placeholder="Phone Number ID (ej: 123456789012345)"
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400 transition-colors font-mono"
                />
                <input
                  type="text"
                  value={waAccessToken}
                  onChange={(e) => setWaAccessToken(e.target.value)}
                  placeholder="Access Token permanente"
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400 transition-colors font-mono"
                />
                <input
                  type="text"
                  value={waVerifyToken}
                  onChange={(e) => setWaVerifyToken(e.target.value)}
                  placeholder="Verify Token (tu secreto)"
                  required
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400 transition-colors font-mono"
                />
                <button
                  type="submit"
                  disabled={waLoading || !waPhoneNumberId.trim() || !waAccessToken.trim() || !waVerifyToken.trim()}
                  className="w-full bg-ailyn-400 hover:bg-ailyn-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  {waLoading ? "Conectando..." : "Conectar WhatsApp"}
                </button>
              </form>

              {waError && <p className="text-red-400 text-xs">{waError}</p>}
            </>
          )}

          {waConnected === true && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">
                Tu asistente responde mensajes de WhatsApp Business con IA.
              </p>
              {waWebhookUrl && (
                <div className="bg-gray-800 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-gray-500">Webhook URL (registrar en Meta):</p>
                  <p className="text-xs text-gray-300 font-mono break-all">{waWebhookUrl}</p>
                </div>
              )}
              <div className="flex justify-end">
                <button
                  onClick={handleWhatsAppDisconnect}
                  disabled={waLoading}
                  className="text-xs text-red-500 hover:text-red-300 transition-colors disabled:opacity-50"
                >
                  {waLoading ? "..." : "Desconectar"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Infraestructura */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
          <h2 className="text-sm font-medium text-white">Infraestructura</h2>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Worker</span>
              <span className="text-gray-400 font-mono">ailyn-agent.novacodepro.workers.dev</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Dashboard</span>
              <span className="text-gray-400 font-mono">ailyn-dashboard.pages.dev</span>
            </div>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="text-sm text-red-500 hover:text-red-300 transition-colors"
        >
          Cerrar sesión
        </button>
      </div>
    </DashboardShell>
  );
}
