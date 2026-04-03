"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getUser, clearAuth, type AuthUser } from "@/shared/hooks/useAuth";
import {
  LayoutDashboard,
  Target,
  Zap,
  BookOpen,
  CreditCard,
  MessageSquare,
  Bot,
  Settings,
  Wallet,
  LogOut,
  Sparkles,
} from "lucide-react";

const NAV = [
  { href: "/dashboard",    label: "Dashboard",        icon: LayoutDashboard },
  { href: "/activity",     label: "Actividad",        icon: Target },
  { href: "/leads",        label: "Leads",            icon: Zap },
  { href: "/knowledge",    label: "Knowledge Base",   icon: BookOpen },
  { href: "/wallet",       label: "Tarjetas",         icon: Wallet },
  { href: "/wallet-chat",  label: "Web Chat",         icon: MessageSquare },
  { href: "/automations",  label: "Automatizaciones", icon: Bot },
  { href: "/billing",      label: "Billing",          icon: CreditCard },
  { href: "/settings",     label: "Configuración",    icon: Settings },
];

export default function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    setUser(u);
    setReady(true);
  }, [router]);

  function handleLogout() {
    clearAuth();
    router.replace("/login");
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] flex relative overflow-hidden">
      {/* Background orbs */}
      <div className="orb orb-purple" />
      <div className="orb orb-cyan" />
      <div className="orb orb-pink" />

      {/* Sidebar */}
      <aside className="w-60 shrink-0 glass-sidebar flex flex-col relative z-10">
        {/* Logo + company */}
        <div className="px-4 py-5 border-b border-white/[0.08]">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-brand-400/20 border border-brand-400/30 flex items-center justify-center shadow-glow-sm">
              <Sparkles className="w-5 h-5 text-brand-300" />
            </div>
            <span className="font-bold text-white text-lg tracking-tight">Ailyn</span>
          </div>
          {user && (
            <p className="text-xs text-white/40 truncate pl-12">{user.company_name}</p>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                  active
                    ? "glass text-white font-medium shadow-glow-sm"
                    : "text-white/50 hover:text-white/80 hover:bg-white/[0.06]"
                }`}
              >
                <Icon className={`w-[18px] h-[18px] ${active ? "text-brand-300" : ""}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User + logout */}
        <div className="p-3 border-t border-white/[0.08] space-y-2">
          {user && (
            <p className="text-xs text-white/30 truncate px-1">{user.email}</p>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 text-left text-xs text-white/30 hover:text-red-400 px-1 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-auto relative z-10">
        {children}
      </div>
    </div>
  );
}
