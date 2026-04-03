import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, shell } from "electron";
import * as path from "path";
import Store from "electron-store";
import { AgentRunner } from "./agent/runner";

// ── Persistent store ─────────────────────────────────────────────────────
const store = new Store<{
  token: string;
  user: { id: number; name: string; email: string; company_id: number; company_name: string };
  settings: { headless: boolean; pollInterval: number; apiUrl: string };
}>({
  defaults: {
    token: "",
    user: { id: 0, name: "", email: "", company_id: 0, company_name: "" },
    settings: {
      headless: true,
      pollInterval: 3000,
      apiUrl: "https://ailyn-agent.novacodepro.workers.dev",
    },
  },
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let agent: AgentRunner | null = null;

const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: "OpenClaw Desktop",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("close", (e) => {
    if (tray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

// ── System Tray ──────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABhSURBVFhH7c4xDQAgDETRjgQk4B8LWMACFnAAGqr8ZODy5iZNE0L4GWPsrLWeZ+aOiHszc2f+WGsdjDG+I+LOzJ35Y611MMb4jog7M3fm/62IZwy/qTX/AgAA8BsifAEJyxQjx1ECPAAAAABJRU5ErkJggg=="
  );
  tray = new Tray(icon);
  tray.setToolTip("OpenClaw Desktop");

  const contextMenu = Menu.buildFromTemplate([
    { label: "Abrir OpenClaw", click: () => mainWindow?.show() },
    { type: "separator" },
    {
      label: "Estado: Conectado",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Salir",
      click: () => {
        tray?.destroy();
        tray = null;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => mainWindow?.show());
}

// ── IPC Handlers ─────────────────────────────────────────────────────────

// Auth
ipcMain.handle("auth:getSession", () => {
  const token = store.get("token");
  const user = store.get("user");
  return token ? { token, user } : null;
});

ipcMain.handle("auth:login", async (_e, email: string, password: string) => {
  const apiUrl = store.get("settings.apiUrl");
  const res = await fetch(`${apiUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json() as { token?: string; user?: Record<string, unknown>; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Login failed");
  store.set("token", data.token!);
  store.set("user", data.user as typeof store extends Store<infer T> ? T["user"] : never);
  // Start agent after login
  startAgent();
  return { token: data.token, user: data.user };
});

ipcMain.handle("auth:logout", () => {
  store.set("token", "");
  store.set("user", { id: 0, name: "", email: "", company_id: 0, company_name: "" });
  stopAgent();
  return true;
});

// Settings
ipcMain.handle("settings:get", () => store.get("settings"));
ipcMain.handle("settings:set", (_e, key: string, value: unknown) => {
  store.set(`settings.${key}`, value);
  // Restart agent if relevant settings changed
  if (key === "pollInterval" || key === "headless") {
    stopAgent();
    startAgent();
  }
  return true;
});

// API proxy (for renderer to make authenticated requests)
ipcMain.handle("api:fetch", async (_e, path: string, options?: { method?: string; body?: string }) => {
  const apiUrl = store.get("settings.apiUrl");
  const token = store.get("token");
  const res = await fetch(`${apiUrl}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: options?.body,
  });
  return res.json();
});

// Chat
ipcMain.handle("chat:send", async (_e, message: string, sessionId: string) => {
  const apiUrl = store.get("settings.apiUrl");
  const user = store.get("user");
  const slug = user.company_name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const res = await fetch(`${apiUrl}/api/chat/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  return res.json();
});

// Open external link
ipcMain.handle("shell:openExternal", (_e, url: string) => {
  shell.openExternal(url);
});

// ── Agent ────────────────────────────────────────────────────────────────

function startAgent() {
  if (agent) return;
  const token = store.get("token");
  if (!token) return;

  const settings = store.get("settings");
  agent = new AgentRunner({
    apiUrl: settings.apiUrl,
    token,
    pollInterval: settings.pollInterval,
    headless: settings.headless,
  });

  agent.on("log", (entry) => {
    mainWindow?.webContents.send("agent:log", entry);
  });

  agent.on("taskUpdate", (task) => {
    mainWindow?.webContents.send("agent:taskUpdate", task);
    // Native notification for completed tasks
    if (task.status === "completed") {
      new Notification({
        title: "Tarea completada",
        body: `${task.task_type}: ${task.instruction ?? "completada"}`,
      }).show();
    }
  });

  agent.start();
}

function stopAgent() {
  if (agent) {
    agent.stop();
    agent = null;
  }
}

// ── App lifecycle ────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Auto-start agent if already logged in
  if (store.get("token")) {
    startAgent();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !tray) app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow?.show();
});
