import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { clientAddress, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, readBoundedJson, rateLimitedResponse } from "../../../../../lib/security/http";
import { hashTwoFactorCode, safeHashEquals } from "../../../../../lib/security/twoFactor";
import { getServiceSupabase, getSupabaseEnv, normalizeBrPhone, requirePanelStaff } from "../../../../../lib/supabaseAdmin";

const CODE_TTL_MS = 10 * 60 * 1000;

function validBrPhone(phone: string): boolean {
  return /^55\d{10,11}$/.test(phone);
}

export async function GET(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({
    phone: staff.member.phone ?? "",
    two_factor_enabled: Boolean(staff.member.two_factor_enabled),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = await readBoundedJson<{
    action?: unknown;
    phone?: unknown;
    code?: unknown;
    password?: unknown;
  }>(request, 3 * 1024);
  if (!parsed.ok) return parsed.response;

  const action = typeof parsed.value?.action === "string" ? parsed.value.action : "";
  const submittedCode = typeof parsed.value?.code === "string" ? parsed.value.code.replace(/\D/g, "") : "";
  try {
    if (!(await enforceRateLimits([
      { scope: "2fa-settings-ip", subject: clientAddress(request), maxHits: 20, windowSeconds: 900 },
      { scope: "2fa-settings-user", subject: staff.user.id, maxHits: 10, windowSeconds: 600 },
    ]))) return rateLimitedResponse();

    const service = getServiceSupabase();
    const { data: current, error: currentError } = await service
      .from("panel_members")
      .select("user_id,email,active,phone,two_factor_enabled,two_factor_code_hash,two_factor_expires_at,two_factor_pending_phone")
      .eq("user_id", staff.user.id)
      .eq("active", true)
      .maybeSingle();
    if (currentError || !current) return NextResponse.json({ error: "Não foi possível atualizar a segurança da conta." }, { status: 503 });

    if (action === "send_code" || action === "send_disable_code") {
      if (!(await enforceRateLimits([
        { scope: "2fa-settings-send", subject: staff.user.id, maxHits: 3, windowSeconds: 900 },
      ]))) return rateLimitedResponse();

      const isDisableCode = action === "send_disable_code";
      const phone = isDisableCode
        ? normalizeBrPhone(current.phone ?? "")
        : normalizeBrPhone(typeof parsed.value.phone === "string" ? parsed.value.phone : "");
      if (!validBrPhone(phone) || (isDisableCode && !current.two_factor_enabled)) {
        return NextResponse.json({ error: "Informe um número de WhatsApp válido com DDD." }, { status: 400 });
      }

      const password = typeof parsed.value.password === "string" ? parsed.value.password : "";
      if (!password || password.length > 1024) return NextResponse.json({ error: "Confirme sua senha atual." }, { status: 400 });
      const { url, anonKey } = getSupabaseEnv();
      if (!url || !anonKey) return NextResponse.json({ error: "Não foi possível confirmar a senha." }, { status: 503 });
      const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: passwordError } = await authClient.auth.signInWithPassword({ email: current.email, password });
      if (passwordError) return NextResponse.json({ error: "Senha atual incorreta." }, { status: 401 });

      const code = String(randomInt(100000, 1000000));
      const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
      const { data: updated, error: updateError } = await service.from("panel_members").update({
        two_factor_code: null,
        two_factor_code_hash: hashTwoFactorCode(staff.user.id, code),
        two_factor_expires_at: expiresAt,
        two_factor_pending_phone: phone,
      }).eq("user_id", staff.user.id).eq("active", true).select("user_id").maybeSingle();
      if (updateError || !updated) return NextResponse.json({ error: "Não foi possível enviar o código de verificação." }, { status: 503 });

      const { error: outboxError } = await service.from("whatsapp_outbox").insert({
        phone,
        kind: isDisableCode ? "2fa_disable_code" : "2fa_setup_code",
        status: "pending",
        message: `🔐 *Benittes Oficina — Confirmação de segurança*\n\nSeu código é: *${code}*\nVálido por 10 minutos.`,
      });
      if (outboxError) {
        await service.from("panel_members").update({
          two_factor_code_hash: null,
          two_factor_expires_at: null,
          two_factor_pending_phone: null,
        }).eq("user_id", staff.user.id);
        return NextResponse.json({ error: "Não foi possível enviar o código de verificação." }, { status: 503 });
      }
      return NextResponse.json({ ok: true, phone }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action !== "verify_enable" && action !== "disable") {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
    if (!/^\d{6}$/.test(submittedCode) || !current.two_factor_code_hash ||
        !current.two_factor_expires_at || Date.now() > new Date(current.two_factor_expires_at).getTime() ||
        !current.two_factor_pending_phone ||
        !safeHashEquals(current.two_factor_code_hash, hashTwoFactorCode(staff.user.id, submittedCode))) {
      return NextResponse.json({ error: "Código inválido ou expirado." }, { status: 400 });
    }

    if (action === "disable" && (!current.two_factor_enabled || current.two_factor_pending_phone !== current.phone)) {
      return NextResponse.json({ error: "Solicite um código novo para confirmar a desativação." }, { status: 400 });
    }

    const disabling = action === "disable";
    const { data: consumed, error: consumeError } = await service.from("panel_members").update({
      phone: disabling ? current.phone : current.two_factor_pending_phone,
      two_factor_enabled: !disabling,
      two_factor_code: null,
      two_factor_code_hash: null,
      two_factor_expires_at: null,
      two_factor_pending_phone: null,
    })
      .eq("user_id", staff.user.id)
      .eq("active", true)
      .eq("two_factor_code_hash", current.two_factor_code_hash)
      .eq("two_factor_pending_phone", current.two_factor_pending_phone)
      .gt("two_factor_expires_at", new Date().toISOString())
      .select("phone,two_factor_enabled")
      .maybeSingle();
    if (consumeError || !consumed) return NextResponse.json({ error: "Código inválido ou expirado." }, { status: 400 });

    return NextResponse.json({ ok: true, phone: consumed.phone ?? "", two_factor_enabled: consumed.two_factor_enabled }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível atualizar a segurança da conta." }, { status: 503 });
  }
}
