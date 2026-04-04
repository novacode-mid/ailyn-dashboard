"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardShell from "@/shared/components/DashboardShell";
import { clearAuth, getUser, authHeaders } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

interface IntegrationStatus {
  provider: string;
  connected: boolean;
  updated_at: string | null;
}

const INTEGRATIONS_CONFIG = [
  {
    provider: "slack",
    name: "Slack",
    description: "Enviar mensajes a canales de Slack desde el asistente.",
    color: "bg-[#4A154B]",
    fields: [
      { key: "access_token", label: "Bot Token", placeholder: "xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx", type: "password" as const },
    ],
  },
  {
    provider: "notion",
    name: "Notion",
    description: "Crear paginas y buscar en tu workspace de Notion.",
    color: "bg-white/10",
    fields: [
      { key: "access_token", label: "Integration Token", placeholder: "ntn_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", type: "password" as const },
      { key: "parent_id", label: "Parent Page/Database ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", type: "text" as const, extra: true },
    ],
  },
  {
    provider: "hubspot",
    name: "HubSpot",
    description: "Crear contactos, buscar clientes y gestionar deals.",
    color: "bg-[#FF7A59]/20",
    fields: [
      { key: "access_token", label: "Access Token", placeholder: "pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", type: "password" as const },
    ],
  },
  {
    provider: "shopify",
    name: "Shopify",
    description: "Consultar pedidos y productos de tu tienda.",
    color: "bg-[#96BF48]/20",
    fields: [
      { key: "access_token", label: "Admin API Access Token", placeholder: "shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", type: "password" as const },
      { key: "shop", label: "Shop Name", placeholder: "mi-tienda (sin .myshopify.com)", type: "text" as const, extra: true },
    ],
  },
  {
    provider: "make",
    name: "Make.com",
    description: "Disparar escenarios y automatizaciones desde el chat.",
    color: "bg-[#6D00CC]/20",
    fields: [
      { key: "access_token", label: "Webhook URL", placeholder: "https://hook.us1.make.com/xxxxxxxxxxxxxxxxxxxxxxxxx", type: "url" as const },
    ],
  },
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const user = getUser();

  // ── Telegram state ──────────────────────────────────────────────────────
  const [tgConnected, setTgConnected] = useState<boolean | null>(null);
  const [tgUsername, setTgUsername] = useState<string | null>(null);
  const [tgToken, setTgToken] = useState("");
  const [tgLoading, setTgLoading] = useState(false);
  const [tgError, setTgError] = useState("");

  // ── MCP state ──────────────────────────────────────────────────────────
  const [mcpServers, setMcpServers] = useState<{ id: number; url: string; name: string; skills_count: number; is_active: number; last_scan_at: string | null }[]>([]);
  const [mcpSkills, setMcpSkills] = useState<{ id: number; server_id: number; skill_name: string; description: string; is_active: number }[]>([]);
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpName, setMcpName] = useState("");
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState("");
  const [mcpExpanded, setMcpExpanded] = useState<number | null>(null);

  // ── Integrations state ──────────────────────────────────────────────────
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [intLoading, setIntLoading] = useState<string | null>(null);
  const [intError, setIntError] = useState<string | null>(null);
  const [intForms, setIntForms] = useState<Record<string, Record<string, string>>>({});

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

    // MCP servers
    fetch(`${WORKER_URL}/api/settings/mcp`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data: { servers?: typeof mcpServers; skills?: typeof mcpSkills }) => {
        setMcpServers(data.servers ?? []);
        setMcpSkills(data.skills ?? []);
      })
      .catch(() => {});

    // Integrations status
    fetch(`${WORKER_URL}/api/settings/integrations`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data: { integrations?: IntegrationStatus[] }) => {
        setIntegrations(data.integrations ?? []);
      })
      .catch(() => {});
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

  async function handleIntegrationConnect(provider: string) {
    const form = intForms[provider] ?? {};
    const config = INTEGRATIONS_CONFIG.find((c) => c.provider === provider);
    if (!config) return;

    const accessToken = form["access_token"]?.trim();
    if (!accessToken) { setIntError("Token/URL requerido"); return; }

    const extraData: Record<string, unknown> = {};
    for (const field of config.fields) {
      if ("extra" in field && field.extra && form[field.key]?.trim()) {
        extraData[field.key] = form[field.key].trim();
      }
    }

    setIntLoading(provider);
    setIntError(null);
    try {
      const res = await fetch(`${WORKER_URL}/api/settings/integrations`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ provider, access_token: accessToken, extra_data: extraData }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { setIntError(data.error ?? "Error al conectar"); return; }
      setIntegrations((prev) => {
        const filtered = prev.filter((i) => i.provider !== provider);
        return [...filtered, { provider, connected: true, updated_at: new Date().toISOString() }];
      });
      setIntForms((prev) => ({ ...prev, [provider]: {} }));
    } catch {
      setIntError("No se pudo conectar al servidor.");
    } finally {
      setIntLoading(null);
    }
  }

  async function handleIntegrationDisconnect(provider: string) {
    const config = INTEGRATIONS_CONFIG.find((c) => c.provider === provider);
    if (!confirm(`Desconectar ${config?.name ?? provider}?`)) return;
    setIntLoading(provider);
    setIntError(null);
    try {
      await fetch(`${WORKER_URL}/api/settings/integrations`, {
        method: "DELETE",
        headers: authHeaders(),
        body: JSON.stringify({ provider }),
      });
      setIntegrations((prev) => prev.map((i) => i.provider === provider ? { ...i, connected: false } : i));
    } catch {
      setIntError("No se pudo desconectar.");
    } finally {
      setIntLoading(null);
    }
  }

  function updateIntForm(provider: string, key: string, value: string) {
    setIntForms((prev) => ({ ...prev, [provider]: { ...(prev[provider] ?? {}), [key]: value } }));
  }

  async function handleMcpConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!mcpUrl.trim()) return;
    setMcpLoading(true);
    setMcpError("");
    try {
      const res = await fetch(`${WORKER_URL}/api/settings/mcp/connect`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ url: mcpUrl.trim(), name: mcpName.trim() || mcpUrl.trim() }),
      });
      const data = await res.json() as { ok?: boolean; skillsCreated?: number; errors?: string[]; error?: string };
      if (!res.ok) { setMcpError(data.error ?? "Error al conectar"); return; }
      setMcpUrl("");
      setMcpName("");
      // Reload
      const listRes = await fetch(`${WORKER_URL}/api/settings/mcp`, { headers: authHeaders() });
      const listData = await listRes.json() as { servers?: typeof mcpServers; skills?: typeof mcpSkills };
      setMcpServers(listData.servers ?? []);
      setMcpSkills(listData.skills ?? []);
    } catch {
      setMcpError("No se pudo conectar al servidor.");
    } finally {
      setMcpLoading(false);
    }
  }

  async function handleMcpDisconnect(serverId: number) {
    if (!confirm("Desconectar este servidor MCP? Sus skills se desactivarán.")) return;
    await fetch(`${WORKER_URL}/api/settings/mcp/disconnect`, {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({ server_id: serverId }),
    });
    setMcpServers((prev) => prev.map((s) => s.id === serverId ? { ...s, is_active: 0 } : s));
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

        {/* ── Integraciones ─────────────────────────────────────────── */}
        <h2 className="text-lg font-bold text-white pt-2">Integraciones</h2>
        {intError && <p className="text-red-400 text-xs">{intError}</p>}

        {INTEGRATIONS_CONFIG.map((config) => {
          const status = integrations.find((i) => i.provider === config.provider);
          const isConnected = status?.connected ?? false;
          const loading = intLoading === config.provider;
          const form = intForms[config.provider] ?? {};

          return (
            <div key={config.provider} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-400" : "bg-gray-600"}`} />
                  <h2 className="text-sm font-medium text-white">{config.name}</h2>
                </div>
                {isConnected && (
                  <span className="text-xs text-green-400">Conectado</span>
                )}
              </div>

              <p className="text-xs text-gray-400">{config.description}</p>

              {!isConnected && (
                <div className="space-y-2">
                  {config.fields.map((field) => (
                    <input
                      key={field.key}
                      type={field.type === "password" ? "password" : "text"}
                      value={form[field.key] ?? ""}
                      onChange={(e) => updateIntForm(config.provider, field.key, e.target.value)}
                      placeholder={field.label}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 transition-colors font-mono"
                    />
                  ))}
                  <button
                    onClick={() => handleIntegrationConnect(config.provider)}
                    disabled={loading || !form["access_token"]?.trim()}
                    className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                  >
                    {loading ? "Conectando..." : `Conectar ${config.name}`}
                  </button>
                </div>
              )}

              {isConnected && (
                <div className="flex justify-end">
                  <button
                    onClick={() => handleIntegrationDisconnect(config.provider)}
                    disabled={loading}
                    className="text-xs text-red-500 hover:text-red-300 transition-colors disabled:opacity-50"
                  >
                    {loading ? "..." : "Desconectar"}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* ── Servidores MCP ───────────────────────────────────── */}
        <h2 className="text-lg font-bold text-white pt-2">Servidores MCP</h2>
        <p className="text-gray-500 text-xs -mt-4">Conecta cualquier servidor MCP y sus tools se convierten en Skills automaticamente</p>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
          <form onSubmit={handleMcpConnect} className="space-y-2">
            <input
              type="url"
              value={mcpUrl}
              onChange={(e) => setMcpUrl(e.target.value)}
              placeholder="URL del servidor MCP (ej: https://mcp.example.com/sse)"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 font-mono"
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
                placeholder="Nombre (opcional)"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400"
              />
              <button
                type="submit"
                disabled={mcpLoading || !mcpUrl.trim()}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
              >
                {mcpLoading ? "Escaneando..." : "Conectar MCP"}
              </button>
            </div>
          </form>
          {mcpError && <p className="text-red-400 text-xs">{mcpError}</p>}
        </div>

        {mcpServers.filter(s => s.is_active).map((server) => (
          <div key={server.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-white text-sm font-medium">{server.name}</span>
                <span className="text-gray-500 text-xs">({server.skills_count} skills)</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMcpExpanded(mcpExpanded === server.id ? null : server.id)}
                  className="text-xs text-purple-400 hover:text-purple-300"
                >
                  {mcpExpanded === server.id ? "Ocultar" : "Ver skills"}
                </button>
                <button
                  onClick={() => handleMcpDisconnect(server.id)}
                  className="text-xs text-red-500 hover:text-red-300"
                >
                  Desconectar
                </button>
              </div>
            </div>
            <p className="text-gray-500 text-xs font-mono">{server.url}</p>
            {server.last_scan_at && (
              <p className="text-gray-600 text-xs">Ultimo escaneo: {new Date(server.last_scan_at).toLocaleString("es-MX")}</p>
            )}

            {mcpExpanded === server.id && (
              <div className="space-y-1 pt-2 border-t border-gray-800">
                {mcpSkills.filter(s => s.server_id === server.id).map((skill) => (
                  <div key={skill.id} className="flex items-center justify-between text-xs py-1">
                    <span className={skill.is_active ? "text-gray-300" : "text-gray-600 line-through"}>{skill.skill_name}</span>
                    <span className="text-gray-500">{skill.description.slice(0, 50)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

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
