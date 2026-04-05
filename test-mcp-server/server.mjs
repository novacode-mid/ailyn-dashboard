// ── MCP Server con APIs Reales ───────────────────────────────────────────
// 6 tools que consultan APIs publicas de verdad (no mocks)

import express from "express";

const app = express();
app.use(express.json());

// ── Tools catalog ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_weather",
    description: "Obtener el clima REAL actual de cualquier ciudad del mundo",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string", description: "Ciudad (ej: Monterrey, New York, Tokyo)" } },
      required: ["city"],
    },
  },
  {
    name: "get_crypto_price",
    description: "Obtener el precio actual de cualquier criptomoneda (Bitcoin, Ethereum, etc)",
    inputSchema: {
      type: "object",
      properties: { coin: { type: "string", description: "ID de la moneda (bitcoin, ethereum, solana, etc)" } },
      required: ["coin"],
    },
  },
  {
    name: "get_news",
    description: "Buscar noticias recientes sobre cualquier tema",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Tema de busqueda (ej: inteligencia artificial, bitcoin)" } },
      required: ["query"],
    },
  },
  {
    name: "generate_qr",
    description: "Generar un codigo QR a partir de cualquier texto o URL",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Texto o URL para el QR" },
        size: { type: "number", description: "Tamaño en pixeles (default: 300)" },
      },
      required: ["content"],
    },
  },
  {
    name: "get_exchange_rate",
    description: "Obtener tipo de cambio entre monedas (USD, MXN, EUR, etc)",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Moneda origen (ej: USD)" },
        to: { type: "string", description: "Moneda destino (ej: MXN)" },
        amount: { type: "number", description: "Cantidad a convertir (default: 1)" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_random_fact",
    description: "Obtener un dato curioso aleatorio para compartir",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ── Tool execution con APIs reales ───────────────────────────────────────

async function executeTool(name, args) {
  switch (name) {
    case "get_weather": {
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(args.city)}?format=j1`);
        const data = await res.json();
        const current = data.current_condition?.[0] ?? {};
        return {
          city: args.city,
          temperature_c: current.temp_C,
          temperature_f: current.temp_F,
          feels_like_c: current.FeelsLikeC,
          humidity: current.humidity + "%",
          condition: current.weatherDesc?.[0]?.value ?? "Unknown",
          wind_kmh: current.windspeedKmph + " km/h",
          wind_direction: current.winddir16Point,
          visibility_km: current.visibility,
          uv_index: current.uvIndex,
        };
      } catch (err) {
        return { error: `No se pudo obtener el clima: ${err.message}` };
      }
    }

    case "get_crypto_price": {
      try {
        const coin = (args.coin ?? "bitcoin").toLowerCase();
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd,mxn&include_24hr_change=true&include_market_cap=true`);
        const data = await res.json();
        const info = data[coin];
        if (!info) return { error: `Moneda "${coin}" no encontrada` };
        return {
          coin,
          price_usd: `$${info.usd?.toLocaleString()}`,
          price_mxn: `$${info.mxn?.toLocaleString()} MXN`,
          change_24h: `${info.usd_24h_change?.toFixed(2)}%`,
          market_cap_usd: `$${(info.usd_market_cap / 1e9)?.toFixed(2)}B`,
        };
      } catch (err) {
        return { error: `No se pudo obtener precio: ${err.message}` };
      }
    }

    case "get_news": {
      try {
        const res = await fetch(`https://newsdata.io/api/1/latest?apikey=pub_64901b05dbfd260af41ca2cd4e5dd45b0caf3&q=${encodeURIComponent(args.query)}&language=es,en&size=5`);
        const data = await res.json();
        const articles = (data.results ?? []).slice(0, 5).map(a => ({
          title: a.title,
          source: a.source_name,
          date: a.pubDate,
          link: a.link,
          description: a.description?.slice(0, 150),
        }));
        return { query: args.query, count: articles.length, articles };
      } catch (err) {
        return { error: `No se pudieron obtener noticias: ${err.message}` };
      }
    }

    case "generate_qr": {
      const size = args.size ?? 300;
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(args.content)}`;
      return { content: args.content, qr_url: url, size };
    }

    case "get_exchange_rate": {
      try {
        const from = (args.from ?? "USD").toUpperCase();
        const to = (args.to ?? "MXN").toUpperCase();
        const amount = args.amount ?? 1;
        const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
        const data = await res.json();
        const rate = data.rates?.[to];
        if (!rate) return { error: `No se encontro tipo de cambio ${from}→${to}` };
        return {
          from, to, amount,
          rate: rate.toFixed(4),
          result: (amount * rate).toFixed(2),
          formatted: `${amount} ${from} = ${(amount * rate).toFixed(2)} ${to}`,
        };
      } catch (err) {
        return { error: `Error al obtener tipo de cambio: ${err.message}` };
      }
    }

    case "get_random_fact": {
      try {
        const res = await fetch("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en");
        const data = await res.json();
        return { fact: data.text, source: data.source };
      } catch {
        return { fact: "Los pulpos tienen tres corazones y sangre azul.", source: "biology" };
      }
    }

    default:
      return { error: `Tool ${name} no encontrada` };
  }
}

// ── JSON-RPC handler ─────────────────────────────────────────────────────
app.post("/mcp", async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;
  if (jsonrpc !== "2.0") return res.json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } });

  switch (method) {
    case "initialize":
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "OpenClaw Real APIs MCP", version: "2.0.0" },
        },
      });

    case "tools/list":
      return res.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });

    case "tools/call": {
      const { name, arguments: args } = params ?? {};
      const result = await executeTool(name, args ?? {});
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
  console.log(`\n  🌐 OpenClaw Real APIs MCP Server v2.0`);
  console.log(`  📍 http://localhost:${PORT}/mcp\n`);
  console.log(`  Tools:`);
  TOOLS.forEach(t => console.log(`    - ${t.name}: ${t.description}`));
  console.log();
});
