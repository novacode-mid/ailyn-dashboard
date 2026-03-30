import { NextResponse } from "next/server";

const WORKER_URL = "https://ailyn-agent.novacodepro.workers.dev";
const ADMIN_TOKEN = process.env.AGENT_ADMIN_TOKEN ?? "ailyn-admin-2026";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id") ?? "";
  const res = await fetch(`${WORKER_URL}/api/admin/knowledge/docs?company_id=${companyId}`, {
    headers: { "X-CF-Token": ADMIN_TOKEN },
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}
