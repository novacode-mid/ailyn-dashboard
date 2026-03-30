import { ChatInterface } from "@/features/wallet-chat/components/ChatInterface";

interface Props {
  params: Promise<{ passId: string }>;
}

export default async function WalletChatPage({ params }: Props) {
  const { passId } = await params;
  return <ChatInterface passId={passId} />;
}

export function generateMetadata() {
  return {
    title: "Enterprise Agent Chat",
    description: "Chat con el agente corporativo",
  };
}
