import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, normalizeBrPhone, requirePanelStaff } from "../../../../../lib/supabaseAdmin";
import { clientAddress, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, readBoundedJson, rateLimitedResponse } from "../../../../../lib/security/http";

const HEARTBEAT_STALE_MS = 90_000;

function isBotHeartbeatFresh(lastHeartbeat: unknown): boolean {
  if (typeof lastHeartbeat !== "string" || !lastHeartbeat.trim()) return false;
  const ts = new Date(lastHeartbeat).getTime();
  return Number.isFinite(ts) && Date.now() - ts <= HEARTBEAT_STALE_MS;
}

export async function GET(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const isAdmin = staff.member.role === "owner" || staff.member.role === "manager";
  if (!isAdmin) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("whatsapp_bot_session")
    .select("*")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
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
          notify_on_human_transfer: data.notify_on_human_transfer,
          notify_on_quote_response: data.notify_on_quote_response,
          closed_auto_reply_enabled: data.closed_auto_reply_enabled,
          closed_auto_reply_message: data.closed_auto_reply_message,
          owner_phone: data.owner_phone,
          ai_model: data.ai_model,
          audio_mode: data.audio_mode,
          audio_voice: data.audio_voice,
        }
      : null,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (staff.member.role !== "owner" && staff.member.role !== "manager") {
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

  const parsed = await readBoundedJson<Record<string, unknown>>(request, 8 * 1024);
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
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
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
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, session: data });
  }

  if (action === "update_settings") {
    const patch: Record<string, unknown> = {
      id: "default",
      updated_at: new Date().toISOString(),
    };
    if (typeof body.ai_enabled === "boolean") patch.ai_enabled = body.ai_enabled;
    if (typeof body.auto_send_quotes === "boolean") patch.auto_send_quotes = body.auto_send_quotes;
    if (typeof body.notify_on_human_transfer === "boolean") {
      patch.notify_on_human_transfer = body.notify_on_human_transfer;
    }
    if (typeof body.notify_on_quote_response === "boolean") {
      patch.notify_on_quote_response = body.notify_on_quote_response;
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

    const { data, error } = await supabase
      .from("whatsapp_bot_session")
      .upsert(patch, { onConflict: "id" })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, session: data });
  }

  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
