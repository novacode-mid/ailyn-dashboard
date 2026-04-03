import { useEffect, useRef, useState } from "react";
import type { User } from "../types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatPage({ user }: { user: User }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `desktop-${Date.now()}`);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const msg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setLoading(true);

    try {
      const result = await window.openclaw.chatSend(msg, sessionId) as { reply?: string; error?: string };
      setMessages((prev) => [...prev, { role: "assistant", content: result.reply ?? result.error ?? "Sin respuesta" }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Error al conectar con Ailyn" }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="titlebar-drag px-6 py-4 border-b border-white/[0.06]">
        <h1 className="text-lg font-bold text-white">Chat con Ailyn</h1>
        <p className="text-gray-500 text-xs">{user.company_name}</p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-600">
            <div className="text-center">
              <p className="text-4xl mb-3">💬</p>
              <p className="text-sm">Escribe algo para hablar con Ailyn</p>
              <p className="text-xs text-gray-700 mt-1">Puedes pedirle screenshots, llenar formularios, buscar info...</p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[75%] rounded-xl px-4 py-3 ${
              msg.role === "user"
                ? "bg-purple-500/20 border border-purple-500/20 text-white"
                : "bg-gray-800/80 border border-gray-700/50 text-gray-200"
            }`}>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800/80 border border-gray-700/50 rounded-xl px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="px-6 py-4 border-t border-white/[0.06]">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe un mensaje..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 transition-colors"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-purple-500 hover:bg-purple-600 disabled:opacity-40 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            Enviar
          </button>
        </div>
      </form>
    </div>
  );
}
