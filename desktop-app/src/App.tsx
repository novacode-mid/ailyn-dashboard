import { useEffect, useState } from "react";
import type { User, LogEntry, TaskUpdate } from "./types";
import LoginPage from "./pages/LoginPage";
import Sidebar from "./components/Sidebar";
import DashboardPage from "./pages/DashboardPage";
import ChatPage from "./pages/ChatPage";
import TasksPage from "./pages/TasksPage";
import LogsPage from "./pages/LogsPage";
import SettingsPage from "./pages/SettingsPage";

type Page = "dashboard" | "chat" | "tasks" | "logs" | "settings";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>("dashboard");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [recentTasks, setRecentTasks] = useState<TaskUpdate[]>([]);

  // Check existing session
  useEffect(() => {
    window.openclaw.getSession().then((session) => {
      if (session) setUser(session.user);
      setLoading(false);
    });
  }, []);

  // Listen to agent events
  useEffect(() => {
    if (!user) return;

    const removeLog = window.openclaw.onLog((entry) => {
      setLogs((prev) => [...prev.slice(-200), entry]);
    });

    const removeTask = window.openclaw.onTaskUpdate((task) => {
      setRecentTasks((prev) => {
        const filtered = prev.filter((t) => t.id !== task.id);
        return [task, ...filtered].slice(0, 50);
      });
    });

    return () => { removeLog(); removeTask(); };
  }, [user]);

  if (loading) {
    return (
      <div className="h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  return (
    <div className="h-screen bg-[#0f172a] flex overflow-hidden">
      <Sidebar
        page={page}
        onNavigate={setPage}
        user={user}
        taskCount={recentTasks.filter((t) => t.status === "running" || t.status === "pending").length}
        onLogout={() => {
          window.openclaw.logout();
          setUser(null);
          setLogs([]);
          setRecentTasks([]);
        }}
      />
      <main className="flex-1 overflow-hidden">
        {page === "dashboard" && <DashboardPage user={user} recentTasks={recentTasks} />}
        {page === "chat" && <ChatPage user={user} />}
        {page === "tasks" && <TasksPage recentTasks={recentTasks} />}
        {page === "logs" && <LogsPage logs={logs} onClear={() => setLogs([])} />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
