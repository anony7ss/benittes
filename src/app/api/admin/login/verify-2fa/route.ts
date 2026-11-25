import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceSupabase, getSupabaseEnv } from "../../../../../lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  const { url, anonKey } = getSupabaseEnv();
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    tempToken?: string;
    code?: string;
  };

  const cleanCode = String(body.code || "").replace(/\D/g, "");
  if (!body.email || !body.password || !body.tempToken || cleanCode.length !== 6) {
    return NextResponse.json({ error: "Informe o código de 6 dígitos." }, { status: 400 });
  }

  const service = getServiceSupabase();
  const { data: member } = await service
    .from("panel_members")
    .select("*")
    .eq("email", body.email.trim().toLowerCase())
    .eq("two_factor_temp_token", body.tempToken)
    .maybeSingle();

  if (!member || member.two_factor_code !== cleanCode) {
    return NextResponse.json({ error: "Código 2FA inválido." }, { status: 401 });
  }

  if (
    !member.two_factor_expires_at ||
    new Date(member.two_factor_expires_at).getTime() < Date.now()
  ) {
    return NextResponse.json({ error: "Código 2FA expirado. Solicite um novo código." }, { status: 401 });
  }

  const anonClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anonClient.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });

  if (error || !data.session) {
    return NextResponse.json({ error: error?.message || "Credenciais inválidas." }, { status: 401 });
  }

  await service
    .from("panel_members")
    .update({
      two_factor_code: null,
      two_factor_expires_at: null,
      two_factor_temp_token: null,
    })
    .eq("user_id", member.user_id);

  return NextResponse.json({ session: data.session });
}
