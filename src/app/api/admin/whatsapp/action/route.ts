import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, normalizeBrPhone, requirePanelStaff } from "../../../../../lib/supabaseAdmin";

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
          ...data,
          is_online: isOnline,
          status: isOnline ? data.status : "disconnected",
          qr_code: isAdmin && isOnline ? data.qr_code : null,
          owner_phone: isAdmin ? data.owner_phone : null,
        }
      : null,
  });
}

export async function POST(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (staff.member.role !== "owner" && staff.member.role !== "manager") {
    return NextResponse.json({ error: "Apenas administradores podem alterar o bot." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
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
    const enabled = Boolean(body.ai_enabled);
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
      patch.closed_auto_reply_message = body.closed_auto_reply_message.trim() || null;
    }
    if (typeof body.owner_phone === "string") {
      patch.owner_phone = normalizeBrPhone(body.owner_phone) || null;
    }
    if (typeof body.ai_model === "string") {
      patch.ai_model = body.ai_model.trim() || null;
    }
    if (
      typeof body.audio_mode === "string" &&
      ["direct_request", "mirror", "always", "disabled"].includes(body.audio_mode)
    ) {
      patch.audio_mode = body.audio_mode;
    }
    if (typeof body.audio_voice === "string") {
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
