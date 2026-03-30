import { Suspense } from "react";
import { AdminCommandChat } from "@/features/admin/components/AdminCommandChat";
import { AgentDashboard } from "@/features/admin/components/AgentDashboard";

function LeftSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-10 w-48 rounded-lg bg-gray-200" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-gray-200" />
        ))}
      </div>
      <div className="h-72 rounded-xl bg-gray-200" />
    </div>
  );
}

export default function AgentDashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-[1400px]">
        {/* Grid 2 columnas: izquierda 60% | derecha 40% */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px] xl:grid-cols-[1fr_480px]">
          {/* Columna izquierda — KPIs + tabla */}
          <div className="min-w-0">
            <Suspense fallback={<LeftSkeleton />}>
              <AgentDashboard />
            </Suspense>
          </div>

          {/* Columna derecha — Admin Command Chat (sticky) */}
          <div className="lg:sticky lg:top-8 lg:self-start" style={{ height: "calc(100vh - 4rem)" }}>
            <div className="h-full">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="font-bold text-gray-900">Command Center</h2>
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                  Admin Mode
                </span>
              </div>
              <div className="h-[calc(100%-2.5rem)]">
                <AdminCommandChat />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const metadata = {
  title: "Command Center | Admin",
};
