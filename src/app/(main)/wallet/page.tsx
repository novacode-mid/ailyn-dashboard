"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders, getUser } from "@/shared/hooks/useAuth";

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
  const user = getUser();
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);

  // Send email
  const [sendingEmail, setSendingEmail] = useState<number | null>(null);
  const [sendEmailTarget, setSendEmailTarget] = useState("");

  // Push
  const [pushTitle, setPushTitle] = useState("");
  const [pushMsg, setPushMsg] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState("");

  const [copied, setCopied] = useState(false);

  const loadPasses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/wallet/my-passes`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { passes: Pass[] };
      setPasses(data.passes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadPasses(); }, [loadPasses]);

  const installed = passes.filter(p => p.is_installed);
  const total = passes.length;
  const rate = total > 0 ? Math.round((installed.length / total) * 100) : 0;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateResult(null);
    try {
      const res = await fetch(`${WORKER_URL}/api/wallet/create-pass`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ holder_name: name.trim(), holder_email: email.trim() || undefined, holder_phone: phone.trim() || undefined }),
      });
      const data = await res.json() as CreateResult;
      setCreateResult(data);
      setName(""); setEmail(""); setPhone("");
      loadPasses();
    } catch { setError("Error al crear tarjeta"); }
    finally { setCreating(false); }
  }

  async function handleSendEmail(passId: number, targetEmail: string) {
    if (!targetEmail.trim()) return;
    setSendingEmail(passId);
    try {
      await fetch(`${WORKER_URL}/api/wallet/send-pass`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ pass_id: passId, email: targetEmail.trim() }),
      });
    } catch { /* */ }
    finally { setSendingEmail(null); setSendEmailTarget(""); }
  }

  async function handlePush(e: React.FormEvent) {
    e.preventDefault();
    if (!pushTitle.trim() || !pushMsg.trim()) return;
    setPushing(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/wallet/push-notification`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ title: pushTitle.trim(), body: pushMsg.trim() }),
      });
      const data = await res.json() as { sent?: number; total?: number };
      setPushResult(`Enviado a ${data.sent ?? 0} de ${data.total ?? 0} tarjetas`);
      setPushTitle(""); setPushMsg("");
      setTimeout(() => setPushResult(""), 3000);
    } catch { setPushResult("Error al enviar"); }
    finally { setPushing(false); }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <DashboardShell>
      <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
        <div>
          <h1 className="text-xl font-bold text-white">Tarjetas Digitales</h1>
          <p className="text-gray-400 text-sm mt-0.5">Crea tarjetas para Apple/Google Wallet con chat integrado</p>
        </div>

        {/* Metricas */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-white">{total}</p>
            <p className="text-xs text-gray-400 mt-1">Creadas</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{installed.length}</p>
            <p className="text-xs text-gray-400 mt-1">Instaladas</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-purple-400">{rate}%</p>
            <p className="text-xs text-gray-400 mt-1">Tasa instalacion</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Crear tarjeta */}
          <div className="space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <h2 className="text-white font-medium text-sm">Crear nueva tarjeta</h2>
              <form onSubmit={handleCreate} className="space-y-3">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del cliente" required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (opcional)" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400" />
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefono (opcional)" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400" />
                <button type="submit" disabled={creating || !name.trim()} className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors">
                  {creating ? "Creando..." : "Crear tarjeta"}
                </button>
              </form>

              {createResult?.ok && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 space-y-2">
                  <p className="text-green-400 text-sm font-medium">Tarjeta creada</p>
                  {createResult.install_url && (
                    <div className="flex gap-2">
                      <input type="text" readOnly value={createResult.install_url} className="flex-1 bg-gray-800 rounded px-2 py-1 text-xs text-gray-300 font-mono" />
                      <button onClick={() => copyToClipboard(createResult.install_url!)} className="text-xs text-purple-400 hover:text-purple-300 whitespace-nowrap">
                        {copied ? "Copiado!" : "Copiar"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Preview tarjeta */}
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700/50 rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full -translate-y-8 translate-x-8" />
              <div className="relative">
                <div className="flex items-center justify-between mb-6">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                    <span className="text-purple-300 font-bold">{user?.company_name?.charAt(0) ?? "A"}</span>
                  </div>
                  <span className="text-gray-500 text-[10px] font-mono">DIGITAL PASS</span>
                </div>
                <p className="text-white font-bold text-lg">{user?.company_name ?? "Tu Empresa"}</p>
                <p className="text-gray-400 text-sm mt-1">{name || "Nombre del cliente"}</p>
                <div className="flex items-center justify-between mt-6">
                  <div>
                    <p className="text-gray-500 text-[10px]">MIEMBRO DESDE</p>
                    <p className="text-gray-300 text-xs">{new Date().toLocaleDateString("es-MX", { month: "short", year: "numeric" })}</p>
                  </div>
                  <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
                      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Push notifications + lista */}
          <div className="space-y-4">
            {/* Push */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <h2 className="text-white font-medium text-sm">Push Notification</h2>
              <p className="text-gray-500 text-xs">Envia un mensaje a todos los clientes con tarjeta instalada ({installed.length})</p>
              <form onSubmit={handlePush} className="space-y-2">
                <input type="text" value={pushTitle} onChange={(e) => setPushTitle(e.target.value)} placeholder="Titulo" required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400" />
                <textarea value={pushMsg} onChange={(e) => setPushMsg(e.target.value)} placeholder="Mensaje" required rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 resize-none" />
                <button type="submit" disabled={pushing || !pushTitle.trim() || !pushMsg.trim()} className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
                  {pushing ? "Enviando..." : "Enviar push"}
                </button>
              </form>
              {pushResult && <p className="text-green-400 text-xs">{pushResult}</p>}
            </div>

            {/* Lista de tarjetas */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-white font-medium text-sm mb-3">Tarjetas ({total})</h2>
              {loading ? (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : error ? (
                <p className="text-red-400 text-xs">{error}</p>
              ) : passes.length === 0 ? (
                <p className="text-gray-500 text-xs text-center py-6">Aun no tienes tarjetas. Crea la primera.</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {passes.map((pass) => (
                    <div key={pass.id} className="bg-gray-800/50 rounded-lg p-3 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{pass.holder_name ?? "Sin nombre"}</p>
                        <p className="text-gray-500 text-[11px]">{pass.holder_email ?? "Sin email"}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${pass.is_installed ? "bg-green-500/10 text-green-400" : "bg-gray-700 text-gray-400"}`}>
                          {pass.is_installed ? "Instalada" : "Pendiente"}
                        </span>
                        {pass.install_url && (
                          <button onClick={() => copyToClipboard(pass.install_url!)} className="text-[10px] text-purple-400 hover:text-purple-300">
                            Link
                          </button>
                        )}
                        {pass.holder_email && (
                          <button
                            onClick={() => handleSendEmail(pass.id, pass.holder_email!)}
                            disabled={sendingEmail === pass.id}
                            className="text-[10px] text-purple-400 hover:text-purple-300 disabled:opacity-50"
                          >
                            {sendingEmail === pass.id ? "..." : "Email"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
