import { contextBridge, ipcRenderer } from "electron";

export interface LogEntry {
  type: "info" | "success" | "warn" | "error" | "log";
  message: string;
  timestamp: string;
}

export interface TaskUpdate {
  id: number;
  task_type: string;
  instruction: string | null;
  status: string;
  error?: string;
}

contextBridge.exposeInMainWorld("openclaw", {
  // Auth
  getSession: () => ipcRenderer.invoke("auth:getSession"),
  login: (email: string, password: string) => ipcRenderer.invoke("auth:login", email, password),
  logout: () => ipcRenderer.invoke("auth:logout"),

  // API
  apiFetch: (path: string, options?: { method?: string; body?: string }) =>
    ipcRenderer.invoke("api:fetch", path, options),

  // Chat
  chatSend: (message: string, sessionId: string) =>
    ipcRenderer.invoke("chat:send", message, sessionId),

  // Settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke("settings:set", key, value),

  // Agent events
  onLog: (callback: (entry: LogEntry) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: LogEntry) => callback(entry);
    ipcRenderer.on("agent:log", handler);
    return () => ipcRenderer.removeListener("agent:log", handler);
  },
  onTaskUpdate: (callback: (task: TaskUpdate) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, task: TaskUpdate) => callback(task);
    ipcRenderer.on("agent:taskUpdate", handler);
    return () => ipcRenderer.removeListener("agent:taskUpdate", handler);
  },

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
});
