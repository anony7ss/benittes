import { NextRequest, NextResponse } from "next/server";
import { PANEL_PERMISSION_MODULES, normalizePanelPermissions } from "../../../../admin/permissions";
import { databaseErrorResponse, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, readBoundedJson, rateLimitedResponse } from "../../../../lib/security/http";
import { requirePanelStaff } from "../../../../lib/supabaseAdmin";

const allowedKeys = new Set<string>(PANEL_PERMISSION_MODULES.map(({ key }) => key));

async function rateLimit(request: NextRequest, userId: string) {
  return enforceRateLimits([
    { scope: "panel-roles-user", subject: userId, maxHits: 40, windowSeconds: 3600 },
  ]).catch(() => false);
}

export async function GET(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (staff.member.role !== "owner") return NextResponse.json({ error: "Apenas o proprietário pode gerenciar cargos." }, { status: 403 });
  const { data, error } = await staff.supabase
    .from("panel_roles")
    .select("role_key,name,permissions,is_system,created_at,updated_at")
    .order("is_system", { ascending: false })
    .order("name", { ascending: true });
  if (error) return databaseErrorResponse(error);
  return NextResponse.json({ roles: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (staff.member.role !== "owner") return NextResponse.json({ error: "Apenas o proprietário pode criar cargos." }, { status: 403 });
  if (!(await rateLimit(request, staff.user.id))) return rateLimitedResponse();
  const parsed = await readBoundedJson<{ name?: unknown; permissions?: unknown }>(request, 16 * 1024);
  if (!parsed.ok) return parsed.response;
  const name = typeof parsed.value.name === "string" ? parsed.value.name.trim() : "";
  const permissions = normalizePanelPermissions(parsed.value.permissions);
  if (name.length < 2 || name.length > 60) return NextResponse.json({ error: "O nome do cargo precisa ter entre 2 e 60 caracteres." }, { status: 400 });
  if (!permissions || Object.keys(permissions).some((key) => key !== "*" && !allowedKeys.has(key))) {
    return NextResponse.json({ error: "Selecione permissões válidas para o cargo." }, { status: 400 });
  }
  const roleKey = `custom_${crypto.randomUUID().replaceAll("-", "")}`;
  const { data, error } = await staff.supabase.from("panel_roles").insert({
    role_key: roleKey,
    name,
    permissions,
    is_system: false,
    created_by: staff.user.id,
  }).select("role_key,name,permissions,is_system,created_at,updated_at").single();
  if (error) return databaseErrorResponse(error);
  return NextResponse.json({ role: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (staff.member.role !== "owner") return NextResponse.json({ error: "Apenas o proprietário pode editar cargos." }, { status: 403 });
  if (!(await rateLimit(request, staff.user.id))) return rateLimitedResponse();
  const parsed = await readBoundedJson<{ role_key?: unknown; name?: unknown; permissions?: unknown }>(request, 16 * 1024);
  if (!parsed.ok) return parsed.response;
  const roleKey = typeof parsed.value.role_key === "string" ? parsed.value.role_key.trim() : "";
  const name = typeof parsed.value.name === "string" ? parsed.value.name.trim() : "";
  const permissions = normalizePanelPermissions(parsed.value.permissions);
  if (!roleKey || roleKey === "owner") return NextResponse.json({ error: "O cargo de proprietário é fixo e não pode ser alterado." }, { status: 400 });
  if (name.length < 2 || name.length > 60) return NextResponse.json({ error: "O nome do cargo precisa ter entre 2 e 60 caracteres." }, { status: 400 });
  if (!permissions || Object.keys(permissions).some((key) => key !== "*" && !allowedKeys.has(key))) {
    return NextResponse.json({ error: "Selecione permissões válidas para o cargo." }, { status: 400 });
  }
  const { data, error } = await staff.supabase.from("panel_roles").update({ name, permissions })
    .eq("role_key", roleKey)
    .select("role_key,name,permissions,is_system,created_at,updated_at")
    .maybeSingle();
  if (error) return databaseErrorResponse(error);
  if (!data) return NextResponse.json({ error: "Cargo não encontrado." }, { status: 404 });
  return NextResponse.json({ role: data });
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (staff.member.role !== "owner") return NextResponse.json({ error: "Apenas o proprietário pode excluir cargos." }, { status: 403 });
  if (!(await rateLimit(request, staff.user.id))) return rateLimitedResponse();
  const roleKey = request.nextUrl.searchParams.get("role_key")?.trim() ?? "";
  if (!roleKey || roleKey === "owner") return NextResponse.json({ error: "Cargo inválido." }, { status: 400 });
  const { data: role, error: roleError } = await staff.supabase.from("panel_roles").select("is_system").eq("role_key", roleKey).maybeSingle();
  if (roleError) return databaseErrorResponse(roleError);
  if (!role) return NextResponse.json({ error: "Cargo não encontrado." }, { status: 404 });
  if (role.is_system) return NextResponse.json({ error: "Os cargos padrão podem ser editados, mas não excluídos." }, { status: 409 });
  const { error } = await staff.supabase.from("panel_roles").delete().eq("role_key", roleKey);
  if (error) {
    if (error.code === "23503") return NextResponse.json({ error: "Remova ou altere o cargo dos membros vinculados antes de excluí-lo." }, { status: 409 });
    return databaseErrorResponse(error);
  }
  return NextResponse.json({ ok: true });
}
