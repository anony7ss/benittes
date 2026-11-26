import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, hasPanelPermission, normalizeBrPhone, requirePanelStaff } from "../../../../../lib/supabaseAdmin";
import { clientAddress, databaseErrorResponse, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, readBoundedJson, rateLimitedResponse } from "../../../../../lib/security/http";

const HEARTBEAT_STALE_MS = 90_000;

function isBotHeartbeatFresh(lastHeartbeat: unknown): boolean {
  if (typeof lastHeartbeat !== "string" || !lastHeartbeat.trim()) return false;
  const ts = new Date(lastHeartbeat).getTime();
  return Number.isFinite(ts) && Date.now() - ts <= HEARTBEAT_STALE_MS;
}

export async function GET(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  if (!hasPanelPermission(staff.member, "bot", "read")) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("whatsapp_bot_session")
    .select("*")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    return databaseErrorResponse(error);
  }

  const isOnline = isBotHeartbeatFresh(data?.last_heartbeat);

  return NextResponse.json({
    session: data
      ? {
          id: data.id,
          is_online: isOnline,
          status: isOnline ? data.status : "disconnected",
          qr_code: isOnline ? data.qr_code : null,
          phone_connected: data.phone_connected,
          profile_name: data.profile_name,
          ai_enabled: data.ai_enabled,
          auto_send_quotes: data.auto_send_quotes,
          automations_enabled: data.automations_enabled,
          notify_on_human_transfer: data.notify_on_human_transfer,
          notify_on_quote_response: data.notify_on_quote_response,
          notify_on_appointment: data.notify_on_appointment,
          appointment_reminders_enabled: data.appointment_reminders_enabled,
          appointment_reminder_minutes: data.appointment_reminder_minutes,
          appointment_reminder_message: data.appointment_reminder_message,
          quote_followups_enabled: data.quote_followups_enabled,
          quote_followup_hours: data.quote_followup_hours,
          quote_followup_message: data.quote_followup_message,
          service_followups_enabled: data.service_followups_enabled,
          service_followup_days: data.service_followup_days,
          service_followup_message: data.service_followup_message,
          auto_quote_message_template: data.auto_quote_message_template,
          owner_human_alert_message: data.owner_human_alert_message,
          owner_quote_alert_message: data.owner_quote_alert_message,
          owner_appointment_alert_message: data.owner_appointment_alert_message,
          closed_auto_reply_enabled: data.closed_auto_reply_enabled,
          closed_auto_reply_message: data.closed_auto_reply_message,
          owner_phone: data.owner_phone,
          ai_model: data.ai_model,
          audio_mode: data.audio_mode,
          audio_voice: data.audio_voice,
          ai_paused_phones: data.ai_paused_phones ?? [],
          human_reply_pause_minutes: data.human_reply_pause_minutes ?? 30,
        }
      : null,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!hasPanelPermission(staff.member, "bot", "write")) {
    return NextResponse.json({ error: "Apenas administradores podem alterar o bot." }, { status: 403 });
  }

  let allowed = false;
  try {
    allowed = await enforceRateLimits([
      { scope: "whatsapp-action-user", subject: staff.user.id, maxHits: 40, windowSeconds: 900 },
      { scope: "whatsapp-action-ip", subject: clientAddress(request), maxHits: 80, windowSeconds: 900 },
    ]);
  } catch {
    return NextResponse.json({ error: "Ações do bot temporariamente indisponíveis." }, { status: 503 });
  }
  if (!allowed) return rateLimitedResponse();

  const parsed = await readBoundedJson<Record<string, unknown>>(request, 24 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const action = String(body.action || "");
  const supabase = getServiceSupabase();

  if (action === "disconnect" || action === "restart" || action === "clear_session") {
    const { data: current } = await supabase
      .from("whatsapp_bot_session")
      .select("last_heartbeat, status")
      .eq("id", "default")
      .maybeSingle();

    const isOnline = isBotHeartbeatFresh(current?.last_heartbeat);
    if (!isOnline) {
      if (action === "disconnect" || action === "clear_session") {
        await supabase
          .from("whatsapp_bot_session")
          .upsert(
            {
              id: "default",
              status: "disconnected",
              qr_code: null,
              action_requested: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );
      }
      return NextResponse.json(
        {
          error:
            "O bot está offline (sem sinal recente). Inicie o processo do bot antes de enviar comandos.",
        },
        { status: 409 },
      );
    }

    const { error } = await supabase
      .from("whatsapp_bot_session")
      .upsert(
        {
          id: "default",
          action_requested: action,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    if (error) return databaseErrorResponse(error);
    return NextResponse.json({ ok: true, action });
  }

  if (action === "toggle_ai") {
    if (typeof body.ai_enabled !== "boolean") return NextResponse.json({ error: "Valor inválido para IA." }, { status: 400 });
    const enabled = body.ai_enabled;
    const { data, error } = await supabase
      .from("whatsapp_bot_session")
      .upsert(
        {
          id: "default",
          ai_enabled: enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      )
      .select("*")
      .single();
    if (error) return databaseErrorResponse(error);
    return NextResponse.json({ ok: true, session: data });
  }

  if (action === "update_settings") {
    const patch: Record<string, unknown> = {
      id: "default",
      updated_at: new Date().toISOString(),
    };
    if (typeof body.ai_enabled === "boolean") patch.ai_enabled = body.ai_enabled;
    if (typeof body.auto_send_quotes === "boolean") patch.auto_send_quotes = body.auto_send_quotes;
    if (typeof body.automations_enabled === "boolean") patch.automations_enabled = body.automations_enabled;
    if (typeof body.notify_on_human_transfer === "boolean") {
      patch.notify_on_human_transfer = body.notify_on_human_transfer;
    }
    if (typeof body.notify_on_quote_response === "boolean") {
      patch.notify_on_quote_response = body.notify_on_quote_response;
    }
    if (typeof body.notify_on_appointment === "boolean") patch.notify_on_appointment = body.notify_on_appointment;
    if (typeof body.appointment_reminders_enabled === "boolean") patch.appointment_reminders_enabled = body.appointment_reminders_enabled;
    if (typeof body.quote_followups_enabled === "boolean") patch.quote_followups_enabled = body.quote_followups_enabled;
    if (typeof body.service_followups_enabled === "boolean") patch.service_followups_enabled = body.service_followups_enabled;
    for (const [field, min, max] of [
      ["appointment_reminder_minutes", 15, 10080],
      ["quote_followup_hours", 1, 720],
      ["service_followup_days", 1, 3650],
    ] as const) {
      if (body[field] === undefined) continue;
      const value = body[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        return NextResponse.json({ error: "Intervalo de lembrete inválido." }, { status: 400 });
      }
      patch[field] = value;
    }
    for (const field of [
      "appointment_reminder_message",
      "quote_followup_message",
      "service_followup_message",
      "auto_quote_message_template",
      "owner_human_alert_message",
      "owner_quote_alert_message",
      "owner_appointment_alert_message",
    ]) {
      if (body[field] === undefined) continue;
      if (typeof body[field] !== "string" || body[field].length > 1500) {
        return NextResponse.json({ error: "Um dos modelos de mensagem excede 1.500 caracteres." }, { status: 400 });
      }
      patch[field] = body[field].trim();
    }
    if (typeof body.closed_auto_reply_enabled === "boolean") {
      patch.closed_auto_reply_enabled = body.closed_auto_reply_enabled;
    }
    if (typeof body.closed_auto_reply_message === "string") {
      if (body.closed_auto_reply_message.length > 1000) return NextResponse.json({ error: "A mensagem automática excede o limite." }, { status: 400 });
      patch.closed_auto_reply_message = body.closed_auto_reply_message.trim() || null;
    }
    if (typeof body.owner_phone === "string") {
      const ownerPhone = normalizeBrPhone(body.owner_phone);
      if (ownerPhone && !/^55\d{10,11}$/.test(ownerPhone)) return NextResponse.json({ error: "Telefone inválido." }, { status: 400 });
      patch.owner_phone = ownerPhone || null;
    }
    if (typeof body.ai_model === "string") {
      if (body.ai_model.length > 100) return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
      patch.ai_model = body.ai_model.trim() || null;
    }
    if (
      typeof body.audio_mode === "string" &&
      ["direct_request", "mirror", "always", "disabled"].includes(body.audio_mode)
    ) {
      patch.audio_mode = body.audio_mode;
    }
    if (typeof body.audio_voice === "string") {
      if (body.audio_voice.length > 100) return NextResponse.json({ error: "Voz inválida." }, { status: 400 });
      patch.audio_voice = body.audio_voice.trim() || "pt-BR-FranciscaNeural";
    }
    if (Array.isArray(body.ai_paused_phones)) {
      if (body.ai_paused_phones.length > 200 || body.ai_paused_phones.some((phone) => typeof phone !== "string")) {
        return NextResponse.json({ error: "Lista de números inválida." }, { status: 400 });
      }
      const phones = [...new Set(body.ai_paused_phones.map((phone) => String(phone).replace(/\D/g, "")).filter(Boolean))];
      if (phones.some((phone) => !/^\d{10,15}$/.test(phone))) {
        return NextResponse.json({ error: "Use números com DDD e código do país." }, { status: 400 });
      }
      patch.ai_paused_phones = phones;
    }
    if (typeof body.human_reply_pause_minutes === "number") {
      if (![0, 15, 30, 60, 120, 240, 480, 1440].includes(body.human_reply_pause_minutes)) {
        return NextResponse.json({ error: "Duração de pausa inválida." }, { status: 400 });
      }
      patch.human_reply_pause_minutes = body.human_reply_pause_minutes;
    }

    const { data, error } = await supabase
      .from("whatsapp_bot_session")
      .upsert(patch, { onConflict: "id" })
      .select("*")
      .single();
    if (error) return databaseErrorResponse(error);
    return NextResponse.json({ ok: true, session: data });
  }

  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
