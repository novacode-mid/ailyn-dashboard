"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface Agent {
  id: number;
  name: string;
}

// ── Loading indicator ─────────────────────────────────────────────────────

const GOD_MODE_MESSAGES = [
  "Analizando archivos locales...",
  "Ejecutando herramientas...",
  "Leyendo código fuente...",
  "Procesando resultados...",
];

function TerminalTyping({ agentId }: { agentId: number | "" }) {
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    if (!agentId) return;
    const t = setInterval(() => setMsgIdx((i) => (i + 1) % GOD_MODE_MESSAGES.length), 1800);
    return () => clearInterval(t);
  }, [agentId]);

  return (
    <div className="flex items-center gap-1 px-3 py-1">
      <span className="font-mono text-xs text-emerald-400">agent $</span>
      {agentId ? (
        <span className="ml-2 font-mono text-xs text-amber-400 animate-pulse">
          {GOD_MODE_MESSAGES[msgIdx]}
        </span>
      ) : (
        <span className="ml-1 flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </span>
      )}
    </div>
  );
}

// ── Component principal ───────────────────────────────────────────────────

export function AdminCommandChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "boot",
      role: "assistant",
      content:
        "[INFO] Ailyn — Admin Mode\n[INFO] Claude Sonnet + Llama 3.3 70B activos\n[OK]   Listo para recibir consultas de administración.\n\nEscribe tu consulta o comando...",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | "">("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Cargar lista de agentes
  useEffect(() => {
    fetch("/api/admin/agents")
      .then((r) => r.json())
      .then((data: unknown) => {
        const list = (data as { id: number; name: string }[]).map((a) => ({
          id: a.id,
          name: a.name,
        }));
        setAgents(list);
      })
      .catch(() => { /* silently ignore */ });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function send() {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    const history = messages
      .filter((m) => m.id !== "boot")
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    if (inputRef.current) inputRef.current.style.height = "auto";

    try {
      const payload: Record<string, unknown> = { message: text, history };
      if (selectedAgentId) payload.agent_id = selectedAgentId;

      const res = await fetch("/api/admin/command-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = (await res.json()) as { reply: string };

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: data.reply },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `[ERROR] ${String(err)}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 96)}px`;
  }

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const isGodMode = selectedAgent?.name === "Agente Master Dev";

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-800 bg-gray-950 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-900 px-4 py-3">
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-red-500" />
          <span className="h-3 w-3 rounded-full bg-yellow-500" />
          <span className="h-3 w-3 rounded-full bg-green-500" />
        </div>
        <span className="ml-2 font-mono text-xs text-gray-400">admin@ailyn ~ command-center</span>

        {/* Agent selector */}
        <div className="ml-auto flex items-center gap-2">
          {isGodMode && (
            <span className="rounded-md bg-amber-900/40 px-2 py-0.5 font-mono text-xs text-amber-400 border border-amber-800/50">
              ⚡ GOD MODE
            </span>
          )}
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value ? Number(e.target.value) : "")}
            className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 font-mono text-xs text-gray-300 outline-none focus:border-indigo-500"
          >
            <option value="">Admin Chat</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-xs text-emerald-400">llama-3.3-70b</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 font-mono text-sm">
        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === "user" ? (
              <div className="flex items-start gap-2">
                <span className="text-indigo-400 shrink-0">admin $</span>
                <span className="text-gray-200 whitespace-pre-wrap break-words">{msg.content}</span>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <span className="text-emerald-400 shrink-0">agent $</span>
                <span className="text-emerald-300 whitespace-pre-wrap break-words leading-relaxed">{msg.content}</span>
              </div>
            )}
          </div>
        ))}
        {isLoading && <TerminalTyping agentId={selectedAgentId} />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-800 bg-gray-900 px-4 py-3">
        {selectedAgent && (
          <div className="mb-2 font-mono text-xs text-gray-600">
            {isGodMode ? "⚡" : "🤖"} {selectedAgent.name}
          </div>
        )}
        <div className="flex items-end gap-2">
          <span className="font-mono text-sm text-indigo-400 shrink-0 pb-1">admin $</span>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={isGodMode ? "lee el archivo X, modifica Y..." : "consulta al agente..."}
            disabled={isLoading}
            className="flex-1 resize-none bg-transparent font-mono text-sm text-gray-200 placeholder-gray-600 outline-none leading-relaxed"
            style={{ maxHeight: "96px" }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || isLoading}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            RUN
          </button>
        </div>
      </div>
    </div>
  );
}
