import { NextRequest, NextResponse } from "next/server";
import {
  applyChatRateLimit,
  authorizeChat,
  CHAT_NO_STORE,
  getChatStorage,
  isValidChatPhone,
  normalizeChatPhone,
  pauseUntil,
  validPauseMinutes,
} from "../../../../../lib/whatsappChat";
import { getServiceSupabase } from "../../../../../lib/supabaseAdmin";
import { databaseErrorResponse, invalidOriginResponse, isSameOriginRequest, readBoundedJson } from "../../../../../lib/security/http";

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const parsed = await readBoundedJson<{
    phone?: unknown;
    action?: unknown;
    minutes?: unknown;
    note?: unknown;
    memberId?: unknown;
  }>(request, 6 * 1024);
  if (!parsed.ok) return parsed.response;
  const phone = normalizeChatPhone(parsed.value.phone);
  const action = parsed.value.action;
  const auth = await authorizeChat(request, action === "read" ? "read" : "write");
  if ("response" in auth) return auth.response;
  const rateError = await applyChatRateLimit(request, auth.staff, "control", 40);
  if (rateError) return rateError;
  if (!isValidChatPhone(phone) || typeof action !== "string") {
    return NextResponse.json({ error: "Conversa ou ação inválida." }, { status: 400, headers: CHAT_NO_STORE });
  }

  const supabase = getServiceSupabase();
  let values: Record<string, unknown> = { phone, updated_at: new Date().toISOString() };
  if (action === "pause") {
    if (!validPauseMinutes(parsed.value.minutes)) return NextResponse.json({ error: "Escolha um tempo de pausa válido." }, { status: 400, headers: CHAT_NO_STORE });
    values = { ...values, ai_paused: true, ai_paused_until: pauseUntil(parsed.value.minutes) };
  } else if (action === "resume") {
    values = { ...values, ai_paused: false, ai_paused_until: null };
  } else if (action === "archive") {
    values = { ...values, is_archived: true, archived_at: new Date().toISOString(), archived_by: auth.staff.user.id };
  } else if (action === "unarchive") {
    values = { ...values, is_archived: false, archived_at: null, archived_by: null };
  } else if (action === "read") {
    values = { ...values, last_read_at: new Date().toISOString() };
  } else if (action === "note") {
    if (typeof parsed.value.note !== "string" || parsed.value.note.length > 2000) {
      return NextResponse.json({ error: "A observação deve ter até 2.000 caracteres." }, { status: 400, headers: CHAT_NO_STORE });
    }
    values = { ...values, internal_note: parsed.value.note.trim() || null };
  } else if (action === "assign") {
    const memberId = parsed.value.memberId;
    if (memberId !== null && (typeof memberId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId))) {
      return NextResponse.json({ error: "Pessoa responsável inválida." }, { status: 400, headers: CHAT_NO_STORE });
    }
    if (memberId) {
      const { data: member } = await supabase.from("panel_members").select("user_id").eq("user_id", memberId).eq("active", true).maybeSingle();
      if (!member) return NextResponse.json({ error: "Essa pessoa não está ativa na equipe." }, { status: 404, headers: CHAT_NO_STORE });
    }
    values = { ...values, assigned_to: memberId };
  } else {
    return NextResponse.json({ error: "Ação não reconhecida." }, { status: 400, headers: CHAT_NO_STORE });
  }

  const { data, error } = await supabase.from("whatsapp_chat_control").upsert(values, { onConflict: "phone" }).select("phone,ai_paused,ai_paused_until,is_archived,assigned_to,internal_note,last_read_at").single();
  if (error || !data) return error ? databaseErrorResponse(error) : NextResponse.json({ error: "Não foi possível atualizar a conversa." }, { status: 500, headers: CHAT_NO_STORE });
  return NextResponse.json({ ok: true, control: data }, { headers: CHAT_NO_STORE });
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const auth = await authorizeChat(request, "write");
  if ("response" in auth) return auth.response;
  const rateError = await applyChatRateLimit(request, auth.staff, "delete", 10);
  if (rateError) return rateError;
  const parsed = await readBoundedJson<{ phone?: unknown; confirm?: unknown }>(request, 2 * 1024);
  if (!parsed.ok) return parsed.response;
  const phone = normalizeChatPhone(parsed.value.phone);
  if (!isValidChatPhone(phone) || parsed.value.confirm !== true) {
    return NextResponse.json({ error: "Confirme a exclusão do histórico local." }, { status: 400, headers: CHAT_NO_STORE });
  }

  const supabase = getServiceSupabase();
  const { data: rows, error: rowsError } = await supabase.from("whatsapp_messages").select("media_url").eq("phone", phone).limit(2000);
  if (rowsError) return databaseErrorResponse(rowsError);
  const paths = [...new Set((rows ?? []).map((row) => row.media_url).filter((path): path is string => typeof path === "string" && new RegExp(`^${phone}/[0-9a-f-]{36}\\.(jpg|png|webp|gif|ogg|opus|mp3|m4a|webm|mp4)$`, "i").test(path)))];

  await supabase.from("whatsapp_outbox").update({ status: "cancelled", error: "Conversa removida do painel." }).eq("phone", phone).eq("kind", "chat_manual").eq("status", "pending");
  const { error: deleteMessagesError } = await supabase.from("whatsapp_messages").delete().eq("phone", phone);
  if (deleteMessagesError) return databaseErrorResponse(deleteMessagesError);
  const { error: deleteControlError } = await supabase.from("whatsapp_chat_control").delete().eq("phone", phone);
  if (deleteControlError) return databaseErrorResponse(deleteControlError);

  if (paths.length) {
    const storage = await getChatStorage();
    await storage.remove(paths).catch(() => ({ error: new Error("cleanup") }));
  }
  return NextResponse.json({ ok: true }, { headers: CHAT_NO_STORE });
}
