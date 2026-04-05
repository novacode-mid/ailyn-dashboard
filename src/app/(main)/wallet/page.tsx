"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders, getUser } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";
const QR_API = "https://api.qrserver.com/v1/create-qr-code";

interface Pass {
  id: number;
  serial_number: string;
  company_id: number;
  holder_name: string | null;
  holder_email: string | null;
  holder_phone: string | null;
  install_url: string | null;
  is_installed: number;
  device_type: string | null;
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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);

  // Push
  const [pushTitle, setPushTitle] = useState("");
  const [pushMsg, setPushMsg] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState("");

  // Detail
  const [selectedPass, setSelectedPass] = useState<Pass | null>(null);
  const [sendingEmail, setSendingEmail] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const loadPasses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/wallet/my-passes`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { passes: Pass[] };
      setPasses(data.passes ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadPasses(); }, [loadPasses]);

  const installed = passes.filter(p => p.is_installed);
  const total = passes.length;
  const rate = total > 0 ? Math.round((installed.length / total) * 100) : 0;
  const iosCount = passes.filter(p => p.device_type === "ios").length;
  const androidCount = passes.filter(p => p.device_type === "android").length;

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      const b64 = await new Promise<string>((resolve) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]); // Remove "data:image/...;base64,"
        };
        reader.readAsDataURL(file);
      });

      const res = await fetch(`${WORKER_URL}/api/wallet/upload-image`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ image_base64: b64, filename: file.name }),
      });
      const data = await res.json() as { image_url?: string };
      if (data.image_url) setThumbnailUrl(data.image_url);
    } catch { /* */ }
    finally { setUploading(false); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) return;
    setCreating(true);
    setCreateResult(null);
    try {
      const res = await fetch(`${WORKER_URL}/api/wallet/create-pass`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim() || undefined,
          thumbnail_url: thumbnailUrl || undefined,
        }),
      });
      const data = await res.json() as CreateResult;
      if (data.ok) {
        setCreateResult(data);
        setFirstName(""); setLastName(""); setEmail(""); setThumbnailUrl("");
        loadPasses();
      } else {
        setError((data as unknown as { error?: string }).error ?? "Error al crear");
      }
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
    finally { setSendingEmail(null); }
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
      setPushResult(`Enviado a ${data.sent ?? 0} de ${data.total ?? 0}`);
      setPushTitle(""); setPushMsg("");
      setTimeout(() => setPushResult(""), 3000);
    } catch { setPushResult("Error"); }
    finally { setPushing(false); }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function qrUrl(content: string, size = 200): string {
    return `${QR_API}/?size=${size}x${size}&data=${encodeURIComponent(content)}&bgcolor=0f172a&color=ffffff`;
  }

  return (
    <DashboardShell>
      <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
        <div>
          <h1 className="text-xl font-bold text-white">Tarjetas Digitales</h1>
          <p className="text-gray-400 text-sm mt-0.5">Crea tarjetas para Apple/Google Wallet con chat integrado</p>
        </div>

        {/* Metricas */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-white">{total}</p>
            <p className="text-[10px] text-gray-400">Creadas</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-green-400">{installed.length}</p>
            <p className="text-[10px] text-gray-400">Instaladas</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-purple-400">{rate}%</p>
            <p className="text-[10px] text-gray-400">Tasa</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-blue-400">{iosCount}</p>
            <p className="text-[10px] text-gray-400">iOS</p>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-green-300">{androidCount}</p>
            <p className="text-[10px] text-gray-400">Android</p>
          </div>
        </div>

        {error && <p className="text-red-400 text-xs">{error}</p>}

        {/* ── Resultado de crear tarjeta: Preview + QR ── */}
        {createResult?.ok && createResult.install_url && (
          <div className="bg-gradient-to-br from-purple-900/30 to-gray-900 border border-purple-500/20 rounded-2xl p-6 space-y-5">
            <div className="text-center">
              <p className="text-green-400 font-semibold text-sm">Tarjeta creada exitosamente</p>
              <p className="text-gray-400 text-xs mt-1">Comparte el QR para que tu cliente la instale</p>
            </div>

            {/* Preview tarjeta */}
            <div className="mx-auto max-w-xs bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700/50 rounded-2xl p-5 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full -translate-y-6 translate-x-6" />
              <div className="relative">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                    <span className="text-purple-300 font-bold text-xs">{user?.company_name?.charAt(0) ?? "A"}</span>
                  </div>
                  <span className="text-gray-600 text-[8px] font-mono">DIGITAL PASS</span>
                </div>
                <p className="text-white font-bold">{user?.company_name}</p>
                <p className="text-gray-400 text-sm mt-0.5">Miembro digital</p>
              </div>
            </div>

            {/* QR Codes para Apple y Android */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Apple Wallet */}
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 text-center space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xl">🍎</span>
                  <span className="text-white text-sm font-medium">Apple Wallet</span>
                </div>
                <img
                  src={qrUrl(createResult.install_url)}
                  alt="QR Apple Wallet"
                  className="mx-auto rounded-lg"
                  width={160}
                  height={160}
                />
                <p className="text-gray-500 text-[10px]">Escanea con la camara del iPhone</p>
                <a
                  href={createResult.install_url}
                  target="_blank"
                  rel="noopener"
                  className="inline-block bg-black text-white text-xs font-medium px-4 py-2 rounded-lg border border-gray-600 hover:border-gray-400 transition-colors"
                >
                  Agregar a Apple Wallet
                </a>
              </div>

              {/* Google Wallet */}
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 text-center space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xl">🤖</span>
                  <span className="text-white text-sm font-medium">Google Wallet</span>
                </div>
                <img
                  src={qrUrl(createResult.install_url)}
                  alt="QR Google Wallet"
                  className="mx-auto rounded-lg"
                  width={160}
                  height={160}
                />
                <p className="text-gray-500 text-[10px]">Escanea con la camara de Android</p>
                <a
                  href={createResult.install_url}
                  target="_blank"
                  rel="noopener"
                  className="inline-block bg-white text-black text-xs font-medium px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Agregar a Google Wallet
                </a>
              </div>
            </div>

            {/* URL directa + compartir */}
            <div className="bg-gray-800/50 rounded-lg p-3 space-y-2">
              <p className="text-gray-400 text-[10px]">URL de instalacion:</p>
              <div className="flex gap-2">
                <input type="text" readOnly value={createResult.install_url} className="flex-1 bg-gray-900 rounded px-2 py-1 text-[11px] text-gray-300 font-mono" />
                <button onClick={() => copy(createResult.install_url!)} className="text-[11px] text-purple-400 hover:text-purple-300 whitespace-nowrap">
                  {copied ? "Copiado!" : "Copiar"}
                </button>
              </div>
            </div>

            <button onClick={() => setCreateResult(null)} className="text-xs text-gray-500 hover:text-gray-300 w-full text-center">
              Crear otra tarjeta
            </button>
          </div>
        )}

        {/* ── Layout principal ── */}
        {!createResult?.ok && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Crear tarjeta */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <h2 className="text-white font-medium text-sm">Crear nueva tarjeta</h2>
              <form onSubmit={handleCreate} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Nombre *" required className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400" />
                  <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Apellido" className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400" />
                </div>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400" />

                {/* Foto */}
                <div className="flex items-center gap-3">
                  {thumbnailUrl ? (
                    <img src={thumbnailUrl} alt="" className="w-12 h-12 rounded-full object-cover border border-gray-700" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-lg">📷</div>
                  )}
                  <label className="flex-1">
                    <span className="text-xs text-purple-400 hover:text-purple-300 cursor-pointer">{uploading ? "Subiendo..." : thumbnailUrl ? "Cambiar foto" : "Subir foto del cliente"}</span>
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={uploading} />
                  </label>
                </div>

                <button type="submit" disabled={creating || !firstName.trim()} className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors">
                  {creating ? "Creando..." : "Crear tarjeta"}
                </button>
              </form>
            </div>

            {/* Push notifications */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <h2 className="text-white font-medium text-sm">Push Notification</h2>
              <p className="text-gray-500 text-xs">Envia a {installed.length} clientes con tarjeta instalada</p>
              <form onSubmit={handlePush} className="space-y-2">
                <input type="text" value={pushTitle} onChange={(e) => setPushTitle(e.target.value)} placeholder="Titulo" required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400" />
                <textarea value={pushMsg} onChange={(e) => setPushMsg(e.target.value)} placeholder="Mensaje" required rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 resize-none" />
                <button type="submit" disabled={pushing || !pushTitle.trim() || !pushMsg.trim()} className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg transition-colors">
                  {pushing ? "Enviando..." : "Enviar push"}
                </button>
              </form>
              {pushResult && <p className="text-green-400 text-xs">{pushResult}</p>}
            </div>
          </div>
        )}

        {/* ── Lista de tarjetas ── */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-medium text-sm">Tarjetas ({total})</h2>
            <button onClick={loadPasses} className="text-[10px] text-purple-400 hover:text-purple-300">Actualizar</button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : passes.length === 0 ? (
            <p className="text-gray-500 text-xs text-center py-6">Crea tu primera tarjeta arriba</p>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {passes.map((pass) => (
                <div key={pass.id} className="bg-gray-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${pass.is_installed ? "bg-green-400" : "bg-gray-600"}`} />
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{pass.holder_name ?? "Sin nombre"}</p>
                        <p className="text-gray-500 text-[10px]">
                          {pass.holder_email ?? "sin email"}
                          {pass.device_type ? ` · ${pass.device_type === "ios" ? "🍎" : "🤖"} ${pass.device_type}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${pass.is_installed ? "bg-green-500/10 text-green-400" : "bg-gray-700 text-gray-400"}`}>
                        {pass.is_installed ? "Instalada" : "Pendiente"}
                      </span>
                      {pass.install_url && (
                        <button onClick={() => setSelectedPass(selectedPass?.id === pass.id ? null : pass)} className="text-[10px] text-purple-400 hover:text-purple-300">
                          {selectedPass?.id === pass.id ? "▲" : "QR"}
                        </button>
                      )}
                      {pass.holder_email && (
                        <button onClick={() => handleSendEmail(pass.id, pass.holder_email!)} disabled={sendingEmail === pass.id} className="text-[10px] text-purple-400 hover:text-purple-300 disabled:opacity-50">
                          {sendingEmail === pass.id ? "..." : "Email"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* QR expandido */}
                  {selectedPass?.id === pass.id && pass.install_url && (
                    <div className="mt-3 pt-3 border-t border-gray-700/50 flex gap-4 justify-center">
                      <div className="text-center">
                        <img src={qrUrl(pass.install_url, 120)} alt="QR" className="rounded-lg mx-auto" width={120} height={120} />
                        <p className="text-gray-500 text-[9px] mt-1">Escanear para instalar</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
