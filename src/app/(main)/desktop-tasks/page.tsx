"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

interface DesktopTask {
  id: number;
  task_type: string;
  instruction: string | null;
  status: string;
  error: string | null;
  batch_id: string | null;
  created_at: string;
  completed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-400 bg-yellow-400/10",
  running: "text-blue-400 bg-blue-400/10",
  completed: "text-green-400 bg-green-400/10",
  failed: "text-red-400 bg-red-400/10",
};

const TYPE_ICONS: Record<string, string> = {
  screenshot: "📸",
  scrape_data: "🔎",
  fill_form: "📝",
  download_file: "📥",
  fs_write: "💾",
  fs_read: "📄",
  fs_list: "📁",
  fs_delete: "🗑️",
};

export default function DesktopTasksPage() {
  const [tasks, setTasks] = useState<DesktopTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  const [taskDetail, setTaskDetail] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter === "all"
        ? `${WORKER_URL}/api/desktop/tasks`
        : `${WORKER_URL}/api/desktop/tasks?status=${filter}`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) return;
      const data = (await res.json()) as { tasks: DesktopTask[] };
      setTasks(data.tasks ?? []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function viewDetail(taskId: number) {
    if (selectedTask === taskId) { setSelectedTask(null); return; }
    setSelectedTask(taskId);
    setDetailLoading(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/desktop/tasks/${taskId}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json() as Record<string, unknown>;
      setTaskDetail(data);
    } catch { /* */ }
    finally { setDetailLoading(false); }
  }

  return (
    <DashboardShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Desktop Agent</h1>
            <p className="text-gray-400 text-sm mt-0.5">Tareas de browser y filesystem ejecutadas</p>
          </div>
          <button onClick={load} className="text-xs text-purple-400 hover:text-white transition-colors">
            Actualizar
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          {["all", "pending", "running", "completed", "failed"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                filter === f ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600"
              }`}
            >
              {f === "all" ? "Todas" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-4xl mb-3">🖥️</p>
            <p className="text-sm">No hay tareas{filter !== "all" ? ` con estado "${filter}"` : ""}.</p>
            <p className="text-xs mt-1 text-gray-600">Las tareas aparecen cuando le pides al agente acciones de browser o archivos.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id}>
                <button
                  onClick={() => viewDetail(task.id)}
                  className="w-full bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{TYPE_ICONS[task.task_type] ?? "⚙️"}</span>
                      <div>
                        <p className="text-sm text-white">{task.instruction ?? task.task_type}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          #{task.id} · {task.task_type} · {new Date(task.created_at).toLocaleString("es-MX")}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-lg ${STATUS_COLORS[task.status] ?? "text-gray-400 bg-gray-800"}`}>
                      {task.status}
                    </span>
                  </div>
                  {task.error && (
                    <p className="text-xs text-red-400 mt-2">{task.error}</p>
                  )}
                </button>

                {/* Detail panel */}
                {selectedTask === task.id && (
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mt-1 space-y-3">
                    {detailLoading ? (
                      <div className="flex justify-center py-4">
                        <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : taskDetail ? (
                      <>
                        {/* Screenshot */}
                        {(taskDetail as Record<string, unknown>).screenshot_b64 && (
                          <div>
                            <p className="text-xs text-gray-400 mb-2">Screenshot:</p>
                            <img
                              src={`data:image/png;base64,${(taskDetail as Record<string, unknown>).screenshot_b64}`}
                              alt="Screenshot"
                              className="rounded-lg border border-gray-700 max-w-full"
                            />
                          </div>
                        )}
                        {/* Result */}
                        {(taskDetail as Record<string, unknown>).result && (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Resultado:</p>
                            <pre className="text-xs text-gray-300 bg-gray-900 rounded-lg p-3 overflow-x-auto max-h-40">
                              {(() => {
                                try {
                                  const r = JSON.parse((taskDetail as Record<string, unknown>).result as string);
                                  const { screenshot: _s, screenshot_b64: _sb, beforeScreenshot: _bs, ...rest } = r;
                                  return JSON.stringify(rest, null, 2);
                                } catch { return String((taskDetail as Record<string, unknown>).result); }
                              })()}
                            </pre>
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
