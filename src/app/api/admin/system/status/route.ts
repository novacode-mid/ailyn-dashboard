import { NextResponse } from "next/server";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";
const ADMIN_TOKEN = process.env.AGENT_ADMIN_TOKEN ?? "ailyn-admin-2026";

export async function POST(request: Request) {
  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status = body.status === "paused" ? "paused" : "active";

  const res = await fetch(`${WORKER_URL}/api/admin/system/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CF-Token": ADMIN_TOKEN,
    },
    body: JSON.stringify({ status }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Worker error" }, { status: res.status });
  }

  return NextResponse.json({ ok: true, system_status: status });
}
