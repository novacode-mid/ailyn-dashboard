"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface Props {
  onInjected?: () => void;
}

export function InjectTaskModal({ onInjected }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({ title: "", description: "", priority: 5 });

  function close() {
    setOpen(false);
    setForm({ title: "", description: "", priority: 5 });
  }

  function submit() {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error("Título y descripción son requeridos");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/tasks/inject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = await res.json() as { taskId: number };
        toast.success(`Tarea #${data.taskId} inyectada`, {
          description: "Será procesada en el próximo ciclo (≤15 min).",
          icon: "🚀",
        });
        close();
        router.refresh(); // refresca el Server Component con la tabla
        onInjected?.();
      } catch (err) {
        toast.error(`Error inyectando tarea: ${String(err)}`);
      }
    });
  }

  return (
    <>
      {/* Botón trigger */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors active:scale-95"
      >
        <span className="text-sm">＋</span> Inyectar tarea
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-lg">Inyectar nueva tarea</h3>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Título</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="ej. Revisar métricas de Q2"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Descripción</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Contexto detallado para Llama 3.3..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Prioridad: <span className="text-indigo-600 font-bold">{form.priority}</span>
                  <span className="ml-1 text-gray-400">(1 = Alta · 10 = Baja)</span>
                </label>
                <input
                  type="range" min={1} max={10} step={1}
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
                  className="w-full accent-indigo-600"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={close} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={submit}
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending && <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                {isPending ? "Inyectando..." : "🚀 Inyectar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
