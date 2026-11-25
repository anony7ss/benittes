import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, normalizeBrPhone, requirePanelStaff } from "../../../../../lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const supabase = getServiceSupabase();
  const [{ data: items, error }, { count: pending }, { count: sent }, { count: failed }] =
    await Promise.all([
      supabase.from("whatsapp_outbox").select("*").order("created_at", { ascending: false }).limit(25),
      supabase.from("whatsapp_outbox").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("whatsapp_outbox").select("*", { count: "exact", head: true }).eq("status", "sent"),
      supabase.from("whatsapp_outbox").select("*", { count: "exact", head: true }).eq("status", "failed"),
    ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    items: items ?? [],
    stats: {
      pending: pending ?? 0,
      sent: sent ?? 0,
      failed: failed ?? 0,
    },
  });
}

export async function POST(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { phone?: string; message?: string };
  const phone = normalizeBrPhone(body.phone || "");
  const message = String(body.message || "").trim();

  if (phone.length < 12 || !message) {
    return NextResponse.json({ error: "Informe um telefone válido e a mensagem." }, { status: 400 });
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("whatsapp_outbox")
    .insert({
      phone,
      message,
      kind: "direct",
      status: "pending",
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, item: data });
}
