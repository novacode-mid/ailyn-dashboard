"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveAuth } from "@/shared/hooks/useAuth";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", company_name: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    if (form.password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres"); setLoading(false); return; }
    try {
      const res = await fetch(`${WORKER_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json() as { token?: string; user?: { id: number; name: string; email: string; company_id: number; company_name: string }; error?: string };
      if (!res.ok) { setError(data.error ?? "Error al registrar"); return; }
      saveAuth(data.token!, data.user!);
      router.push("/setup"); // siempre al wizard en primer registro
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
          <h1 className="text-white text-2xl font-bold">Crear cuenta</h1>
          <p className="text-gray-400 text-sm mt-1">Empieza gratis, sin tarjeta</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text" value={form.name} onChange={set("name")}
            placeholder="Tu nombre" required autoFocus
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400 transition-colors"
          />
          <input
            type="text" value={form.company_name} onChange={set("company_name")}
            placeholder="Nombre de tu empresa" required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400 transition-colors"
          />
          <input
            type="email" value={form.email} onChange={set("email")}
            placeholder="correo@empresa.com" required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400 transition-colors"
          />
          <input
            type="password" value={form.password} onChange={set("password")}
            placeholder="Contraseña (mín. 8 caracteres)" required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-ailyn-400 transition-colors"
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full bg-ailyn-400 hover:bg-ailyn-600 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors mt-1"
          >
            {loading ? "Creando cuenta..." : "Crear cuenta"}
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm mt-6">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="text-ailyn-400 hover:text-ailyn-100 transition-colors">
            Inicia sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
