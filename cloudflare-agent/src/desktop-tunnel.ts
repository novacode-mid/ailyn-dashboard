// ── Desktop Tunnel: WebSocket persistente via Durable Object ─────────────
// Mantiene conexión WebSocket con el Desktop Agent para push instantáneo
// de tareas en vez de polling cada 3 segundos.

export class DesktopTunnel {
  private state: DurableObjectState;
  private connections: Map<string, WebSocket> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade request from Desktop Agent
    if (request.headers.get("Upgrade") === "websocket") {
      const companyId = url.searchParams.get("company_id");
      if (!companyId) return new Response("company_id required", { status: 400 });

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];

      this.state.acceptWebSocket(server);
      this.connections.set(companyId, server);

      server.addEventListener("close", () => {
        this.connections.delete(companyId);
      });

      server.addEventListener("message", (event) => {
        // Handle pings from client
        if (event.data === "ping") {
          server.send("pong");
        }
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // Push task to connected Desktop Agent
    if (request.method === "POST" && url.pathname === "/push") {
      const body = await request.json() as { company_id: string; task: Record<string, unknown> };
      const ws = this.connections.get(body.company_id);

      if (ws) {
        try {
          ws.send(JSON.stringify({ type: "new_task", task: body.task }));
          return new Response(JSON.stringify({ pushed: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch {
          this.connections.delete(body.company_id);
        }
      }

      return new Response(JSON.stringify({ pushed: false, reason: "not_connected" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if a company is connected
    if (request.method === "GET" && url.pathname === "/status") {
      const companyId = url.searchParams.get("company_id");
      const connected = companyId ? this.connections.has(companyId) : false;
      return new Response(JSON.stringify({ connected, total: this.connections.size }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }

  // Handle WebSocket messages from Durable Object API
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") {
      ws.send("pong");
    }
  }

  async webSocketClose(): Promise<void> {
    // Cleanup handled by close event listener
  }
}
