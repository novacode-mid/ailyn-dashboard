"use client";

import { useEffect, useState } from "react";
import { ChatInterface } from "@/features/wallet-chat/components/ChatInterface";

export default function WalletChatPage() {
  const [passId, setPassId] = useState<string | null>(null);

  useEffect(() => {
    // Extraer passId del path: /wallet-chat/<passId>/
    const parts = window.location.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("wallet-chat");
    const id = idx !== -1 ? parts[idx + 1] : null;
    setPassId(id ?? "");
  }, []);

  if (passId === null) return null;
  return <ChatInterface passId={passId} />;
}
