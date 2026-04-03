export interface User {
  id: number;
  name: string;
  email: string;
  company_id: number;
  company_name: string;
}

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

// Global window type for preload bridge
declare global {
  interface Window {
    openclaw: {
      getSession: () => Promise<{ token: string; user: User } | null>;
      login: (email: string, password: string) => Promise<{ token: string; user: User }>;
      logout: () => Promise<boolean>;
      apiFetch: (path: string, options?: { method?: string; body?: string }) => Promise<unknown>;
      chatSend: (message: string, sessionId: string) => Promise<{ reply?: string; error?: string }>;
      getSettings: () => Promise<{ headless: boolean; pollInterval: number; apiUrl: string }>;
      setSetting: (key: string, value: unknown) => Promise<boolean>;
      onLog: (callback: (entry: LogEntry) => void) => () => void;
      onTaskUpdate: (callback: (task: TaskUpdate) => void) => () => void;
      openExternal: (url: string) => Promise<void>;
    };
  }
}
