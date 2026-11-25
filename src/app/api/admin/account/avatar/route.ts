import { NextRequest, NextResponse } from "next/server";
import { invalidOriginResponse, isSameOriginRequest, readBoundedJson } from "../../../../../lib/security/http";
import { getServiceSupabase, requirePanelStaff } from "../../../../../lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { data, error } = await getServiceSupabase().from("panel_member_avatars")
    .select("photo").eq("user_id", staff.user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Erro ao carregar a foto." }, { status: 503 });
  return NextResponse.json({ avatar: data }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = await readBoundedJson<{ photo?: unknown }>(request, 66 * 1024);
  if (!body.ok) return body.response;
  const photo = body.value?.photo;
  if (photo !== null && (typeof photo !== "string" || photo.length > 65536 ||
      !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(photo))) {
    return NextResponse.json({ error: "Foto inválida." }, { status: 400 });
  }
  const { error } = await getServiceSupabase().from("panel_member_avatars")
    .upsert({ user_id: staff.user.id, photo });
  if (error) return NextResponse.json({ error: "Erro ao salvar a foto." }, { status: 503 });
  return new Response(null, { status: 204 });
}
