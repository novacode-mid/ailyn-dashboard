#!/usr/bin/env node

import { loadConfig, saveConfig, isConfigured } from "./config";
import { startPoller } from "./poller";
import * as logger from "./logger";

const BANNER = `
  ╔═══════════════════════════════════════╗
  ║     OpenClaw Desktop Agent v1.0       ║
  ║     Browser & File Automation         ║
  ╚═══════════════════════════════════════╝
`;

async function handleLogin(): Promise<void> {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((r) => rl.question(q, r));

  console.log("\n  Configura tu Desktop Agent\n");

  const apiUrl = await ask("  Worker URL (Enter para default): ");
  const token = await ask("  Session Token: ");

  if (!token.trim()) {
    logger.error("Token requerido. Obtén uno desde el dashboard en /settings");
    rl.close();
    process.exit(1);
  }

  saveConfig({
    apiUrl: apiUrl.trim() || undefined,
    token: token.trim(),
  });

  logger.success("Configuración guardada en ~/.openclaw/config.json");
  logger.info("Ejecuta 'openclaw start' para iniciar el agente");
  rl.close();
}

async function handleStart(): Promise<void> {
  console.log(BANNER);

  if (!isConfigured()) {
    logger.error("No configurado. Ejecuta primero: openclaw login");
    process.exit(1);
  }

  const config = loadConfig();
  logger.info(`Worker: ${config.apiUrl}`);
  logger.info(`Headless: ${config.headless}`);
  logger.info(`Poll interval: ${config.pollInterval}ms`);
  logger.log("Esperando tareas...\n");

  // Graceful shutdown
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    logger.warn("Deteniendo agente...");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await startPoller(config);
}

// ── CLI Router ───────────────────────────────────────────────────────────

const command = process.argv[2];

switch (command) {
  case "login":
    handleLogin();
    break;
  case "start":
    handleStart();
    break;
  case "config":
    console.log(JSON.stringify(loadConfig(), null, 2));
    break;
  case "bridge": {
    const mcpCommand = process.argv.slice(3).join(" ");
    if (!mcpCommand) {
      console.log("  Uso: openclaw bridge <comando-mcp>");
      console.log("  Ej:  openclaw bridge npx @modelcontextprotocol/server-github");
      process.exit(1);
    }
    import("./mcp-bridge").then(({ startBridge }) => {
      startBridge(mcpCommand, 4569);
    });
    break;
  }
  default:
    console.log(BANNER);
    console.log("  Comandos:");
    console.log("    openclaw login    — Configurar token y URL");
    console.log("    openclaw start    — Iniciar el agente");
    console.log("    openclaw bridge   — Exponer MCP stdio como HTTP");
    console.log("    openclaw config   — Ver configuración actual");
    console.log("");
    break;
}
