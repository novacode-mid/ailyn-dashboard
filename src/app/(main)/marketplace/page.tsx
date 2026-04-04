"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardShell from "@/shared/components/DashboardShell";
import { authHeaders } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

interface MarketplaceSkill {
  id: number;
  skill_name: string;
  display_name: string;
  description: string;
  category: string;
  icon: string;
  price_cents: number;
  installs: number;
  rating: number;
  publisher_name: string;
}

const CATEGORIES = ["all", "productivity", "data", "communication", "automation", "general"];

export default function MarketplacePage() {
  const [skills, setSkills] = useState<MarketplaceSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [installing, setInstalling] = useState<number | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = category === "all"
        ? `${WORKER_URL}/api/marketplace`
        : `${WORKER_URL}/api/marketplace?category=${category}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as { skills: MarketplaceSkill[] };
      setSkills(data.skills ?? []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [category]);

  useEffect(() => { load(); }, [load]);

  async function handleInstall(skillId: number) {
    setInstalling(skillId);
    try {
      const res = await fetch(`${WORKER_URL}/api/marketplace/install`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ marketplace_skill_id: skillId }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        setToast("Skill instalado correctamente");
        setTimeout(() => setToast(""), 2500);
      } else {
        setToast(data.error ?? "Error al instalar");
        setTimeout(() => setToast(""), 2500);
      }
    } catch {
      setToast("Error de conexion");
      setTimeout(() => setToast(""), 2500);
    } finally {
      setInstalling(null);
    }
  }

  return (
    <DashboardShell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white">Skill Marketplace</h1>
          <p className="text-gray-400 text-sm mt-0.5">Instala skills creados por la comunidad para ampliar las capacidades de tu agente</p>
        </div>

        {/* Categories */}
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors capitalize ${
                category === cat ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" : "bg-gray-800 text-gray-400 border border-gray-700"
              }`}
            >
              {cat === "all" ? "Todos" : cat}
            </button>
          ))}
        </div>

        {/* Toast */}
        {toast && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 text-green-400 text-xs">
            {toast}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : skills.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-5xl mb-4">🏪</p>
            <p className="text-sm font-medium">El marketplace esta vacio todavia</p>
            <p className="text-xs text-gray-600 mt-1">Conecta un MCP server en Settings y publica tus skills aqui</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {skills.map((skill) => (
              <div key={skill.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{skill.icon}</span>
                    <div>
                      <p className="text-white font-medium text-sm">{skill.display_name}</p>
                      <p className="text-gray-500 text-[11px]">por {skill.publisher_name}</p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500">{skill.installs} installs</span>
                </div>

                <p className="text-gray-400 text-xs mb-4 line-clamp-2">{skill.description}</p>

                <div className="flex items-center justify-between">
                  <span className={`text-xs font-medium ${skill.price_cents === 0 ? "text-green-400" : "text-white"}`}>
                    {skill.price_cents === 0 ? "Gratis" : `$${(skill.price_cents / 100).toFixed(2)}/mes`}
                  </span>
                  <button
                    onClick={() => handleInstall(skill.id)}
                    disabled={installing === skill.id}
                    className="text-xs bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
                  >
                    {installing === skill.id ? "..." : "Instalar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
