"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type Tab = "overview" | "empresas" | "actividad" | "followups" | "smartpasses" | "sistema";

interface Company {
  id: number;
  name: string;
  slug: string;
  plan_slug: string;
  industry: string;
  created_at: string;
  user_count: number;
  message_count: number;
  emails_sent: number;
  meetings_count: number;
  telegram_bot: string | null;
  has_whatsapp: number;
  has_google: number;
}

interface Stats {
  total_companies: number;
  total_users: number;
  total_messages: number;
  messages_24h: number;
  messages_7d: number;
  total_emails: number;
  total_meetings: number;
  total_followups: number;
  total_leads: number;
}

interface RecentAction {
  id: number;
  company_id: string;
  action_type: string;
  action_data: Record<string, unknown>;
  status: string;
  created_at: string;
  executed_at: string | null;
  company_name: string;
}

interface Followup {
  id: number;
  company_id: string;
  action_data: Record<string, unknown>;
  status: string;
  followup_scheduled_at: string | null;
  followup_number: number;
  company_name: string;
}

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";
const getAdminToken = () => sessionStorage.getItem("ailyn_admin_token") ?? "";
const adminHeaders = () => ({ "Content-Type": "application/json", "X-CF-Token": getAdminToken() });

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

const ACTION_LABELS: Record<string, string> = {
  send_email: "Email",
  schedule_meeting: "Reunion",
  send_followup: "Follow-up",
  create_lead: "Lead",
  update_lead: "Lead Update",
};

const STATUS_COLORS: Record<string, string> = {
  executed: "bg-green-900/50 text-green-400",
  pending: "bg-yellow-900/50 text-yellow-400",
  scheduled: "bg-blue-900/50 text-blue-400",
  cancelled: "bg-gray-800 text-gray-500",
  failed: "bg-red-900/50 text-red-400",
};

const PLANS = ["free", "starter", "pro", "enterprise"];

