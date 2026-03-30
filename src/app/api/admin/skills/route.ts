import { NextResponse } from "next/server";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";
const ADMIN_TOKEN = process.env.AGENT_ADMIN_TOKEN ?? "ailyn-admin-2026";

export async function GET() {
  const res = await fetch(`${WORKER_URL}/api/admin/skills`, {
    headers: { "X-CF-Token": ADMIN_TOKEN },
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}
