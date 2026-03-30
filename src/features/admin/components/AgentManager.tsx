"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────

interface Company { id: number; name: string }
interface Skill   { id: number; name: string; description: string }

interface Agent {
  id: number;
  company_id: number;
  company_name: string;
  name: string;
  role_prompt: string;
  model_id: string;
  is_active: number;
  skill_ids: number[];
  skill_names: string[];
}

interface FormState {
  company_id: number | "";
  name: string;
  role_prompt: string;
  model_id: string;
  skill_ids: number[];
}

const EMPTY_FORM: FormState = {
  company_id: "",
  name: "",
  role_prompt: "",
  model_id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  skill_ids: [],
};

const MODELS = [
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B (Razonamiento)" },
  { id: "@cf/meta/llama-3.2-3b-instruct",            label: "Llama 3.2 3B (Rápido)" },
  { id: "@cf/meta/llama-3.1-8b-instruct",            label: "Llama 3.1 8B (Balanceado)" },
  { id: "@cf/mistral/mistral-7b-instruct-v0.2",      label: "Mistral 7B" },
];

// ── Main Component ─────────────────────────────────────────────────────────

export function AgentManager() {
  const [agents,    setAgents]    = useState<Agent[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [skills,    setSkills]    = useState<Skill[]>([]);
  const [selected,  setSelected]  = useState<Agent | null>(null);
  const [form,      setForm]      = useState<FormState>(EMPTY_FORM);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);

  // ── Load initial data ────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch("/api/admin/agents").then((r) => r.json()),
      fetch("/api/admin/companies").then((r) => r.json()),
      fetch("/api/admin/skills").then((r) => r.json()),
    ]).then(([a, c, s]) => {
      setAgents(a as Agent[]);
      setCompanies(c as Company[]);
      setSkills(s as Skill[]);
    }).catch(() => toast.error("Error cargando datos")).finally(() => setLoading(false));
  }, []);

  // ── Select agent to edit ─────────────────────────────────────────────────
  function selectAgent(agent: Agent) {
    setSelected(agent);
    setForm({
      company_id: agent.company_id,
      name:       agent.name,
      role_prompt: agent.role_prompt,
      model_id:   agent.model_id,
      skill_ids:  agent.skill_ids,
    });
  }

  function newAgent() {
    setSelected(null);
    setForm(EMPTY_FORM);
  }

  // ── Toggle skill checkbox ────────────────────────────────────────────────
  function toggleSkill(skillId: number) {
    setForm((f) => ({
      ...f,
      skill_ids: f.skill_ids.includes(skillId)
        ? f.skill_ids.filter((id) => id !== skillId)
        : [...f.skill_ids, skillId],
    }));
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function save() {
    if (!form.company_id || !form.name.trim() || !form.role_prompt.trim()) {
      toast.error("Empresa, nombre y system prompt son requeridos.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      toast.success(selected ? "Agente actualizado" : "Agente creado", {
        description: form.name,
        icon: "🤖",
      });
      // Refrescar lista
      const updated = await fetch("/api/admin/agents").then((r) => r.json());
      setAgents(updated as Agent[]);
      newAgent();
    } catch (err) {
      toast.error(`Error guardando: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-[1400px]">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Constructor de Agentes</h1>
            <p className="mt-1 text-sm text-zinc-400">Gestiona los agentes de IA por empresa y sus habilidades.</p>
          </div>
          <button
            onClick={newAgent}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            <span className="text-base">＋</span> Nuevo Agente
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-zinc-500">Cargando...</div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_480px]">
            {/* ── Columna izquierda: lista de agentes ── */}
            <div className="space-y-3">
              {agents.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 py-20 text-zinc-500">
                  <span className="text-4xl">🤖</span>
                  <p className="mt-2 text-sm">No hay agentes todavía</p>
                </div>
              ) : (
                agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => selectAgent(agent)}
                    className={`w-full rounded-xl border p-5 text-left transition-all ${
                      selected?.id === agent.id
                        ? "border-indigo-500 bg-indigo-950/40"
                        : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white truncate">{agent.name}</span>
                          <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                            {agent.company_name}
                          </span>
                          {agent.is_active === 1 && (
                            <span className="shrink-0 flex items-center gap-1 rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              Activo
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-zinc-500 truncate">{MODELS.find((m) => m.id === agent.model_id)?.label ?? agent.model_id}</p>
                        {agent.skill_names.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {agent.skill_names.map((s) => (
                              <span key={s} className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{s}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 text-zinc-600">›</span>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* ── Columna derecha: formulario ── */}
            <div className="lg:sticky lg:top-8 lg:self-start">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                <h2 className="mb-5 font-semibold text-white">
                  {selected ? `Editar: ${selected.name}` : "Nuevo Agente"}
                </h2>

                <div className="space-y-4">
                  {/* Empresa */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-zinc-400">Empresa</label>
                    <select
                      value={form.company_id}
                      onChange={(e) => setForm((f) => ({ ...f, company_id: Number(e.target.value) }))}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                    >
                      <option value="">Selecciona empresa...</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Nombre */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-zinc-400">Nombre del Agente</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="ej. Asistente Ejecutivo"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Modelo */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-zinc-400">Modelo de IA</label>
                    <select
                      value={form.model_id}
                      onChange={(e) => setForm((f) => ({ ...f, model_id: e.target.value }))}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                    >
                      {MODELS.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* SOUL / System Prompt */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-zinc-400">
                      SOUL / System Prompt
                    </label>
                    <textarea
                      rows={8}
                      value={form.role_prompt}
                      onChange={(e) => setForm((f) => ({ ...f, role_prompt: e.target.value }))}
                      placeholder="Eres un agente corporativo..."
                      className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-white placeholder-zinc-600 outline-none focus:border-indigo-500 leading-relaxed"
                    />
                  </div>

                  {/* Skills */}
                  <div>
                    <label className="mb-2 block text-xs font-semibold text-zinc-400">Skills disponibles</label>
                    <div className="space-y-2">
                      {skills.map((skill) => (
                        <label
                          key={skill.id}
                          className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-800 p-3 hover:border-zinc-600 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={form.skill_ids.includes(skill.id)}
                            onChange={() => toggleSkill(skill.id)}
                            className="mt-0.5 accent-indigo-500"
                          />
                          <div>
                            <p className="text-sm font-medium text-white">{skill.name}</p>
                            <p className="text-xs text-zinc-500">{skill.description}</p>
                          </div>
                        </label>
                      ))}
                      {skills.length === 0 && (
                        <p className="text-xs text-zinc-600">No hay skills registradas.</p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-2 pt-2">
                    {selected && (
                      <button
                        onClick={newAgent}
                        className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      onClick={save}
                      disabled={saving}
                      className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {saving && <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                      {saving ? "Guardando..." : selected ? "💾 Actualizar" : "🤖 Crear Agente"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
