import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomInt } from "node:crypto";
import { clientAddress, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, readBoundedJson, rateLimitedResponse } from "../../../../lib/security/http";
import { AUTH_ERROR, hashTwoFactorCode } from "../../../../lib/security/twoFactor";
import { getServiceSupabase, getSupabaseEnv } from "../../../../lib/supabaseAdmin";
import { writeSupabaseAuthCookie } from "../../../../lib/supabaseAuthCookie";

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length < 4 ? "****" : `***${digits.slice(-4)}`;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();

  try {
    const parsed = await readBoundedJson<{ email?: unknown; password?: unknown }>(request, 4 * 1024);
    if (!parsed.ok) return parsed.response;
    const email = typeof parsed.value?.email === "string" ? parsed.value.email.trim().toLowerCase() : "";
    const password = typeof parsed.value?.password === "string" ? parsed.value.password : "";
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 1024) {
      return NextResponse.json({ error: "Informe um e-mail e uma senha válidos." }, { status: 400 });
    }

    if (!(await enforceRateLimits([
      { scope: "login-ip", subject: clientAddress(request), maxHits: 10, windowSeconds: 600 },
      { scope: "login-email", subject: email, maxHits: 5, windowSeconds: 900 },
    ]))) return rateLimitedResponse();

    const { url, anonKey } = getSupabaseEnv();
    if (!url || !anonKey) return NextResponse.json({ error: "Login temporariamente indisponível." }, { status: 503 });
    const anonClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) return NextResponse.json({ error: AUTH_ERROR }, { status: 401 });

    const service = getServiceSupabase();
    const { data: member, error: memberError } = await service
      .from("panel_members")
      .select("user_id, email, active, phone, two_factor_enabled")
      .eq("user_id", data.session.user.id)
      .maybeSingle();
    if (memberError) return NextResponse.json({ error: "Login temporariamente indisponível." }, { status: 503 });
    if (!member?.active) return NextResponse.json({ error: AUTH_ERROR }, { status: 401 });

    if (member.two_factor_enabled) {
      if (!member.phone) return NextResponse.json({ error: "Login temporariamente indisponível." }, { status: 503 });

      const code = String(randomInt(100000, 1000000));
      const tempToken = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { error: updateError } = await service
        .from("panel_members")
        .update({
          two_factor_code: null,
          two_factor_code_hash: hashTwoFactorCode(member.user_id, code),
          two_factor_expires_at: expiresAt,
          two_factor_temp_token: tempToken,
          two_factor_temp_token_expires_at: expiresAt,
        })
        .eq("user_id", member.user_id)
        .eq("active", true)
        .select("user_id")
        .maybeSingle();
      if (updateError) return NextResponse.json({ error: "Login temporariamente indisponível." }, { status: 503 });

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
        return NextResponse.json({ error: "Não foi possível enviar o código de acesso." }, { status: 503 });
      }

      return NextResponse.json({ requires2FA: true, tempToken, maskedPhone: maskPhone(member.phone) }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const response = NextResponse.json(
      { session: { user: { id: data.session.user.id, email: data.session.user.email ?? null } } },
      { headers: { "Cache-Control": "no-store" } },
    );
    await writeSupabaseAuthCookie(request, response, data.session, url, anonKey);
    return response;
  } catch {
    return NextResponse.json({ error: "Login temporariamente indisponível." }, { status: 503 });
  }
}
