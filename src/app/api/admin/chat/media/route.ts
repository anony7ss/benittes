import { NextRequest, NextResponse } from "next/server";
import { authorizeChat, CHAT_NO_STORE, getChatStorage, isValidChatPhone, normalizeChatPhone, sniffChatMedia } from "../../../../../lib/whatsappChat";

export async function GET(request: NextRequest) {
  const auth = await authorizeChat(request, "read");
  if ("response" in auth) return auth.response;
  const path = request.nextUrl.searchParams.get("path") ?? "";
  const type = request.nextUrl.searchParams.get("type") ?? "";
  const phone = normalizeChatPhone(path.split("/", 1)[0]);
  if (!isValidChatPhone(phone) || phone !== path.split("/", 1)[0] || !["image", "audio", "video"].includes(type) || !/^[0-9a-f-]{36}\.(jpg|png|webp|gif|ogg|opus|mp3|m4a|webm|mp4)$/i.test(path.split("/").at(-1) ?? "")) {
    return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404, headers: CHAT_NO_STORE });
  }

  const storage = await getChatStorage();
  const { data, error } = await storage.download(path);
  if (error || !data || data.size > 16 * 1024 * 1024) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404, headers: CHAT_NO_STORE });
  const bytes = Buffer.from(await data.arrayBuffer());
  const detected = sniffChatMedia(bytes);
  const extension = path.split(".").at(-1)?.toLowerCase();
  const image = detected?.mediaType === "image" && ["jpg", "png", "webp", "gif"].includes(String(extension));
  const audio = ["audio", "video"].includes(detected?.mediaType ?? "") && ["ogg", "opus", "mp3", "m4a", "webm"].includes(String(extension));
  const video = ["audio", "video"].includes(detected?.mediaType ?? "") && ["mp4", "webm"].includes(String(extension));
  if (!detected || (type === "image" && !image) || (type === "audio" && !audio) || (type === "video" && !video)) {
    return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404, headers: CHAT_NO_STORE });
  }

  const contentType = type === "video"
    ? extension === "webm" ? "video/webm" : "video/mp4"
    : type === "audio"
      ? detected.mime
      : detected.mime;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      ...CHAT_NO_STORE,
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
