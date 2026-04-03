import { useEffect, useRef } from "react";
import type { LogEntry } from "../types";

const TYPE_COLORS: Record<string, string> = {
  info: "text-cyan-400",
  success: "text-green-400",
  warn: "text-yellow-400",
  error: "text-red-400",
  log: "text-gray-300",
};

const TYPE_ICONS: Record<string, string> = {
  info: "→",
  success: "✓",
  warn: "⚠",
  error: "✗",
  log: " ",
};

export default function LogsPage({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [logs]);

  return (
    <div className="h-full flex flex-col">
      <div className="titlebar-drag px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Logs del Agente</h1>
          <p className="text-gray-500 text-xs">{logs.length} entradas</p>
        </div>
        <button onClick={onClear} className="text-xs text-gray-500 hover:text-white transition-colors">Limpiar</button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono text-xs">
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600">
            <p>Esperando logs del agente...</p>
          </div>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className="flex gap-2 py-0.5 hover:bg-white/[0.02]">
              <span className="text-gray-600 shrink-0">[{entry.timestamp}]</span>
              <span className={`shrink-0 ${TYPE_COLORS[entry.type] ?? "text-gray-400"}`}>
                {TYPE_ICONS[entry.type] ?? " "}
              </span>
              <span className={TYPE_COLORS[entry.type] ?? "text-gray-400"}>
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
