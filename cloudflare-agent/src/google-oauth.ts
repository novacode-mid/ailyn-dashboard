// ── Google OAuth 2.0 ──────────────────────────────────────────────────────
// Maneja el flujo OAuth para Gmail + Calendar + futuras APIs de Google.

import type { Env } from "./types";

const GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

// ── Helpers ────────────────────────────────────────────────────────────────

function getRedirectUri(workerUrl: string): string {
  return `${workerUrl}/api/auth/google/callback`;
}

// ── Handlers ──────────────────────────────────────────────────────────────

/**
 * GET /api/auth/google?company_id=N&redirect_after=URL
 * Redirige al usuario a la pantalla de consentimiento de Google.
 */
export async function handleGoogleAuthStart(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const companyId = url.searchParams.get("company_id") ?? "";
  const redirectAfter = url.searchParams.get("redirect_after") ?? "";

  if (!companyId) {
    return new Response("company_id requerido", { status: 400 });
  }

  if (!env.GOOGLE_CLIENT_ID) {
    return new Response("GOOGLE_CLIENT_ID no configurado", { status: 500 });
  }

  const workerUrl = `${url.protocol}//${url.host}`;
  const state = btoa(JSON.stringify({ company_id: companyId, redirect_after: redirectAfter }));

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", getRedirectUri(workerUrl));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return Response.redirect(authUrl.toString(), 302);
}

/**
 * GET /api/auth/google/callback?code=...&state=...
 * Intercambia el code por tokens y los guarda en D1.
 */
export async function handleGoogleAuthCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(`Error de autorización Google: ${error}`, { status: 400 });
  }
  if (!code || !state) {
    return new Response("Parámetros faltantes", { status: 400 });
  }

  let stateData: { company_id: string; redirect_after?: string };
  try {
    stateData = JSON.parse(atob(state)) as { company_id: string; redirect_after?: string };
  } catch {
    return new Response("State inválido", { status: 400 });
  }

  const workerUrl = `${url.protocol}//${url.host}`;

  // Intercambiar code por tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: getRedirectUri(workerUrl),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("[google-oauth] Token exchange error:", err);
    return new Response(`Error al obtener tokens: ${err}`, { status: 500 });
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  // Obtener info del usuario (email)
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = userRes.ok
    ? await userRes.json() as { email?: string; name?: string; picture?: string }
    : {};

  const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const companyId = Number(stateData.company_id);

  // Guardar en D1
  await env.DB.prepare(
    `INSERT INTO integrations (company_id, provider, access_token, refresh_token, token_expiry, scope, extra_data, is_active, updated_at)
     VALUES (?, 'google', ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(company_id, provider) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, refresh_token),
       token_expiry = excluded.token_expiry,
       scope = excluded.scope,
       extra_data = excluded.extra_data,
       is_active = 1,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    companyId,
    tokens.access_token,
    tokens.refresh_token ?? null,
    expiry,
    tokens.scope,
    JSON.stringify(userInfo)
  ).run();

  // Redirigir de vuelta al dashboard o mostrar página de éxito
  const redirectTo = stateData.redirect_after || null;
  if (redirectTo) return Response.redirect(redirectTo, 302);

  return new Response(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:400px;margin:80px auto;text-align:center">
    <h2>✅ Google conectado</h2>
    <p>Tu cuenta <strong>${userInfo.email ?? ""}</strong> está lista.</p>
    <p>Ailyn ahora puede leer tu Gmail y Calendar.</p>
    <p><a href="javascript:window.close()">Cerrar ventana</a></p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

/**
 * DELETE /api/auth/google?company_id=N
 * Revoca y elimina la integración.
 */
export async function handleGoogleDisconnect(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const companyId = url.searchParams.get("company_id");
  if (!companyId) return new Response(JSON.stringify({ error: "company_id requerido" }), { status: 400 });

  const row = await env.DB.prepare(
    `SELECT access_token FROM integrations WHERE company_id = ? AND provider = 'google'`
  ).bind(Number(companyId)).first<{ access_token: string }>();

  if (row?.access_token) {
    // Revocar token en Google
    await fetch(`https://oauth2.googleapis.com/revoke?token=${row.access_token}`, { method: "POST" }).catch(() => {});
  }

  await env.DB.prepare(
    `UPDATE integrations SET is_active = 0 WHERE company_id = ? AND provider = 'google'`
  ).bind(Number(companyId)).run();

  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}

/**
 * Refresca el access token usando el refresh token.
 * Llamar automáticamente cuando el token expira.
 */
export async function refreshGoogleToken(env: Env, companyId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT refresh_token, token_expiry FROM integrations
     WHERE company_id = ? AND provider = 'google' AND is_active = 1`
  ).bind(companyId).first<{ refresh_token: string | null; token_expiry: string | null }>();

  if (!row?.refresh_token) return null;

  // Verificar si ya expiró (con 5min de margen)
  const expiry = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
  if (Date.now() < expiry - 5 * 60 * 1000) {
    // Token aún válido — retornar el access_token actual
    const cur = await env.DB.prepare(
      `SELECT access_token FROM integrations WHERE company_id = ? AND provider = 'google'`
    ).bind(companyId).first<{ access_token: string }>();
    return cur?.access_token ?? null;
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: row.refresh_token,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type:    "refresh_token",
    }),
  });

  if (!res.ok) {
    console.error("[google-oauth] Refresh error:", await res.text());
    return null;
  }

  const tokens = await res.json() as { access_token: string; expires_in: number };
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await env.DB.prepare(
    `UPDATE integrations SET access_token = ?, token_expiry = ?, updated_at = CURRENT_TIMESTAMP
     WHERE company_id = ? AND provider = 'google'`
  ).bind(tokens.access_token, newExpiry, companyId).run();

  return tokens.access_token;
}

/** Obtiene un access token válido (refresca si es necesario) */
export async function getValidGoogleToken(env: Env, companyId: number): Promise<string | null> {
  return refreshGoogleToken(env, companyId);
}
