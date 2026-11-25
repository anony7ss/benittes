import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function GET() {
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("work_orders")
      .select("id, reference, customer_name, vehicle_plate, status, updated_at, created_at")
      .neq("status", "cancelado")
      .order("updated_at", { ascending: false })
      .limit(60);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];
    return NextResponse.json(
      {
        inBox: rows.filter((r) => r.status === "em_andamento"),
        waiting: rows.filter((r) => r.status === "novo" || r.status === "aguardando"),
        ready: rows.filter((r) => r.status === "concluido").slice(0, 10),
        updatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao carregar painel TV." },
      { status: 500 },
    );
  }
}
