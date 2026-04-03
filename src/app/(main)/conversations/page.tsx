"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

interface Session {
  session_id: string;
  channel: string;
  first_msg: string;
  last_msg: string;
  msg_count: number;
}

interface Message {
  role: string;
  content: string;
  model_used: string | null;
  tools_used: string | null;
  complexity: string | null;
  created_at: string;
}

const CHANNEL_ICONS: Record<string, string> = {
  telegram: "💬",
  whatsapp: "📱",
  webchat: "🖥️",
  api: "⚡",
};

export default function ConversationsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);

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

  async function openSession(sessionId: string) {
    if (selectedSession === sessionId) { setSelectedSession(null); return; }
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

  return (
    <DashboardShell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white">Conversaciones</h1>
          <p className="text-gray-400 text-sm mt-0.5">Historial de todas las conversaciones del agente</p>
        </div>

        {/* Channel filter */}
        <div className="flex gap-2">
          {["all", "telegram", "whatsapp", "webchat", "api"].map((ch) => (
            <button
              key={ch}
              onClick={() => { setChannelFilter(ch); setSelectedSession(null); }}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                channelFilter === ch ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600"
              }`}
            >
              {ch === "all" ? "Todos" : `${CHANNEL_ICONS[ch] ?? ""} ${ch.charAt(0).toUpperCase() + ch.slice(1)}`}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-4xl mb-3">💬</p>
            <p className="text-sm">No hay conversaciones todavia.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div key={session.session_id}>
                <button
                  onClick={() => openSession(session.session_id)}
                  className={`w-full bg-gray-900 border rounded-lg p-4 hover:border-gray-700 transition-colors text-left ${
                    selectedSession === session.session_id ? "border-purple-500/50" : "border-gray-800"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{CHANNEL_ICONS[session.channel] ?? "💬"}</span>
                      <div>
                        <p className="text-sm text-white">{session.session_id}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {session.channel} · {session.msg_count} mensajes · {new Date(session.last_msg).toLocaleString("es-MX")}
                        </p>
                      </div>
                    </div>
                  </div>
                </button>

                {/* Messages panel */}
                {selectedSession === session.session_id && (
                  <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mt-1 max-h-96 overflow-y-auto space-y-3">
                    {msgsLoading ? (
                      <div className="flex justify-center py-4">
                        <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : messages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] rounded-lg px-3 py-2 ${
                          msg.role === "user"
                            ? "bg-purple-500/20 border border-purple-500/30"
                            : "bg-gray-900 border border-gray-700"
                        }`}>
                          <p className="text-sm text-gray-200 whitespace-pre-wrap">{msg.content.slice(0, 500)}{msg.content.length > 500 ? "..." : ""}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-gray-500">{new Date(msg.created_at).toLocaleTimeString("es-MX")}</span>
                            {msg.model_used && <span className="text-[10px] text-gray-600">{msg.model_used.split("/").pop()}</span>}
                            {msg.tools_used && msg.tools_used !== '["none"]' && (
                              <span className="text-[10px] text-purple-400">{msg.tools_used}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
