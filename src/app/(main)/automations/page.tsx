"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

// ── Types ──────────────────────────────────────────────────────────────────

interface WorkPlanStep {
  id?: number;
  step_order: number;
  action_type: string;
  config: string; // JSON string
}

interface WorkPlan {
  id: number;
  name: string;
  description: string | null;
  cron_expression: string;
  is_active: number;
  last_run_at: string | null;
  steps: WorkPlanStep[];
}

interface WorkPlanRun {
  id: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  results: string | null;
  error: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  prospect_research: "🔍 Prospección",
  send_report: "📊 Reporte",
  follow_up: "📬 Follow-up",
  auto_email: "✉️ Email Auto",
  knowledge_refresh: "🔄 Actualizar info",
};

const FREQ_OPTIONS = [
  { label: "Cada día laborable a las 2am", cron: "0 2 * * 1-5" },
  { label: "Cada día laborable a las 8am", cron: "0 8 * * 1-5" },
  { label: "Cada día laborable a las 9am", cron: "0 9 * * 1-5" },
  { label: "Cada lunes a las 8am", cron: "0 8 * * 1" },
  { label: "Cada día a medianoche", cron: "0 0 * * *" },
  { label: "Personalizado", cron: "custom" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "Nunca";
  try { return new Date(iso + "Z").toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }); }
  catch { return iso; }
}

function nextRun(cron: string): string {
  try {
    const found = FREQ_OPTIONS.find((f) => f.cron === cron);
    if (found && found.cron !== "custom") return found.label;
    return `cron: ${cron}`;
  } catch { return cron; }
}

// ── Formulario de step ────────────────────────────────────────────────────

function StepForm({
  step,
  onChange,
  onRemove,
}: {
  step: WorkPlanStep;
  onChange: (s: WorkPlanStep) => void;
  onRemove: () => void;
}) {
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(step.config); } catch { cfg = {}; }

  function setConfig(patch: Record<string, unknown>) {
    onChange({ ...step, config: JSON.stringify({ ...cfg, ...patch }) });
  }

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <select
          value={step.action_type}
          onChange={(e) => onChange({ ...step, action_type: e.target.value, config: "{}" })}
          className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none"
        >
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button onClick={onRemove} className="text-gray-500 hover:text-red-400 text-xs">✕ Quitar</button>
      </div>

      {step.action_type === "prospect_research" && (
        <div className="grid grid-cols-3 gap-2">
          <input
            placeholder="Industria (ej: tecnología)"
            value={String(cfg.industry ?? "")}
            onChange={(e) => setConfig({ industry: e.target.value })}
            className="col-span-2 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none"
          />
          <input
            placeholder="Región (México)"
            value={String(cfg.region ?? "")}
            onChange={(e) => setConfig({ region: e.target.value })}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none"
          />
          <input
            type="number" min={1} max={10}
            placeholder="Cantidad (1-10)"
            value={String(cfg.count ?? 5)}
            onChange={(e) => setConfig({ count: Number(e.target.value) })}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none"
          />
        </div>
      )}

      {step.action_type === "send_report" && (
        <select
          value={String(cfg.type ?? "plan_results")}
          onChange={(e) => setConfig({ type: e.target.value })}
          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none"
        >
          <option value="plan_results">Resultados del plan</option>
          <option value="daily_summary">Resumen diario</option>
          <option value="weekly_summary">Resumen semanal</option>
        </select>
      )}

      {step.action_type === "follow_up" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Follow-up después de</span>
          <input
            type="number" min={1} max={14}
            value={String(cfg.days_after ?? 2)}
            onChange={(e) => setConfig({ days_after: Number(e.target.value) })}
            className="w-16 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none text-center"
          />
          <span className="text-xs text-gray-400">días sin respuesta</span>
        </div>
      )}
    </div>
  );
}

// ── Modal crear/editar plan ───────────────────────────────────────────────

function PlanModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: WorkPlan;
  onSave: (data: { name: string; description: string; cron_expression: string; steps: WorkPlanStep[] }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [freq, setFreq] = useState(() => {
    const found = FREQ_OPTIONS.find((f) => f.cron === initial?.cron_expression);
    return found?.cron ?? "custom";
  });
  const [customCron, setCustomCron] = useState(
    !FREQ_OPTIONS.find((f) => f.cron === initial?.cron_expression) ? (initial?.cron_expression ?? "") : ""
  );
  const [steps, setSteps] = useState<WorkPlanStep[]>(
    initial?.steps ?? [{ step_order: 1, action_type: "prospect_research", config: '{"industry":"tecnología","region":"México","count":5}' }]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cronExpr = freq === "custom" ? customCron : freq;

  function addStep() {
    setSteps((s) => [...s, { step_order: s.length + 1, action_type: "send_report", config: '{"type":"plan_results"}' }]);
  }

  async function handleSave() {
    if (!name.trim()) { setError("El nombre es requerido"); return; }
    if (!cronExpr.trim()) { setError("Selecciona una frecuencia"); return; }
    if (steps.length === 0) { setError("Agrega al menos un paso"); return; }
    setSaving(true);
    setError("");
    try {
      await onSave({ name: name.trim(), description: description.trim(), cron_expression: cronExpr, steps });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-white font-semibold">{initial ? "Editar plan" : "Nuevo plan"}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>

        <div className="p-4 space-y-4">
          <input
            placeholder="Nombre del plan"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400"
          />
          <input
            placeholder="Descripción (opcional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400"
          />

          {/* Frecuencia */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Frecuencia</label>
            <select
              value={freq}
              onChange={(e) => setFreq(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-ailyn-400"
            >
              {FREQ_OPTIONS.map((f) => (
                <option key={f.cron} value={f.cron}>{f.label}</option>
              ))}
            </select>
            {freq === "custom" && (
              <input
                placeholder="Ej: 0 9 * * 1-5"
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                className="mt-2 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 font-mono focus:outline-none focus:border-ailyn-400"
              />
            )}
          </div>

          {/* Steps */}
          <div>
            <label className="text-xs text-gray-400 mb-2 block">Pasos (se ejecutan en orden)</label>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <StepForm
                  key={i}
                  step={step}
                  onChange={(s) => setSteps((prev) => prev.map((p, j) => j === i ? s : p))}
                  onRemove={() => setSteps((prev) => prev.filter((_, j) => j !== i).map((s, j) => ({ ...s, step_order: j + 1 })))}
                />
              ))}
            </div>
            <button
              onClick={addStep}
              className="mt-2 text-xs text-ailyn-400 hover:text-ailyn-100 transition-colors"
            >
              + Agregar paso
            </button>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-ailyn-400 hover:bg-ailyn-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
            >
              {saving ? "Guardando..." : "Guardar plan"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Vista de runs (historial) ─────────────────────────────────────────────

function RunsPanel({ plan, onClose }: { plan: WorkPlan; onClose: () => void }) {
  const [runs, setRuns] = useState<WorkPlanRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${WORKER_URL}/api/work-plans/${plan.id}/runs`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data: WorkPlanRun[]) => setRuns(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [plan.id]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-white font-semibold">Historial: {plan.name}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>
        <div className="p-4">
          {loading && <p className="text-gray-400 text-sm text-center py-4">Cargando...</p>}
          {!loading && runs.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-4">Sin ejecuciones aún</p>
          )}
          <div className="space-y-2">
            {runs.map((run) => {
              const dur = run.completed_at
                ? Math.round((new Date(run.completed_at + "Z").getTime() - new Date(run.started_at + "Z").getTime()) / 1000)
                : null;
              let results: Array<{ action: string; success: boolean; summary: string }> = [];
              try { if (run.results) results = JSON.parse(run.results); } catch { results = []; }

              return (
                <div key={run.id} className="bg-gray-800 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium ${
                        run.status === "completed" ? "text-green-400" :
                        run.status === "running" ? "text-yellow-400" : "text-red-400"
                      }`}>
                        {run.status === "completed" ? "✅" : run.status === "running" ? "⏳" : "❌"} {run.status}
                      </span>
                      <span className="text-xs text-gray-400">{formatDate(run.started_at)}</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {dur !== null ? `${dur}s` : ""} {expanded === run.id ? "▲" : "▼"}
                    </span>
                  </button>

                  {expanded === run.id && (
                    <div className="px-3 pb-3 space-y-1 border-t border-gray-700">
                      {run.error && <p className="text-red-400 text-xs mt-2">{run.error}</p>}
                      {results.map((r, i) => (
                        <div key={i} className="flex items-start gap-2 mt-2">
                          <span className="text-xs">{r.success ? "✅" : "❌"}</span>
                          <div>
                            <span className="text-xs text-gray-300 font-medium">{ACTION_LABELS[r.action] ?? r.action}</span>
                            <p className="text-xs text-gray-400">{r.summary}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────

export default function AutomationsPage() {
  const [plans, setPlans] = useState<WorkPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<WorkPlan | undefined>();
  const [viewingRuns, setViewingRuns] = useState<WorkPlan | undefined>();
  const [triggering, setTriggering] = useState<number | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function loadPlans() {
    try {
      const res = await fetch(`${WORKER_URL}/api/work-plans`, { headers: authHeaders() });
      const data = await res.json() as WorkPlan[];
      setPlans(data);
    } catch {
      setError("No se pudieron cargar las automatizaciones");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPlans(); }, []);

  async function handleSavePlan(data: { name: string; description: string; cron_expression: string; steps: WorkPlanStep[] }) {
    const url = editingPlan ? `${WORKER_URL}/api/work-plans/${editingPlan.id}` : `${WORKER_URL}/api/work-plans`;
    const method = editingPlan ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: authHeaders(),
      body: JSON.stringify({ ...data, steps: data.steps.map((s) => ({ action_type: s.action_type, config: JSON.parse(s.config) })) }),
    });
    if (!res.ok) {
      const d = await res.json() as { error?: string };
      throw new Error(d.error ?? "Error al guardar");
    }
    setModalOpen(false);
    setEditingPlan(undefined);
    await loadPlans();
  }

  async function handleToggle(plan: WorkPlan) {
    setToggling(plan.id);
    try {
      await fetch(`${WORKER_URL}/api/work-plans/${plan.id}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ is_active: plan.is_active === 1 ? 0 : 1 }),
      });
      await loadPlans();
    } catch { /* ignore */ } finally {
      setToggling(null);
    }
  }

  async function handleTrigger(plan: WorkPlan) {
    setTriggering(plan.id);
    try {
      await fetch(`${WORKER_URL}/api/work-plans/${plan.id}/trigger`, {
        method: "POST",
        headers: authHeaders(),
      });
      // Small feedback — the execution happens async in the worker
    } catch { /* ignore */ } finally {
      setTriggering(null);
    }
  }

  async function handleDelete(plan: WorkPlan) {
    if (!confirm(`¿Eliminar "${plan.name}"?`)) return;
    await fetch(`${WORKER_URL}/api/work-plans/${plan.id}`, { method: "DELETE", headers: authHeaders() });
    await loadPlans();
  }

  return (
    <DashboardShell>
      <div className="p-6 max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Automatizaciones</h1>
            <p className="text-gray-400 text-sm mt-1">Ailyn trabaja sola — configura qué hacer y cuándo.</p>
          </div>
          <button
            onClick={() => { setEditingPlan(undefined); setModalOpen(true); }}
            className="bg-ailyn-400 hover:bg-ailyn-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            + Nuevo plan
          </button>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {/* Lista de planes */}
        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-5 h-5 border-2 border-ailyn-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && plans.length === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
            <p className="text-4xl mb-3">🤖</p>
            <p className="text-white font-medium">Sin automatizaciones</p>
            <p className="text-gray-400 text-sm mt-1">Crea tu primer plan y Ailyn trabajará sola.</p>
          </div>
        )}

        <div className="space-y-3">
          {plans.map((plan) => (
            <div key={plan.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              {/* Header del plan */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${plan.is_active ? "bg-green-400" : "bg-gray-600"}`} />
                    <h3 className="text-white font-medium text-sm truncate">{plan.name}</h3>
                  </div>
                  {plan.description && (
                    <p className="text-gray-400 text-xs mt-0.5 ml-4">{plan.description}</p>
                  )}
                </div>

                {/* Acciones */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleTrigger(plan)}
                    disabled={triggering === plan.id}
                    title="Ejecutar ahora"
                    className="text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50 px-2 py-1 rounded border border-gray-700 hover:border-gray-500"
                  >
                    {triggering === plan.id ? "▶ ..." : "▶ Ejecutar"}
                  </button>
                  <button
                    onClick={() => handleToggle(plan)}
                    disabled={toggling === plan.id}
                    className={`text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                      plan.is_active
                        ? "border-green-700 text-green-400 hover:border-red-600 hover:text-red-400"
                        : "border-gray-700 text-gray-400 hover:border-green-600 hover:text-green-400"
                    }`}
                  >
                    {plan.is_active ? "Activo" : "Pausado"}
                  </button>
                  <button
                    onClick={() => { setEditingPlan(plan); setModalOpen(true); }}
                    className="text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDelete(plan)}
                    className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                  >
                    🗑
                  </button>
                </div>
              </div>

              {/* Steps summary */}
              <div className="flex flex-wrap gap-1 ml-4">
                {plan.steps.map((step, i) => (
                  <span key={i} className="bg-gray-800 text-gray-300 text-xs px-2 py-0.5 rounded">
                    {ACTION_LABELS[step.action_type] ?? step.action_type}
                  </span>
                ))}
              </div>

              {/* Meta info */}
              <div className="flex items-center gap-4 text-xs text-gray-500 ml-4">
                <span>🕐 {nextRun(plan.cron_expression)}</span>
                <span>Última: {formatDate(plan.last_run_at)}</span>
                <button
                  onClick={() => setViewingRuns(plan)}
                  className="text-ailyn-400 hover:text-ailyn-100 transition-colors"
                >
                  Ver historial →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modales */}
      {modalOpen && (
        <PlanModal
          initial={editingPlan}
          onSave={handleSavePlan}
          onClose={() => { setModalOpen(false); setEditingPlan(undefined); }}
        />
      )}
      {viewingRuns && (
        <RunsPanel plan={viewingRuns} onClose={() => setViewingRuns(undefined)} />
      )}
    </DashboardShell>
  );
}
