import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  applyChatRateLimit,
  authorizeChat,
  CHAT_NO_STORE,
  getChatStorage,
  isValidChatPhone,
  normalizeChatPhone,
  pauseUntil,
  sniffChatMedia,
  validPauseMinutes,
} from "../../../../../lib/whatsappChat";
import { getServiceSupabase } from "../../../../../lib/supabaseAdmin";
import { databaseErrorResponse, invalidOriginResponse, isSameOriginRequest, readBoundedJson } from "../../../../../lib/security/http";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/webm": "webm",
};
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const AUDIO_MIME = new Set(["audio/ogg", "audio/opus", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/webm"]);
const VIDEO_MIME = new Set(["video/mp4", "video/webm"]);

function isAllowedType(type: string, mime: string) {
  return type === "image" ? IMAGE_MIME.has(mime) : type === "audio" ? AUDIO_MIME.has(mime) : type === "video" ? VIDEO_MIME.has(mime) : false;
}

function validMediaPath(phone: string, path: unknown) {
  return typeof path === "string" && new RegExp(`^${phone}/[0-9a-f-]{36}\\.(jpg|png|webp|gif|ogg|opus|mp3|m4a|webm|mp4)$`, "i").test(path);
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const auth = await authorizeChat(request, "write");
  if ("response" in auth) return auth.response;
  const rateError = await applyChatRateLimit(request, auth.staff, "upload-sign", 20);
  if (rateError) return rateError;
  const parsed = await readBoundedJson<{ phone?: unknown; type?: unknown; mime?: unknown; size?: unknown }>(request, 4 * 1024);
  if (!parsed.ok) return parsed.response;

  const phone = normalizeChatPhone(parsed.value.phone);
  const type = parsed.value.type;
  const mime = typeof parsed.value.mime === "string" ? parsed.value.mime.toLowerCase().split(";", 1)[0].trim() : "";
  const size = Number(parsed.value.size);
  if (!isValidChatPhone(phone) || typeof type !== "string" || !isAllowedType(type, mime) || !Number.isInteger(size) || size <= 0 || size > MAX_MEDIA_BYTES) {
    return NextResponse.json({ error: "Tipo ou tamanho do arquivo não permitido. O limite é 16 MB." }, { status: 400, headers: CHAT_NO_STORE });
  }

  const id = randomUUID();
  const path = `${phone}/${id}.${MIME_EXTENSIONS[mime]}`;
  const storage = await getChatStorage();
  const { data, error } = await storage.createSignedUploadUrl(path, { upsert: false });
  if (error || !data) return NextResponse.json({ error: "Não foi possível preparar o envio do arquivo." }, { status: 503, headers: CHAT_NO_STORE });
  return NextResponse.json({ path, token: data.token, type, mime }, { headers: CHAT_NO_STORE });
}

export async function PUT(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const auth = await authorizeChat(request, "write");
  if ("response" in auth) return auth.response;
  const rateError = await applyChatRateLimit(request, auth.staff, "upload-finalize", 20);
  if (rateError) return rateError;
  const parsed = await readBoundedJson<{
    phone?: unknown;
    path?: unknown;
    type?: unknown;
    caption?: unknown;
    pauseMinutes?: unknown;
  }>(request, 5 * 1024);
  if (!parsed.ok) return parsed.response;
  const phone = normalizeChatPhone(parsed.value.phone);
  const type = parsed.value.type;
  const caption = typeof parsed.value.caption === "string" ? parsed.value.caption.trim() : "";
  const pauseMinutes = parsed.value.pauseMinutes;
  if (!isValidChatPhone(phone) || !validMediaPath(phone, parsed.value.path) || !["image", "audio", "video"].includes(String(type)) || caption.length > 1000 || !validPauseMinutes(pauseMinutes)) {
    return NextResponse.json({ error: "Revise os dados do arquivo e da conversa." }, { status: 400, headers: CHAT_NO_STORE });
  }
  const path = String(parsed.value.path);
  const uuid = path.split("/").at(-1)?.split(".", 1)[0] ?? "";
  if (!UUID_RE.test(uuid)) return NextResponse.json({ error: "Arquivo inválido." }, { status: 400, headers: CHAT_NO_STORE });
  const supabase = getServiceSupabase();
  const dedupeKey = `chat-media:${auth.staff.user.id}:${uuid}`;
  const { data: alreadyQueued } = await supabase.from("whatsapp_outbox").select("id,status").eq("dedupe_key", dedupeKey).maybeSingle();
  if (alreadyQueued) {
    const { data: previousMessage } = await supabase.from("whatsapp_messages").select("id,phone,direction,sender_name,body,media_type,media_url,status,created_at").eq("outbox_id", alreadyQueued.id).maybeSingle();
    return NextResponse.json({ ok: true, duplicate: true, status: alreadyQueued.status, message: previousMessage }, { headers: CHAT_NO_STORE });
  }

  const storage = await getChatStorage();
  const { data: file, error: downloadError } = await storage.download(path);
  if (downloadError || !file || file.size <= 0 || file.size > MAX_MEDIA_BYTES) {
    return NextResponse.json({ error: "Não foi possível validar o arquivo enviado." }, { status: 400, headers: CHAT_NO_STORE });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const detected = sniffChatMedia(bytes);
  const expectedType = String(type);
  const extension = path.split(".").at(-1)?.toLowerCase();
  const imageExtension = ["jpg", "png", "webp", "gif"].includes(String(extension));
  const audioExtension = ["ogg", "opus", "mp3", "m4a"].includes(String(extension));
  const videoExtension = ["mp4"].includes(String(extension)) || (extension === "webm" && expectedType === "video");
  if (!detected ||
    (expectedType === "image" && (!imageExtension || detected.mediaType !== "image")) ||
    (expectedType === "audio" && (!audioExtension && extension !== "webm" || !["audio", "video"].includes(detected.mediaType))) ||
    (expectedType === "video" && (!videoExtension || !["audio", "video"].includes(detected.mediaType)))
  ) {
    await storage.remove([path]);
    return NextResponse.json({ error: "O conteúdo do arquivo não corresponde ao tipo escolhido." }, { status: 415, headers: CHAT_NO_STORE });
  }

  const mediaType = expectedType;
  const body = caption || (mediaType === "image" ? "[Imagem enviada]" : mediaType === "audio" ? "🎤 Áudio enviado" : "[Vídeo enviado]");
  const { data: outbox, error: outboxError } = await supabase.from("whatsapp_outbox").insert({
    phone,
    message: caption,
    media_url: `storage://${path}`,
    media_type: mediaType,
    kind: "chat_manual",
    // Stage the outbox row so the worker cannot send before history and pause
    // state are recorded. It becomes pending as the final step below.
    status: "cancelled",
    dedupe_key: dedupeKey,
    ai_pause_minutes: pauseMinutes,
    created_by: auth.staff.user.id,
  }).select("id").single();
  if (outboxError || !outbox) return databaseErrorResponse(outboxError ?? { code: "" });

  const { error: pauseError } = await supabase.from("whatsapp_chat_control").upsert({
    phone,
    ai_paused: true,
    ai_paused_until: pauseUntil(pauseMinutes),
    updated_at: new Date().toISOString(),
  }, { onConflict: "phone" });
  if (pauseError) {
    return NextResponse.json({ error: "Não foi possível pausar a resposta automática com segurança." }, { status: 503, headers: CHAT_NO_STORE });
  }

  const { data: message, error: messageError } = await supabase.from("whatsapp_messages").insert({
    phone,
    direction: "outgoing",
    sender_name: auth.staff.member.full_name || auth.staff.user.email || "Equipe",
    body,
    media_type: mediaType,
    media_url: path,
    status: "queued",
    outbox_id: outbox.id,
  }).select("id,phone,direction,sender_name,body,media_type,media_url,status,created_at").single();
  if (messageError) {
    await supabase.from("whatsapp_outbox").update({ error: "Mídia não pôde ser exibida no histórico." }).eq("id", outbox.id).eq("status", "cancelled");
    return databaseErrorResponse(messageError);
  }
  const { error: releaseError } = await supabase.from("whatsapp_outbox").update({ status: "pending" }).eq("id", outbox.id).eq("status", "cancelled");
  if (releaseError) {
    await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("outbox_id", outbox.id);
    return NextResponse.json({ error: "Arquivo preparado, mas não foi possível iniciar o envio. Tente novamente." }, { status: 503, headers: CHAT_NO_STORE });
  }
  return NextResponse.json({ ok: true, outboxId: outbox.id, queued: true, message: { ...message, media_url: `/api/admin/chat/media?path=${encodeURIComponent(path)}&type=${mediaType}` } }, { headers: CHAT_NO_STORE });
}
