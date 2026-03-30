"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

interface Company { id: number; name: string }

interface KnowledgeDoc {
  id: number;
  company_id: number;
  title: string;
  vector_id: string;
  content_preview: string | null;
  created_at: string;
}

export function KnowledgeManager() {
  const [companies,  setCompanies]  = useState<Company[]>([]);
  const [companyId,  setCompanyId]  = useState<number | "">("");
  const [docs,       setDocs]       = useState<KnowledgeDoc[]>([]);
  const [title,      setTitle]      = useState("");
  const [content,    setContent]    = useState("");
  const [loading,    setLoading]    = useState(true);
  const [uploading,  setUploading]  = useState(false);
  const [docsLoading,setDocsLoading]= useState(false);

  // Cargar empresas al montar
  useEffect(() => {
    fetch("/api/admin/companies")
      .then((r) => r.json())
      .then((data) => {
        setCompanies(data as Company[]);
        if ((data as Company[]).length > 0) setCompanyId((data as Company[])[0].id);
      })
      .catch(() => toast.error("Error cargando empresas"))
      .finally(() => setLoading(false));
  }, []);

  // Cargar docs cuando cambia empresa
  useEffect(() => {
    if (!companyId) return;
    setDocsLoading(true);
    fetch(`/api/admin/knowledge/docs?company_id=${companyId}`)
      .then((r) => r.json())
      .then((data) => setDocs(data as KnowledgeDoc[]))
      .catch(() => toast.error("Error cargando documentos"))
      .finally(() => setDocsLoading(false));
  }, [companyId]);

  async function upload() {
    if (!companyId || !title.trim() || !content.trim()) {
      toast.error("Empresa, título y contenido son requeridos.");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch("/api/admin/knowledge/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, title: title.trim(), content: content.trim() }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      toast.success("Documento vectorizado y guardado", {
        description: title.trim(),
        icon: "🧠",
      });
      setTitle("");
      setContent("");
      // Refrescar lista
      const updated = await fetch(`/api/admin/knowledge/docs?company_id=${companyId}`).then((r) => r.json());
      setDocs(updated as KnowledgeDoc[]);
    } catch (err) {
      toast.error(`Error: ${String(err)}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-[1200px]">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white">Base de Conocimiento</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Vectoriza manuales y políticas para que el agente los use como contexto (RAG).
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-zinc-500">Cargando...</div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px]">
            {/* ── Columna izquierda: lista de documentos ── */}
            <div className="space-y-4">
              {/* Selector de empresa */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <label className="mb-2 block text-xs font-semibold text-zinc-400">Empresa</label>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(Number(e.target.value))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Lista de documentos */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                <div className="border-b border-zinc-800 px-5 py-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Documentos Vectorizados</h2>
                  <span className="text-xs text-zinc-500">{docs.length} doc{docs.length !== 1 ? "s" : ""}</span>
                </div>

                {docsLoading ? (
                  <div className="flex items-center justify-center py-12 text-zinc-600 text-sm">Cargando...</div>
                ) : docs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                    <span className="text-4xl">🧠</span>
                    <p className="mt-2 text-sm">No hay documentos todavía</p>
                    <p className="text-xs text-zinc-700">Vectoriza tu primer manual →</p>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800">
                    {docs.map((doc) => (
                      <div key={doc.id} className="px-5 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-white truncate">{doc.title}</p>
                            {doc.content_preview && (
                              <p className="mt-0.5 text-xs text-zinc-500 line-clamp-2">{doc.content_preview}</p>
                            )}
                          </div>
                          <span className="shrink-0 rounded-md bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-400">
                            ✓ Vectorizado
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-xs text-zinc-700">{doc.vector_id}</p>
                        <p className="text-xs text-zinc-600">
                          {new Date(doc.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Columna derecha: formulario upload ── */}
            <div className="lg:sticky lg:top-8 lg:self-start">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                <h2 className="mb-5 font-semibold text-white">Vectorizar Documento</h2>

                <div className="space-y-4">
                  {/* Título */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-zinc-400">Título del Documento</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="ej. Manual de Onboarding 2026"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Contenido */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-zinc-400">
                      Contenido
                      <span className="ml-2 text-zinc-600 font-normal">({content.length} chars)</span>
                    </label>
                    <textarea
                      rows={12}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="Pega aquí el texto del manual, política o procedimiento..."
                      className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none focus:border-indigo-500 leading-relaxed"
                    />
                    <p className="mt-1 text-xs text-zinc-600">
                      El contenido se embederá con BGE-base-en-v1.5 (768 dims) y se almacenará en Cloudflare Vectorize.
                    </p>
                  </div>

                  {/* Botón */}
                  <button
                    onClick={upload}
                    disabled={uploading || !title.trim() || !content.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {uploading ? (
                      <>
                        <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        Vectorizando...
                      </>
                    ) : (
                      <>🧠 Vectorizar y Guardar</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
