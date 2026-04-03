"use client";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  company_id: number;
  company_name: string;
  setup_completed?: number;
}

export function getToken(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem("ailyn_token") ?? "";
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem("ailyn_user");
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch { return null; }
}

export function saveAuth(token: string, user: AuthUser): void {
  sessionStorage.setItem("ailyn_token", token);
  sessionStorage.setItem("ailyn_user", JSON.stringify(user));
}

export function clearAuth(): void {
  const token = getToken();
  sessionStorage.removeItem("ailyn_token");
  sessionStorage.removeItem("ailyn_user");
  if (token) {
    fetch(`${WORKER_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
}

export function authHeaders(): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` };
}
