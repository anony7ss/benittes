import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse, invalidOriginResponse, isSameOriginRequest, readBoundedJson } from "../../../../../lib/security/http";
import { getServiceSupabase, hasPanelPermission, requirePanelStaff } from "../../../../../lib/supabaseAdmin";

const BUCKET = "site-gallery";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorize(request: NextRequest, access: "read" | "write") {
  const staff = await requirePanelStaff(request);
  if (!staff) return { response: NextResponse.json({ error: "Não autorizado." }, { status: 401 }) };
  if (!hasPanelPermission(staff.member, "gallery", access)) {
    return { response: NextResponse.json({ error: "Acesso negado." }, { status: 403 }) };
  }
  return { staff };
}

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const access = await authorize(request, "write");
  if (access.response) return access.response;
  const parsed = await readBoundedJson<Record<string, unknown>>(request, 24 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  const service = getServiceSupabase();

  if (body.action === "move") {
    const id = typeof body.id === "string" ? body.id : "";
    const scope = body.scope;
    const direction = body.direction;
    if (!UUID_RE.test(id) || (scope !== "gallery" && scope !== "home") || (direction !== "up" && direction !== "down")) {
      return NextResponse.json({ error: "Ordem inválida." }, { status: 400 });
    }
    const { data: current, error: currentError } = await service.from("site_gallery_media")
      .select("id,media_type,show_on_home,gallery_order,home_order")
      .eq("status", "published")
      .eq("is_published", true)
      .order(scope === "home" ? "home_order" : "gallery_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (currentError) return databaseErrorResponse(currentError);
    const ordered = scope === "home"
      ? (current ?? []).filter((item) => item.media_type === "image" && item.show_on_home)
      : (current ?? []);
    const index = ordered.findIndex((item) => item.id === id);
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0) return NextResponse.json({ error: "Item não encontrado na sequência." }, { status: 404 });
    if (nextIndex < 0 || nextIndex >= ordered.length) return NextResponse.json({ ok: true });
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];

    const orderColumn = scope === "home" ? "home_order" : "gallery_order";
    for (const [position, item] of ordered.entries()) {
      const { error } = await service.from("site_gallery_media")
        .update({ [orderColumn]: position + 1, updated_at: new Date().toISOString() })
        .eq("id", item.id);
      if (error) return databaseErrorResponse(error);
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }

  if (body.action !== "update") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const id = typeof body.id === "string" ? body.id : "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Item inválido." }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 120) {
      return NextResponse.json({ error: "O título deve ter de 1 a 120 caracteres." }, { status: 400 });
    }
    patch.title = body.title.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  }
  if (body.alt_text !== undefined) {
    if (typeof body.alt_text !== "string" || body.alt_text.length > 240) return NextResponse.json({ error: "O texto alternativo pode ter até 240 caracteres." }, { status: 400 });
    patch.alt_text = body.alt_text.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  }
  if (body.caption !== undefined) {
    if (typeof body.caption !== "string" || body.caption.length > 500) return NextResponse.json({ error: "A legenda pode ter até 500 caracteres." }, { status: 400 });
    patch.caption = body.caption.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  }
  if (body.is_published !== undefined) {
    if (typeof body.is_published !== "boolean") return NextResponse.json({ error: "Estado de publicação inválido." }, { status: 400 });
    if (body.is_published) {
      const { data: current, error: currentError } = await service.from("site_gallery_media")
        .select("status,is_published")
        .eq("id", id)
        .maybeSingle();
      if (currentError) return databaseErrorResponse(currentError);
      if (!current || current.status !== "published") {
        return NextResponse.json({ error: "Finalize o envio antes de publicar este arquivo." }, { status: 409 });
      }
      if (!current.is_published) {
        const { data: last, error } = await service.from("site_gallery_media")
          .select("gallery_order")
          .eq("status", "published")
          .eq("is_published", true)
          .order("gallery_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) return databaseErrorResponse(error);
        patch.gallery_order = Number(last?.gallery_order ?? 0) + 1;
      }
    }
    patch.is_published = body.is_published;
    if (!body.is_published) patch.show_on_home = false;
  }
  if (body.show_on_home !== undefined) {
    if (typeof body.show_on_home !== "boolean") return NextResponse.json({ error: "Estado de destaque inválido." }, { status: 400 });
    if (body.show_on_home) {
      const { data: item, error } = await service.from("site_gallery_media").select("media_type,is_published,status,show_on_home").eq("id", id).maybeSingle();
      if (error) return databaseErrorResponse(error);
      if (!item || item.media_type !== "image" || !item.is_published || item.status !== "published") {
        return NextResponse.json({ error: "A home aceita apenas fotos publicadas." }, { status: 400 });
      }
      if (!item.show_on_home) {
        const { data: last, error: orderError } = await service.from("site_gallery_media")
          .select("home_order")
          .eq("status", "published")
          .eq("is_published", true)
          .eq("show_on_home", true)
          .order("home_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (orderError) return databaseErrorResponse(orderError);
        patch.home_order = Number(last?.home_order ?? 0) + 1;
      }
    }
    patch.show_on_home = body.is_published === false ? false : body.show_on_home;
  }

  const { data, error } = await service.from("site_gallery_media").update(patch).eq("id", id).select("id").maybeSingle();
  if (error) return databaseErrorResponse(error);
  if (!data) return NextResponse.json({ error: "Item não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const access = await authorize(request, "write");
  if (access.response) return access.response;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Item inválido." }, { status: 400 });

  const service = getServiceSupabase();
  const { data: item, error: itemError } = await service.from("site_gallery_media")
    .select("id,asset_source,storage_path")
    .eq("id", id)
    .maybeSingle();
  if (itemError) return databaseErrorResponse(itemError);
  if (!item) return NextResponse.json({ error: "Item não encontrado." }, { status: 404 });

  await service.from("site_gallery_media").update({ is_published: false, show_on_home: false }).eq("id", id);
  if (item.asset_source === "storage" && item.storage_path) {
    const { error } = await service.storage.from(BUCKET).remove([item.storage_path]);
    if (error) return NextResponse.json({ error: "O item foi ocultado, mas o arquivo não pôde ser removido. Tente novamente." }, { status: 503 });
  }
  const { error } = await service.from("site_gallery_media").delete().eq("id", id);
  if (error) return databaseErrorResponse(error);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
