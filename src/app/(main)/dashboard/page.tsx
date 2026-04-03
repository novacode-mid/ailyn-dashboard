"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

/* ── Types ─────────────────────────────────────────────────── */

interface DashboardPlan {
  name: string;
  chat_limit: number;
  leads_limit: number;
}

interface DashboardUsage {
  chat_messages: number;
}

interface DashboardStats {
  total_leads: number;
  emails_sent: number;
  meetings_scheduled: number;
}

interface Integration {
  name: string;
  connected: boolean;
}

interface ActivityItem {
  type: string;
  description: string;
  status: string;
  created_at: string;
}

interface DashboardSummary {
  plan: DashboardPlan;
  usage: DashboardUsage;
  stats: DashboardStats;
  integrations: { telegram: boolean; whatsapp: boolean; google: boolean; github: boolean };
  recent_activity: ActivityItem[];
}

/* ── Helpers ───────────────────────────────────────────────── */

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

function activityIcon(type: string): string {
  switch (type) {
    case "send_email": return "\uD83D\uDCE7";
    case "schedule_meeting": return "\uD83D\uDCC5";
    case "send_followup": return "\uD83D\uDD04";
    default: return "\u26A1";
  }
}

function activityLabel(type: string, desc: string): string {
  if (desc && desc !== type) return desc;
  switch (type) {
    case "send_email": return "Email enviado";
    case "schedule_meeting": return "Reunión agendada";
    case "send_followup": return "Follow-up programado";
    default: return type;
  }
}

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(Math.round((used / limit) * 100), 100);
}

/* ── Sub-components ────────────────────────────────────────── */

function ProgressBar({ value, max, warn }: { value: number; max: number; warn?: boolean }) {
  const p = pct(value, max);
  const barColor = p > 95 ? "bg-red-500" : p > 80 ? "bg-yellow-500" : "bg-ailyn-400";
  return (
    <div className="w-full h-2 rounded-full bg-gray-800 mt-2">
      <div
        className={`h-2 rounded-full transition-all ${barColor}`}
        style={{ width: `${p}%` }}
      />
      {warn && p > 95 && (
        <p className="text-red-400 text-xs mt-1">Actualiza tu plan</p>
      )}
      {warn && p > 80 && p <= 95 && (
        <p className="text-yellow-400 text-xs mt-1">Uso elevado</p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  limit,
  showBar,
}: {
  label: string;
  value: number;
  limit?: number;
  showBar?: boolean;
}) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <p className="text-gray-400 text-sm">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">
        {value.toLocaleString()}
        {limit !== undefined && (
          <span className="text-gray-500 text-base font-normal"> / {limit.toLocaleString()}</span>
        )}
      </p>
      {showBar && limit !== undefined && <ProgressBar value={value} max={limit} />}
    </div>
  );
}

/* ── Onboarding Checklist ─────────────────────────────────── */

