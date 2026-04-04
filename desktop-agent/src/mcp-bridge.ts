// ── MCP Bridge: Expone MCPs stdio como HTTP para que el Worker los use ───
// El Desktop Agent corre el MCP server localmente via child_process (stdio)
// y expone un endpoint HTTP que traduce JSON-RPC HTTP ↔ stdio.
//
// Uso: openclaw bridge --command "npx @modelcontextprotocol/server-github"
// Expone en: http://localhost:4569/mcp
// El Worker se conecta via Cloudflare Tunnel o directamente.

import { spawn, type ChildProcess } from "child_process";
import * as http from "http";

interface BridgeOptions {
  command: string;
  args?: string[];
  port?: number;
}

export class McpBridge {
  private proc: ChildProcess | null = null;
  private server: http.Server | null = null;
  private port: number;
  private command: string;
  private cmdArgs: string[];
  private pendingRequests = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private nextId = 1;

  constructor(options: BridgeOptions) {
    this.command = options.command;
    this.cmdArgs = options.args ?? [];
    this.port = options.port ?? 4569;
  }

  async start(): Promise<void> {
    // 1. Spawn the MCP process with stdio transport
    const [cmd, ...args] = this.command.split(" ");
    this.proc = spawn(cmd, [...args, ...this.cmdArgs], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    // Read stdout for JSON-RPC responses
    this.proc.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.proc.stderr?.on("data", (data: Buffer) => {
      console.error(`[mcp-bridge] stderr: ${data.toString().trim()}`);
    });

    this.proc.on("close", (code) => {
      console.log(`[mcp-bridge] Process exited with code ${code}`);
      // Reject all pending requests
      for (const [, req] of this.pendingRequests) {
        req.reject(new Error("MCP process exited"));
      }
      this.pendingRequests.clear();
    });

    // 2. Initialize MCP
    await this.sendToProcess({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "OpenClaw Bridge", version: "1.0.0" },
      },
    });

    // 3. Start HTTP server
    this.server = http.createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/mcp") {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", async () => {
          try {
            const jsonRpc = JSON.parse(body);
            const response = await this.sendToProcess(jsonRpc);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(response);
          } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32603, message: err instanceof Error ? err.message : "Bridge error" },
            }));
          }
        });
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(this.port, () => {
        console.log(`\n  🔌 MCP Bridge running on http://localhost:${this.port}/mcp`);
        console.log(`  ↔  Bridging: ${this.command}\n`);
        resolve();
      });
    });
  }

  private sendToProcess(message: Record<string, unknown>): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = (message.id as number) ?? this.nextId++;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timeout (${message.method})`));
      }, 30_000);

      this.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });

      const json = JSON.stringify({ ...message, id }) + "\n";
      this.proc?.stdin?.write(json);
    });
  }

  private processBuffer(): void {
    // Try to parse complete JSON objects from buffer
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { id?: number };
        if (parsed.id !== undefined) {
          const pending = this.pendingRequests.get(parsed.id);
          if (pending) {
            this.pendingRequests.delete(parsed.id);
            pending.resolve(trimmed);
          }
        }
      } catch {
        // Not valid JSON — skip
      }
    }
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

// ── CLI entry for bridge mode ────────────────────────────────────────────

export async function startBridge(command: string, port?: number): Promise<void> {
  const bridge = new McpBridge({ command, port });

  process.on("SIGINT", () => { bridge.stop(); process.exit(0); });
  process.on("SIGTERM", () => { bridge.stop(); process.exit(0); });

  await bridge.start();
  console.log("  Bridge ready. Press Ctrl+C to stop.\n");

  // Keep alive
  await new Promise(() => {});
}
