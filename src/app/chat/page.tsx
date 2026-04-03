"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

interface Message {
  role: "user" | "assistant";
  content: string;
}

function useSlug(): string {
  const [slug, setSlug] = useState("");
  useEffect(() => {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("chat");
    setSlug(idx !== -1 && parts[idx + 1] ? parts[idx + 1] : "");
  }, []);
  return slug;
}

export default function PublicChatPage() {
  const slug = useSlug();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll al último mensaje
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  // Cargar sesión y historial al montar
  const initChat = useCallback(async (currentSlug: string) => {
    if (!currentSlug) return;

    // Recuperar session_id guardado
    const storedSession = sessionStorage.getItem(`ailyn_chat_session_${currentSlug}`) ?? null;
    setSessionId(storedSession);

    // Si hay sesión, cargar historial
    if (storedSession) {
      try {
        const res = await fetch(
          `${WORKER_URL}/api/chat/${currentSlug}/history?session_id=${storedSession}`,
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = await res.json() as { messages?: Array<{ role: string; content: string }> };
          const hist = (data.messages ?? []).map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));
          if (hist.length > 0) {
            setMessages(hist);
            return; // skip welcome message
          }
        }
      } catch { /* si falla historial, empezar de cero */ }
    }

    // Mensaje de bienvenida (no guardado en D1, solo local)
    const name = currentSlug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    setCompanyName(name);
    setMessages([{
      role: "assistant",
      content: `¡Hola! Soy el asistente de ${name}. ¿En qué puedo ayudarte hoy?`,
    }]);
  }, []);

  useEffect(() => {
    if (slug) initChat(slug);
  }, [slug, initChat]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending || !slug) return;

    setInput("");
    setSending(true);
    setError("");

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch(`${WORKER_URL}/api/chat/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId ?? undefined }),
      });

      if (res.status === 404) {
        setNotFound(true);
        return;
      }

      if (res.status === 429) {
        setError("Límite de mensajes alcanzado. Intenta de nuevo más tarde.");
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json() as { reply: string; session_id: string };

      // Guardar session_id para mantener contexto
      if (data.session_id && !sessionId) {
        setSessionId(data.session_id);
        sessionStorage.setItem(`ailyn_chat_session_${slug}`, data.session_id);
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch {
      setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // Error: empresa no encontrada
  if (notFound || (slug && slug.length > 0 && !messages.length && !sending)) {
    // Deja que se cargue
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-gray-800 flex items-center justify-center mx-auto">
            <span className="text-2xl">🔍</span>
          </div>
          <p className="text-white font-semibold">Empresa no encontrada</p>
          <p className="text-gray-500 text-sm">Verifica el enlace de tu Smart Pass.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="shrink-0 bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="max-w-[500px] mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-ailyn-400 flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-sm">A</span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-none">Ailyn</p>
            {companyName && (
              <p className="text-gray-500 text-xs mt-0.5">{companyName}</p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-gray-500">En línea</span>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[500px] mx-auto px-4 py-4 space-y-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-ailyn-400 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                  <span className="text-white text-xs font-bold">A</span>
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-ailyn-400 text-white rounded-tr-sm"
                    : "bg-gray-800 text-gray-100 rounded-tl-sm"
                }`}
              >
                {msg.content.split("\n").map((line, j) => (
                  <span key={j}>
                    {line}
                    {j < msg.content.split("\n").length - 1 && <br />}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {sending && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full bg-ailyn-400 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                <span className="text-white text-xs font-bold">A</span>
              </div>
              <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 bg-gray-900 border-t border-gray-800 px-4 py-3">
        <div className="max-w-[500px] mx-auto">
          {error && <p className="text-red-400 text-xs mb-2 text-center">{error}</p>}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              rows={1}
              placeholder="Escribe un mensaje..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-2xl px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-ailyn-400 transition-colors resize-none disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ lineHeight: "1.5" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
              }}
            />
            <button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              className="shrink-0 w-10 h-10 bg-ailyn-400 hover:bg-ailyn-600 disabled:opacity-40 rounded-full flex items-center justify-center transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M14 8L2 2l2.5 6L2 14l12-6z" fill="white" />
              </svg>
            </button>
          </div>
          <p className="text-gray-700 text-xs mt-2 text-center">
            Enter para enviar · Shift+Enter para nueva línea
          </p>
        </div>
      </div>
    </div>
  );
}
