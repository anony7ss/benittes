import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse, clientAddress, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, rateLimitedResponse, readBoundedJson } from "../../../../../lib/security/http";
import { getServiceSupabase, getSupabaseEnv, hasPanelPermission, requirePanelStaff } from "../../../../../lib/supabaseAdmin";

const BUCKET = "agent-chat-private";
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/opus": "opus", "audio/mp4": "m4a",
  "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function kindForMime(mimeType: string) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "";
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!hasPanelPermission(staff.member, "agents", "read")) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const limited = await enforceRateLimits([
    { scope: "agents-upload-user", subject: staff.user.id, maxHits: 60, windowSeconds: 3600 },
    { scope: "agents-upload-ip", subject: clientAddress(request), maxHits: 100, windowSeconds: 3600 },
  ]).catch(() => null);
  if (limited === null) return NextResponse.json({ error: "Envio de anexos temporariamente indisponível." }, { status: 503 });
  if (!limited) return rateLimitedResponse();

  const parsed = await readBoundedJson<Record<string, unknown>>(request, 2048);
  if (!parsed.ok) return parsed.response;
  const conversationId = typeof parsed.value.conversation_id === "string" ? parsed.value.conversation_id : "";
  const mimeType = typeof parsed.value.mime_type === "string" ? parsed.value.mime_type.toLowerCase().split(";", 1)[0] : "";
  const declaredSize = parsed.value.size;
  const declaredKind = parsed.value.kind;
  const kind = kindForMime(mimeType);
  if (!UUID_RE.test(conversationId)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  if (!kind || !MIME_EXTENSIONS[mimeType] || (declaredKind !== kind && !(declaredKind === "video-frame" && kind === "image"))) {
    return NextResponse.json({ error: "Formato de anexo não permitido." }, { status: 415 });
  }
  const maxBytes = kind === "video" ? 50 * 1024 * 1024 : kind === "audio" ? 15 * 1024 * 1024 : declaredKind === "video-frame" ? 512 * 1024 : 10 * 1024 * 1024;
  if (typeof declaredSize !== "number" || !Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > maxBytes) {
    return NextResponse.json({ error: `Este anexo excede o limite de ${Math.round(maxBytes / 1024 / 1024)} MB.` }, { status: 413 });
  }

  const service = getServiceSupabase();
  const { data: conversation, error: conversationError } = await service.from("panel_agent_conversations")
    .select("id,agent_key").eq("id", conversationId).eq("user_id", staff.user.id).maybeSingle();
  if (conversationError) return databaseErrorResponse(conversationError);
  if (!conversation) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  const { data: profile } = await service.from("panel_agent_profiles").select("enabled").eq("agent_key", conversation.agent_key).maybeSingle();
  if (!profile?.enabled) return NextResponse.json({ error: "Este agente está desativado." }, { status: 409 });

  const path = `${staff.user.id}/${conversationId}/${randomUUID()}.${MIME_EXTENSIONS[mimeType]}`;
  const { data: signed, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (error || !signed?.signedUrl) return NextResponse.json({ error: "Não foi possível preparar o envio." }, { status: 503 });
  const { anonKey } = getSupabaseEnv();
  return NextResponse.json({
    path,
    kind: declaredKind,
    mime_type: mimeType,
    upload_url: signed.signedUrl,
    upload_headers: anonKey ? { apikey: anonKey, authorization: `Bearer ${anonKey}` } : {},
  }, { headers: { "Cache-Control": "no-store" } });
}
