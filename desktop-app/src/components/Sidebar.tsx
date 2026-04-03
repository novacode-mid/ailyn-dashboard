import type { User } from "../types";

type Page = "dashboard" | "chat" | "tasks" | "logs" | "settings";

interface Props {
  page: Page;
  onNavigate: (page: Page) => void;
  user: User;
  taskCount: number;
  onLogout: () => void;
}

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "tasks", label: "Tasks", icon: "🖥️" },
  { id: "logs", label: "Logs", icon: "📋" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar({ page, onNavigate, user, taskCount, onLogout }: Props) {
  return (
    <aside className="w-56 shrink-0 bg-gray-900/50 border-r border-white/[0.06] flex flex-col">
      {/* Header / drag region */}
      <div className="titlebar-drag px-4 pt-6 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
            <span className="text-purple-300 font-bold text-sm">A</span>
          </div>
          <span className="text-white font-bold text-lg">Ailyn</span>
        </div>
        <p className="text-[11px] text-white/30 mt-1 pl-10 truncate">{user.company_name}</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              page === item.id
                ? "bg-purple-500/15 text-purple-300"
                : "text-gray-400 hover:text-white hover:bg-white/[0.04]"
            }`}
          >
            <span className="text-base">{item.icon}</span>
            <span>{item.label}</span>
            {item.id === "tasks" && taskCount > 0 && (
              <span className="ml-auto bg-purple-500/30 text-purple-300 text-[10px] px-1.5 py-0.5 rounded-full">
                {taskCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Status */}
      <div className="px-4 py-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[11px] text-green-400/70">Agente activo</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-500 truncate">{user.email}</span>
          <button
            onClick={onLogout}
            className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
          >
            Salir
          </button>
        </div>
      </div>
    </aside>
  );
}
