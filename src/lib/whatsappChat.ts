import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, hasPanelPermission, normalizeBrPhone, requirePanelStaff } from "./supabaseAdmin";
import { clientAddress, enforceRateLimits, rateLimitedResponse } from "./security/http";

export const WHATSAPP_CHAT_BUCKET = "whatsapp-chat-media";
export const CHAT_NO_STORE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export function normalizeChatPhone(value: unknown): string {
  return typeof value === "string" ? normalizeBrPhone(value) : "";
}

export function isValidChatPhone(phone: string): boolean {
  return /^55\d{10,11}$/.test(phone);
}

export async function authorizeChat(
  request: NextRequest,
  access: "read" | "write",
) {
  const staff = await requirePanelStaff(request);
  if (!staff) {
    return { response: NextResponse.json({ error: "Não autorizado." }, { status: 401, headers: CHAT_NO_STORE }) } as const;
  }
  if (!hasPanelPermission(staff.member, "chat", access)) {
    return { response: NextResponse.json({ error: "Acesso negado ao Chat." }, { status: 403, headers: CHAT_NO_STORE }) } as const;
  }
  return { staff } as const;
}

export async function applyChatRateLimit(
  request: NextRequest,
  staff: NonNullable<Awaited<ReturnType<typeof requirePanelStaff>>>,
  scope: string,
  userLimit = 60,
) {
  try {
    const allowed = await enforceRateLimits([
      { scope: `chat-${scope}-user`, subject: staff.user.id, maxHits: userLimit, windowSeconds: 60 },
      { scope: `chat-${scope}-ip`, subject: clientAddress(request), maxHits: userLimit * 2, windowSeconds: 60 },
    ]);
    return allowed ? null : rateLimitedResponse();
  } catch {
    return NextResponse.json({ error: "Chat temporariamente indisponível." }, { status: 503, headers: CHAT_NO_STORE });
  }
}

export function validPauseMinutes(value: unknown): value is 0 | 15 | 30 | 60 | 240 | 1440 | 10080 {
  return value === 0 || value === 15 || value === 30 || value === 60 || value === 240 || value === 1440 || value === 10080;
}

export function pauseUntil(minutes: number): string | null {
  return minutes === 0 ? null : new Date(Date.now() + minutes * 60_000).toISOString();
}

export function mediaUrlForStoragePath(path: unknown, type?: unknown): string | null {
  if (typeof path !== "string" || !/^[0-9]{12,13}\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif|ogg|opus|mp3|m4a|webm|mp4)$/i.test(path)) return null;
  const kind = type === "image" || type === "audio" || type === "video" ? `&type=${type}` : "";
  return `/api/admin/chat/media?path=${encodeURIComponent(path)}${kind}`;
}

export function sniffChatMedia(bytes: Uint8Array): { mediaType: "image" | "audio" | "video"; mime: string; extension: string } | null {
  const b = Buffer.from(bytes);
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mediaType: "image", mime: "image/jpeg", extension: "jpg" };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mediaType: "image", mime: "image/png", extension: "png" };
  if (b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return { mediaType: "image", mime: "image/webp", extension: "webp" };
  if (b.subarray(0, 4).toString("ascii") === "GIF8") return { mediaType: "image", mime: "image/gif", extension: "gif" };
  if (b.subarray(0, 4).toString("ascii") === "OggS") return { mediaType: "audio", mime: "audio/ogg", extension: "ogg" };
  if (b.subarray(0, 3).toString("ascii") === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { mediaType: "audio", mime: "audio/mpeg", extension: "mp3" };
  if (b.subarray(4, 8).toString("ascii") === "ftyp") return { mediaType: "audio", mime: "audio/mp4", extension: "m4a" };
  if (b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { mediaType: "audio", mime: "audio/webm", extension: "webm" };
  return null;
}

export function chatMediaDisplayMime(info: { mediaType: string; mime: string }, expectedType?: string) {
  if (expectedType === "video" && info.mime === "audio/mp4") return "video/mp4";
  if (expectedType === "video" && info.mime === "audio/webm") return "video/webm";
  return info.mime;
}

export async function getChatStorage() {
  return getServiceSupabase().storage.from(WHATSAPP_CHAT_BUCKET);
}
