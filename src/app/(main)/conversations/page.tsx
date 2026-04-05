"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

interface Session {
  session_id: string;
  channel: string;
  first_msg: string;
  last_msg: string;
  msg_count: number;
  last_user_msg?: string;
}

interface Message {
  role: string;
  content: string;
  model_used: string | null;
  tools_used: string | null;
  created_at: string;
}

const CHANNEL_LABEL: Record<string, { icon: string; label: string; color: string }> = {
  telegram: { icon: "💬", label: "Telegram", color: "#2AABEE" },
  whatsapp: { icon: "📱", label: "WhatsApp", color: "#25D366" },
  webchat: { icon: "🌐", label: "Web Chat", color: "#6366f1" },
  api: { icon: "⚡", label: "API", color: "#f59e0b" },
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(dateStr).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function extractName(sessionId: string): string {
  // tg-slug-12345 → "Chat 12345"
  // wa-slug-phone → "Chat phone"
  // web-timestamp → "Web visitor"
  const parts = sessionId.split("-");
  if (sessionId.startsWith("tg-")) return `Usuario ${parts[parts.length - 1]?.slice(-4) ?? ""}`;
  if (sessionId.startsWith("wa-")) return `WhatsApp ${parts[parts.length - 1]?.slice(-4) ?? ""}`;
  if (sessionId.startsWith("web-")) return "Visitante web";
  if (sessionId.startsWith("api-")) return "API client";
  return sessionId.slice(0, 20);
}

export default function ConversationsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState("all");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const msgsEndRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const url = channelFilter === "all"
        ? `${WORKER_URL}/api/conversations`
        : `${WORKER_URL}/api/conversations?channel=${channelFilter}`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) return;
      const data = (await res.json()) as { sessions: Session[] };
      setSessions(data.sessions ?? []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [channelFilter]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function openSession(sessionId: string) {
    setSelectedSession(sessionId);
    setMsgsLoading(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/conversations/${encodeURIComponent(sessionId)}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = (await res.json()) as { messages: Message[] };
      setMessages(data.messages ?? []);
    } catch { /* */ }
    finally { setMsgsLoading(false); }
  }

  const filtered = sessions.filter(s => {
    if (!search) return true;
    const lower = search.toLowerCase();
    return s.session_id.toLowerCase().includes(lower) || extractName(s.session_id).toLowerCase().includes(lower);
  });

  const selectedSessionData = sessions.find(s => s.session_id === selectedSession);

  return (
    <DashboardShell>
      <div className="h-[calc(100vh-3.5rem)] lg:h-screen flex">
        {/* Sidebar: lista de conversaciones */}
        <div className={`${selectedSession ? "hidden lg:flex" : "flex"} flex-col w-full lg:w-96 border-r border-white/[0.06] bg-[#0f172a]`}>
          {/* Header */}
          <div className="p-4 border-b border-white/[0.06] space-y-3">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold text-white">Inbox</h1>
              <span className="text-xs text-gray-500">{sessions.length} conversaciones</span>
            </div>

            {/* Search */}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversacion..."
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-400/50"
            />

            {/* Channel filter */}
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {["all", "telegram", "whatsapp", "webchat", "api"].map((ch) => (
                <button
                  key={ch}
                  onClick={() => { setChannelFilter(ch); setSelectedSession(null); }}
                  className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
                    channelFilter === ch ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" : "bg-white/[0.04] text-gray-400 border border-white/[0.06]"
                  }`}
                >
                  {ch === "all" ? "Todos" : `${CHANNEL_LABEL[ch]?.icon ?? ""} ${CHANNEL_LABEL[ch]?.label ?? ch}`}
                </button>
              ))}
            </div>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-600 text-sm">Sin conversaciones</div>
            ) : (
              filtered.map((session) => {
                const ch = CHANNEL_LABEL[session.channel] ?? { icon: "💬", label: session.channel, color: "#999" };
                const active = selectedSession === session.session_id;
                return (
                  <button
                    key={session.session_id}
                    onClick={() => openSession(session.session_id)}
                    className={`w-full text-left px-4 py-3 border-b border-white/[0.04] transition-colors ${
                      active ? "bg-purple-500/10" : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: ch.color + "33" }}>
                        <span>{ch.icon}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-white text-sm font-medium truncate">{extractName(session.session_id)}</p>
                          <span className="text-gray-500 text-[10px] shrink-0 ml-2">{timeAgo(session.last_msg)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: ch.color + "22", color: ch.color }}>
                            {ch.label}
                          </span>
                          <span className="text-gray-500 text-[11px]">{session.msg_count} msgs</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Main: mensajes */}
        <div className={`${selectedSession ? "flex" : "hidden lg:flex"} flex-col flex-1 bg-[#0b1120]`}>
          {selectedSession && selectedSessionData ? (
            <>
              {/* Chat header */}
              <div className="px-4 sm:px-6 py-3 border-b border-white/[0.06] flex items-center gap-3 bg-[#0f172a]">
                <button
                  onClick={() => setSelectedSession(null)}
                  className="lg:hidden text-gray-400 hover:text-white mr-1"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm" style={{ background: (CHANNEL_LABEL[selectedSessionData.channel]?.color ?? "#999") + "33" }}>
                  {CHANNEL_LABEL[selectedSessionData.channel]?.icon ?? "💬"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{extractName(selectedSession)}</p>
                  <p className="text-gray-500 text-[11px]">
                    {CHANNEL_LABEL[selectedSessionData.channel]?.label} · {selectedSessionData.msg_count} mensajes · {timeAgo(selectedSessionData.last_msg)}
                  </p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3">
                {msgsLoading ? (
                  <div className="flex justify-center py-12">
                    <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 ${
                        msg.role === "user"
                          ? "bg-purple-500/15 border border-purple-500/20 rounded-br-md"
                          : "bg-white/[0.05] border border-white/[0.06] rounded-bl-md"
                      }`}>
                        <p className="text-sm text-gray-200 whitespace-pre-wrap">{msg.content.slice(0, 800)}{msg.content.length > 800 ? "..." : ""}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] text-gray-600">{new Date(msg.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>
                          {msg.model_used && msg.role === "assistant" && (
                            <span className="text-[10px] text-gray-700">{msg.model_used.split("/").pop()?.slice(0, 15)}</span>
                          )}
                          {msg.tools_used && msg.tools_used !== '["none"]' && (
                            <span className="text-[10px] text-purple-500/60">{JSON.parse(msg.tools_used).join(", ")}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={msgsEndRef} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-600">
              <div className="text-center">
                <p className="text-5xl mb-4">💬</p>
                <p className="text-sm font-medium">Selecciona una conversacion</p>
                <p className="text-xs text-gray-700 mt-1">Elige del panel izquierdo para ver el historial</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
