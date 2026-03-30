"use client";

import { useEffect, useState, useCallback } from "react";
import {
  listCompanies,
  createCompany,
  updateCompany,
  deleteCompany,
  type CompanyWithStats,
} from "@/features/admin/services/admin-api";

interface Props {
  onSelectCompany: (id: number, goTo: "detail" | "knowledge") => void;
}

export default function CompaniesTab({ onSelectCompany }: Props) {
  const [companies, setCompanies] = useState<CompanyWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listCompanies();
      setCompanies(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createCompany(newName.trim());
      setNewName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear");
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdate(id: number) {
    if (!editName.trim()) return;
    try {
      await updateCompany(id, editName.trim());
      setEditId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al actualizar");
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`¿Eliminar "${name}" y todos sus datos? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteCompany(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Clientes</h2>
        <button
          onClick={load}
          className="text-gray-400 hover:text-white text-sm transition-colors"
        >
          Actualizar
        </button>
      </div>

      {/* Create form */}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nombre del nuevo cliente"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-ailyn-400 transition-colors"
        />
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="bg-ailyn-400 hover:bg-ailyn-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {creating ? "..." : "Crear"}
        </button>
      </form>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-ailyn-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : companies.length === 0 ? (
        <p className="text-gray-500 text-center py-12">No hay clientes registrados.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 border-b border-gray-800">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Nombre</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">Agentes</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">Leads</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">Emails</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">Follow-ups</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {companies.map((c) => (
                <tr key={c.id} className="bg-gray-900/50 hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3">
                    {editId === c.id ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-ailyn-400"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleUpdate(c.id);
                            if (e.key === "Escape") setEditId(null);
                          }}
                        />
                        <button
                          onClick={() => handleUpdate(c.id)}
                          className="text-ailyn-400 hover:text-ailyn-100 text-xs"
                        >
                          Guardar
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="text-gray-500 hover:text-gray-300 text-xs"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <span className="text-white font-medium">{c.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-300">{c.agent_count}</td>
                  <td className="px-4 py-3 text-center text-gray-300">{c.lead_count}</td>
                  <td className="px-4 py-3 text-center text-gray-300">{c.email_count}</td>
                  <td className="px-4 py-3 text-center text-gray-300">{c.followup_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => onSelectCompany(c.id, "detail")}
                        className="text-ailyn-400 hover:text-ailyn-100 text-xs transition-colors"
                      >
                        Agentes
                      </button>
                      <button
                        onClick={() => onSelectCompany(c.id, "knowledge")}
                        className="text-ailyn-400 hover:text-ailyn-100 text-xs transition-colors"
                      >
                        Docs
                      </button>
                      <button
                        onClick={() => { setEditId(c.id); setEditName(c.name); }}
                        className="text-gray-400 hover:text-white text-xs transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDelete(c.id, c.name)}
                        className="text-red-500 hover:text-red-300 text-xs transition-colors"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
