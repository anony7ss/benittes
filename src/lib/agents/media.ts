import { getServiceSupabase } from "../supabaseAdmin";
import { getAgentRuntimeConfig } from "./server";

const BUCKET = "agent-chat-private";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_FRAME_BYTES = 512 * 1024;

export type RequestedAttachment = {
  path: string;
  name: string;
  mime_type: string;
  size: number;
  kind: "image" | "video" | "audio";
  frame_paths?: string[];
};

export type ProcessedAttachment = RequestedAttachment & { analyzed: boolean; note?: string };

const MIME_KIND: Record<string, RequestedAttachment["kind"]> = {
  "image/jpeg": "image", "image/png": "image", "image/webp": "image",
  "video/mp4": "video", "video/webm": "video", "video/quicktime": "video",
  "audio/webm": "audio", "audio/ogg": "audio", "audio/opus": "audio", "audio/mp4": "audio",
  "audio/x-m4a": "audio", "audio/mpeg": "audio", "audio/wav": "audio", "audio/x-wav": "audio",
};

function isMagic(buffer: Uint8Array, mime: string) {
  const ascii = (start: number, length: number) => String.fromCharCode(...buffer.slice(start, start + length));
  if (mime === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.length >= 8 && buffer[0] === 0x89 && ascii(1, 3) === "PNG";
  if (mime === "image/webp") return buffer.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
  if (mime === "video/mp4" || mime === "video/quicktime" || mime === "audio/mp4" || mime === "audio/x-m4a") return buffer.length >= 8 && ascii(4, 4) === "ftyp";
  if (mime === "video/webm" || mime === "audio/webm") return buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  if (mime === "audio/ogg" || mime === "audio/opus") return ascii(0, 4) === "OggS";
  if (mime === "audio/wav" || mime === "audio/x-wav") return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE";
  if (mime === "audio/mpeg") return ascii(0, 3) === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  return false;
}

function getTotalBytes(response: Response) {
  const range = response.headers.get("content-range") || "";
  const total = /\/(\d+)$/.exec(range)?.[1];
  return total ? Number(total) : Number(response.headers.get("content-length") || 0);
}

async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("MEDIA_EMPTY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("MEDIA_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

async function getSignedObject(path: string, userId: string, conversationId: string, mimeType: string, maxBytes: number, headerOnly = false) {
  if (!MIME_KIND[mimeType] || !path.startsWith(`${userId}/${conversationId}/`) || !/^\d{8}-\d{4}-[1-5]\d{3}-[89ab]\d{3}-[0-9a-f]{12}\.[a-z0-9]+$/i.test(path.split("/").at(-1) || "")) {
    throw new Error("MEDIA_PATH_INVALID");
  }
  const service = getServiceSupabase();
  const { data: signed, error } = await service.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !signed?.signedUrl) throw new Error("MEDIA_NOT_FOUND");
  const rangeEnd = headerOnly ? 15 : Math.max(0, maxBytes - 1);
  const response = await fetch(signed.signedUrl, {
    headers: { Range: `bytes=0-${rangeEnd}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 206 && response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    throw new Error("MEDIA_READ_FAILED");
  }
  const total = getTotalBytes(response);
  if (!Number.isSafeInteger(total) || total < 1 || total > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(total > maxBytes ? "MEDIA_TOO_LARGE" : "MEDIA_SIZE_UNKNOWN");
  }
  const returnedType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (returnedType && returnedType !== mimeType) {
    await response.body?.cancel().catch(() => {});
    throw new Error("MEDIA_TYPE_MISMATCH");
  }
  const buffer = await readBounded(response, headerOnly ? 16 : maxBytes);
  return { buffer, total };
}

async function transcribeAudio(buffer: Buffer, mimeType: string) {
  const runtime = getAgentRuntimeConfig();
  if (!runtime.groqKey) throw new Error("TRANSCRIBE_NOT_CONFIGURED");
  const ext = mimeType === "audio/mpeg" ? "mp3" : mimeType === "audio/wav" || mimeType === "audio/x-wav" ? "wav" : mimeType === "audio/mp4" || mimeType === "audio/x-m4a" ? "m4a" : mimeType === "audio/opus" ? "opus" : mimeType === "audio/ogg" ? "ogg" : "webm";
  const form = new FormData();
  const bytes = new Uint8Array(buffer).buffer as ArrayBuffer;
  form.append("file", new Blob([bytes], { type: mimeType }), `agent-audio.${ext}`);
  form.append("model", runtime.transcriptionModel);
  form.append("language", "pt");
  form.append("response_format", "json");
  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${runtime.groqKey}` },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`TRANSCRIBE_PROVIDER_${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("TRANSCRIBE_EMPTY");
  const chunks: Uint8Array[] = [];
  let responseSize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      responseSize += value.byteLength;
      if (responseSize > 64 * 1024) {
        await reader.cancel();
        throw new Error("TRANSCRIBE_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), responseSize).toString("utf8");
  const payload = JSON.parse(raw) as { text?: unknown };
  const text = typeof payload.text === "string" ? payload.text.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000) : "";
  if (!text) throw new Error("TRANSCRIBE_EMPTY");
  return text;
}

export async function processAgentAttachments(args: {
  attachments: RequestedAttachment[];
  userId: string;
  conversationId: string;
  report: (state: { id: string; title: string; status: "active" | "complete" | "skipped" }) => void;
}) {
  if (args.attachments.length > 4) throw new Error("MEDIA_TOO_MANY");
  const processed: ProcessedAttachment[] = [];
  const multimodal: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
  const transcripts: string[] = [];
  let analyzedImages = 0;

  for (const [index, attachment] of args.attachments.entries()) {
    const mime = String(attachment.mime_type || "").toLowerCase();
    if (MIME_KIND[mime] !== attachment.kind) throw new Error("MEDIA_KIND_INVALID");
    const max = attachment.kind === "video" ? MAX_VIDEO_BYTES : attachment.kind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
    const size = Number(attachment.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > max) throw new Error("MEDIA_TOO_LARGE");
    args.report({ id: "media", title: `Conferindo anexo ${index + 1} de ${args.attachments.length}`, status: "active" });
    if (attachment.kind === "video") {
      const video = await getSignedObject(attachment.path, args.userId, args.conversationId, mime, max, true);
      if (!isMagic(video.buffer, mime)) throw new Error("MEDIA_SIGNATURE_INVALID");
      if (Array.isArray(attachment.frame_paths) && attachment.frame_paths.length > 4) throw new Error("MEDIA_TOO_MANY_FRAMES");
      const frames = Array.isArray(attachment.frame_paths) ? attachment.frame_paths : [];
      for (const framePath of frames) {
        const frame = await getSignedObject(framePath, args.userId, args.conversationId, "image/jpeg", MAX_FRAME_BYTES, false);
        if (!isMagic(frame.buffer, "image/jpeg")) throw new Error("MEDIA_SIGNATURE_INVALID");
        multimodal.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${frame.buffer.toString("base64")}` } });
      }
      if (frames.length) {
        multimodal.unshift({ type: "text", text: `Quadros amostrados do vídeo ${attachment.name.slice(0, 160)}. Analise somente os quadros fornecidos; não afirme que assistiu ao vídeo todo.` });
        analyzedImages += frames.length;
      }
      processed.push({ ...attachment, analyzed: frames.length > 0, note: frames.length ? `${frames.length} quadros amostrados` : "vídeo anexado sem quadros analisáveis" });
    } else if (attachment.kind === "image") {
      const image = await getSignedObject(attachment.path, args.userId, args.conversationId, mime, max, false);
      if (!isMagic(image.buffer, mime)) throw new Error("MEDIA_SIGNATURE_INVALID");
      multimodal.push({ type: "image_url", image_url: { url: `data:${mime};base64,${image.buffer.toString("base64")}` } });
      processed.push({ ...attachment, analyzed: true });
      analyzedImages += 1;
    } else {
      const audio = await getSignedObject(attachment.path, args.userId, args.conversationId, mime, max, false);
      if (!isMagic(audio.buffer, mime)) throw new Error("MEDIA_SIGNATURE_INVALID");
      const transcript = await transcribeAudio(audio.buffer, mime);
      transcripts.push(transcript);
      processed.push({ ...attachment, analyzed: true, note: "áudio transcrito" });
    }
  }

  args.report({ id: "media", title: "Anexos conferidos", status: "complete" });
  return { processed, multimodal, transcripts, analyzedImages };
}
