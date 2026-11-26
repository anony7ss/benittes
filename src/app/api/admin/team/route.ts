import { NextRequest, NextResponse } from "next/server";
import { clientAddress, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, readBoundedJson, rateLimitedResponse } from "../../../../lib/security/http";
import { getServiceSupabase, requirePanelStaff } from "../../../../lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff || staff.member.role !== "owner") {
    return NextResponse.json({ error: "Somente um proprietário pode criar contas." }, { status: 403 });
  }
  const parsed = await readBoundedJson<{ email?: unknown; full_name?: unknown; password?: unknown; role?: unknown }>(request, 4096);
  if (!parsed.ok) return parsed.response;

  const email = typeof parsed.value.email === "string" ? parsed.value.email.trim().toLowerCase() : "";
  const fullName = typeof parsed.value.full_name === "string" ? parsed.value.full_name.trim() : "";
  const password = typeof parsed.value.password === "string" ? parsed.value.password : "";
  const role = typeof parsed.value.role === "string" ? parsed.value.role : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
  }
  if (!fullName || fullName.length > 120) return NextResponse.json({ error: "Informe o nome completo." }, { status: 400 });
  if (password.length < 12 || password.length > 128) return NextResponse.json({ error: "A senha inicial deve ter entre 12 e 128 caracteres." }, { status: 400 });
  const { data: selectedRole, error: roleError } = await staff.supabase
    .from("panel_roles")
    .select("role_key")
    .eq("role_key", role)
    .maybeSingle();
  if (roleError) return NextResponse.json({ error: "Não foi possível validar o cargo. Aplique a migração de cargos configuráveis." }, { status: 503 });
  if (!selectedRole) return NextResponse.json({ error: "Cargo inválido." }, { status: 400 });

  try {
    if (!(await enforceRateLimits([
      { scope: "team-create-ip", subject: clientAddress(request), maxHits: 10, windowSeconds: 3600 },
      { scope: "team-create-owner", subject: staff.user.id, maxHits: 10, windowSeconds: 3600 },
    ]))) return rateLimitedResponse();

    const service = getServiceSupabase();
    const { data, error } = await service.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (error || !data.user) {
      return NextResponse.json({ error: error?.message.includes("already") ? "Já existe uma conta com este e-mail." : "Não foi possível criar a conta." }, { status: 400 });
    }
    const { data: member, error: insertError } = await service.from("panel_members").insert({
      user_id: data.user.id, email, full_name: fullName, role, active: true,
    }).select("user_id,email,full_name,role,active,created_at").single();
    if (insertError || !member) {
      await service.auth.admin.deleteUser(data.user.id);
      return NextResponse.json({ error: "Não foi possível vincular a conta à equipe." }, { status: 500 });
    }
    return NextResponse.json({ member }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Criação de conta temporariamente indisponível." }, { status: 503 });
  }
}
