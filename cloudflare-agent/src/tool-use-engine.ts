// ── Tool Use Engine: Anthropic native tool_use con execution loop ─────────
// Sonnet decide que tools usar, nosotros los ejecutamos, Sonnet da respuesta final.
// Max 3 tool calls por mensaje para evitar loops infinitos.

import type { Env } from "./types";
import type { AnthropicTool } from "./tool-registry";
import { getIntegrationToken, slackSendMessage, slackListChannels, notionCreatePage, notionSearch, hubspotCreateContact, hubspotSearchContacts, hubspotCreateDeal, shopifyGetOrders, shopifyGetProducts, shopifySearchOrders, makeTriggerScenario } from "./integrations-hub";
import { mcpCallTool } from "./mcp-scanner";
import { searchWeb } from "./web-search";
import { createDesktopTask } from "./desktop-tasks";

const MAX_TOOL_CALLS = 3;

interface ToolCallResult {
  tool_use_id: string;
  content: string;
}

// ── Execute a single tool call from Sonnet ───────────────────────────────

async function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  env: Env,
  companyId: number,
  userMessage: string
): Promise<string> {
  try {
    switch (name) {
      case "send_email":
        return JSON.stringify({ action: "email_draft", to: input.to, subject: input.subject, body: input.body });

      case "gmail_read": {
        const token = await getGoogleToken(env, companyId);
        if (!token) return JSON.stringify({ error: "Google no conectado" });
        const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=${encodeURIComponent((input.query as string) ?? "is:unread")}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        return JSON.stringify(data);
      }

      case "calendar_read": {
        const token = await getGoogleToken(env, companyId);
        if (!token) return JSON.stringify({ error: "Google no conectado" });
        const now = new Date().toISOString();
        const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&maxResults=10&singleEvents=true&orderBy=startTime`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        return JSON.stringify(data);
      }

      case "calendar_write":
        return JSON.stringify({ action: "calendar_draft", title: input.title, date: input.date, startTime: input.start_time, endTime: input.end_time, attendees: input.attendees, description: input.description });

      case "web_search": {
        const results = await searchWeb(input.query as string, env);
        return JSON.stringify(results);
      }

      case "rag_search": {
        const embRes = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [(input.query as string).slice(0, 500)] }) as { data: number[][] };
        const results = await env.KNOWLEDGE_BASE.query(embRes.data[0], { topK: 5, returnMetadata: "all" });
        const matches = (results.matches ?? []).filter(m => !m.id.startsWith("skill-") && !m.id.startsWith("mcp-skill-"));
        return JSON.stringify(matches.map(m => ({ score: m.score, ...(m.metadata as Record<string, unknown>) })));
      }

      case "save_note":
        return JSON.stringify({ action: "save_note", url: input.url, title: input.title ?? "Nota" });

      case "schedule_followup":
        return JSON.stringify({ action: "followup_draft", to: input.to, days: Number(input.days) || 3, context: input.context ?? "", subject: input.subject ?? "Seguimiento" });

      case "crm_lookup": {
        const rows = await env.DB.prepare(
          `SELECT * FROM leads WHERE company_id = ? AND (name LIKE ? OR email LIKE ?) ORDER BY created_at DESC LIMIT 5`
        ).bind(companyId, `%${input.name}%`, `%${input.name}%`).all();
        return JSON.stringify({ leads: rows.results ?? [] });
      }

      case "desktop_action": {
        const taskId = await createDesktopTask(env, companyId, input.action as string, input as Record<string, unknown>, userMessage);
        return JSON.stringify({ task_created: taskId, status: "pending", note: "El Desktop Agent ejecutara esta tarea" });
      }

      // Integraciones
      case "slack": {
        const creds = await getIntegrationToken(env, companyId, "slack");
        if (!creds) return JSON.stringify({ error: "Slack no conectado" });
        if (input.channel === "list") {
          const channels = await slackListChannels(creds.access_token);
          return JSON.stringify({ channels });
        }
        await slackSendMessage(creds.access_token, input.channel as string, input.message as string);
        return JSON.stringify({ sent: true, channel: input.channel });
      }

      case "notion": {
        const creds = await getIntegrationToken(env, companyId, "notion");
        if (!creds) return JSON.stringify({ error: "Notion no conectado" });
        if (input.action === "search") {
          const results = await notionSearch(creds.access_token, (input.query as string) ?? "");
          return JSON.stringify({ results });
        }
        const parentId = (creds.extra_data as Record<string, string>)?.parent_id ?? "";
        const page = await notionCreatePage(creds.access_token, parentId, (input.title as string) ?? "", (input.content as string) ?? "");
        return JSON.stringify(page);
      }

      case "hubspot": {
        const creds = await getIntegrationToken(env, companyId, "hubspot");
        if (!creds) return JSON.stringify({ error: "HubSpot no conectado" });
        if (input.action === "search") {
          const results = await hubspotSearchContacts(creds.access_token, (input.query as string) ?? "");
          return JSON.stringify({ contacts: results });
        }
        if (input.action === "create_contact") {
          const contact = await hubspotCreateContact(creds.access_token, (input.email as string) ?? "", (input.first_name as string) ?? "", (input.last_name as string) ?? "");
          return JSON.stringify(contact);
        }
        if (input.action === "create_deal") {
          const deal = await hubspotCreateDeal(creds.access_token, (input.deal_name as string) ?? "", Number(input.amount) || 0);
          return JSON.stringify(deal);
        }
        return JSON.stringify({ error: "Accion no reconocida" });
      }

      case "shopify": {
        const creds = await getIntegrationToken(env, companyId, "shopify");
        if (!creds) return JSON.stringify({ error: "Shopify no conectado" });
        const shop = (creds.extra_data as Record<string, string>)?.shop ?? "";
        if (input.action === "products") return JSON.stringify(await shopifyGetProducts(creds.access_token, shop));
        if (input.action === "search_order") return JSON.stringify(await shopifySearchOrders(creds.access_token, shop, (input.query as string) ?? ""));
        return JSON.stringify(await shopifyGetOrders(creds.access_token, shop));
      }

      case "make_trigger": {
        const creds = await getIntegrationToken(env, companyId, "make");
        if (!creds) return JSON.stringify({ error: "Make no conectado" });
        let data: Record<string, unknown> = {};
        try { data = input.data ? JSON.parse(input.data as string) : { action: input.action }; } catch { data = { action: input.action }; }
        await makeTriggerScenario(creds.access_token, data);
        return JSON.stringify({ triggered: true, action: input.action });
      }

      default: {
        // MCP skills — buscar en D1 y ejecutar
        if (name.startsWith("mcp_")) {
          const skill = await env.DB.prepare(
            `SELECT ms.url, mk.mcp_tool_name FROM mcp_skills mk JOIN mcp_servers ms ON ms.id = mk.server_id
             WHERE mk.company_id = ? AND mk.skill_name = ? AND mk.is_active = 1 AND ms.is_active = 1`
          ).bind(companyId, name).first<{ url: string; mcp_tool_name: string }>();
          if (skill) {
            const result = await mcpCallTool(skill.url, skill.mcp_tool_name, input);
            return result;
          }
        }
        return JSON.stringify({ error: `Tool ${name} no disponible` });
      }
    }
  } catch (err) {
    return JSON.stringify({ error: `Error ejecutando ${name}: ${err instanceof Error ? err.message : String(err)}` });
  }
}

// Helper
async function getGoogleToken(env: Env, companyId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT access_token FROM integrations WHERE company_id = ? AND provider = 'google' AND is_active = 1`
  ).bind(companyId).first<{ access_token: string }>();
  return row?.access_token ?? null;
}

// ── Main: Call Anthropic with tool_use loop ──────────────────────────────

export interface ToolUseResult {
  text: string;
  toolsUsed: string[];
  model: string;
  emailDraft?: { to: string; subject: string; body: string };
  calendarDraft?: { title: string; date: string; startTime: string; endTime: string; attendees?: string; description?: string };
  followupDraft?: { to: string; days: number; context: string; subject: string };
  noteDraft?: { url: string; title: string };
}

export async function callWithToolUse(
  systemPrompt: string,
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[],
  tools: AnthropicTool[],
  env: Env,
  companyId: number,
  provider: "anthropic" | "openai" = "anthropic"
): Promise<ToolUseResult> {
  // Route to the right provider
  if (provider === "openai" && env.OPENAI_API_KEY) {
    return callWithToolUseOpenAI(systemPrompt, userMessage, history, tools, env, companyId);
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback: try OpenAI if Anthropic not available
    if (env.OPENAI_API_KEY) return callWithToolUseOpenAI(systemPrompt, userMessage, history, tools, env, companyId);
    throw new Error("No LLM API key configured (ANTHROPIC_API_KEY or OPENAI_API_KEY)");
  }

  const toolsUsed: string[] = [];
  let emailDraft: ToolUseResult["emailDraft"];
  let calendarDraft: ToolUseResult["calendarDraft"];
  let followupDraft: ToolUseResult["followupDraft"];
  let noteDraft: ToolUseResult["noteDraft"];

  // Build messages array
  const messages: { role: string; content: unknown }[] = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  // Tool use loop
  for (let iteration = 0; iteration < MAX_TOOL_CALLS + 1; iteration++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[tool-use] Anthropic error ${res.status}: ${err}`);
      throw new Error(`Anthropic API error: ${res.status}`);
    }

    const data = await res.json() as {
      content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
      stop_reason: string;
      usage?: { cache_read_input_tokens?: number };
    };

    if (data.usage?.cache_read_input_tokens) {
      console.log(`[tool-use] Cache HIT: ${data.usage.cache_read_input_tokens} tokens`);
    }

    // Extract text and tool calls
    const textParts = data.content.filter(c => c.type === "text").map(c => c.text ?? "");
    const toolCalls = data.content.filter(c => c.type === "tool_use");

    // If no tool calls — we're done
    if (data.stop_reason === "end_turn" || toolCalls.length === 0) {
      return {
        text: textParts.join("\n"),
        toolsUsed,
        model: "claude-sonnet-4-20250514",
        emailDraft,
        calendarDraft,
        followupDraft,
        noteDraft,
      };
    }

    // Execute tool calls
    const toolResults: ToolCallResult[] = [];
    for (const tc of toolCalls) {
      const toolName = tc.name!;
      const toolInput = tc.input ?? {};
      toolsUsed.push(toolName);

      console.log(`[tool-use] Calling: ${toolName}(${JSON.stringify(toolInput).slice(0, 100)})`);
      const result = await executeToolCall(toolName, toolInput, env, companyId, userMessage);

      // Extract drafts for approval flow
      try {
        const parsed = JSON.parse(result);
        if (parsed.action === "email_draft") emailDraft = parsed;
        if (parsed.action === "calendar_draft") calendarDraft = parsed;
        if (parsed.action === "followup_draft") followupDraft = parsed;
        if (parsed.action === "save_note") noteDraft = parsed;
      } catch { /* not JSON */ }

      toolResults.push({ tool_use_id: tc.id!, content: result });
    }

    // Add assistant response + tool results to messages for next iteration
    messages.push({ role: "assistant", content: data.content });
    messages.push({
      role: "user",
      content: toolResults.map(tr => ({
        type: "tool_result",
        tool_use_id: tr.tool_use_id,
        content: tr.content,
      })),
    });
  }

  // If we hit max iterations, return whatever text we have
  return {
    text: "He ejecutado varias acciones. ¿Necesitas algo más?",
    toolsUsed,
    model: "claude-sonnet-4-20250514",
    emailDraft,
    calendarDraft,
    followupDraft,
    noteDraft,
  };
}

// ── OpenAI Function Calling (alternativa a Anthropic) ────────────────────

async function callWithToolUseOpenAI(
  systemPrompt: string,
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[],
  tools: AnthropicTool[],
  env: Env,
  companyId: number
): Promise<ToolUseResult> {
  const apiKey = env.OPENAI_API_KEY!;

  const toolsUsed: string[] = [];
  let emailDraft: ToolUseResult["emailDraft"];
  let calendarDraft: ToolUseResult["calendarDraft"];
  let followupDraft: ToolUseResult["followupDraft"];
  let noteDraft: ToolUseResult["noteDraft"];

  // Convert Anthropic tool format to OpenAI function format
  const openaiTools = tools.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  const messages: { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }[] = [
    { role: "system", content: systemPrompt },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  for (let iteration = 0; iteration < MAX_TOOL_CALLS + 1; iteration++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        tools: openaiTools,
        max_tokens: 2048,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[tool-use-openai] Error ${res.status}: ${err}`);
      throw new Error(`OpenAI API error: ${res.status}`);
    }

    const data = await res.json() as {
      choices: [{
        message: {
          content: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
        finish_reason: string;
      }];
    };

    const choice = data.choices[0];
    const toolCalls = choice.message.tool_calls ?? [];

    // No tool calls — done
    if (choice.finish_reason === "stop" || toolCalls.length === 0) {
      return {
        text: choice.message.content ?? "",
        toolsUsed,
        model: "gpt-4o",
        emailDraft,
        calendarDraft,
        followupDraft,
        noteDraft,
      };
    }

    // Add assistant message with tool calls
    messages.push({ role: "assistant", content: choice.message.content, tool_calls: toolCalls });

    // Execute each tool call
    for (const tc of toolCalls) {
      const toolName = tc.function.name;
      let toolInput: Record<string, unknown> = {};
      try { toolInput = JSON.parse(tc.function.arguments); } catch { /* */ }
      toolsUsed.push(toolName);

      console.log(`[tool-use-openai] Calling: ${toolName}`);
      const result = await executeToolCall(toolName, toolInput, env, companyId, userMessage);

      // Extract drafts
      try {
        const parsed = JSON.parse(result);
        if (parsed.action === "email_draft") emailDraft = parsed;
        if (parsed.action === "calendar_draft") calendarDraft = parsed;
        if (parsed.action === "followup_draft") followupDraft = parsed;
        if (parsed.action === "save_note") noteDraft = parsed;
      } catch { /* */ }

      messages.push({ role: "tool", content: result, tool_call_id: tc.id, name: toolName });
    }
  }

  return {
    text: "He ejecutado varias acciones. ¿Necesitas algo más?",
    toolsUsed,
    model: "gpt-4o",
    emailDraft,
    calendarDraft,
    followupDraft,
    noteDraft,
  };
}
