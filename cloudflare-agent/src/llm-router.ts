// ── LLM Router: selecciona el modelo óptimo para cada tarea ──────────────
// Cada tarea usa el modelo con mejor relación costo/calidad.
// Si la API key no está disponible o la llamada falla, hace fallback a Llama 70B.

export type LLMTask =
  | "quick_classify"    // Clasificar urgencia, industria, tipo de lead
  | "brief_generation"  // Generar brief completo de inteligencia comercial
  | "email_draft"       // Redactar email de primer contacto
  | "chat_response"     // Responder en chat general
  | "document_analysis" // Analizar documentos para RAG
  | "summarize";        // Resumir textos

export type LLMProvider = "cloudflare" | "anthropic" | "openai";

interface LLMConfig {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface LLMResponse {
  text: string;
  provider: LLMProvider;
  model: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface LLMEnv {
  AI: Ai;
  KV: KVNamespace;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

// ── Selección de modelo por tarea ─────────────────────────────────────────

function selectModel(task: LLMTask): LLMConfig {
  switch (task) {
    case "quick_classify":
      return {
        provider: "cloudflare",
        model: "@cf/meta/llama-3.2-3b-instruct",
        maxTokens: 512,
        temperature: 0.1,
      };

    case "brief_generation":
      return {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        maxTokens: 4096,
        temperature: 0.3,
      };

    case "email_draft":
      return {
        provider: "openai",
        model: "gpt-4o-mini",
        maxTokens: 2048,
        temperature: 0.7,
      };

    case "chat_response":
      return {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        maxTokens: 2048,
        temperature: 0.5,
      };

    case "document_analysis":
    case "summarize":
      return {
        provider: "cloudflare",
        model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        maxTokens: 2048,
        temperature: 0.2,
      };
  }
}

// ── Proveedores ───────────────────────────────────────────────────────────

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
  history: ChatTurn[] = []
): Promise<string> {
  const messages = [
    ...history,
    { role: "user" as const, content: userMessage },
  ];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${error}`);
  }

  const data = await response.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text ?? "";
}

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
  history: ChatTurn[] = []
): Promise<string> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history,
    { role: "user" as const, content: userMessage },
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${error}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? "";
}

async function callCloudflare(
  ai: Ai,
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  history: ChatTurn[] = []
): Promise<string> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history,
    { role: "user" as const, content: userMessage },
  ];

  const result = await ai.run(
    model as Parameters<typeof ai.run>[0],
    { messages, max_tokens: maxTokens }
  ) as { response?: unknown };

  const resp = result.response;

  // Workers AI sometimes returns JSON as an already-parsed object when max_tokens is set
  if (typeof resp === "object" && resp !== null && !Array.isArray(resp)) {
    return JSON.stringify(resp);
  }
  if (Array.isArray(resp)) return (resp as string[]).join("");
  return String(resp ?? "");
}

// ── Función principal ─────────────────────────────────────────────────────

export async function runLLM(
  env: LLMEnv,
  task: LLMTask,
  systemPrompt: string,
  userMessage: string,
  companyId?: string | number,
  history: ChatTurn[] = [],
  /** If true, force Cloudflare Llama regardless of task (used for free-tier companies) */
  forceCloudflare = false
): Promise<LLMResponse> {
  const config = selectModel(task);

  // Free-tier override: downgrade to Llama 70B
  if (forceCloudflare && config.provider !== "cloudflare") {
    const text = await callCloudflare(
      env.AI,
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      systemPrompt,
      userMessage,
      config.maxTokens,
      history
    );
    return { text, provider: "cloudflare", model: "llama-3.3-70b-free-tier" };
  }

  // Resolver keys: KV por tenant → secret global → fallback a Llama
  const kvPrefix = companyId !== undefined ? `config:${companyId}:` : null;
  const anthropicKey = kvPrefix
    ? (await env.KV.get(`${kvPrefix}ANTHROPIC_API_KEY`)) ?? env.ANTHROPIC_API_KEY
    : env.ANTHROPIC_API_KEY;
  const openaiKey = kvPrefix
    ? (await env.KV.get(`${kvPrefix}OPENAI_API_KEY`)) ?? env.OPENAI_API_KEY
    : env.OPENAI_API_KEY;

  console.log(`[llm-router] task=${task} provider=${config.provider} | anthropic key: ${anthropicKey ? "PRESENT" : "NONE"} | openai key: ${openaiKey ? "PRESENT" : "NONE"}`);

  try {
    let text: string;

    switch (config.provider) {
      case "anthropic":
        if (!anthropicKey) {
          console.log(`[llm-router] No ANTHROPIC_API_KEY (company=${companyId ?? "global"}), fallback to Cloudflare for task: ${task}`);
          text = await callCloudflare(env.AI, "@cf/meta/llama-3.3-70b-instruct-fp8-fast", systemPrompt, userMessage, config.maxTokens, history);
          return { text, provider: "cloudflare", model: "llama-3.3-70b" };
        }
        text = await callAnthropic(anthropicKey, config.model, systemPrompt, userMessage, config.maxTokens, config.temperature, history);
        return { text, provider: "anthropic", model: config.model };

      case "openai":
        if (!openaiKey) {
          console.log(`[llm-router] No OPENAI_API_KEY (company=${companyId ?? "global"}), fallback to Cloudflare for task: ${task}`);
          text = await callCloudflare(env.AI, "@cf/meta/llama-3.3-70b-instruct-fp8-fast", systemPrompt, userMessage, config.maxTokens, history);
          return { text, provider: "cloudflare", model: "llama-3.3-70b" };
        }
        text = await callOpenAI(openaiKey, config.model, systemPrompt, userMessage, config.maxTokens, config.temperature, history);
        return { text, provider: "openai", model: config.model };

      case "cloudflare":
        text = await callCloudflare(env.AI, config.model, systemPrompt, userMessage, config.maxTokens, history);
        return { text, provider: "cloudflare", model: config.model };
    }
  } catch (error) {
    console.error(`[llm-router] ${config.provider}/${config.model} failed for task ${task}:`, error);
    console.log("[llm-router] Falling back to Cloudflare Llama 3.3 70B...");

    try {
      const text = await callCloudflare(
        env.AI,
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        systemPrompt,
        userMessage,
        config.maxTokens,
        history
      );
      return { text, provider: "cloudflare", model: "llama-3.3-70b-fallback" };
    } catch (fallbackError) {
      console.error("[llm-router] Fallback also failed:", fallbackError);
      throw new Error(`All LLM providers failed for task: ${task}`);
    }
  }
}
