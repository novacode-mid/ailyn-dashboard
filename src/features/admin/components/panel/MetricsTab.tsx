"use client";

import { useEffect, useState, useCallback } from "react";
import { getGlobalMetrics, type GlobalMetrics } from "@/features/admin/services/admin-api";

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

export default function MetricsTab() {
  const [metrics, setMetrics] = useState<GlobalMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getGlobalMetrics();
      setMetrics(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Métricas Globales</h2>
        <button
          onClick={load}
          className="text-gray-400 hover:text-white text-sm transition-colors"
        >
          Actualizar
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-ailyn-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !metrics ? null : (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard label="Clientes" value={metrics.total_companies} />
            <StatCard label="Total Leads" value={metrics.total_leads} />
            <StatCard label="Emails enviados" value={metrics.total_emails_sent} />
            <StatCard label="Follow-ups" value={metrics.total_followups} />
            <StatCard label="Leads últimos 30d" value={metrics.leads_last_30d} />
          </div>

          {/* Top clients */}
          {metrics.top_companies.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <h3 className="text-sm font-medium text-white">Top Clientes por Leads</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2 text-gray-400 font-medium">#</th>
                    <th className="text-left px-4 py-2 text-gray-400 font-medium">Cliente</th>
                    <th className="text-right px-4 py-2 text-gray-400 font-medium">Leads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {metrics.top_companies.map((c, i) => (
                    <tr key={c.name} className="hover:bg-gray-800/50 transition-colors">
                      <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                      <td className="px-4 py-3 text-white">{c.name}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-ailyn-400 font-semibold">{c.lead_count}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
