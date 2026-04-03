// ── Cloudflare bindings ────────────────────────────────────────────────────
export interface Env {
  // Workers AI
  AI: Ai;
  // D1 Database
  DB: D1Database;
  // KV Namespace
  KV: KVNamespace;
  // Vectorize (Knowledge Base RAG)
  KNOWLEDGE_BASE: VectorizeIndex;
  // Secrets (set via wrangler secret put)
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  SMARTPASSES_API_KEY: string;
  SMARTPASSES_PASS_TYPE_ID: string;
  SMARTPASSES_PASS_TEMPLATE_ID: string;
  CLOUDFLARE_ADMIN_TOKEN: string;
  // Secrets opcionales para Fase 15
  TAVILY_API_KEY: string;
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  // Secrets opcionales para Multi-LLM Router (Fase 17)
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  // Secret opcional para envío de emails (Fase 18)
  RESEND_API_KEY?: string;
  // Google OAuth (para Gmail + Calendar)
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // GitHub (opcional — PAT por tenant en KV o global)
  GITHUB_TOKEN?: string;
  // Polar webhook (pagos / suscripciones)
  POLAR_WEBHOOK_SECRET?: string;
  // WhatsApp Cloud API (optional)
  WHATSAPP_APP_SECRET?: string;
}

// ── KV: historial de conversación ─────────────────────────────────────────
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type ChatHistory = ChatMessage[];

// ── D1: modelo de tareas ──────────────────────────────────────────────────
export type TaskStatus = "pending" | "processing" | "completed" | "failed" | "pending_approval";

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  result: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── D1: modelo de usuarios ─────────────────────────────────────────────────
export type UserRole = "admin" | "user";

export interface User {
  id: number;
  telegram_id: string;
  username: string | null;
  role: UserRole;
  is_active: number;
  smartpass_id: string | null;
  created_at: string;
}

// ── Telegram: update de entrada ───────────────────────────────────────────
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  voice?: TelegramVoice;
}

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TelegramChat {
  id: number;
}
