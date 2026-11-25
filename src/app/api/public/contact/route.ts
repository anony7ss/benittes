import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "../../../../lib/supabaseAdmin";
import {
  clientAddress,
  enforceRateLimits,
  invalidOriginResponse,
  isSameOriginRequest,
  readBoundedJson,
  rateLimitedResponse,
} from "../../../../lib/security/http";

const NAME_MIN = 2;
const NAME_MAX = 100;
const EMAIL_MAX = 254;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 1500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(raw: unknown, maxLen: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLen + 1);
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();

  try {
    if (!(await enforceRateLimits([
      { scope: "contact-ip", subject: clientAddress(request), maxHits: 5, windowSeconds: 300 },
    ]))) return rateLimitedResponse();

    const parsed = await readBoundedJson<{
      name?: unknown;
      email?: unknown;
      message?: unknown;
      website?: unknown;
    }>(request, 8 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }

    // Honeypot: respond as if accepted without storing the submission.
    if (String(body.website ?? "").trim() !== "") return NextResponse.json({ ok: true });

    const name = cleanText(body.name, NAME_MAX);
    const email = cleanText(body.email, EMAIL_MAX).toLowerCase();
    const message = cleanText(body.message, MESSAGE_MAX);
    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      return NextResponse.json({ error: `Informe seu nome (entre ${NAME_MIN} e ${NAME_MAX} caracteres).` }, { status: 400 });
    }
    if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
    }
    if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) {
      return NextResponse.json({ error: `A mensagem deve ter entre ${MESSAGE_MIN} e ${MESSAGE_MAX} caracteres.` }, { status: 400 });
    }

    if (!(await enforceRateLimits([
      { scope: "contact-email", subject: email, maxHits: 3, windowSeconds: 900 },
    ]))) return rateLimitedResponse();

    const { error } = await getServiceSupabase().from("contact_messages").insert({ name, email, message });
    if (error) return NextResponse.json({ error: "Não foi possível enviar a mensagem agora." }, { status: 503 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Formulário temporariamente indisponível." }, { status: 503 });
  }
}
