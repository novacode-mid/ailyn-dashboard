"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

interface Pass {
  id: number;
  serial_number: string;
  company_id: number;
  holder_name: string | null;
  holder_email: string | null;
  install_url: string | null;
  is_installed: number;
  created_at: string;
}

interface CreateResult {
  ok: boolean;
  id: number;
  install_url: string | null;
  webchat_url: string;
}

export default function WalletPage() {
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [createError, setCreateError] = useState("");

  // Send email
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [sendEmailTarget, setSendEmailTarget] = useState("");

  // Push notification
  const [pushTitle, setPushTitle] = useState("");
  const [pushMessage, setPushMessage] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ total: number; sent: number } | null>(null);

  // Clipboard feedback
  const [copied, setCopied] = useState(false);

  const loadPasses = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${WORKER_URL}/api/wallet/my-passes`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { passes?: Pass[] };
      setPasses(data.passes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar tarjetas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPasses();
  }, [loadPasses]);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setCreateError("");
    setCreateResult(null);
    try {
      const res = await fetch(`${WORKER_URL}/api/wallet/create-pass`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CreateResult;
      setCreateResult(data);
      setName("");
      setEmail("");
      setPhone("");
      loadPasses();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Error al crear tarjeta");
    } finally {
      setCreating(false);
    }
  }

  async function handleSendEmail(serialNumber: string, targetEmail: string) {
    if (!targetEmail.trim()) return;
    setSendingEmail(serialNumber);
    try {
      const res = await fetch(`${WORKER_URL}/api/wallet/send-pass`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ serial_number: serialNumber, email: targetEmail.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSendEmailTarget("");
    } catch {
      /* silent */
    } finally {
      setSendingEmail(null);
    }
  }

  async function handlePush() {
    if (!pushTitle.trim() || !pushMessage.trim()) return;
    setPushing(true);
    setPushResult(null);
    try {
      const res = await fetch(`${WORKER_URL}/api/wallet/push-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ title: pushTitle.trim(), message: pushMessage.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { ok: boolean; total: number; sent: number };
      setPushResult({ total: data.total, sent: data.sent });
      setPushTitle("");
      setPushMessage("");
    } catch {
      /* silent */
    } finally {
      setPushing(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <DashboardShell>
      <div className="p-6 space-y-8 max-w-5xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Tarjetas Digitales</h1>
          <p className="text-gray-400 text-sm mt-1">
            Crea tarjetas para tus clientes. Se agregan a Apple Wallet / Google Pay con tu chat integrado.
          </p>
        </div>

        {/* ── Create Card ─────────────────────────────────────── */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Crear tarjeta</h2>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nombre del cliente *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Juan Perez"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Email del cliente</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="juan@ejemplo.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Telefono</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+52 55 1234 5678"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400"
              />
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-ailyn-500 to-purple-600 hover:from-ailyn-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {creating ? "Creando..." : "Crear tarjeta"}
          </button>

          {createError && <p className="text-red-400 text-sm">{createError}</p>}

          {createResult && (
            <div className="bg-green-900/20 border border-green-800 rounded-lg p-4 space-y-3">
              <p className="text-green-400 text-sm font-medium">Tarjeta creada correctamente</p>
              {createResult.install_url && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => copyToClipboard(createResult.install_url!)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 hover:text-white border border-gray-700 transition-colors"
                  >
                    {copied ? "Copiado!" : "Copiar link"}
                  </button>
                  <a
                    href={createResult.install_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-ailyn-400 hover:text-ailyn-300 border border-gray-700 transition-colors"
                  >
                    Ver tarjeta
                  </a>
                </div>
              )}
              <p className="text-gray-500 text-xs">Comparte este link con tu cliente para que agregue la tarjeta a su wallet.</p>
            </div>
          )}
        </section>

        {/* ── My Cards ────────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Mis tarjetas</h2>
            <button
              onClick={loadPasses}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              Actualizar
            </button>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-5 h-5 border-2 border-ailyn-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : passes.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
              <p className="text-gray-500">No hay tarjetas creadas aun. Crea la primera arriba.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {passes.map((pass) => (
                <div key={pass.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-white font-medium text-sm">{pass.holder_name ?? "Sin nombre"}</p>
                      <p className="text-gray-500 text-xs">{pass.holder_email ?? "Sin email"}</p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        pass.is_installed
                          ? "bg-green-900/50 text-green-400"
                          : "bg-gray-800 text-gray-500"
                      }`}
                    >
                      {pass.is_installed ? "Instalado" : "Sin instalar"}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {pass.install_url && (
                      <a
                        href={pass.install_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-ailyn-400 hover:text-ailyn-300 transition-colors"
                      >
                        Ver tarjeta
                      </a>
                    )}
                    {pass.holder_email && (
                      <button
                        onClick={() => handleSendEmail(pass.serial_number, pass.holder_email!)}
                        disabled={sendingEmail === pass.serial_number}
                        className="text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                      >
                        {sendingEmail === pass.serial_number ? "Enviando..." : "Enviar por email"}
                      </button>
                    )}
                    {!pass.holder_email && (
                      <div className="flex items-center gap-1">
                        <input
                          type="email"
                          placeholder="email@ejemplo.com"
                          value={sendEmailTarget}
                          onChange={(e) => setSendEmailTarget(e.target.value)}
                          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-600 w-36 focus:outline-none focus:border-ailyn-400"
                        />
                        <button
                          onClick={() => handleSendEmail(pass.serial_number, sendEmailTarget)}
                          disabled={sendingEmail === pass.serial_number || !sendEmailTarget.trim()}
                          className="text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                        >
                          Enviar
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-gray-700 text-xs">
                    {new Date(pass.created_at).toLocaleDateString("es-MX", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Push Notification ────────────────────────────────── */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Enviar notificacion push</h2>
          <p className="text-gray-500 text-xs">Envia un mensaje a todos los clientes que tienen tu tarjeta instalada.</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Titulo</label>
              <input
                type="text"
                value={pushTitle}
                onChange={(e) => setPushTitle(e.target.value)}
                placeholder="Nuevo descuento!"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Mensaje</label>
              <textarea
                value={pushMessage}
                onChange={(e) => setPushMessage(e.target.value)}
                placeholder="Aprovecha el 20% de descuento este fin de semana..."
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400 resize-none"
              />
            </div>
          </div>

          <button
            onClick={handlePush}
            disabled={pushing || !pushTitle.trim() || !pushMessage.trim()}
            className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {pushing ? "Enviando..." : "Enviar notificacion push"}
          </button>

          {pushResult && (
            <p className="text-green-400 text-sm">
              Enviado a {pushResult.sent} de {pushResult.total} tarjetas.
            </p>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
