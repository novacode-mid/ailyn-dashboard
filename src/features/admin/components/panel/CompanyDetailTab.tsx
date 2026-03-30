"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getCompanyDetail,
  updateAgent,
  deleteAgent,
  type CompanyDetail,
  type AgentWithSkills,
} from "@/features/admin/services/admin-api";

interface Props {
  companyId: number | null;
  onBack: () => void;
}

const MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/mistral/mistral-7b-instruct-v0.2",
];

export default function CompanyDetailTab({ companyId, onBack }: Props) {
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editAgent, setEditAgent] = useState<AgentWithSkills | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    try {
      const data = await getCompanyDetail(companyId);
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  async function handleSaveAgent() {
    if (!editAgent) return;
    setSaving(true);
    try {
      await updateAgent(editAgent.id, {
        name: editAgent.name,
        role_prompt: editAgent.role_prompt,
        model_id: editAgent.model_id,
        is_active: editAgent.is_active,
      });
      setEditAgent(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAgent(id: number, name: string) {
    if (!confirm(`¿Eliminar el agente "${name}"?`)) return;
    try {
      await deleteAgent(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar");
    }
  }

  if (!companyId) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Selecciona un cliente en la pestaña Clientes.</p>
        <button onClick={onBack} className="mt-4 text-ailyn-400 hover:text-ailyn-100 text-sm">
          ← Ir a Clientes
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white text-sm transition-colors"
        >
          ← Clientes
        </button>
        {detail && (
          <h2 className="text-lg font-semibold text-white">{detail.name} — Agentes</h2>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-ailyn-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !detail || detail.agents.length === 0 ? (
        <p className="text-gray-500 text-center py-12">No hay agentes en este cliente.</p>
      ) : (
        <div className="space-y-4">
          {detail.agents.map((agent) => (
            <div
              key={agent.id}
              className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3"
            >
              {editAgent?.id === agent.id ? (
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 mb-1 block">Nombre</label>
                      <input
                        type="text"
                        value={editAgent.name}
                        onChange={(e) => setEditAgent({ ...editAgent, name: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-ailyn-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Modelo</label>
                      <select
                        value={editAgent.model_id}
                        onChange={(e) => setEditAgent({ ...editAgent, model_id: e.target.value })}
                        className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-ailyn-400"
                      >
                        {MODELS.map((m) => (
                          <option key={m} value={m}>{m.split("/")[2]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 cursor-pointer mb-2">
                        <input
                          type="checkbox"
                          checked={editAgent.is_active === 1}
                          onChange={(e) => setEditAgent({ ...editAgent, is_active: e.target.checked ? 1 : 0 })}
                          className="accent-ailyn-400"
                        />
                        <span className="text-sm text-gray-300">Activo</span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Role Prompt</label>
                    <textarea
                      value={editAgent.role_prompt}
                      onChange={(e) => setEditAgent({ ...editAgent, role_prompt: e.target.value })}
                      rows={4}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-ailyn-400 resize-none"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setEditAgent(null)}
                      className="text-gray-400 hover:text-white text-sm transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleSaveAgent}
                      disabled={saving}
                      className="bg-ailyn-400 hover:bg-ailyn-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      {saving ? "Guardando..." : "Guardar"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{agent.name}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            agent.is_active ? "bg-green-900/50 text-green-400" : "bg-gray-800 text-gray-500"
                          }`}
                        >
                          {agent.is_active ? "Activo" : "Inactivo"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{agent.model_id.split("/")[2]}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditAgent(agent)}
                        className="text-gray-400 hover:text-white text-xs transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDeleteAgent(agent.id, agent.name)}
                        className="text-red-500 hover:text-red-300 text-xs transition-colors"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                  <p className="text-gray-400 text-sm line-clamp-2">{agent.role_prompt}</p>
                  {agent.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {agent.skills.map((s) => (
                        <span
                          key={s.id}
                          className="text-xs bg-ailyn-900/30 text-ailyn-400 border border-ailyn-800/50 px-2 py-0.5 rounded-full"
                        >
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
