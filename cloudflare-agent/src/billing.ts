// ── Billing con Polar (Merchant of Record) ──────────────────────────────
// Checkout → webhook → actualizar plan_slug de la empresa

import type { Env } from "./types";

const POLAR_API = "https://api.polar.sh/v1";

// Map Polar product IDs to plan slugs (configurar en Polar dashboard)
const PRODUCT_TO_PLAN: Record<string, string> = {
  // Estos IDs se configuran cuando creas los productos en Polar
  // Por ahora usamos los nombres como fallback
  starter: "starter",
  pro: "pro",
  enterprise: "enterprise",
};

export interface CheckoutResult {
  url: string;
  id: string;
}

// ── Crear checkout session ───────────────────────────────────────────────

export async function createCheckout(
  env: Env,
  companyId: number,
  planSlug: string,
  successUrl: string
): Promise<CheckoutResult> {
  // Buscar el producto en Polar por metadata
  const productRes = await fetch(`${POLAR_API}/products?organization_id=${env.POLAR_ORG_ID ?? ""}&limit=10`, {
    headers: { Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN ?? ""}` },
  });

  if (!productRes.ok) throw new Error(`Polar products error: ${productRes.status}`);
  const products = (await productRes.json()) as { items?: { id: string; name: string; metadata?: Record<string, string> }[] };

  const product = (products.items ?? []).find(
    (p) => p.metadata?.plan_slug === planSlug || p.name.toLowerCase().includes(planSlug)
  );

  if (!product) throw new Error(`Plan ${planSlug} no encontrado en Polar`);

  // Crear checkout
  const checkoutRes = await fetch(`${POLAR_API}/checkouts/custom`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      product_id: product.id,
      success_url: successUrl,
      metadata: {
        company_id: String(companyId),
        plan_slug: planSlug,
      },
    }),
  });

  if (!checkoutRes.ok) {
    const err = await checkoutRes.text();
    throw new Error(`Polar checkout error: ${checkoutRes.status} ${err}`);
  }

  const checkout = (await checkoutRes.json()) as { id: string; url: string };
  return { url: checkout.url, id: checkout.id };
}

// ── Verificar webhook signature ──────────────────────────────────────────

async function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return computed === signature;
}

// ── Handle webhook ──────────────────────────────────────────────────────

export async function handlePolarWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await request.text();
  const signature = request.headers.get("webhook-signature") ?? request.headers.get("x-polar-signature") ?? "";

  // Verificar firma si hay secret configurado
  if (env.POLAR_WEBHOOK_SECRET) {
    const valid = await verifyWebhookSignature(body, signature, env.POLAR_WEBHOOK_SECRET);
    if (!valid) return new Response("Invalid signature", { status: 401 });
  }

  let event: {
    type: string;
    data: {
      id?: string;
      metadata?: Record<string, string>;
      product?: { metadata?: Record<string, string>; name?: string };
      status?: string;
      amount?: number;
      currency?: string;
    };
  };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  console.log(`[billing] Polar webhook: ${event.type}`);

  // Manejar checkout completado
  if (event.type === "checkout.completed" || event.type === "order.created") {
    const companyId = Number(event.data.metadata?.company_id ?? "0");
    const planSlug = event.data.metadata?.plan_slug
      ?? event.data.product?.metadata?.plan_slug
      ?? PRODUCT_TO_PLAN[event.data.product?.name?.toLowerCase() ?? ""]
      ?? null;

    if (companyId && planSlug) {
      // Actualizar plan de la empresa
      await env.DB.prepare(
        `UPDATE companies SET plan_slug = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(planSlug, companyId).run();

      // Registrar billing event
      await env.DB.prepare(
        `INSERT INTO billing_events (company_id, event_type, plan_slug, amount_cents, currency, polar_id, raw_data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        companyId,
        event.type,
        planSlug,
        event.data.amount ?? 0,
        event.data.currency ?? "usd",
        event.data.id ?? "",
        body.slice(0, 5000)
      ).run();

      console.log(`[billing] Company ${companyId} upgraded to ${planSlug}`);
    }
  }

  // Manejar cancelación de suscripción
  if (event.type === "subscription.canceled") {
    const companyId = Number(event.data.metadata?.company_id ?? "0");
    if (companyId) {
      await env.DB.prepare(
        `UPDATE companies SET plan_slug = 'free', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(companyId).run();

      await env.DB.prepare(
        `INSERT INTO billing_events (company_id, event_type, plan_slug, polar_id, raw_data)
         VALUES (?, ?, 'free', ?, ?)`
      ).bind(companyId, event.type, event.data.id ?? "", body.slice(0, 5000)).run();

      console.log(`[billing] Company ${companyId} downgraded to free (canceled)`);
    }
  }

  return new Response("OK", { status: 200 });
}
