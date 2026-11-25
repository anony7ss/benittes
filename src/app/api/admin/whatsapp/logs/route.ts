import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, requirePanelStaff } from "../../../../../lib/supabaseAdmin";
import { enforceRateLimits, invalidOriginResponse, isSameOriginRequest, rateLimitedResponse } from "../../../../../lib/security/http";

export async function GET(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (staff.member.role !== "owner" && staff.member.role !== "manager") {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from("whatsapp_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(120);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ logs: (data ?? []).reverse() }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (staff.member.role !== "owner" && staff.member.role !== "manager") {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  try {
    if (!(await enforceRateLimits([
      { scope: "whatsapp-log-delete", subject: staff.user.id, maxHits: 2, windowSeconds: 3600 },
    ]))) return rateLimitedResponse();
  } catch {
    return NextResponse.json({ error: "Ação temporariamente indisponível." }, { status: 503 });
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("whatsapp_logs")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
