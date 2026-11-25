import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { getServiceSupabase, normalizeBrPhone, requirePanelStaff } from "../../../../../lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  return NextResponse.json({
    phone: staff.member.phone ?? "",
    two_factor_enabled: Boolean(staff.member.two_factor_enabled),
  });
}

export async function POST(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    action?: "send_code" | "verify_enable" | "disable";
    phone?: string;
    code?: string;
    two_factor_enabled?: boolean;
  };

  const action =
    body.action ??
    (body.two_factor_enabled === false ? "disable" : "send_code");
  const phone = normalizeBrPhone(body.phone || staff.member.phone || "");
  const supabase = getServiceSupabase();

  if (action === "disable") {
    const { error } = await supabase
      .from("panel_members")
      .update({
        phone: phone || null,
        two_factor_enabled: false,
        two_factor_code: null,
        two_factor_expires_at: null,
      })
      .eq("user_id", staff.user.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, phone, two_factor_enabled: false });
  }

  if (phone.length < 12) {
    return NextResponse.json(
      { error: "Informe um número de WhatsApp válido (com DDD) para ativar o 2FA." },
      { status: 400 },
    );
  }

  if (action === "send_code") {
    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("panel_members")
      .update({
        two_factor_code: code,
        two_factor_expires_at: expiresAt,
      })
      .eq("user_id", staff.user.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const { error: outboxError } = await supabase.from("whatsapp_outbox").insert({
      phone,
      kind: "2fa_setup_code",
      status: "pending",
      message:
        `🔐 *Benittes Oficina — Confirmação de 2FA*\n\n` +
        `Seu código para ativar a verificação em duas etapas é: *${code}*\n` +
        `Válido por 10 minutos.`,
    });

    if (outboxError) {
      return NextResponse.json({ error: outboxError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, sent: true, phone });
  }

  // verify_enable
  const submittedCode = String(body.code ?? "").replace(/\D/g, "");
  if (submittedCode.length !== 6) {
    return NextResponse.json(
      { error: "Informe o código de 6 dígitos enviado no WhatsApp." },
      { status: 400 },
    );
  }

  const { data: current, error: fetchError } = await supabase
    .from("panel_members")
    .select("two_factor_code, two_factor_expires_at")
    .eq("user_id", staff.user.id)
    .maybeSingle();

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 400 });

  const expectedCode = String(current?.two_factor_code ?? "");
  const expiresAt = current?.two_factor_expires_at ? new Date(current.two_factor_expires_at).getTime() : 0;

  if (!expectedCode || submittedCode !== expectedCode) {
    return NextResponse.json({ error: "Código inválido. Verifique e tente novamente." }, { status: 400 });
  }

  if (!expiresAt || Date.now() > expiresAt) {
    return NextResponse.json({ error: "Código expirado. Solicite um novo código." }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("panel_members")
    .update({
      phone,
      two_factor_enabled: true,
      two_factor_code: null,
      two_factor_expires_at: null,
    })
    .eq("user_id", staff.user.id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 });

  return NextResponse.json({ ok: true, phone, two_factor_enabled: true });
}
