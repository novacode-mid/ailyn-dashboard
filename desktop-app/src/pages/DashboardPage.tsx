import { useEffect, useState } from "react";
import type { User, TaskUpdate } from "../types";

interface Summary {
  plan: { name: string; chat_limit: number; leads_limit: number };
  usage: { chat_messages: number };
  stats: { total_leads: number };
  integrations: { slack: boolean; notion: boolean; hubspot: boolean; shopify: boolean; make: boolean; telegram: boolean; whatsapp: boolean; google: boolean };
}

export default function DashboardPage({ user, recentTasks }: { user: User; recentTasks: TaskUpdate[] }) {
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    window.openclaw.apiFetch("/api/dashboard/summary").then((d) => setData(d as Summary)).catch(() => {});
  }, []);

  const running = recentTasks.filter((t) => t.status === "running").length;
  const completed = recentTasks.filter((t) => t.status === "completed").length;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="titlebar-drag">
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-500 text-sm">Bienvenido, {user.name}</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Plan</p>
          <p className="text-white font-bold text-lg">{data?.plan.name ?? "—"}</p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Mensajes usados</p>
          <p className="text-white font-bold text-lg">
            {data ? `${data.usage.chat_messages} / ${data.plan.chat_limit}` : "—"}
          </p>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Leads</p>
          <p className="text-white font-bold text-lg">{data?.stats.total_leads ?? "—"}</p>
        </div>
      </div>

      {/* Agent status */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
        <p className="text-white font-medium text-sm mb-3">Desktop Agent</p>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-sm">Activo</span>
          </div>
          <div className="text-gray-400 text-sm">
            {running > 0 ? `${running} ejecutando` : "Sin tareas activas"}
          </div>
          <div className="text-gray-500 text-sm">
            {completed} completadas esta sesion
          </div>
        </div>
      </div>

      {/* Integrations */}
      {data?.integrations && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-white font-medium text-sm mb-3">Integraciones</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.integrations).map(([key, connected]) => (
              <span
                key={key}
                className={`text-xs px-2.5 py-1 rounded-full ${
                  connected ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-gray-700/50 text-gray-500 border border-gray-600/30"
                }`}
              >
                {key}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent tasks */}
      {recentTasks.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <p className="text-white font-medium text-sm mb-3">Tareas recientes</p>
          <div className="space-y-2">
            {recentTasks.slice(0, 5).map((task) => (
              <div key={task.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-300">#{task.id} {task.instruction ?? task.task_type}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  task.status === "completed" ? "text-green-400 bg-green-400/10"
                  : task.status === "running" ? "text-blue-400 bg-blue-400/10"
                  : task.status === "failed" ? "text-red-400 bg-red-400/10"
                  : "text-yellow-400 bg-yellow-400/10"
                }`}>
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
