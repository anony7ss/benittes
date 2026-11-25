import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { getServiceSupabase } from "../../../../../lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    tempToken?: string;
  };
  if (!body.email || !body.tempToken) {
    return NextResponse.json({ error: "Dados incompletos." }, { status: 400 });
  }

  const service = getServiceSupabase();
  const { data: member } = await service
    .from("panel_members")
    .select("*")
    .eq("email", body.email.trim().toLowerCase())
    .eq("two_factor_temp_token", body.tempToken)
    .maybeSingle();

  if (!member || !member.phone) {
    return NextResponse.json({ error: "Sessão 2FA não encontrada." }, { status: 404 });
  }

  const code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await service
    .from("panel_members")
    .update({
      two_factor_code: code,
      two_factor_expires_at: expiresAt,
    })
    .eq("user_id", member.user_id);

  await service.from("whatsapp_outbox").insert({
    phone: member.phone,
    kind: "2fa_code",
    status: "pending",
    message: `🔐 *Benittes Oficina — Código de acesso*\n\nSeu código 2FA é: *${code}*\nVálido por 10 minutos.`,
  });

  return NextResponse.json({ ok: true });
}
