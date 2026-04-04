// ── Test MCP Server via JSON-RPC over HTTP ───────────────────────────────
// Simula un servidor MCP con 4 tools para probar el scanner de Ailyn.

import express from "express";

const app = express();
app.use(express.json());

// ── Tools catalog ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_weather",
    description: "Obtener el clima actual de una ciudad",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "Nombre de la ciudad" },
      },
      required: ["city"],
    },
  },
  {
    name: "calculate",
    description: "Realizar un calculo matematico (suma, resta, multiplicacion, division)",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Expresion matematica (ej: 2+2, 10*5)" },
      },
      required: ["expression"],
    },
  },
  {
    name: "translate_text",
    description: "Traducir texto de un idioma a otro",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Texto a traducir" },
        from: { type: "string", description: "Idioma de origen (ej: es, en)" },
        to: { type: "string", description: "Idioma de destino (ej: en, es)" },
      },
      required: ["text", "to"],
    },
  },
  {
    name: "generate_qr",
    description: "Generar un codigo QR a partir de texto o URL",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Texto o URL para el QR" },
        size: { type: "number", description: "Tamaño en pixeles (default: 200)" },
      },
      required: ["content"],
    },
  },
];

// ── Tool execution ───────────────────────────────────────────────────────
function executeTool(name, args) {
  switch (name) {
    case "get_weather":
      return { temperature: Math.floor(Math.random() * 30) + 5, city: args.city, condition: "Soleado", humidity: 65 };
    case "calculate":
      try { return { result: eval(args.expression), expression: args.expression }; }
      catch { return { error: "Expresion invalida" }; }
    case "translate_text":
      return { original: args.text, translated: `[Traducido a ${args.to}]: ${args.text}`, from: args.from ?? "auto", to: args.to };
    case "generate_qr":
      return { url: `https://api.qrserver.com/v1/create-qr-code/?size=${args.size ?? 200}x${args.size ?? 200}&data=${encodeURIComponent(args.content)}`, content: args.content };
    default:
      return { error: `Tool ${name} no encontrada` };
  }
}

// ── JSON-RPC handler ─────────────────────────────────────────────────────
app.post("/mcp", (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== "2.0") {
    return res.json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } });
  }

  switch (method) {
    case "initialize":
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "Test MCP Server", version: "1.0.0" },
        },
      });

    case "tools/list":
      return res.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });

    case "tools/call": {
      const { name, arguments: args } = params ?? {};
      const result = executeTool(name, args ?? {});
      return res.json({
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      });
    }

    default:
      return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});

const PORT = 4567;
app.listen(PORT, () => {
  console.log(`\n  🔌 Test MCP Server running on http://localhost:${PORT}/mcp\n`);
  console.log(`  Tools: ${TOOLS.map(t => t.name).join(", ")}\n`);
});
