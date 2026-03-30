"use client";

import { useEffect, useState, useCallback } from "react";
import {
  listKnowledgeDocs,
  deleteKnowledgeDoc,
  type KnowledgeDoc,
} from "@/features/admin/services/admin-api";

interface Props {
  companyId: number | null;
  onBack: () => void;
}

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

export default function KnowledgeTab({ companyId, onBack }: Props) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadContent, setUploadContent] = useState("");

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    try {
      const data = await listKnowledgeDocs(companyId);
      setDocs(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadTitle.trim() || !uploadContent.trim() || !companyId) return;
    setUploading(true);
    setError("");
    try {
      const token = sessionStorage.getItem("ailyn_admin_token") ?? "";
      const res = await fetch(`${WORKER_URL}/api/admin/knowledge/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CF-Token": token },
        body: JSON.stringify({
          company_id: companyId,
          title: uploadTitle.trim(),
          content: uploadContent.trim(),
        }),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUploadTitle("");
      setUploadContent("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al subir");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: number, title: string) {
    if (!confirm(`¿Eliminar "${title}" de la Knowledge Base?`)) return;
    try {
      await deleteKnowledgeDoc(id);
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
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm transition-colors">
          ← Clientes
        </button>
        <h2 className="text-lg font-semibold text-white">Knowledge Base</h2>
      </div>

      {/* Upload form */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-white mb-3">Agregar documento</h3>
        <form onSubmit={handleUpload} className="space-y-3">
          <input
            type="text"
            value={uploadTitle}
            onChange={(e) => setUploadTitle(e.target.value)}
            placeholder="Título del documento"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-ailyn-400 transition-colors"
          />
          <textarea
            value={uploadContent}
            onChange={(e) => setUploadContent(e.target.value)}
            placeholder="Contenido del documento (el agente usará esto como contexto)"
            rows={5}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-ailyn-400 transition-colors resize-none"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={uploading || !uploadTitle.trim() || !uploadContent.trim()}
              className="bg-ailyn-400 hover:bg-ailyn-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {uploading ? "Vectorizando..." : "Subir y vectorizar"}
            </button>
          </div>
        </form>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-ailyn-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : docs.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No hay documentos en la Knowledge Base.</p>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{doc.title}</p>
                <p className="text-gray-500 text-xs mt-0.5 truncate">{doc.content_preview}</p>
                <p className="text-gray-600 text-xs mt-1">
                  {new Date(doc.created_at).toLocaleDateString("es-MX", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
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
  );
}
