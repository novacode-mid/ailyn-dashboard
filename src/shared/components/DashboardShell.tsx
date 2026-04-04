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
  MessagesSquare,
  Bot,
  Monitor,
  Store,
  Settings,
  Wallet,
  LogOut,
  Sparkles,
  Menu,
  X,
} from "lucide-react";

const NAV = [
  { href: "/dashboard",      label: "Dashboard",        icon: LayoutDashboard },
  { href: "/conversations",  label: "Conversaciones",   icon: MessagesSquare },
  { href: "/activity",       label: "Actividad",        icon: Target },
  { href: "/leads",          label: "Leads",            icon: Zap },
  { href: "/knowledge",      label: "Knowledge Base",   icon: BookOpen },
  { href: "/wallet",         label: "Tarjetas",         icon: Wallet },
  { href: "/wallet-chat",    label: "Web Chat",         icon: MessageSquare },
  { href: "/automations",    label: "Automatizaciones", icon: Bot },
  { href: "/marketplace",    label: "Marketplace",      icon: Store },
  { href: "/desktop-tasks",  label: "Desktop Agent",    icon: Monitor },
  { href: "/billing",        label: "Billing",          icon: CreditCard },
  { href: "/settings",       label: "Configuración",    icon: Settings },
];

export default function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    setUser(u);
    setReady(true);
  }, [router]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

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

      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-30 lg:hidden glass-sidebar border-b border-white/[0.08]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-400/20 border border-brand-400/30 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-brand-300" />
            </div>
            <span className="font-bold text-white text-base">Ailyn</span>
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-10 h-10 flex items-center justify-center rounded-xl text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full z-20
        w-64 glass-sidebar flex flex-col
        transition-transform duration-300 ease-in-out
        lg:relative lg:translate-x-0 lg:w-60 lg:shrink-0 lg:z-10
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
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
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
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
                <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? "text-brand-300" : ""}`} />
                <span className="truncate">{item.label}</span>
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
            className="w-full flex items-center gap-2 text-left text-xs text-white/30 hover:text-red-400 px-1 py-1 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-auto relative z-10 pt-14 lg:pt-0">
        {children}
      </div>
    </div>
  );
}
