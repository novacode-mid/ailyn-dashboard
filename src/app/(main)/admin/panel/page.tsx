"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CompaniesTab from "@/features/admin/components/panel/CompaniesTab";
import CompanyDetailTab from "@/features/admin/components/panel/CompanyDetailTab";
import KnowledgeTab from "@/features/admin/components/panel/KnowledgeTab";
import MetricsTab from "@/features/admin/components/panel/MetricsTab";

type Tab = "companies" | "detail" | "knowledge" | "metrics";

export default function AdminPanelPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("companies");
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem("ailyn_admin_token");
    if (!token) {
      router.replace("/admin");
    } else {
      setReady(true);
    }
  }, [router]);

  function handleSelectCompany(id: number, goTo: "detail" | "knowledge") {
    setSelectedCompanyId(id);
    setActiveTab(goTo);
  }

  function handleLogout() {
    sessionStorage.removeItem("ailyn_admin_token");
    router.replace("/admin");
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-ailyn-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "companies", label: "Clientes" },
    { id: "detail", label: "Detalle" },
    { id: "knowledge", label: "Knowledge Base" },
    { id: "metrics", label: "Métricas" },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-ailyn-400 flex items-center justify-center">
              <span className="text-white font-bold text-xs">A</span>
            </div>
            <span className="font-semibold text-white">Ailyn</span>
            <span className="text-gray-500 text-sm">/ Admin Panel</span>
          </div>
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-white text-sm transition-colors"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? "border-ailyn-400 text-white"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === "companies" && (
          <CompaniesTab onSelectCompany={handleSelectCompany} />
        )}
        {activeTab === "detail" && (
          <CompanyDetailTab
            companyId={selectedCompanyId}
            onBack={() => setActiveTab("companies")}
          />
        )}
        {activeTab === "knowledge" && (
          <KnowledgeTab
            companyId={selectedCompanyId}
            onBack={() => setActiveTab("companies")}
          />
        )}
        {activeTab === "metrics" && <MetricsTab />}
      </main>
    </div>
  );
}
