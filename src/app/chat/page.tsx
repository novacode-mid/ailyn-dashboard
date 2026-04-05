"use client";

import { useEffect, useRef, useState } from "react";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
}

interface Branding {
  name: string;
  slug: string;
  brand_color: string;
  welcome_message: string;
  logo_url: string | null;
  chat_avatar_url: string | null;
}

export default function ChatPage() {
  const [slug, setSlug] = useState<string | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Extract slug from URL
  useEffect(() => {
    const parts = window.location.pathname.split("/");
    const s = parts[2] ?? null;
    setSlug(s);
    if (s) {
      const stored = sessionStorage.getItem(`chat_session_${s}`);
      setSessionId(stored ?? `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    }
  }, []);

  // Load branding
  useEffect(() => {
    if (!slug) return;
    fetch(`${WORKER_URL}/api/company/${slug}/branding`)
      .then((r) => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.json();
      })
      .then((data: Branding | null) => {
        if (data) {
          setBranding(data);
          setMessages([{
            id: "welcome",
            role: "assistant",
            content: data.welcome_message,
            time: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }),
          }]);
        }
      })
      .catch(() => setNotFound(true));
  }, [slug]);

  // Load history
  useEffect(() => {
    if (!slug || !sessionId) return;
    sessionStorage.setItem(`chat_session_${slug}`, sessionId);
    fetch(`${WORKER_URL}/api/chat/${slug}/history?session_id=${sessionId}`)
      .then((r) => r.json())
      .then((data: { messages?: { role: string; content: string }[] }) => {
        if (data.messages?.length) {
          setMessages((prev) => [
            prev[0],
            ...data.messages!.map((m, i) => ({
              id: `h-${i}`,
              role: m.role as "user" | "assistant",
              content: m.content,
              time: "",
            })),
          ]);
        }
      })
      .catch(() => {});
  }, [slug, sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading || !slug) return;

    const msg = input.trim();
    setInput("");
    const now = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: msg, time: now }]);
    setLoading(true);

    try {
      const res = await fetch(`${WORKER_URL}/api/chat/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, session_id: sessionId }),
      });

      if (res.status === 429) {
        setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: "assistant", content: "Has enviado muchos mensajes. Intenta de nuevo en un momento.", time: now }]);
        return;
      }

      const data = await res.json() as { reply?: string; session_id?: string; error?: string };
      if (data.session_id && data.session_id !== sessionId) {
        setSessionId(data.session_id);
        sessionStorage.setItem(`chat_session_${slug}`, data.session_id);
      }

      setMessages((prev) => [...prev, {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: data.reply ?? data.error ?? "Sin respuesta",
        time: new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }),
      }]);
    } catch {
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: "assistant", content: "Error de conexion. Intenta de nuevo.", time: now }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  if (notFound) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-4xl mb-4">🔍</p>
          <h1 className="text-white text-xl font-bold mb-2">Empresa no encontrada</h1>
          <p className="text-gray-500 text-sm">Verifica que la URL sea correcta</p>
        </div>
      </div>
    );
  }

  if (!branding) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const color = branding.brand_color;

  return (
    <div className="flex flex-col" style={{ background: "#0a0a0f", height: "100dvh", minHeight: "100vh" }}>
      {/* Header */}
      <div className="shrink-0 px-4 sm:px-6 py-3 flex items-center gap-3 border-b border-white/10" style={{ background: `linear-gradient(135deg, ${color}22, ${color}11)` }}>
        {branding.logo_url ? (
          <img src={branding.logo_url} alt="" className="w-10 h-10 rounded-xl object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg" style={{ background: color }}>
            {branding.name.charAt(0)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm truncate">{branding.name}</p>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400/70 text-[11px]">En linea</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className="flex items-end gap-2 max-w-[85%] sm:max-w-[70%]">
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-white text-[10px] font-bold mb-1" style={{ background: color }}>
                  {branding.chat_avatar_url ? (
                    <img src={branding.chat_avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                  ) : branding.name.charAt(0)}
                </div>
              )}
              <div>
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "rounded-br-md text-white"
                      : "rounded-bl-md bg-white/[0.07] text-gray-200 border border-white/[0.06]"
                  }`}
                  style={msg.role === "user" ? { background: color } : undefined}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
                {msg.time && (
                  <p className={`text-[10px] text-gray-600 mt-1 ${msg.role === "user" ? "text-right" : ""}`}>{msg.time}</p>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-end gap-2">
              <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-white text-[10px] font-bold" style={{ background: color }}>
                {branding.name.charAt(0)}
              </div>
              <div className="bg-white/[0.07] border border-white/[0.06] rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ background: color, animationDelay: "0ms" }} />
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ background: color, animationDelay: "150ms" }} />
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ background: color, animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-3 sm:px-6 py-3 border-t border-white/[0.06]" style={{ background: "#0d0d14" }}>
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe un mensaje..."
            rows={1}
            className="flex-1 bg-white/[0.06] border border-white/[0.08] rounded-2xl px-4 py-2.5 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-white/20 transition-colors max-h-32"
            style={{ minHeight: 42 }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white transition-all disabled:opacity-30 shrink-0"
            style={{ background: loading || !input.trim() ? "#333" : color }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </form>
        <p className="text-center text-[10px] text-gray-600 mt-2">
          Powered by{" "}
          <a href="https://ailyn-dashboard.pages.dev" target="_blank" rel="noopener" className="text-gray-500 hover:text-gray-400 transition-colors">
            Ailyn
          </a>
        </p>
      </div>
    </div>
  );
}
