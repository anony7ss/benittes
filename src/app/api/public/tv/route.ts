import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clientAddress, enforceRateLimits, rateLimitedResponse } from "../../../../lib/security/http";

function getAdminClient() {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) {
    throw new Error("Supabase não configurado no servidor.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function publicBoardRow(row: Record<string, unknown>) {
  const plateDigits = String(row.vehicle_plate ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return {
    reference: typeof row.reference === "string" ? row.reference.slice(0, 40) : "",
    customer_name: "Cliente",
    vehicle_plate: plateDigits.length >= 2 ? `***-**${plateDigits.slice(-2)}` : "—",
    status: row.status,
    updated_at: row.updated_at,
    created_at: row.created_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    if (!(await enforceRateLimits([
      { scope: "public-tv-ip", subject: clientAddress(request), maxHits: 60, windowSeconds: 300 },
    ]))) return rateLimitedResponse();

    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("work_orders")
      .select("id, reference, customer_name, vehicle_plate, status, updated_at, created_at")
      .neq("status", "cancelado")
      .order("updated_at", { ascending: false })
      .limit(60);

    if (error) {
      return NextResponse.json({ error: "Não foi possível carregar o painel TV." }, { status: 503 });
    }

    const rows = data ?? [];
    return NextResponse.json(
      {
        inBox: rows.filter((r) => r.status === "em_andamento").map((r) => publicBoardRow(r)),
        waiting: rows.filter((r) => r.status === "novo" || r.status === "aguardando").map((r) => publicBoardRow(r)),
        ready: rows.filter((r) => r.status === "concluido").slice(0, 10).map((r) => publicBoardRow(r)),
        updatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar o painel TV." }, { status: 503 });
  }
}
