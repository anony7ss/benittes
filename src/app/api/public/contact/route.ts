import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const NAME_MIN = 2;
const NAME_MAX = 100;
const EMAIL_MAX = 254;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 1500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const ipHits = new Map<string, number[]>();

function cleanText(raw: unknown, maxLen: number): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLen + 50);
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) {
    ipHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  return false;
}

export async function POST(request: NextRequest) {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "";

  if (!url || !key) {
    return NextResponse.json({ error: "Formulário indisponível." }, { status: 503 });
  }

  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (isRateLimited(clientIp)) {
    return NextResponse.json(
      { error: "Muitas mensagens enviadas em sequência. Aguarde alguns minutos." },
      { status: 429 },
    );
  }

  try {
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      email?: unknown;
      message?: unknown;
      website?: unknown;
    } | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }

    if (String(body.website ?? "").trim() !== "") {
      return NextResponse.json({ ok: true });
    }

    const name = cleanText(body.name, NAME_MAX);
    const email = cleanText(body.email, EMAIL_MAX).toLowerCase();
    const message = cleanText(body.message, MESSAGE_MAX);

    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      return NextResponse.json(
        { error: `Informe seu nome (entre ${NAME_MIN} e ${NAME_MAX} caracteres).` },
        { status: 400 },
      );
    }

    if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
    }

    if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) {
      return NextResponse.json(
        { error: `A mensagem deve ter entre ${MESSAGE_MIN} e ${MESSAGE_MAX} caracteres.` },
        { status: 400 },
      );
    }

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from("contact_messages").insert({
      name,
      email,
      message,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Erro ao enviar mensagem." }, { status: 500 });
  }
}
