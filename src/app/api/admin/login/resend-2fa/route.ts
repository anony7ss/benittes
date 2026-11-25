import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { clientAddress, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, readBoundedJson, rateLimitedResponse } from "../../../../../lib/security/http";
import { hashTwoFactorCode } from "../../../../../lib/security/twoFactor";
import { getServiceSupabase } from "../../../../../lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const parsed = await readBoundedJson<{ email?: unknown; tempToken?: unknown }>(request, 3 * 1024);
  if (!parsed.ok) return parsed.response;
  const email = typeof parsed.value?.email === "string" ? parsed.value.email.trim().toLowerCase() : "";
  const tempToken = typeof parsed.value?.tempToken === "string" ? parsed.value.tempToken.trim() : "";
  if (!email || email.length > 254 || !/^[a-f0-9]{64}$/i.test(tempToken)) {
    return NextResponse.json({ error: "Não foi possível reenviar o código." }, { status: 400 });
  }

  try {
    if (!(await enforceRateLimits([
      { scope: "2fa-resend-ip", subject: clientAddress(request), maxHits: 5, windowSeconds: 900 },
      { scope: "2fa-resend-token", subject: tempToken.toLowerCase(), maxHits: 3, windowSeconds: 900 },
    ]))) return rateLimitedResponse();

    const service = getServiceSupabase();
    const now = new Date().toISOString();
    const { data: member, error } = await service
      .from("panel_members")
      .select("user_id,phone,active,two_factor_enabled")
      .eq("email", email)
      .eq("active", true)
      .eq("two_factor_enabled", true)
      .eq("two_factor_temp_token", tempToken)
      .gt("two_factor_temp_token_expires_at", now)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Não foi possível reenviar o código." }, { status: 503 });
    if (!member?.phone) return NextResponse.json({ error: "Não foi possível reenviar o código." }, { status: 401 });

    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { data: updated, error: updateError } = await service.from("panel_members").update({
      two_factor_code: null,
      two_factor_code_hash: hashTwoFactorCode(member.user_id, code),
      two_factor_expires_at: expiresAt,
      two_factor_temp_token_expires_at: expiresAt,
    }).eq("user_id", member.user_id).eq("two_factor_temp_token", tempToken).eq("active", true).eq("two_factor_enabled", true)
      .select("user_id")
      .maybeSingle();
    if (updateError || !updated) return NextResponse.json({ error: "Não foi possível reenviar o código." }, { status: 503 });

    const { error: outboxError } = await service.from("whatsapp_outbox").insert({
      phone: member.phone,
      kind: "2fa_code",
      status: "pending",
      message: `🔐 *Benittes Oficina — Código de acesso*\n\nSeu código 2FA é: *${code}*\nVálido por 10 minutos.`,
    });
    if (outboxError) {
      await service.from("panel_members").update({
        two_factor_code_hash: null,
        two_factor_expires_at: null,
        two_factor_temp_token: null,
        two_factor_temp_token_expires_at: null,
      }).eq("user_id", member.user_id).eq("two_factor_temp_token", tempToken);
      return NextResponse.json({ error: "Não foi possível reenviar o código." }, { status: 503 });
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível reenviar o código." }, { status: 503 });
  }
}
