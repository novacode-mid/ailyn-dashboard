"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

/* -- Plan definitions -------------------------------------------------- */

interface PlanDef {
  id: string;
  name: string;
  price: number;
  features: string[];
  recommended?: boolean;
}

const PLANS: PlanDef[] = [
  {
    id: "starter",
    name: "Starter",
    price: 19,
    features: [
      "500 mensajes/mes",
      "100 leads",
      "3 automatizaciones",
      "2 agentes",
      "Sonnet para tareas medias",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 49,
    recommended: true,
    features: [
      "2,000 mensajes/mes",
      "500 leads",
      "10 automatizaciones",
      "4 agentes",
      "Sonnet + Opus",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: 149,
    features: [
      "Mensajes ilimitados",
      "Leads ilimitados",
      "Automatizaciones ilimitadas",
      "6 agentes",
      "Soporte prioritario",
    ],
  },
];

const PLAN_RANK: Record<string, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  enterprise: 3,
};

/* -- Types ------------------------------------------------------------- */

interface DashboardSummary {
  plan: { name: string; chat_limit: number; leads_limit: number };
  usage: { chat_messages: number };
  stats: { total_leads: number };
}

/* -- Helpers ----------------------------------------------------------- */

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(Math.round((used / limit) * 100), 100);
}

function currentRank(planName: string): number {
  return PLAN_RANK[planName.toLowerCase()] ?? 0;
}

/* -- Toast ------------------------------------------------------------- */

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 2500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed bottom-6 right-6 bg-gray-800 border border-gray-700 text-white text-sm px-4 py-3 rounded-xl shadow-lg z-50 animate-fade-in">
      {message}
    </div>
  );
}

/* -- Page -------------------------------------------------------------- */

export default function BillingPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${WORKER_URL}/api/dashboard/summary`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DashboardSummary;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rank = data ? currentRank(data.plan.name) : 0;

  function handlePlanClick(planId: string) {
    const targetRank = PLAN_RANK[planId] ?? 0;
    if (targetRank === rank) return;
    setToast("Proximamente disponible");
  }

  return (
    <DashboardShell>
      <div className="p-6 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-white">Billing</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Administra tu plan y uso de Ailyn
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-3">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={load}
              className="text-xs text-ailyn-400 hover:text-white transition-colors"
            >
              Reintentar
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-ailyn-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : data ? (
          <>
            {/* Current Plan */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
              <p className="text-sm text-gray-400 mb-1">Plan actual</p>
              <p className="text-lg font-bold text-white">
                {data.plan.name}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                {/* Messages usage */}
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Mensajes</span>
                    <span className="text-gray-300">
                      {data.usage.chat_messages} / {data.plan.chat_limit}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-800 mt-2">
                    <div
                      className="h-2 rounded-full bg-ailyn-400 transition-all"
                      style={{
                        width: `${pct(data.usage.chat_messages, data.plan.chat_limit)}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Leads usage */}
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Leads</span>
                    <span className="text-gray-300">
                      {data.stats.total_leads} / {data.plan.leads_limit}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-800 mt-2">
                    <div
                      className="h-2 rounded-full bg-ailyn-400 transition-all"
                      style={{
                        width: `${pct(data.stats.total_leads, data.plan.leads_limit)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Pricing Cards */}
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">Planes</h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {PLANS.map((plan) => {
                  const planRank = PLAN_RANK[plan.id] ?? 0;
                  const isCurrent = planRank === rank;
                  const isUpgrade = planRank > rank;

                  return (
                    <div
                      key={plan.id}
                      className={`relative bg-gray-900 rounded-xl border p-6 flex flex-col ${
                        plan.recommended
                          ? "border-ailyn-400"
                          : "border-gray-800"
                      }`}
                    >
                      {plan.recommended && (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-ailyn-400 text-white text-xs font-medium px-3 py-0.5 rounded-full">
                          Recomendado
                        </span>
                      )}

                      <p className="text-white font-semibold text-lg">
                        {plan.name}
                      </p>
                      <p className="mt-2">
                        <span className="text-3xl font-bold text-white">
                          ${plan.price}
                        </span>
                        <span className="text-gray-400 text-sm">/mes</span>
                      </p>

                      <ul className="mt-5 space-y-2 flex-1">
                        {plan.features.map((f) => (
                          <li
                            key={f}
                            className="flex items-start gap-2 text-sm text-gray-300"
                          >
                            <span className="text-ailyn-400 mt-0.5">
                              &#10003;
                            </span>
                            {f}
                          </li>
                        ))}
                      </ul>

                      <button
                        disabled={isCurrent}
                        onClick={() => handlePlanClick(plan.id)}
                        className={`mt-6 w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${
                          isCurrent
                            ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                            : isUpgrade
                              ? "bg-ailyn-400 hover:bg-ailyn-500 text-white"
                              : "border border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white"
                        }`}
                      >
                        {isCurrent
                          ? "Plan actual"
                          : isUpgrade
                            ? "Actualizar"
                            : "Cambiar"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {toast && <Toast message={toast} onClose={() => setToast("")} />}
    </DashboardShell>
  );
}
