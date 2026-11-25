import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomInt, randomUUID } from "node:crypto";
import { getServiceSupabase, getSupabaseEnv } from "../../../../lib/supabaseAdmin";

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `***${digits.slice(-4)}`;
}

export async function POST(request: NextRequest) {
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Supabase não configurado no servidor." }, { status: 500 });
  }

  try {
    const { email, password } = (await request.json()) as {
      email?: string;
      password?: string;
    };
    if (!email || !password) {
      return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });
    }

    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      return NextResponse.json({ error: error?.message || "Credenciais inválidas." }, { status: 401 });
    }

    // Verifica se o membro tem 2FA via WhatsApp ativado
    try {
      const service = getServiceSupabase();
      const { data: member } = await service
        .from("panel_members")
        .select("user_id, phone, two_factor_enabled")
        .eq("user_id", data.session.user.id)
        .maybeSingle();

      if (member?.two_factor_enabled && member.phone) {
        const code = String(randomInt(100000, 1000000));
        const tempToken = randomUUID();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await service
          .from("panel_members")
          .update({
            two_factor_code: code,
            two_factor_expires_at: expiresAt,
            two_factor_temp_token: tempToken,
          })
          .eq("user_id", member.user_id);

        await service.from("whatsapp_outbox").insert({
          phone: member.phone,
          kind: "2fa_code",
          status: "pending",
          message: `🔐 *Benittes Oficina — Código de acesso*\n\nSeu código 2FA é: *${code}*\nVálido por 10 minutos.`,
        });

        return NextResponse.json({
          requires2FA: true,
          tempToken,
          maskedPhone: maskPhone(member.phone),
        });
      }
    } catch {
      // Se as colunas 2FA ainda não existirem, segue o login normal
    }

    return NextResponse.json({ session: data.session });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao autenticar." },
      { status: 500 },
    );
  }
}
