import type { Env } from "./types";
import type { ClientUserWithCompany } from "./d1";
import {
  getUserByEmail,
  createClientUser,
  createCompany,
  createSession,
  getSessionUser,
  deleteSession,
} from "./d1";

// ── PBKDF2 password hashing via Web Crypto API ────────────────────────────

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
    keyMaterial,
    256
  );
  const hashArray = Array.from(new Uint8Array(bits));
  const saltArray = Array.from(salt);
  // Format: salt_hex:hash_hex
  const toHex = (arr: number[]) => arr.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${toHex(saltArray)}:${toHex(hashArray)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const salt = fromHex(saltHex);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
    keyMaterial,
    256
  );
  const computed = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return computed === hashHex;
}

// ── Middleware ────────────────────────────────────────────────────────────

export async function authenticateUser(
  request: Request,
  env: Env
): Promise<ClientUserWithCompany | null> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token) return null;
  return getSessionUser(env, token);
}

// ── Input sanitization ────────────────────────────────────────────────────

function sanitize(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ── Rate limiting (in-memory, resets on deploy — sufficient for auth) ──────

const loginAttempts  = new Map<string, { count: number; resetAt: number }>();
const registerAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(
  map: Map<string, { count: number; resetAt: number }>,
  ip: string,
  max: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = map.get(ip);
  if (!entry || now > entry.resetAt) {
    map.set(ip, { count: 1, resetAt: now + windowMs });
    return true; // allowed
  }
  if (entry.count >= max) return false; // blocked
  entry.count++;
  return true;
}

function getIP(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

// ── Handlers ──────────────────────────────────────────────────────────────

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const ip = getIP(request);
  if (!checkRateLimit(registerAttempts, ip, 3, 60 * 60 * 1000)) {
    return json({ error: "Demasiados registros. Intenta en 1 hora." }, 429);
  }

  let body: { name?: string; email?: string; password?: string; company_name?: string };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const rawName = body.name?.trim() ?? "";
  const rawEmail = body.email?.trim().toLowerCase() ?? "";
  const rawCompany = body.company_name?.trim() ?? "";
  const { password } = body;

  if (!rawName || !rawEmail || !password || !rawCompany) {
    return json({ error: "name, email, password y company_name son requeridos" }, 400);
  }
  if (password.length < 8) {
    return json({ error: "La contraseña debe tener al menos 8 caracteres" }, 400);
  }

  const name        = sanitize(rawName);
  const email       = rawEmail; // emails no se sanitizan con HTML entities
  const company_name = sanitize(rawCompany);

  // Check email unique
  const existing = await getUserByEmail(env, email);
  if (existing) return json({ error: "Este email ya está registrado" }, 409);

  // Create company
  let companyId: number;
  try {
    companyId = await createCompany(env, company_name);
  } catch {
    return json({ error: "Error al crear la empresa" }, 500);
  }

  // Hash password + create user
  const passwordHash = await hashPassword(password);
  const userId = await createClientUser(env, email, passwordHash, name, companyId);

  // Create session
  const token = await createSession(env, userId);

  return json({
    token,
    user: { id: userId, name: name.trim(), email: email.toLowerCase().trim(), company_id: companyId, company_name: company_name.trim(), setup_completed: 0 },
  }, 201);
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const ip = getIP(request);
  if (!checkRateLimit(loginAttempts, ip, 5, 60 * 1000)) {
    return json({ error: "Demasiados intentos. Espera 1 minuto." }, 429);
  }

  let body: { email?: string; password?: string };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { email, password } = body;
  if (!email?.trim() || !password) return json({ error: "email y password son requeridos" }, 400);

  const user = await getUserByEmail(env, email);
  if (!user) return json({ error: "Credenciales incorrectas" }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return json({ error: "Credenciales incorrectas" }, 401);

  const token = await createSession(env, user.id);

  const company = await env.DB.prepare(
    `SELECT name, setup_completed FROM companies WHERE id = ?`
  ).bind(user.company_id).first<{ name: string; setup_completed: number }>();

  return json({
    token,
    user: { id: user.id, name: user.name, email: user.email, company_id: user.company_id, company_name: company?.name ?? "", setup_completed: company?.setup_completed ?? 0 },
  });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token) await deleteSession(env, token);
  return json({ ok: true });
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return json({ error: "No autorizado" }, 401);
  return json({ user });
}
