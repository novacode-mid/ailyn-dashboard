import { fetchAgentStats, parseNextStep, parseNotifyManager } from "../services/agent-stats";
import type { TaskRow } from "../services/agent-stats";
import { InjectTaskModal } from "./InjectTaskModal";
import { KillSwitch } from "./KillSwitch";

// ── KPI Card ──────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: number;
  accent: string;
  icon: string;
}) {
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm ${accent}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-4xl font-bold tracking-tight text-gray-900">{value}</p>
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending:          "bg-yellow-100 text-yellow-800 border-yellow-200",
  processing:       "bg-blue-100   text-blue-800   border-blue-200",
  completed:        "bg-green-100  text-green-800  border-green-200",
  failed:           "bg-red-100    text-red-800    border-red-200",
  pending_approval: "bg-purple-100 text-purple-800 border-purple-200",
};

const STATUS_LABELS: Record<string, string> = {
  pending:          "Pendiente",
  processing:       "Procesando",
  completed:        "Completada",
  failed:           "Fallida",
  pending_approval: "⏳ Aprobación",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── Priority Badge ────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: number }) {
  const label = priority <= 2 ? "Alta" : priority <= 5 ? "Media" : "Baja";
  const style =
    priority <= 2
      ? "text-red-700 font-bold"
      : priority <= 5
      ? "text-amber-700 font-semibold"
      : "text-gray-500";
  return <span className={`text-sm ${style}`}>{label} ({priority})</span>;
}

// ── Task Row ──────────────────────────────────────────────────────────────

function TaskTableRow({ task }: { task: TaskRow }) {
  const nextStep = parseNextStep(task.result);
  const notifyManager = parseNotifyManager(task.result);

  return (
    <tr className="border-b border-gray-100 transition-colors hover:bg-gray-50">
      <td className="px-4 py-3 text-sm font-mono text-gray-400">#{task.id}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{task.title}</span>
          {notifyManager && (
            <span title="Gerente notificado" className="text-base">🔔</span>
          )}
        </div>
        <p className="mt-0.5 max-w-xs truncate text-xs text-gray-400">{task.description}</p>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={task.status} />
      </td>
      <td className="px-4 py-3">
        <PriorityBadge priority={task.priority} />
      </td>
      <td className="max-w-sm px-4 py-3 text-sm text-gray-600">
        {task.status === "completed" ? (
          <span className="italic">{nextStep}</span>
        ) : task.status === "failed" ? (
          <span className="text-red-500 text-xs">{task.result ?? "Error desconocido"}</span>
        ) : task.status === "pending_approval" ? (
          <span className="text-purple-700 text-xs font-medium">{task.result ?? "Esperando aprobación del gerente."}</span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
        {new Date(task.updated_at).toLocaleString("es-MX", {
          dateStyle: "short",
          timeStyle: "short",
        })}
      </td>
    </tr>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────

export async function AgentDashboard() {
  let stats;
  try {
    stats = await fetchAgentStats();
  } catch (err) {
    return (
      <div className="flex min-h-[400px] items-center justify-center rounded-xl border border-red-200 bg-red-50 p-8">
        <div className="text-center">
          <p className="text-4xl">⚠️</p>
          <p className="mt-2 font-semibold text-red-700">No se pudo conectar con el Worker</p>
          <p className="mt-1 text-sm text-red-500">{String(err)}</p>
        </div>
      </div>
    );
  }

  const total = stats.pending + stats.processing + stats.completed + stats.failed;

  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Agent Monitor
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Cloudflare Workers AI · Llama 3.3 · Cron cada 15 min
          </p>
        </div>
        <KillSwitch initialStatus={stats.system_status} />
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total tareas"    value={total}            accent="border-gray-200"   icon="📋" />
        <KpiCard label="Pendientes"      value={stats.pending}    accent="border-yellow-200" icon="⏳" />
        <KpiCard label="Completadas"     value={stats.completed}  accent="border-green-200"  icon="✅" />
        <KpiCard label="Fallidas"        value={stats.failed}     accent="border-red-200"    icon="❌" />
      </div>

      {/* ── Tabla de historial ─────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Historial del Bucle Agéntico</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">Últimas 15 tareas</span>
            <InjectTaskModal />
          </div>
        </div>

        {stats.recentTasks.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <div className="text-center">
              <p className="text-4xl">🤖</p>
              <p className="mt-2 text-sm">No hay tareas todavía</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Tarea</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Prioridad</th>
                  <th className="px-4 py-3">Siguiente paso (IA)</th>
                  <th className="px-4 py-3">Actualizado</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentTasks.map((task) => (
                  <TaskTableRow key={task.id} task={task} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <p className="text-center text-xs text-gray-400">
        🔔 = Gerente notificado vía Smart Pass push · Datos actualizados cada 30 s
      </p>
    </div>
  );
}
