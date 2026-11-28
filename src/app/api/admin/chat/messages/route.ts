import { NextRequest, NextResponse } from "next/server";
import {
  applyChatRateLimit,
  authorizeChat,
  CHAT_NO_STORE,
  isValidChatPhone,
  mediaUrlForStoragePath,
  normalizeChatPhone,
  pauseUntil,
  validPauseMinutes,
} from "../../../../../lib/whatsappChat";
import { getServiceSupabase } from "../../../../../lib/supabaseAdmin";
import { databaseErrorResponse, isSameOriginRequest, readBoundedJson, invalidOriginResponse } from "../../../../../lib/security/http";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const auth = await authorizeChat(request, "read");
  if ("response" in auth) return auth.response;

  const phone = normalizeChatPhone(request.nextUrl.searchParams.get("phone"));
  if (!isValidChatPhone(phone)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400, headers: CHAT_NO_STORE });
  const limitValue = Number(request.nextUrl.searchParams.get("limit") ?? 80);
  const limit = Number.isInteger(limitValue) ? Math.max(1, Math.min(100, limitValue)) : 80;
  const before = request.nextUrl.searchParams.get("before");
  const after = request.nextUrl.searchParams.get("after");
  const cursor = before || after;
  if (cursor && !Number.isFinite(Date.parse(cursor))) {
    return NextResponse.json({ error: "Data de paginação inválida." }, { status: 400, headers: CHAT_NO_STORE });
  }

  let query = getServiceSupabase()
    .from("whatsapp_messages")
    .select("id,phone,direction,sender_name,body,media_type,media_url,status,created_at,outbox_id")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (before) query = query.lt("created_at", before);
  if (after) query = query.gte("created_at", after);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Não foi possível carregar as mensagens." }, { status: 500, headers: CHAT_NO_STORE });
  const rows = data ?? [];
  const outboxIds = [...new Set(rows.map((row) => typeof row.outbox_id === "string" ? row.outbox_id : "").filter(Boolean))];
  const { data: outboxRows } = outboxIds.length
    ? await getServiceSupabase().from("whatsapp_outbox").select("id,kind").in("id", outboxIds)
    : { data: [] };
  const outboxKinds = new Map((outboxRows ?? []).map((row) => [String(row.id), String(row.kind ?? "")]));
  const hasMore = rows.length > limit;
  const selected = rows.slice(0, limit).reverse().map((row) => ({
    id: String(row.id),
    phone: String(row.phone),
    direction: String(row.direction),
    senderName: row.sender_name ? String(row.sender_name) : null,
    body: String(row.body ?? ""),
    mediaType: row.media_type ? String(row.media_type) : null,
    mediaUrl: mediaUrlForStoragePath(row.media_url, row.media_type),
    status: String(row.status ?? "received"),
    createdAt: String(row.created_at),
    outboxId: row.outbox_id ? String(row.outbox_id) : null,
    kind: row.outbox_id ? outboxKinds.get(String(row.outbox_id)) ?? null : null,
  }));
  return NextResponse.json({ messages: selected, hasMore }, { headers: CHAT_NO_STORE });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const auth = await authorizeChat(request, "write");
  if ("response" in auth) return auth.response;
  const rateError = await applyChatRateLimit(request, auth.staff, "send", 25);
  if (rateError) return rateError;

  const parsed = await readBoundedJson<{ phone?: unknown; text?: unknown; pauseMinutes?: unknown; clientId?: unknown }>(request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const phone = normalizeChatPhone(parsed.value.phone);
  const text = typeof parsed.value.text === "string" ? parsed.value.text.trim() : "";
  const pauseMinutes = parsed.value.pauseMinutes;
  const clientId = parsed.value.clientId;
  if (!isValidChatPhone(phone) || !text || text.length > 4000 || !validPauseMinutes(pauseMinutes) || typeof clientId !== "string" || !UUID_RE.test(clientId)) {
    return NextResponse.json({ error: "Revise o telefone, a mensagem e o tempo de pausa." }, { status: 400, headers: CHAT_NO_STORE });
  }

  const supabase = getServiceSupabase();
  const dedupeKey = `chat:${auth.staff.user.id}:${clientId}`;
  const { data: alreadyQueued } = await supabase.from("whatsapp_outbox").select("id,status").eq("dedupe_key", dedupeKey).maybeSingle();
  if (alreadyQueued) {
    const { data: previousMessage } = await supabase.from("whatsapp_messages").select("id,phone,direction,sender_name,body,media_type,media_url,status,created_at,outbox_id").eq("outbox_id", alreadyQueued.id).maybeSingle();
    return NextResponse.json({ ok: true, duplicate: true, status: alreadyQueued.status, message: previousMessage }, { headers: CHAT_NO_STORE });
  }

  const { data: outbox, error: outboxError } = await supabase
    .from("whatsapp_outbox")
    .insert({
      phone,
      message: text,
      kind: "chat_manual",
      // Keep the worker from racing the history/control writes below. It is
      // released to the queue only after the chat row and bot pause exist.
      status: "cancelled",
      dedupe_key: dedupeKey,
      ai_pause_minutes: pauseMinutes,
      created_by: auth.staff.user.id,
    })
    .select("id")
    .single();
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
    body: text,
    media_type: "text",
    status: "queued",
    outbox_id: outbox.id,
  }).select("id,phone,direction,sender_name,body,media_type,media_url,status,created_at,outbox_id").single();
  if (messageError) {
    await supabase.from("whatsapp_outbox").update({ error: "Mensagem não pôde ser exibida no histórico." }).eq("id", outbox.id).eq("status", "cancelled");
    return databaseErrorResponse(messageError);
  }
  const { error: releaseError } = await supabase.from("whatsapp_outbox").update({ status: "pending" }).eq("id", outbox.id).eq("status", "cancelled");
  if (releaseError) {
    await supabase.from("whatsapp_messages").update({ status: "failed" }).eq("outbox_id", outbox.id);
    return NextResponse.json({ error: "Mensagem preparada, mas não foi possível iniciar o envio. Tente novamente." }, { status: 503, headers: CHAT_NO_STORE });
  }
  return NextResponse.json({ ok: true, outboxId: outbox.id, queued: true, message }, { headers: CHAT_NO_STORE });
}
