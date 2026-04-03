"use client";

import { useEffect, useState } from "react";
import { ChatInterface } from "@/features/wallet-chat/components/ChatInterface";
import DashboardShell from "@/shared/components/DashboardShell";

export default function WalletChatPage() {
  const [passId, setPassId] = useState<string | null>(null);

  useEffect(() => {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("wallet-chat");
    const id = idx !== -1 ? parts[idx + 1] : null;
    setPassId(id ?? "");
  }, []);

  if (passId === null) return null;

  // Si hay passId en el path, mostrar el chat sin sidebar
  if (passId) return <ChatInterface passId={passId} />;

  // Sin passId: mostrar selector con sidebar
  return (
    <DashboardShell>
      <div className="p-6 space-y-4">
        <h1 className="text-xl font-bold text-white">Web Chat</h1>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
          <p className="text-gray-400 text-sm">
            Accede al chat con un Smart Pass ID en la URL:
          </p>
          <p className="text-gray-600 text-xs mt-2 font-mono">/wallet-chat/&lt;passId&gt;</p>
        </div>
      </div>
    </DashboardShell>
  );
}
