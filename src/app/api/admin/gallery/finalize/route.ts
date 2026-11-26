import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse, invalidOriginResponse, isSameOriginRequest, readBoundedJson } from "../../../../../lib/security/http";
import { getServiceSupabase, hasPanelPermission, requirePanelStaff } from "../../../../../lib/supabaseAdmin";

const BUCKET = "site-gallery";
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function hasValidSignature(bytes: Uint8Array, mimeType: string) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (mimeType === "image/webp") {
    return bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  }
  if (mimeType === "video/webm") {
    return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  }
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
    return bytes.length >= 8 && ascii(4, 8) === "ftyp";
  }
  return false;
}

async function validateUploadedObject(service: ReturnType<typeof getServiceSupabase>, path: string, mimeType: string) {
  const url = service.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const response = await fetch(url, {
    headers: { Range: "bytes=0-15" },
    cache: "no-store",
  });
  if (response.status !== 206) {
    await response.body?.cancel().catch(() => {});
    return { ok: false as const };
  }

  const contentRange = response.headers.get("content-range") ?? "";
  const totalMatch = /^bytes 0-\d+\/(\d+)$/.exec(contentRange);
  const total = totalMatch ? Number(totalMatch[1]) : 0;
  const actualType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    ok: total > 0 && total <= MAX_FILE_BYTES && actualType === mimeType && hasValidSignature(bytes, mimeType),
  } as const;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!hasPanelPermission(staff.member, "gallery", "write")) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const parsed = await readBoundedJson<{ id?: unknown }>(request, 1024);
  if (!parsed.ok) return parsed.response;
  const id = typeof parsed.value?.id === "string" ? parsed.value.id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
  }

  const service = getServiceSupabase();
  const { data: item, error: itemError } = await service.from("site_gallery_media")
    .select("id,storage_path,mime_type,media_type,status")
    .eq("id", id)
    .maybeSingle();
  if (itemError) return databaseErrorResponse(itemError);
  if (!item || typeof item.storage_path !== "string") return NextResponse.json({ error: "Upload não encontrado." }, { status: 404 });
  if (item.status === "published") return NextResponse.json({ ok: true, id });
  if (item.status !== "uploading") return NextResponse.json({ error: "Este upload não pode ser finalizado." }, { status: 409 });

  let validation: { ok: boolean };
  try {
    validation = await validateUploadedObject(service, item.storage_path, item.mime_type);
  } catch {
    validation = { ok: false };
  }
  if (!validation.ok) {
    await service.storage.from(BUCKET).remove([item.storage_path]);
    await service.from("site_gallery_media").delete().eq("id", id).eq("status", "uploading");
    return NextResponse.json({ error: "O arquivo enviado não corresponde ao formato permitido ou excede 50 MB." }, { status: 400 });
  }

  const { error: updateError } = await service.from("site_gallery_media").update({
    status: "published",
    is_published: true,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("status", "uploading");
  if (updateError) return databaseErrorResponse(updateError);
  return NextResponse.json({ ok: true, id }, { headers: { "Cache-Control": "no-store" } });
}
