"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

interface Lead {
  id: string;
  contact_name: string;
  contact_email: string;
  contact_company: string | null;
  contact_message: string | null;
  company_id: string;
  lead_score: number;
  urgency: string;
  research_status: string;
  brief_summary: string | null;
  recommended_unit: string | null;
  created_at: string;
}

const URGENCY_STYLE: Record<string, string> = {
  high:   "bg-red-900/40 text-red-400 border border-red-800",
  medium: "bg-yellow-900/40 text-yellow-400 border border-yellow-800",
  low:    "bg-gray-800 text-gray-400 border border-gray-700",
};

const URGENCY_LABEL: Record<string, string> = {
  high: "Alta", medium: "Media", low: "Baja",
};

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? "text-green-400" : score >= 60 ? "text-yellow-400" : "text-gray-400";
  return <span className={`font-bold text-sm ${color}`}>{score}</span>;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${WORKER_URL}/api/leads?limit=50`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { leads?: Lead[] } | Lead[];
      setLeads(Array.isArray(data) ? data : (data as { leads?: Lead[] }).leads ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar leads");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <DashboardShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Leads</h1>
            <p className="text-gray-400 text-sm mt-0.5">Investigados por IA con score y urgencia</p>
          </div>
          <button
            onClick={load}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Actualizar
          </button>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-ailyn-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-20 text-gray-500">No hay leads registrados.</div>
        ) : (
          <div className="space-y-2">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => setExpanded(expanded === lead.id ? null : lead.id)}
                  className="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-gray-800/50 transition-colors"
                >
                  <div className="w-10 text-center">
                    <ScoreBadge score={lead.lead_score} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{lead.contact_name}</p>
                    <p className="text-gray-500 text-xs truncate">{lead.contact_company ?? lead.contact_email}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${URGENCY_STYLE[lead.urgency] ?? URGENCY_STYLE.low}`}>
                    {URGENCY_LABEL[lead.urgency] ?? lead.urgency}
                  </span>
                  <span className="text-xs text-gray-600 shrink-0 hidden md:block">
                    {new Date(lead.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                  </span>
                  <span className="text-gray-600 text-xs shrink-0">{expanded === lead.id ? "▲" : "▼"}</span>
                </button>

                {expanded === lead.id && (
                  <div className="border-t border-gray-800 px-4 py-3 space-y-2 bg-gray-900/50">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div>
                        <p className="text-gray-500">Email</p>
                        <p className="text-gray-300">{lead.contact_email}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Estado</p>
                        <p className="text-gray-300">{lead.research_status}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Unidad recomendada</p>
                        <p className="text-gray-300">{lead.recommended_unit ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Mensaje</p>
                        <p className="text-gray-300 truncate">{lead.contact_message ?? "—"}</p>
                      </div>
                    </div>
                    {lead.brief_summary && (
                      <div className="bg-gray-800 rounded p-3">
                        <p className="text-xs text-gray-400 mb-1">Brief IA</p>
                        <p className="text-sm text-gray-200">{lead.brief_summary}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
