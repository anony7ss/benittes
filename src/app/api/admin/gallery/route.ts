import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  clientAddress,
  databaseErrorResponse,
  enforceRateLimits,
  invalidOriginResponse,
  isSameOriginRequest,
  rateLimitedResponse,
  readBoundedJson,
} from "../../../../lib/security/http";
import { getServiceSupabase, hasPanelPermission, getSupabaseEnv, requirePanelStaff } from "../../../../lib/supabaseAdmin";

const BUCKET = "site-gallery";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const FILE_TYPES: Record<string, { mediaType: "image" | "video"; extension: string }> = {
  "image/webp": { mediaType: "image", extension: "webp" },
  "video/mp4": { mediaType: "video", extension: "mp4" },
  "video/webm": { mediaType: "video", extension: "webm" },
  "video/quicktime": { mediaType: "video", extension: "mov" },
};

function cleanText(value: unknown, limit: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function assetUrl(service: ReturnType<typeof getServiceSupabase>, row: Record<string, unknown>) {
  if (row.asset_source === "local" && typeof row.local_path === "string") return row.local_path;
  if (typeof row.storage_path !== "string") return "";
  return service.storage.from(BUCKET).getPublicUrl(row.storage_path).data.publicUrl;
}

export async function GET(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!hasPanelPermission(staff.member, "gallery", "read")) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const service = getServiceSupabase();
  const { data, error } = await service
    .from("site_gallery_media")
    .select("id,title,alt_text,caption,media_type,mime_type,asset_source,storage_path,local_path,status,is_published,show_on_home,gallery_order,home_order,created_at")
    .eq("status", "published")
    .order("gallery_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return databaseErrorResponse(error);

  const items = (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    alt_text: row.alt_text,
    caption: row.caption,
    media_type: row.media_type,
    mime_type: row.mime_type,
    asset_source: row.asset_source,
    status: row.status,
    is_published: row.is_published,
    show_on_home: row.show_on_home,
    gallery_order: row.gallery_order,
    home_order: row.home_order,
    url: assetUrl(service, row as Record<string, unknown>),
    created_at: row.created_at,
  }));

  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!hasPanelPermission(staff.member, "gallery", "write")) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  try {
    const allowed = await enforceRateLimits([
      { scope: "gallery-upload-user", subject: staff.user.id, maxHits: 30, windowSeconds: 3600 },
      { scope: "gallery-upload-ip", subject: clientAddress(request), maxHits: 50, windowSeconds: 3600 },
    ]);
    if (!allowed) return rateLimitedResponse();
  } catch {
    return NextResponse.json({ error: "Uploads temporariamente indisponíveis." }, { status: 503 });
  }

  const parsed = await readBoundedJson<Record<string, unknown>>(request, 4 * 1024);
  if (!parsed.ok) return parsed.response;

  const mimeType = typeof parsed.value?.mime_type === "string" ? parsed.value.mime_type.toLowerCase() : "";
  const type = FILE_TYPES[mimeType];
  const size = parsed.value?.size;
  const mediaType = parsed.value?.media_type;
  const title = cleanText(parsed.value?.title, 120);
  const altText = cleanText(parsed.value?.alt_text, 240, title);
  const caption = cleanText(parsed.value?.caption, 500);

  if (!type || mediaType !== type.mediaType) {
    return NextResponse.json({ error: "Formato de foto ou vídeo não permitido." }, { status: 400 });
  }
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "Cada foto ou vídeo pode ter no máximo 50 MB." }, { status: 413 });
  }
  if (!title) return NextResponse.json({ error: "Informe um título para o arquivo." }, { status: 400 });

  const service = getServiceSupabase();
  const id = randomUUID();
  const storagePath = `${id}.${type.extension}`;
  const [{ data: lastGallery }, { data: lastHome }] = await Promise.all([
    service.from("site_gallery_media").select("gallery_order").eq("status", "published").order("gallery_order", { ascending: false }).limit(1).maybeSingle(),
    type.mediaType === "image"
      ? service.from("site_gallery_media").select("home_order").eq("status", "published").eq("show_on_home", true).order("home_order", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { error: insertError } = await service.from("site_gallery_media").insert({
    id,
    title,
    alt_text: altText,
    caption,
    media_type: type.mediaType,
    mime_type: mimeType,
    asset_source: "storage",
    storage_path: storagePath,
    status: "uploading",
    is_published: false,
    show_on_home: false,
    gallery_order: Number(lastGallery?.gallery_order ?? 0) + 1,
    home_order: Number(lastHome?.home_order ?? 0) + 1,
    created_by: staff.user.id,
  });
  if (insertError) return databaseErrorResponse(insertError);

  const { error: signedError, data: signed } = await service.storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (signedError || !signed?.signedUrl) {
    await service.from("site_gallery_media").delete().eq("id", id);
    return NextResponse.json({ error: "Não foi possível preparar o envio do arquivo." }, { status: 503 });
  }

  const { anonKey } = getSupabaseEnv();
  return NextResponse.json({
    id,
    upload_url: signed.signedUrl,
    upload_headers: anonKey ? { apikey: anonKey, authorization: `Bearer ${anonKey}` } : {},
  }, { headers: { "Cache-Control": "no-store" } });
}
