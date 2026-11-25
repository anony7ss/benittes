import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, normalizeBrPhone, requirePanelStaff } from "../../../../../lib/supabaseAdmin";
import { clientAddress, databaseErrorResponse, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, readBoundedJson, rateLimitedResponse } from "../../../../../lib/security/http";

function canManageBot(role: unknown): boolean {
  return role === "owner" || role === "manager";
}

function validWhatsApp(phone: string): boolean {
  return /^55\d{10,11}$/.test(phone);
}

export async function GET(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!canManageBot(staff.member.role)) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const supabase = getServiceSupabase();
  const [{ data: items, error }, { count: pending }, { count: sent }, { count: failed }] =
    await Promise.all([
      supabase.from("whatsapp_outbox").select("*").not("kind", "like", "2fa_%").order("created_at", { ascending: false }).limit(25),
      supabase.from("whatsapp_outbox").select("*", { count: "exact", head: true }).not("kind", "like", "2fa_%").eq("status", "pending"),
      supabase.from("whatsapp_outbox").select("*", { count: "exact", head: true }).not("kind", "like", "2fa_%").eq("status", "sent"),
      supabase.from("whatsapp_outbox").select("*", { count: "exact", head: true }).not("kind", "like", "2fa_%").eq("status", "failed"),
    ]);

  if (error) return databaseErrorResponse(error);
  return NextResponse.json({
    items: items ?? [],
    stats: {
      pending: pending ?? 0,
      sent: sent ?? 0,
      failed: failed ?? 0,
    },
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!canManageBot(staff.member.role)) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const parsed = await readBoundedJson<{ phone?: unknown; message?: unknown }>(request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  const phone = normalizeBrPhone(typeof body?.phone === "string" ? body.phone : "");
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!validWhatsApp(phone) || !message || message.length > 4000) {
    return NextResponse.json({ error: "Informe um telefone válido e a mensagem." }, { status: 400 });
  }

  try {
    if (!(await enforceRateLimits([
      { scope: "whatsapp-send-user", subject: staff.user.id, maxHits: 30, windowSeconds: 900 },
      { scope: "whatsapp-send-ip", subject: clientAddress(request), maxHits: 60, windowSeconds: 900 },
    ]))) return rateLimitedResponse();
  } catch {
    return NextResponse.json({ error: "Envios temporariamente indisponíveis." }, { status: 503 });
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

  if (error) return databaseErrorResponse(error);
  return NextResponse.json({ ok: true, item: data });
}
