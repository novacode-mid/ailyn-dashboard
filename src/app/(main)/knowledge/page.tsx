"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders, getUser } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

interface Doc { id: number; title: string; content_preview: string; created_at: string }

export default function KnowledgePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const companyId = getUser()?.company_id;

  const loadDocs = useCallback(async () => {
    if (!companyId) return;
    setLoadingDocs(true);
    setError("");
    try {
      const res = await fetch(`${WORKER_URL}/api/admin/knowledge/docs?company_id=${companyId}`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDocs(await res.json() as Doc[]);
    } catch { setError("Error al cargar documentos"); }
    finally { setLoadingDocs(false); }
  }, [companyId]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId || !title.trim() || !content.trim()) return;
    setUploading(true); setError("");
    try {
      const res = await fetch(`${WORKER_URL}/api/admin/knowledge/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ company_id: companyId, title: title.trim(), content: content.trim() }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTitle(""); setContent("");
      await loadDocs();
    } catch (err) { setError(err instanceof Error ? err.message : "Error al subir"); }
    finally { setUploading(false); }
  }

  async function handleDelete(id: number, docTitle: string) {
    if (!confirm(`¿Eliminar "${docTitle}"?`)) return;
    try {
      await fetch(`${WORKER_URL}/api/admin/knowledge/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
        cache: "no-store",
      });
      await loadDocs();
    } catch { setError("Error al eliminar"); }
  }

  return (
    <DashboardShell>
      <div className="p-4 sm:p-6 space-y-6">
        <h1 className="text-xl font-bold text-white">Knowledge Base</h1>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium text-white">Agregar documento</h2>
          <form onSubmit={handleUpload} className="space-y-3">
            <input
              type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Título del documento"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-ailyn-400"
            />
            <textarea
              value={content} onChange={(e) => setContent(e.target.value)}
              placeholder="Contenido (el agente usará esto como contexto RAG)"
              rows={4}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-ailyn-400 resize-none"
            />
            <div className="flex justify-end">
              <button
                type="submit" disabled={uploading || !title.trim() || !content.trim()}
                className="bg-ailyn-400 hover:bg-ailyn-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {uploading ? "Vectorizando..." : "Subir y vectorizar"}
              </button>
            </div>
          </form>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {loadingDocs ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-ailyn-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : docs.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">No hay documentos todavía.</p>
        ) : (
          <div className="space-y-2">
            {docs.map((doc) => (
              <div key={doc.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{doc.title}</p>
                  <p className="text-gray-500 text-xs mt-0.5 truncate">{doc.content_preview}</p>
                  <p className="text-gray-700 text-xs mt-1">
                    {new Date(doc.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(doc.id, doc.title)}
                  className="text-red-500 hover:text-red-300 text-xs shrink-0 transition-colors"
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
