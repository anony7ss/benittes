import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clientAddress, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, readBoundedJson, rateLimitedResponse } from "../../../../../lib/security/http";
import { AUTH_ERROR, hashTwoFactorCode, safeHashEquals } from "../../../../../lib/security/twoFactor";
import { getServiceSupabase, getSupabaseEnv } from "../../../../../lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const parsed = await readBoundedJson<{
    email?: unknown;
    password?: unknown;
    tempToken?: unknown;
    code?: unknown;
  }>(request, 4 * 1024);
  if (!parsed.ok) return parsed.response;

  const email = typeof parsed.value?.email === "string" ? parsed.value.email.trim().toLowerCase() : "";
  const password = typeof parsed.value?.password === "string" ? parsed.value.password : "";
  const tempToken = typeof parsed.value?.tempToken === "string" ? parsed.value.tempToken.trim() : "";
  const code = typeof parsed.value?.code === "string" ? parsed.value.code.replace(/\D/g, "") : "";
  if (!email || email.length > 254 || password.length > 1024 || !/^[a-f0-9]{64}$/i.test(tempToken) || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: AUTH_ERROR }, { status: 401 });
  }

  try {
    if (!(await enforceRateLimits([
      { scope: "2fa-verify-ip", subject: clientAddress(request), maxHits: 15, windowSeconds: 600 },
      { scope: "2fa-verify-token", subject: tempToken.toLowerCase(), maxHits: 5, windowSeconds: 600 },
    ]))) return rateLimitedResponse();

    const service = getServiceSupabase();
    const now = new Date().toISOString();
    const { data: member, error: memberError } = await service
      .from("panel_members")
      .select("user_id,email,active,two_factor_enabled,two_factor_code_hash,two_factor_expires_at,two_factor_temp_token_expires_at")
      .eq("email", email)
      .eq("active", true)
      .eq("two_factor_enabled", true)
      .eq("two_factor_temp_token", tempToken)
      .gt("two_factor_expires_at", now)
      .gt("two_factor_temp_token_expires_at", now)
      .maybeSingle();
    if (memberError) return NextResponse.json({ error: "Login temporariamente indisponível." }, { status: 503 });
    if (!member?.user_id || !safeHashEquals(member.two_factor_code_hash, hashTwoFactorCode(member.user_id, code))) {
      return NextResponse.json({ error: AUTH_ERROR }, { status: 401 });
    }

    const { url, anonKey } = getSupabaseEnv();
    if (!url || !anonKey) return NextResponse.json({ error: "Login temporariamente indisponível." }, { status: 503 });
    const anonClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) return NextResponse.json({ error: AUTH_ERROR }, { status: 401 });

    // Consume the code atomically so parallel requests cannot reuse the same OTP.
    const { data: consumed, error: consumeError } = await service
      .from("panel_members")
      .update({
        two_factor_code: null,
        two_factor_code_hash: null,
        two_factor_expires_at: null,
        two_factor_temp_token: null,
        two_factor_temp_token_expires_at: null,
      })
      .eq("user_id", member.user_id)
      .eq("active", true)
      .eq("two_factor_enabled", true)
      .eq("two_factor_code_hash", member.two_factor_code_hash)
      .eq("two_factor_temp_token", tempToken)
      .gt("two_factor_expires_at", now)
      .gt("two_factor_temp_token_expires_at", now)
      .select("user_id")
      .maybeSingle();
    if (consumeError || !consumed) return NextResponse.json({ error: AUTH_ERROR }, { status: 401 });

    return NextResponse.json({ session: data.session }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Login temporariamente indisponível." }, { status: 503 });
  }
}
