"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveAuth } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch(`${WORKER_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json() as { token?: string; user?: { id: number; name: string; email: string; company_id: number; company_name: string; setup_completed?: number }; error?: string };
      if (!res.ok) { setError(data.error ?? "Error al iniciar sesión"); return; }
      saveAuth(data.token!, data.user!);
      router.push(data.user!.setup_completed ? "/dashboard" : "/setup");
    } catch { setError("No se pudo conectar al servidor."); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-ailyn-400 flex items-center justify-center">
              <span className="text-white font-bold text-sm">A</span>
            </div>
            <span className="text-white text-xl font-semibold">Ailyn</span>
          </div>
          <h1 className="text-white text-2xl font-bold">Iniciar sesión</h1>
          <p className="text-gray-400 text-sm mt-1">Accede a tu dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@empresa.com" required autoFocus
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400 transition-colors"
          />
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña" required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400 transition-colors"
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full bg-ailyn-400 hover:bg-ailyn-600 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm mt-6">
          ¿No tienes cuenta?{" "}
          <Link href="/signup" className="text-ailyn-400 hover:text-ailyn-100 transition-colors">
            Regístrate
          </Link>
        </p>
      </div>
    </div>
  );
}
