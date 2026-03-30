"use client";

import { Bot, Send, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface Props {
  passId: string;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 px-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#075E54]">
        <Bot size={16} className="text-white" />
      </div>
      <div className="rounded-2xl rounded-bl-none bg-white px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-4">
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex items-end justify-end gap-2 px-3">
        <div className="max-w-[75%]">
          <div className="rounded-2xl rounded-br-none bg-[#DCF8C6] px-4 py-2 shadow-sm">
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
              {message.content}
            </p>
            <p className="mt-1 text-right text-[10px] text-gray-500">
              {formatTime(message.timestamp)}
            </p>
          </div>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#128C7E]">
          <User size={16} className="text-white" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 px-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#075E54]">
        <Bot size={16} className="text-white" />
      </div>
      <div className="max-w-[75%]">
        <div className="rounded-2xl rounded-bl-none bg-white px-4 py-2 shadow-sm">
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </p>
          <p className="mt-1 text-right text-[10px] text-gray-500">
            {formatTime(message.timestamp)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ChatInterface({ passId }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hola, soy tu agente corporativo. ¿En qué puedo ayudarte hoy?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Bloquear scroll del body — la UI se auto-contiene en 100dvh (iOS Wallet)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Auto-scroll al último mensaje
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || isTyping) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    try {
      const res = await fetch(`${WORKER_URL}/api/chat/wallet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${passId}`,
        },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `Error ${res.status}`);
      }

      const data = (await res.json()) as { reply: string };

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Error de conexión";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `⚠️ ${errorMsg}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    // Auto-resize hasta 5 líneas
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  }

  return (
    <div
      className="flex flex-col bg-[#ECE5DD]"
      style={{ height: "100dvh" }}
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="flex items-center gap-3 bg-[#075E54] px-4 py-3 shadow-md">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#128C7E]">
          <Bot size={22} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate font-semibold text-white text-base leading-tight">
            Enterprise Agent
          </p>
          <p className="text-xs text-green-200 leading-tight">
            {isTyping ? "escribiendo..." : "en línea"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-green-300 font-mono">
            {passId.slice(0, 8)}…
          </p>
        </div>
      </header>

      {/* ── Mensajes ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-3 space-y-2">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* ── Input ───────────────────────────────────────────── */}
      <div className="flex items-end gap-2 bg-[#F0F0F0] px-3 py-2 shadow-inner">
        <div className="flex flex-1 items-end rounded-3xl bg-white px-4 py-2 shadow-sm">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Escribe un mensaje..."
            className="w-full resize-none bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none leading-relaxed"
            style={{ maxHeight: "120px" }}
            disabled={isTyping}
          />
        </div>
        <button
          onClick={sendMessage}
          disabled={!input.trim() || isTyping}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#075E54] text-white shadow transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Enviar mensaje"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
