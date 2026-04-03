import { useEffect, useState } from "react";
import type { TaskUpdate } from "../types";

interface FullTask {
  id: number;
  task_type: string;
  instruction: string | null;
  status: string;
  error: string | null;
  result: string | null;
  screenshot_b64: string | null;
  created_at: string;
}

const TYPE_ICONS: Record<string, string> = {
  screenshot: "📸", scrape_data: "🔎", fill_form: "📝", download_file: "📥",
  fs_write: "💾", fs_read: "📄", fs_list: "📁", fs_delete: "🗑️",
};

export default function TasksPage({ recentTasks }: { recentTasks: TaskUpdate[] }) {
  const [tasks, setTasks] = useState<FullTask[]>([]);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<FullTask | null>(null);

  useEffect(() => {
    const url = filter === "all" ? "/api/desktop/tasks" : `/api/desktop/tasks?status=${filter}`;
    window.openclaw.apiFetch(url).then((d) => setTasks((d as { tasks: FullTask[] }).tasks ?? [])).catch(() => {});
  }, [filter, recentTasks]);

  async function viewDetail(id: number) {
    if (selectedId === id) { setSelectedId(null); return; }
    setSelectedId(id);
    const d = await window.openclaw.apiFetch(`/api/desktop/tasks/${id}`) as FullTask;
    setDetail(d);
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="titlebar-drag">
        <h1 className="text-lg font-bold text-white">Desktop Tasks</h1>
        <p className="text-gray-500 text-xs">Tareas de browser y filesystem</p>
      </div>

      <div className="flex gap-2">
        {["all", "pending", "running", "completed", "failed"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              filter === f ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" : "bg-gray-800 text-gray-400 border border-gray-700"
            }`}>{f === "all" ? "Todas" : f}</button>
        ))}
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          <p className="text-4xl mb-3">🖥️</p>
          <p className="text-sm">No hay tareas</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div key={task.id}>
              <button onClick={() => viewDetail(task.id)}
                className={`w-full bg-gray-800/50 border rounded-lg p-3 text-left transition-colors hover:border-gray-600 ${
                  selectedId === task.id ? "border-purple-500/50" : "border-gray-700/50"
                }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{TYPE_ICONS[task.task_type] ?? "⚙️"}</span>
                    <span className="text-sm text-white">{task.instruction ?? task.task_type}</span>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded ${
                    task.status === "completed" ? "text-green-400 bg-green-400/10"
                    : task.status === "running" ? "text-blue-400 bg-blue-400/10"
                    : task.status === "failed" ? "text-red-400 bg-red-400/10"
                    : "text-yellow-400 bg-yellow-400/10"
                  }`}>{task.status}</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">#{task.id} · {new Date(task.created_at).toLocaleString("es-MX")}</p>
              </button>

              {selectedId === task.id && detail && (
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mt-1 space-y-3">
                  {detail.screenshot_b64 && (
                    <img src={`data:image/png;base64,${detail.screenshot_b64}`} alt="Screenshot" className="rounded-lg border border-gray-700 max-w-full" />
                  )}
                  {detail.result && (
                    <pre className="text-xs text-gray-300 bg-gray-800 rounded-lg p-3 overflow-x-auto max-h-40">
                      {(() => { try { const r = JSON.parse(detail.result); const { screenshot: _s, screenshot_b64: _sb, beforeScreenshot: _bs, ...rest } = r; return JSON.stringify(rest, null, 2); } catch { return detail.result; } })()}
                    </pre>
                  )}
                  {detail.error && <p className="text-xs text-red-400">{detail.error}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
