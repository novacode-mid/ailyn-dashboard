"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
// Llama al proxy Next.js para no exponer el admin token en el browser
async function setSystemStatus(status: "active" | "paused"): Promise<void> {
  const res = await fetch("/api/admin/system/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`Error: ${res.status}`);
}

interface Props {
  initialStatus: "active" | "paused";
}

export function KillSwitch({ initialStatus }: Props) {
  const [status, setStatus] = useState<"active" | "paused">(initialStatus);
  const [isPending, startTransition] = useTransition();

  const isPaused = status === "paused";

  function toggle() {
    const next: "active" | "paused" = isPaused ? "active" : "paused";
    startTransition(async () => {
      try {
        await setSystemStatus(next);
        setStatus(next);
        if (next === "paused") {
          toast.warning("Agente pausado", {
            description: "El cron no procesará nuevas tareas hasta que lo reactives.",
            icon: "⏸️",
            duration: 5000,
          });
        } else {
          toast.success("Agente reactivado", {
            description: "El bucle autónomo está activo y procesará tareas en el próximo ciclo.",
            icon: "▶️",
            duration: 4000,
          });
        }
      } catch {
        toast.error("Error al cambiar estado del agente");
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      {/* Indicador Live / Paused */}
      <div
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors ${
          isPaused
            ? "border-red-200 bg-red-50"
            : "border-green-200 bg-green-50"
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full transition-colors ${
            isPaused ? "bg-red-500" : "bg-green-500 animate-pulse"
          }`}
        />
        <span
          className={`text-xs font-medium ${
            isPaused ? "text-red-700" : "text-green-700"
          }`}
        >
          {isPaused ? "Pausado" : "Live"}
        </span>
      </div>

      {/* Kill Switch button */}
      <button
        onClick={toggle}
        disabled={isPending}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
          isPaused
            ? "border-green-300 bg-green-600 text-white hover:bg-green-700 shadow-sm"
            : "border-red-300 bg-white text-red-600 hover:bg-red-50 shadow-sm"
        }`}
        title={isPaused ? "Reanudar agente" : "Pausar agente"}
      >
        {isPending ? (
          <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
        ) : isPaused ? (
          <span>▶</span>
        ) : (
          <span>⏸</span>
        )}
        {isPaused ? "Reanudar" : "Pausar agente"}
      </button>
    </div>
  );
}