export default function SuperadminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentActions, setRecentActions] = useState<RecentAction[]>([]);
  const [systemStatus, setSystemStatus] = useState("active");
  const [activeFollowups, setActiveFollowups] = useState<Followup[]>([]);
  const [planEditing, setPlanEditing] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/admin/superadmin`, { headers: adminHeaders() });
      if (!res.ok) throw new Error("Unauthorized");
      const data = await res.json();
      setCompanies(data.companies ?? []);
      setStats(data.stats ?? null);
      setRecentActions(data.recentActions ?? []);
      setSystemStatus(data.systemStatus ?? "active");
      setActiveFollowups(data.activeFollowups ?? []);
    } catch {
      sessionStorage.removeItem("ailyn_admin_token");
      router.replace("/admin");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const token = sessionStorage.getItem("ailyn_admin_token");
    if (!token) { router.replace("/admin"); return; }
    setReady(true);
    fetchData();
  }, [router, fetchData]);

  async function toggleSystem() {
    const res = await fetch(`${WORKER_URL}/api/admin/system/toggle`, { method: "POST", headers: adminHeaders() });
    if (res.ok) {
      const data = await res.json();
      setSystemStatus(data.status);
    }
  }

  async function changePlan(companyId: number, newPlan: string) {
    await fetch(`${WORKER_URL}/api/admin/company/${companyId}/plan`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ plan_slug: newPlan }),
    });
    setPlanEditing(null);
    fetchData();
  }

  async function impersonate(companyId: number) {
    try {
      const res = await fetch(`${WORKER_URL}/api/admin/company/${companyId}/impersonate`, {
        method: "POST",
        headers: adminHeaders(),
      });
      const data = await res.json() as { token?: string; user?: Record<string, unknown>; error?: string };
      if (data.token && data.user) {
        // Guardar sesión del usuario impersonado
        sessionStorage.setItem("ailyn_token", data.token);
        sessionStorage.setItem("ailyn_user", JSON.stringify(data.user));
        // Abrir dashboard en nueva pestaña
        window.open("/dashboard", "_blank");
      } else {
        alert(data.error ?? "Error al impersonar");
      }
    } catch {
      alert("Error de conexión");
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("ailyn_admin_token");
    router.replace("/admin");
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "empresas", label: "Empresas" },
    { id: "actividad", label: "Actividad Global" },
    { id: "followups", label: "Follow-ups" },
    { id: "smartpasses", label: "SmartPasses" },
    { id: "sistema", label: "Sistema" },
  ];

  return (
    <div className="min-h-screen bg-[#0f172a] text-white relative overflow-hidden">
      {/* Background orbs */}
      <div className="orb orb-purple" />
      <div className="orb orb-cyan" />
      <div className="orb orb-pink" />
      {/* Header */}
      <header className="border-b border-white/[0.08] glass-sidebar">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-amber-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs">SA</span>
            </div>
            <span className="font-semibold text-white">Ailyn Superadmin</span>
            <button
              onClick={toggleSystem}
              className="flex items-center gap-1.5 ml-4 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer"
              style={{
                borderColor: systemStatus === "active" ? "#22c55e" : "#ef4444",
                background: systemStatus === "active" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                color: systemStatus === "active" ? "#4ade80" : "#f87171",
              }}
            >
              <span className={`w-2 h-2 rounded-full ${systemStatus === "active" ? "bg-green-400" : "bg-red-400"}`} />
              {systemStatus === "active" ? "Activo" : "Pausado"}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={fetchData} className="text-gray-400 hover:text-white text-sm transition-colors">
              Refrescar
            </button>
            <button onClick={handleLogout} className="text-gray-400 hover:text-white text-sm transition-colors">
              Salir
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-white/[0.08] glass-sidebar">
        <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                tab === t.id
                  ? "border-amber-400 text-white"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {tab === "overview" && stats && <OverviewTab stats={stats} systemStatus={systemStatus} />}
            {tab === "empresas" && (
              <EmpresasTab
                companies={companies}
                planEditing={planEditing}
                setPlanEditing={setPlanEditing}
                changePlan={changePlan}
                impersonate={impersonate}
              />
            )}
            {tab === "actividad" && <ActividadTab actions={recentActions} />}
            {tab === "followups" && <FollowupsTab followups={activeFollowups} />}
            {tab === "smartpasses" && <SmartPassesTab companies={companies} />}
            {tab === "sistema" && <SistemaTab systemStatus={systemStatus} toggleSystem={toggleSystem} />}
          </>
        )}
      </main>
    </div>
  );
}

/* ── Tab: Overview ─────────────────────────────────────────────────────── */

function OverviewTab({ stats, systemStatus }: { stats: Stats; systemStatus: string }) {
  const mainCards = [
    { label: "Total Empresas", value: stats.total_companies, color: "text-amber-400" },
    { label: "Total Usuarios", value: stats.total_users, color: "text-blue-400" },
    { label: "Mensajes (24h)", value: stats.messages_24h, color: "text-green-400" },
    { label: "Mensajes (7d)", value: stats.messages_7d, color: "text-purple-400" },
  ];
  const secondaryCards = [
    { label: "Emails Enviados", value: stats.total_emails },
    { label: "Reuniones Agendadas", value: stats.total_meetings },
    { label: "Follow-ups", value: stats.total_followups },
    { label: "Leads Totales", value: stats.total_leads },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <h2 className="text-lg font-semibold">Platform Overview</h2>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            systemStatus === "active" ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"
          }`}
        >
          Sistema {systemStatus === "active" ? "Activo" : "Pausado"}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {mainCards.map((c) => (
          <div key={c.label} className="glass rounded-2xl p-5">
            <div className="text-gray-400 text-sm mb-1">{c.label}</div>
            <div className={`text-3xl font-bold ${c.color}`}>{c.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {secondaryCards.map((c) => (
          <div key={c.label} className="glass-light rounded-xl p-4">
            <div className="text-gray-500 text-xs mb-1">{c.label}</div>
            <div className="text-xl font-semibold text-gray-200">{c.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="glass-light rounded-xl p-4 text-sm text-gray-500">
        Total mensajes historicos: <span className="text-gray-300 font-medium">{stats.total_messages.toLocaleString()}</span>
      </div>
    </div>
  );
}

/* ── Tab: Empresas ─────────────────────────────────────────────────────── */

function EmpresasTab({
  companies,
  planEditing,
  setPlanEditing,
  changePlan,
  impersonate,
}: {
  companies: Company[];
  planEditing: number | null;
  setPlanEditing: (id: number | null) => void;
  changePlan: (id: number, plan: string) => void;
  impersonate: (id: number) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Empresas ({companies.length})</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] text-left text-white/50">
              <th className="pb-3 pr-4 font-medium">Empresa</th>
              <th className="pb-3 pr-4 font-medium">Plan</th>
              <th className="pb-3 pr-4 font-medium text-center">Usuarios</th>
              <th className="pb-3 pr-4 font-medium text-center">Mensajes</th>
              <th className="pb-3 pr-4 font-medium text-center">Emails</th>
              <th className="pb-3 pr-4 font-medium text-center">Reuniones</th>
              <th className="pb-3 pr-4 font-medium text-center">TG</th>
              <th className="pb-3 pr-4 font-medium text-center">WA</th>
              <th className="pb-3 pr-4 font-medium text-center">Google</th>
              <th className="pb-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c, i) => (
              <tr key={c.id} className={`border-b border-white/[0.05] ${i % 2 === 0 ? "bg-white/[0.03]" : ""}`}>
                <td className="py-3 pr-4">
                  <div className="font-medium text-white">{c.name}</div>
                  <div className="text-gray-500 text-xs">{c.slug} &middot; {c.industry ?? "N/A"}</div>
                </td>
                <td className="py-3 pr-4">
                  {planEditing === c.id ? (
                    <select
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                      defaultValue={c.plan_slug ?? "free"}
                      onChange={(e) => changePlan(c.id, e.target.value)}
                      onBlur={() => setPlanEditing(null)}
                      autoFocus
                    >
                      {PLANS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-900/40 text-amber-400">
                      {c.plan_slug ?? "free"}
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4 text-center text-gray-300">{c.user_count}</td>
                <td className="py-3 pr-4 text-center text-gray-300">{c.message_count.toLocaleString()}</td>
                <td className="py-3 pr-4 text-center text-gray-300">{c.emails_sent}</td>
                <td className="py-3 pr-4 text-center text-gray-300">{c.meetings_count}</td>
                <td className="py-3 pr-4 text-center">
                  {c.telegram_bot ? (
                    <span className="text-green-400 text-xs" title={c.telegram_bot}>@{c.telegram_bot}</span>
                  ) : (
                    <span className="text-gray-600">-</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-center">
                  {c.has_whatsapp ? <span className="text-green-400">Si</span> : <span className="text-gray-600">-</span>}
                </td>
                <td className="py-3 pr-4 text-center">
                  {c.has_google ? <span className="text-green-400">Si</span> : <span className="text-gray-600">-</span>}
                </td>
                <td className="py-3 space-x-3">
                  <button
                    onClick={() => setPlanEditing(c.id)}
                    className="text-amber-400 hover:text-amber-300 text-xs font-medium transition-colors"
                  >
                    Plan
                  </button>
                  <button
                    onClick={() => impersonate(c.id)}
                    className="text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors"
                  >
                    Entrar como
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {companies.length === 0 && (
          <div className="text-center text-gray-500 py-10">Sin empresas registradas</div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Actividad Global ─────────────────────────────────────────────── */

function ActividadTab({ actions }: { actions: RecentAction[] }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Actividad Global (ultimas 20)</h2>
      <div className="space-y-2">
        {actions.map((a) => {
          const data = a.action_data ?? {};
          const subject = (data.subject as string) ?? (data.to as string) ?? "";
          return (
            <div key={a.id} className="glass rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-300 shrink-0">
                  {ACTION_LABELS[a.action_type] ?? a.action_type}
                </span>
                <div className="min-w-0">
                  <span className="text-amber-400 text-xs font-medium mr-2">{a.company_name ?? "?"}</span>
                  <span className="text-gray-300 text-sm truncate">{subject}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[a.status] ?? "bg-gray-800 text-gray-400"}`}>
                  {a.status}
                </span>
                <span className="text-gray-500 text-xs w-10 text-right">{timeAgo(a.created_at)}</span>
              </div>
            </div>
          );
        })}
        {actions.length === 0 && (
          <div className="text-center text-gray-500 py-10">Sin actividad reciente</div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Follow-ups Activos ───────────────────────────────────────────── */

function FollowupsTab({ followups }: { followups: Followup[] }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Follow-ups Activos ({followups.length})</h2>
      <div className="space-y-2">
        {followups.map((f) => {
          const data = f.action_data ?? {};
          const to = (data.to as string) ?? "?";
          const totalSteps = (data.total_followups as number) ?? 3;
          return (
            <div key={f.id} className="glass rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-amber-400 text-xs font-medium shrink-0">{f.company_name ?? "?"}</span>
                <span className="text-gray-300 text-sm truncate">{to}</span>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-900/40 text-blue-400 shrink-0">
                  {f.followup_number ?? 1}/{totalSteps}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[f.status] ?? "bg-gray-800 text-gray-400"}`}>
                  {f.status}
                </span>
                <span className="text-gray-500 text-xs">
                  {f.followup_scheduled_at ? new Date(f.followup_scheduled_at).toLocaleDateString("es") : "-"}
                </span>
              </div>
            </div>
          );
        })}
        {followups.length === 0 && (
          <div className="text-center text-gray-500 py-10">Sin follow-ups activos</div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Sistema ──────────────────────────────────────────────────────── */

function SmartPassesTab({ companies }: { companies: Company[] }) {
  const [creds, setCreds] = useState<{ company_id: number; company_name: string; extra_data: string; is_active: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ company_id: "", api_key: "", pass_type_id: "", pass_template_id: "", passes_limit: "100" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`${WORKER_URL}/api/admin/smartpasses/list`, { headers: adminHeaders() })
      .then(r => r.json())
      .then((d: { credentials?: typeof creds }) => setCreds(d.credentials ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company_id || !form.api_key || !form.pass_type_id || !form.pass_template_id) return;
    setSaving(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/admin/smartpasses/assign`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          company_id: Number(form.company_id),
          api_key: form.api_key,
          pass_type_id: form.pass_type_id,
          pass_template_id: form.pass_template_id,
          passes_limit: Number(form.passes_limit) || 100,
        }),
      });
      if (res.ok) {
        setMsg("Credenciales asignadas");
        setForm({ company_id: "", api_key: "", pass_type_id: "", pass_template_id: "", passes_limit: "100" });
        // Reload
        const r2 = await fetch(`${WORKER_URL}/api/admin/smartpasses/list`, { headers: adminHeaders() });
        const d2 = await r2.json() as { credentials?: typeof creds };
        setCreds(d2.credentials ?? []);
        setTimeout(() => setMsg(""), 2000);
      }
    } catch { setMsg("Error"); }
    finally { setSaving(false); }
  }

  async function handleRevoke(companyId: number) {
    if (!confirm("Revocar credenciales de SmartPasses para esta empresa?")) return;
    await fetch(`${WORKER_URL}/api/admin/smartpasses/revoke`, {
      method: "DELETE",
      headers: adminHeaders(),
      body: JSON.stringify({ company_id: companyId }),
    });
    setCreds(prev => prev.filter(c => c.company_id !== companyId));
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-lg font-semibold">SmartPasses — Tarjetas Digitales</h2>
      <p className="text-gray-400 text-sm">Asigna credenciales de SmartPasses a cada empresa. Controla cuantas tarjetas puede crear cada una.</p>

      {msg && <p className="text-green-400 text-sm">{msg}</p>}

      {/* Asignar credenciales */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-white text-sm font-medium">Asignar credenciales</h3>
        <form onSubmit={handleAssign} className="space-y-3">
          <select
            value={form.company_id}
            onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
          >
            <option value="">Seleccionar empresa...</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name} (ID: {c.id})</option>
            ))}
          </select>
          <input type="password" value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))} placeholder="SmartPasses API Key" required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 font-mono" />
          <div className="grid grid-cols-2 gap-3">
            <input type="text" value={form.pass_type_id} onChange={e => setForm(f => ({ ...f, pass_type_id: e.target.value }))} placeholder="Pass Type ID" required className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 font-mono" />
            <input type="text" value={form.pass_template_id} onChange={e => setForm(f => ({ ...f, pass_template_id: e.target.value }))} placeholder="Template ID" required className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-400 font-mono" />
          </div>
          <div className="flex items-center gap-3">
            <input type="number" value={form.passes_limit} onChange={e => setForm(f => ({ ...f, passes_limit: e.target.value }))} placeholder="Limite de tarjetas" className="w-40 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-400" />
            <span className="text-gray-500 text-xs">tarjetas maximas</span>
          </div>
          <button type="submit" disabled={saving} className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
            {saving ? "Asignando..." : "Asignar credenciales"}
          </button>
        </form>
      </div>

      {/* Lista de credenciales asignadas */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-white text-sm font-medium mb-3">Credenciales asignadas ({creds.length})</h3>
        {loading ? (
          <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" /></div>
        ) : creds.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-4">Ninguna empresa tiene credenciales asignadas</p>
        ) : (
          <div className="space-y-2">
            {creds.map((c) => {
              let extra: Record<string, string> = {};
              try { extra = c.extra_data ? JSON.parse(c.extra_data) : {}; } catch { /* */ }
              return (
                <div key={c.company_id} className="flex items-center justify-between bg-gray-800/50 rounded-lg p-3">
                  <div>
                    <p className="text-white text-sm font-medium">{c.company_name}</p>
                    <p className="text-gray-500 text-[11px] font-mono">
                      Type: {extra.pass_type_id?.slice(0, 15) ?? "—"} · Template: {extra.pass_template_id?.slice(0, 15) ?? "—"}
                      {extra.passes_limit ? ` · Limite: ${extra.passes_limit}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${c.is_active ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                      {c.is_active ? "Activo" : "Revocado"}
                    </span>
                    {c.is_active ? (
                      <button onClick={() => handleRevoke(c.company_id)} className="text-[11px] text-red-400 hover:text-red-300">Revocar</button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SistemaTab({ systemStatus, toggleSystem }: { systemStatus: string; toggleSystem: () => void }) {
  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-lg font-semibold">Control del Sistema</h2>

      {/* System toggle */}
      <div className="glass rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-white">Estado del Agente</div>
            <div className="text-gray-400 text-sm mt-1">
              {systemStatus === "active"
                ? "El agente esta procesando mensajes, crons y follow-ups normalmente."
                : "El agente esta PAUSADO. No procesara crons ni follow-ups automaticos."}
            </div>
          </div>
          <button
            onClick={toggleSystem}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              systemStatus === "active"
                ? "bg-red-900/50 text-red-400 hover:bg-red-900/80 border border-red-800"
                : "bg-green-900/50 text-green-400 hover:bg-green-900/80 border border-green-800"
            }`}
          >
            {systemStatus === "active" ? "Pausar Sistema" : "Reanudar Sistema"}
          </button>
        </div>
        {systemStatus !== "active" && (
          <div className="bg-red-950/50 border border-red-900/50 rounded-lg p-3 text-red-400 text-sm">
            ADVERTENCIA: El sistema esta pausado. Los crons, follow-ups y acciones automaticas no se ejecutaran hasta que se reanude.
          </div>
        )}
      </div>

      {/* Info cards */}
      <div className="glass rounded-2xl p-6 space-y-3">
        <div className="font-medium text-white mb-3">Configuracion</div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Worker URL</span>
          <span className="text-gray-300 font-mono text-xs">ailyn-agent.novacodepro.workers.dev</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Cron Schedule</span>
          <span className="text-gray-300 font-mono text-xs">*/5 * * * * (cada 5 min)</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Admin Token</span>
          <span className="text-gray-300 font-mono text-xs">****{getAdminToken().slice(-4)}</span>
        </div>
      </div>

      {/* External links */}
      <div className="glass rounded-2xl p-6 space-y-3">
        <div className="font-medium text-white mb-3">Links Externos</div>
        <div className="flex flex-col gap-2">
          <a
            href="https://dash.cloudflare.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:text-amber-300 text-sm transition-colors"
          >
            Cloudflare Dashboard &rarr;
          </a>
          <a
            href="https://dash.cloudflare.com/?to=/:account/workers"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:text-amber-300 text-sm transition-colors"
          >
            Workers &amp; Pages &rarr;
          </a>
          <a
            href="https://dash.cloudflare.com/?to=/:account/d1"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:text-amber-300 text-sm transition-colors"
          >
            D1 Database &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
