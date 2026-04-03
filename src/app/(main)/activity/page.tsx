"use client";

import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders } from "@/shared/hooks/useAuth";
import { useEffect, useState, useCallback } from "react";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

interface ActionData {
  to?: string;
  subject?: string;
  title?: string;
  date?: string;
  chainIndex?: number;
  chain?: number[];
}

interface ActiveAction {
  id: number;
  type: string;
  status: string;
  data: ActionData;
  scheduled_at?: string;
  created_at: string;
}

interface RecentAction {
  id: number;
  type: string;
  status: string;
  data: ActionData;
  executed_at?: string;
  created_at: string;
}

interface Capability {
  icon: string;
  name: string;
  description: string;
  status: string;
}

interface ActivityData {
  active: ActiveAction[];
  recent: RecentAction[];
  capabilities: Capability[];
}

function typeIcon(type: string): string {
  if (type.includes("email")) return "\u{1F4E7}";
  if (type.includes("meeting") || type.includes("calendar")) return "\u{1F4C5}";
  if (type.includes("followup")) return "\u{1F504}";
  return "\u{1F4CB}";
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    pending:   { bg: "bg-yellow-900/50", text: "text-yellow-400", label: "Pendiente" },
    scheduled: { bg: "bg-blue-900/50",   text: "text-blue-400",   label: "Programada" },
    executed:  { bg: "bg-green-900/50",  text: "text-green-400",  label: "Ejecutada" },
    rejected:  { bg: "bg-gray-800",      text: "text-gray-400",   label: "Rechazada" },
    failed:    { bg: "bg-red-900/50",    text: "text-red-400",    label: "Fallida" },
  };
  const s = map[status] ?? { bg: "bg-gray-800", text: "text-gray-400", label: status };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

function actionDescription(action: { type: string; data: ActionData }): string {
  const d = action.data;
  if (d.to && d.subject) return `${d.to} - ${d.subject}`;
  if (d.to) return d.to;
  if (d.subject) return d.subject;
  if (d.title) return d.title;
  return action.type.replace(/_/g, " ");
}

export default function ActivityPage() {
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Set<number>>(new Set());
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${WORKER_URL}/api/activity`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Error al cargar actividad");
      const json = await res.json() as ActivityData;
      setData(json);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleCancel(id: number) {
    setCancelling((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`${WORKER_URL}/api/activity/${id}/cancel`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Error al cancelar");
      setRemoved((prev) => new Set(prev).add(id));
    } catch {
      // revert
    } finally {
      setCancelling((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text.replace(/"/g, ""));
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  }

  const visibleActive = (data?.active ?? []).filter((a) => !removed.has(a.id));

  return (
    <DashboardShell>
      <div className="p-6 max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Centro de Actividad</h1>
          <p className="text-gray-400 text-sm mt-1">Todo lo que Ailyn puede hacer y lo que esta haciendo por ti</p>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-ailyn-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 flex items-center justify-between">
            <p className="text-red-400 text-sm">{error}</p>
            <button onClick={fetchData} className="text-sm text-red-300 hover:text-white underline">
              Reintentar
            </button>
          </div>
        )}

        {data && !loading && (
          <>
            {/* Section 1: Capabilities */}
            <section>
              <h2 className="text-lg font-semibold text-white mb-4">Lo que Ailyn puede hacer</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {data.capabilities.map((cap) => (
                  <div
                    key={cap.name}
                    className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors group"
                  >
                    <div className="text-2xl mb-2">{cap.icon}</div>
                    <p className="font-medium text-white text-sm">{cap.name}</p>
                    <p className="text-gray-500 text-xs mt-1 italic leading-relaxed">{cap.description}</p>
                    <button
                      onClick={() => handleCopy(cap.description)}
                      className="mt-2 text-xs text-gray-600 hover:text-ailyn-400 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      {copied === cap.description ? "Copiado!" : "Copiar ejemplo"}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Section 2: Active actions */}
            <section>
              <h2 className="text-lg font-semibold text-white mb-4">
                Acciones activas
                {visibleActive.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-500">({visibleActive.length})</span>
                )}
              </h2>
              {visibleActive.length === 0 ? (
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
                  <p className="text-gray-500 text-sm">No hay acciones activas. Pide algo a Ailyn desde el chat.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleActive.map((action) => (
                    <div
                      key={action.id}
                      className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center gap-4 hover:border-gray-700 transition-all"
                    >
                      <span className="text-xl shrink-0">{typeIcon(action.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{actionDescription(action)}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {statusBadge(action.status)}
                          {action.type === "send_followup" && action.data.chain && (
                            <span className="text-xs text-gray-500">
                              Paso {(action.data.chainIndex ?? 0) + 1}/{action.data.chain.length}
                            </span>
                          )}
                          {action.scheduled_at && (
                            <span className="text-xs text-gray-500">
                              Programada: {new Date(action.scheduled_at).toLocaleDateString("es")}
                            </span>
                          )}
                          <span className="text-xs text-gray-600">{relativeTime(action.created_at)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleCancel(action.id)}
                        disabled={cancelling.has(action.id)}
                        className="shrink-0 px-3 py-1.5 text-xs border border-red-800 text-red-400 rounded-md hover:bg-red-900/30 hover:text-red-300 transition-colors disabled:opacity-50"
                      >
                        {cancelling.has(action.id) ? "..." : "Cancelar"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Section 3: Recent history */}
            <section>
              <h2 className="text-lg font-semibold text-white mb-4">
                Historial reciente
                <span className="ml-2 text-xs font-normal text-gray-500">(7 dias)</span>
              </h2>
              {data.recent.length === 0 ? (
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
                  <p className="text-gray-500 text-sm">No hay actividad reciente.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {data.recent.map((action) => (
                    <div
                      key={action.id}
                      className="bg-gray-900/50 border border-gray-800/50 rounded-lg px-4 py-3 flex items-center gap-4"
                    >
                      <span className="text-lg shrink-0 opacity-70">{typeIcon(action.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-300 text-sm truncate">{actionDescription(action)}</p>
                      </div>
                      {statusBadge(action.status)}
                      <span className="text-xs text-gray-600 shrink-0">
                        {relativeTime(action.executed_at ?? action.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
