// ── WebSocket client for Desktop Tunnel ──────────────────────────────────
// Connects to the Worker's Durable Object for instant task push.
// Falls back to HTTP polling if WebSocket fails.

import type { AgentConfig } from "./config";
import WebSocket from "ws";

export interface WsTask {
  id: number;
  task_type: string;
  config: string;
  instruction?: string;
  batch_id?: string;
  status: string;
}

export class TunnelClient {
  private ws: WebSocket | null = null;
  private config: AgentConfig;
  private onTask: (task: WsTask) => void;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: AgentConfig, onTask: (task: WsTask) => void) {
    this.config = config;
    this.onTask = onTask;
  }

  connect(): void {
    const wsUrl = this.config.apiUrl
      .replace("https://", "wss://")
      .replace("http://", "ws://")
      + `/api/desktop/tunnel?token=${encodeURIComponent(this.config.token)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        console.log("[tunnel] WebSocket connected");
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type: string; task?: WsTask };
          if (msg.type === "new_task" && msg.task) {
            this.onTask(msg.task);
          }
        } catch { /* ignore non-JSON */ }
      });

      this.ws.on("close", () => {
        console.log("[tunnel] WebSocket disconnected, reconnecting in 5s...");
        this.scheduleReconnect();
      });

      this.ws.on("error", () => {
        // Will trigger close event
      });

      // Keepalive ping every 30s
      const pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send("ping");
        } else {
          clearInterval(pingInterval);
        }
      }, 30_000);
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
