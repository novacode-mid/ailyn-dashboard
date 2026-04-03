import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [headless, setHeadless] = useState(true);
  const [pollInterval, setPollInterval] = useState(3000);
  const [apiUrl, setApiUrl] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.openclaw.getSettings().then((s) => {
      setHeadless(s.headless);
      setPollInterval(s.pollInterval);
      setApiUrl(s.apiUrl);
    });
  }, []);

  async function save(key: string, value: unknown) {
    await window.openclaw.setSetting(key, value);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="titlebar-drag">
        <h1 className="text-lg font-bold text-white">Settings</h1>
        <p className="text-gray-500 text-xs">Configuracion del Desktop Agent</p>
      </div>

      {saved && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 text-green-400 text-xs">
          Guardado
        </div>
      )}

      {/* Headless mode */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white text-sm font-medium">Modo headless</p>
            <p className="text-gray-500 text-xs mt-0.5">Si esta activo, el browser no se muestra. Desactiva para ver las acciones en vivo.</p>
          </div>
          <button
            onClick={() => { setHeadless(!headless); save("headless", !headless); }}
            className={`w-11 h-6 rounded-full transition-colors relative ${headless ? "bg-purple-500" : "bg-gray-600"}`}
          >
            <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${headless ? "translate-x-5.5 left-[1px]" : "left-[2px]"}`}
              style={{ transform: headless ? "translateX(22px)" : "translateX(0)" }}
            />
          </button>
        </div>
      </div>

      {/* Poll interval */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-white text-sm font-medium">Intervalo de polling</p>
          <p className="text-gray-500 text-xs mt-0.5">Cada cuanto busca tareas nuevas</p>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={1000}
            max={10000}
            step={1000}
            value={pollInterval}
            onChange={(e) => setPollInterval(Number(e.target.value))}
            onMouseUp={() => save("pollInterval", pollInterval)}
            className="flex-1 accent-purple-500"
          />
          <span className="text-sm text-gray-300 w-14 text-right">{pollInterval / 1000}s</span>
        </div>
      </div>

      {/* API URL */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 space-y-3">
        <div>
          <p className="text-white text-sm font-medium">Worker URL</p>
          <p className="text-gray-500 text-xs mt-0.5">URL del backend de Ailyn</p>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-purple-400"
          />
          <button
            onClick={() => save("apiUrl", apiUrl)}
            className="text-xs bg-purple-500 hover:bg-purple-600 text-white px-3 py-2 rounded-lg transition-colors"
          >
            Guardar
          </button>
        </div>
      </div>

      {/* Links */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 space-y-2">
        <p className="text-white text-sm font-medium mb-2">Links rapidos</p>
        <button
          onClick={() => window.openclaw.openExternal("https://ailyn-dashboard.pages.dev/settings")}
          className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
        >
          Abrir Settings del Dashboard web →
        </button>
        <br />
        <button
          onClick={() => window.openclaw.openExternal("https://ailyn-dashboard.pages.dev/billing")}
          className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
        >
          Administrar plan y billing →
        </button>
      </div>
    </div>
  );
}
