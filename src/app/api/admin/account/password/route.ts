import { NextRequest, NextResponse } from "next/server";
import { invalidOriginResponse, isSameOriginRequest, readBoundedJson } from "../../../../../lib/security/http";
import { requirePanelStaff } from "../../../../../lib/supabaseAdmin";

export async function PUT(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const parsed = await readBoundedJson<{ password?: unknown }>(request, 2 * 1024);
  if (!parsed.ok) return parsed.response;
  const password = typeof parsed.value?.password === "string" ? parsed.value.password : "";
  if (password.length < 12 || password.length > 128) {
    return NextResponse.json({ error: "A senha deve ter entre 12 e 128 caracteres." }, { status: 400 });
  }

  const { error } = await staff.supabase.auth.updateUser({ password });
  if (error) {
    return NextResponse.json({ error: "Não foi possível atualizar a senha." }, { status: 400 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