function OnboardingChecklist({ integrations, stats }: { integrations: DashboardSummary["integrations"]; stats: DashboardStats }) {
  const items = [
    { key: "telegram", label: "Conectar Telegram", description: "Tu canal principal de comunicación con Ailyn", done: integrations?.telegram ?? false, href: "/settings", icon: "💬" },
    { key: "google", label: "Conectar Google", description: "Gmail + Calendar para emails y reuniones", done: integrations?.google ?? false, href: "https://ailyn-agent.novacodepro.workers.dev/api/auth/google?company_id=2", icon: "📧" },
    { key: "email", label: "Enviar primer email", description: "Prueba enviando un email desde Telegram", done: (stats?.emails_sent ?? 0) > 0, href: "https://t.me/AgenteAilynbot", icon: "✉️" },
    { key: "meeting", label: "Agendar una reunión", description: "Prueba agendar desde Telegram", done: (stats?.meetings_scheduled ?? 0) > 0, href: "https://t.me/AgenteAilynbot", icon: "📅" },
  ];

  const completed = items.filter(i => i.done).length;
  if (completed === items.length) return null;

  return (
    <div className="bg-gray-900 rounded-xl border border-ailyn-400/30 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-medium text-white">Activa tu asistente</p>
          <p className="text-xs text-gray-400 mt-0.5">{completed} de {items.length} completados</p>
        </div>
        <div className="flex items-center gap-1">
          {items.map(i => (
            <div key={i.key} className={`w-2.5 h-2.5 rounded-full ${i.done ? "bg-ailyn-400" : "bg-gray-700"}`} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {items.map(i => (
          <a
            key={i.key}
            href={i.href}
            target={i.href.startsWith("http") ? "_blank" : undefined}
            rel={i.href.startsWith("http") ? "noopener noreferrer" : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
              i.done
                ? "border-gray-800 bg-gray-800/50 opacity-60"
                : "border-gray-700 bg-gray-800 hover:border-ailyn-400/50"
            }`}
          >
            <span className="text-lg">{i.done ? "✅" : i.icon}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${i.done ? "text-gray-400 line-through" : "text-white"}`}>{i.label}</p>
              <p className="text-xs text-gray-500">{i.description}</p>
            </div>
            {!i.done && <span className="text-gray-500 text-xs">&rarr;</span>}
          </a>
        ))}
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────── */

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      setError(e instanceof Error ? e.message : "Error al cargar dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <DashboardShell>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Dashboard</h1>
            <p className="text-gray-400 text-sm mt-0.5">Resumen de tu actividad con Ailyn</p>
          </div>
          <button
            onClick={load}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Actualizar
          </button>
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
            {/* 0. Onboarding Checklist (se oculta cuando todo está conectado) */}
            <OnboardingChecklist integrations={data.integrations} stats={data.stats} />

            {/* 1. Stats Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Mensajes este mes"
                value={data.usage.chat_messages}
                limit={data.plan.chat_limit}
                showBar
              />
              <StatCard
                label="Leads"
                value={data.stats.total_leads}
                limit={data.plan.leads_limit}
                showBar
              />
              <StatCard label="Emails enviados" value={data.stats.emails_sent} />
              <StatCard label="Reuniones" value={data.stats.meetings_scheduled} />
            </div>

            {/* 2. Integration Status */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
              <p className="text-sm font-medium text-white mb-3">Integraciones</p>
              <div className="flex flex-wrap gap-3">
                {([
                  { name: "Telegram", connected: data.integrations?.telegram },
                  { name: "WhatsApp", connected: data.integrations?.whatsapp },
                  { name: "Google", connected: data.integrations?.google },
                  { name: "GitHub", connected: data.integrations?.github },
                ] as Integration[]).map((ig) => (
                  <span
                    key={ig.name}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border border-gray-700 bg-gray-800"
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${ig.connected ? "bg-green-400" : "bg-gray-600"}`}
                    />
                    <span className="text-gray-300">{ig.name}</span>
                    <span className={ig.connected ? "text-green-400" : "text-gray-500"}>
                      {ig.connected ? "Conectado" : "No conectado"}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {/* 3. Plan Info */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-white">
                  Plan: <span className="text-ailyn-400">{data.plan.name}</span>
                </p>
                <span className="text-xs text-gray-400">
                  {pct(data.usage.chat_messages, data.plan.chat_limit)}% usado
                </span>
              </div>
              <ProgressBar value={data.usage.chat_messages} max={data.plan.chat_limit} warn />
            </div>

            {/* 4. Recent Activity */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
              <p className="text-sm font-medium text-white mb-3">Actividad reciente</p>
              {(data.recent_activity ?? []).length === 0 ? (
                <p className="text-gray-500 text-xs">Sin actividad reciente</p>
              ) : (
                <ul className="space-y-3">
                  {data.recent_activity.slice(0, 10).map((item, idx) => (
                    <li key={idx} className="flex items-start gap-3">
                      <span className="text-base leading-none mt-0.5">{activityIcon(item.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200">{activityLabel(item.type, item.description)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{relativeTime(item.created_at)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 5. Quick Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <a
                href="https://t.me/AilynAssistantBot"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gray-900 rounded-xl border border-gray-800 p-5 text-center hover:border-ailyn-400/50 transition-colors group"
              >
                <span className="text-2xl block mb-2">{"\uD83D\uDCE7"}</span>
                <p className="text-sm font-medium text-white group-hover:text-ailyn-400 transition-colors">
                  Enviar Email
                </p>
              </a>
              <a
                href="https://t.me/AilynAssistantBot"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gray-900 rounded-xl border border-gray-800 p-5 text-center hover:border-ailyn-400/50 transition-colors group"
              >
                <span className="text-2xl block mb-2">{"\uD83D\uDCC5"}</span>
                <p className="text-sm font-medium text-white group-hover:text-ailyn-400 transition-colors">
                  Agendar Reunion
                </p>
              </a>
              <Link
                href="/leads"
                className="bg-gray-900 rounded-xl border border-gray-800 p-5 text-center hover:border-ailyn-400/50 transition-colors group"
              >
                <span className="text-2xl block mb-2">{"\u26A1"}</span>
                <p className="text-sm font-medium text-white group-hover:text-ailyn-400 transition-colors">
                  Ver Leads
                </p>
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </DashboardShell>
  );
}
