import type { Env } from "./types";

const BASE_URL = "https://pass.smartpasses.io/api/v1";

// ── Credenciales por empresa o globales ──────────────────────────────────

interface SmartPassCreds {
  apiKey: string;
  passTypeId: string;
  templateId: string;
}

export async function getSmartPassCreds(env: Env, companyId?: number): Promise<SmartPassCreds> {
  // 1. Buscar credenciales asignadas a la empresa
  if (companyId) {
    const row = await env.DB.prepare(
      `SELECT access_token, extra_data FROM integrations WHERE company_id = ? AND provider = 'smartpasses' AND is_active = 1`
    ).bind(companyId).first<{ access_token: string; extra_data: string | null }>();

    if (row) {
      let extra: Record<string, string> = {};
      try { extra = row.extra_data ? JSON.parse(row.extra_data) : {}; } catch { /* */ }
      return {
        apiKey: row.access_token,
        passTypeId: extra.pass_type_id ?? env.SMARTPASSES_PASS_TYPE_ID,
        templateId: (extra.pass_template_id ?? env.SMARTPASSES_PASS_TEMPLATE_ID).replace("passtemplates:", ""),
      };
    }
  }

  // 2. Fallback: credenciales globales del env
  return {
    apiKey: env.SMARTPASSES_API_KEY,
    passTypeId: env.SMARTPASSES_PASS_TYPE_ID,
    templateId: env.SMARTPASSES_PASS_TEMPLATE_ID.replace("passtemplates:", ""),
  };
}

/** Crea un env override con las credenciales de la empresa */
export async function withCompanyCreds(env: Env, companyId?: number): Promise<Env> {
  if (!companyId) return env;
  const creds = await getSmartPassCreds(env, companyId);
  return {
    ...env,
    SMARTPASSES_API_KEY: creds.apiKey,
    SMARTPASSES_PASS_TYPE_ID: creds.passTypeId,
    SMARTPASSES_PASS_TEMPLATE_ID: creds.templateId,
  };
}

function getTemplateId(env: Env): string {
  return env.SMARTPASSES_PASS_TEMPLATE_ID.replace("passtemplates:", "");
}

function authHeader(env: Env): Record<string, string> {
  return { Authorization: env.SMARTPASSES_API_KEY };
}

function jsonHeaders(env: Env): Record<string, string> {
  return { ...authHeader(env), "Content-Type": "application/json" };
}

export interface PassInfo {
  passTypeIdentifier: string;
  serialNumber: string;
  url?: string;
}

export interface CreatePassOptions {
  nombre: string;
  empresa: string;
  rol?: string;
  email?: string;
}

// ── Crear pase desde template ──────────────────────────────────────────────
export async function createPass(env: Env, options: CreatePassOptions): Promise<PassInfo> {
  const templateId = getTemplateId(env);
  const passType = env.SMARTPASSES_PASS_TYPE_ID;

  const response = await fetch(`${BASE_URL}/templates/${templateId}/pass`, {
    method: "POST",
    headers: jsonHeaders(env),
    body: JSON.stringify({
      Mensaje: `Bienvenido a Ailyn, ${options.nombre}`,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SmartPass createPass failed: ${response.status} - ${text}`);
  }

  const data = await response.json() as Record<string, unknown>;
  // Handle various possible response shapes
  const serialNumber = String(
    (data.serialNumber ?? data.serial_number ?? data.id ?? data.passSerialNumber ?? "") as string
  );
  const url = data.url as string | undefined ?? data.shortUrl as string | undefined;

  return { passTypeIdentifier: passType, serialNumber, url };
}

// ── Obtener URL de instalación ─────────────────────────────────────────────
export async function getPassUrl(env: Env, serialNumber: string): Promise<string> {
  const passType = env.SMARTPASSES_PASS_TYPE_ID;

  const response = await fetch(`${BASE_URL}/passes/${passType}/${serialNumber}/url`, {
    headers: authHeader(env),
  });

  if (!response.ok) {
    throw new Error(`SmartPass getPassUrl failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;
  return String(data.url ?? data.shortUrl ?? data);
}

// ── Obtener valores actuales del pase ─────────────────────────────────────
export async function getPassValues(env: Env, serialNumber: string): Promise<Record<string, string>> {
  const passType = env.SMARTPASSES_PASS_TYPE_ID;

  const response = await fetch(`${BASE_URL}/passes/${passType}/${serialNumber}/values`, {
    headers: authHeader(env),
  });

  if (!response.ok) {
    throw new Error(`SmartPass getPassValues failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;
  return (data.values ?? data) as Record<string, string>;
}

// ── Actualizar valores del pase ────────────────────────────────────────────
export async function updatePassValues(
  env: Env,
  serialNumber: string,
  values: Record<string, string>
): Promise<void> {
  const passType = env.SMARTPASSES_PASS_TYPE_ID;

  const response = await fetch(`${BASE_URL}/passes/${passType}/${serialNumber}/values`, {
    method: "PUT",
    headers: jsonHeaders(env),
    body: JSON.stringify(values),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SmartPass updateValues failed: ${response.status} - ${text}`);
  }
}

// ── Enviar push notification ───────────────────────────────────────────────
export async function sendPassPush(env: Env, serialNumber: string): Promise<void> {
  const passType = env.SMARTPASSES_PASS_TYPE_ID;

  const response = await fetch(`${BASE_URL}/passes/${passType}/${serialNumber}/push`, {
    method: "POST",
    headers: authHeader(env),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SmartPass sendPush failed: ${response.status} - ${text}`);
  }
}

// ── Enviar pase por email ──────────────────────────────────────────────────
export async function emailPass(env: Env, serialNumber: string, email: string): Promise<void> {
  const passType = env.SMARTPASSES_PASS_TYPE_ID;

  const response = await fetch(`${BASE_URL}/passes/${passType}/${serialNumber}/email`, {
    method: "POST",
    headers: jsonHeaders(env),
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SmartPass emailPass failed: ${response.status} - ${text}`);
  }
}

// ── Obtener estado del pase ────────────────────────────────────────────────
export async function getPassStatus(env: Env, serialNumber: string): Promise<Record<string, unknown>> {
  const passType = env.SMARTPASSES_PASS_TYPE_ID;

  const response = await fetch(`${BASE_URL}/passes/${passType}/${serialNumber}/status`, {
    headers: authHeader(env),
  });

  if (!response.ok) {
    throw new Error(`SmartPass getPassStatus failed: ${response.status}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

// ── Combo: actualizar + push (flujo correcto) ─────────────────────────────
export async function notifyViaPass(
  env: Env,
  serialNumber: string,
  values: Record<string, string>
): Promise<void> {
  await updatePassValues(env, serialNumber, values);
  await sendPassPush(env, serialNumber);
}
