import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getSupabaseEnv } from "../supabaseAdmin";

export type BoundedJson<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse };

export async function readBoundedJson<T = unknown>(
  request: NextRequest,
  maxBytes = 16 * 1024,
): Promise<BoundedJson<T>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return { ok: false, response: NextResponse.json({ error: "Envie os dados em JSON." }, { status: 415 }) };
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, response: NextResponse.json({ error: "Requisição muito grande." }, { status: 413 }) };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, response: NextResponse.json({ error: "Corpo da requisição ausente." }, { status: 400 }) };

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, response: NextResponse.json({ error: "Requisição muito grande." }, { status: 413 }) };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "JSON inválido." }, { status: 400 }) };
  } finally {
    reader.releaseLock();
  }
}

export function isSameOriginRequest(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export function clientAddress(request: NextRequest): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for");
  const lastAddress = forwarded?.split(",").map((part) => part.trim()).filter(Boolean).at(-1);
  const candidate = lastAddress || request.headers.get("x-real-ip")?.trim();
  return candidate && candidate.length <= 64 ? candidate : "unknown";
}

export async function consumeRateLimit(
  scope: string,
  subject: string,
  maxHits: number,
  windowSeconds: number,
): Promise<boolean> {
  const { serviceRoleKey } = getSupabaseEnv();
  const secret = process.env.RATE_LIMIT_HMAC_SECRET || serviceRoleKey;
  if (!secret || secret.length < 32) throw new Error("Rate limiting is not configured.");

  const subjectHash = createHmac("sha256", secret).update(`${scope}\0${subject}`).digest("hex");
  const { data, error } = await getServiceSupabase().rpc("consume_api_rate_limit", {
    p_scope: scope,
    p_subject_hash: subjectHash,
    p_max_hits: maxHits,
    p_window_seconds: windowSeconds,
  });
  if (error || typeof data !== "boolean") throw new Error("Rate limiting is unavailable.");
  return data;
}

export async function enforceRateLimits(
  limits: Array<{ scope: string; subject: string; maxHits: number; windowSeconds: number }>,
): Promise<boolean> {
  for (const limit of limits) {
    if (!(await consumeRateLimit(limit.scope, limit.subject, limit.maxHits, limit.windowSeconds))) return false;
  }
  return true;
}

export function rateLimitedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Muitas tentativas. Aguarde um pouco e tente novamente." },
    { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
  );
}

export function invalidOriginResponse(): NextResponse {
  return NextResponse.json({ error: "Origem da requisição inválida." }, { status: 403 });
}
