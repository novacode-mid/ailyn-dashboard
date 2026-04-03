// ── Integrations Hub — Framework genérico para todas las integraciones ─────
// Cada integración sigue el mismo patrón:
// 1. Credenciales en tabla `integrations` (provider, access_token, extra_data)
// 2. Tool detection en smart-router
// 3. Tool execution aquí
// 4. Webhook trigger después de acciones

import type { Env } from "./types";

// ── Tipos ─────────────────────────────────────────────────────────────────

export interface IntegrationCredentials {
  provider: string;
  access_token: string;
  extra_data: Record<string, unknown>;
}

// ── Obtener credenciales de una integración ───────────────────────────────

export async function getIntegrationToken(
  env: Env,
  companyId: number,
  provider: string
): Promise<IntegrationCredentials | null> {
  const row = await env.DB.prepare(
    `SELECT access_token, extra_data FROM integrations
     WHERE company_id = ? AND provider = ? AND is_active = 1`
  ).bind(companyId, provider).first<{ access_token: string; extra_data: string | null }>();

  if (!row) return null;

  let extra: Record<string, unknown> = {};
  try { extra = row.extra_data ? JSON.parse(row.extra_data) : {}; } catch { /* */ }

  return { provider, access_token: row.access_token, extra_data: extra };
}

// ── Guardar credenciales de integración ───────────────────────────────────

export async function saveIntegration(
  env: Env,
  companyId: number,
  provider: string,
  accessToken: string,
  extraData: Record<string, unknown> = {}
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO integrations (company_id, provider, access_token, extra_data, is_active, updated_at)
     VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(company_id, provider) DO UPDATE SET
       access_token = excluded.access_token,
       extra_data = excluded.extra_data,
       is_active = 1,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(companyId, provider, accessToken, JSON.stringify(extraData)).run();
}

// ══════════════════════════════════════════════════════════════════════════
// SLACK
// ══════════════════════════════════════════════════════════════════════════

export async function slackSendMessage(token: string, channel: string, text: string): Promise<boolean> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel, text }),
  });
  const data = await res.json() as { ok: boolean };
  return data.ok;
}

export async function slackListChannels(token: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch("https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=50", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as { ok: boolean; channels?: { id: string; name: string }[] };
  return data.ok ? (data.channels ?? []).map(c => ({ id: c.id, name: c.name })) : [];
}

// ══════════════════════════════════════════════════════════════════════════
// NOTION
// ══════════════════════════════════════════════════════════════════════════

export async function notionCreatePage(
  token: string,
  parentId: string,
  title: string,
  content: string
): Promise<{ id: string; url: string }> {
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { type: "database_id", database_id: parentId },
      properties: {
        title: { title: [{ text: { content: title } }] },
      },
      children: [
        { object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content } }] } },
      ],
    }),
  });
  if (!res.ok) {
    // Fallback: try as page parent
    const res2 = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        parent: { type: "page_id", page_id: parentId },
        properties: {
          title: { title: [{ text: { content: title } }] },
        },
        children: [
          { object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content } }] } },
        ],
      }),
    });
    const data2 = await res2.json() as { id: string; url: string };
    return { id: data2.id, url: data2.url };
  }
  const data = await res.json() as { id: string; url: string };
  return { id: data.id, url: data.url };
}

export async function notionSearch(token: string, query: string): Promise<{ id: string; title: string; type: string }[]> {
  const res = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({ query, page_size: 10 }),
  });
  const data = await res.json() as { results?: { id: string; object: string; properties?: Record<string, unknown> }[] };
  return (data.results ?? []).map(r => {
    let title = "Sin título";
    try {
      const props = r.properties ?? {};
      const titleProp = Object.values(props).find((p: unknown) => (p as { type?: string }).type === "title") as { title?: { plain_text: string }[] } | undefined;
      title = titleProp?.title?.[0]?.plain_text ?? "Sin título";
    } catch { /* */ }
    return { id: r.id, title, type: r.object };
  });
}

// ══════════════════════════════════════════════════════════════════════════
// HUBSPOT
// ══════════════════════════════════════════════════════════════════════════

export async function hubspotCreateContact(
  token: string,
  email: string,
  firstName: string,
  lastName: string,
  company?: string
): Promise<{ id: string }> {
  const properties: Record<string, string> = { email, firstname: firstName, lastname: lastName };
  if (company) properties.company = company;

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ properties }),
  });
  const data = await res.json() as { id: string };
  return { id: data.id };
}

export async function hubspotSearchContacts(token: string, query: string): Promise<unknown[]> {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "CONTAINS_TOKEN", value: `*${query}*` }] }],
      properties: ["email", "firstname", "lastname", "company", "phone"],
      limit: 5,
    }),
  });
  const data = await res.json() as { results?: unknown[] };
  return data.results ?? [];
}

export async function hubspotCreateDeal(
  token: string,
  name: string,
  amount: number,
  contactId?: string
): Promise<{ id: string }> {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ properties: { dealname: name, amount: String(amount), pipeline: "default", dealstage: "appointmentscheduled" } }),
  });
  const data = await res.json() as { id: string };

  // Associate with contact if provided
  if (contactId && data.id) {
    await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${data.id}/associations/contacts/${contactId}/deal_to_contact`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }

  return { id: data.id };
}

// ══════════════════════════════════════════════════════════════════════════
// SHOPIFY
// ══════════════════════════════════════════════════════════════════════════

export async function shopifyGetOrders(token: string, shop: string, limit = 5): Promise<unknown[]> {
  const res = await fetch(`https://${shop}.myshopify.com/admin/api/2024-01/orders.json?status=any&limit=${limit}`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  const data = await res.json() as { orders?: unknown[] };
  return data.orders ?? [];
}

export async function shopifyGetProducts(token: string, shop: string, limit = 10): Promise<unknown[]> {
  const res = await fetch(`https://${shop}.myshopify.com/admin/api/2024-01/products.json?limit=${limit}`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  const data = await res.json() as { products?: unknown[] };
  return data.products ?? [];
}

export async function shopifySearchOrders(token: string, shop: string, query: string): Promise<unknown[]> {
  const res = await fetch(`https://${shop}.myshopify.com/admin/api/2024-01/orders.json?status=any&name=${encodeURIComponent(query)}&limit=5`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  const data = await res.json() as { orders?: unknown[] };
  return data.orders ?? [];
}

// ══════════════════════════════════════════════════════════════════════════
// MAKE.COM (MIDDLEWARE UNIVERSAL)
// ══════════════════════════════════════════════════════════════════════════

export async function makeTriggerScenario(
  webhookUrl: string,
  data: Record<string, unknown>
): Promise<boolean> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.ok;
}
