import { NextRequest, NextResponse } from "next/server";
import { authorizeChat, CHAT_NO_STORE, mediaUrlForStoragePath, normalizeChatPhone } from "../../../../../lib/whatsappChat";
import { getServiceSupabase } from "../../../../../lib/supabaseAdmin";

function phoneVariants(phone: string) {
  const local = phone.startsWith("55") ? phone.slice(2) : phone;
  const area = local.slice(0, 2);
  const number = local.slice(2);
  const national = number.length === 9 ? `${number.slice(0, 5)}-${number.slice(5)}` : `${number.slice(0, 4)}-${number.slice(4)}`;
  return [...new Set([
    phone,
    local,
    `+${phone}`,
    `+55 (${area}) ${national}`,
    `(${area}) ${national}`,
    `${area} ${national}`,
  ])];
}

export async function GET(request: NextRequest) {
  const auth = await authorizeChat(request, "read");
  if ("response" in auth) return auth.response;

  const archived = request.nextUrl.searchParams.get("archived") === "1";
  const supabase = getServiceSupabase();
  const { data: messages, error } = await supabase
    .from("whatsapp_messages")
    .select("id,phone,direction,sender_name,body,media_type,media_url,status,created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(700);

  if (error) return NextResponse.json({ error: "Não foi possível carregar as conversas." }, { status: 500, headers: CHAT_NO_STORE });
  const recent = messages ?? [];
  const phones = [...new Set(recent.map((row) => normalizeChatPhone(String(row.phone ?? ""))).filter(Boolean))];
  const [controlResult, clientResult, memberResult, botResult] = await Promise.all([
    phones.length
      ? supabase.from("whatsapp_chat_control").select("phone,ai_paused,ai_paused_until,is_archived,assigned_to,internal_note,last_read_at").in("phone", phones)
      : Promise.resolve({ data: [], error: null }),
    phones.length
      ? supabase.from("clients").select("id,full_name,phone").in("phone", [...new Set(phones.flatMap(phoneVariants))]).limit(1000)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("panel_members").select("user_id,full_name,email").eq("active", true).order("full_name", { ascending: true }).limit(100),
    supabase.from("whatsapp_bot_session").select("status,phone_connected,profile_name,last_heartbeat").eq("id", "default").maybeSingle(),
  ]);

  if (controlResult.error || clientResult.error || memberResult.error) {
    return NextResponse.json({ error: "Não foi possível carregar os detalhes das conversas." }, { status: 503, headers: CHAT_NO_STORE });
  }
  const controls = controlResult.data ?? [];
  const clients = clientResult.data ?? [];
  const members = memberResult.data ?? [];
  const bot = botResult.data;
  const controlMap = new Map(controls.map((row) => [normalizeChatPhone(String(row.phone ?? "")), row]));
  const conversationMap = new Map<string, {
    phone: string;
    lastMessage: { id: string; direction: string; body: string; mediaType: string | null; mediaUrl: string | null; status: string; createdAt: string; senderName: string | null };
    unread: number;
  }>();

  for (const row of recent) {
    const phone = normalizeChatPhone(String(row.phone ?? ""));
    if (!phone) continue;
    const control = controlMap.get(phone);
    if (Boolean(control?.is_archived) !== archived) continue;
    let conversation = conversationMap.get(phone);
    if (!conversation) {
      conversation = {
        phone,
        lastMessage: {
          id: String(row.id),
          direction: String(row.direction),
          body: String(row.body ?? ""),
          mediaType: row.media_type ? String(row.media_type) : null,
          mediaUrl: mediaUrlForStoragePath(row.media_url, row.media_type),
          status: String(row.status ?? "received"),
          createdAt: String(row.created_at),
          senderName: row.sender_name ? String(row.sender_name) : null,
        },
        unread: 0,
      };
      conversationMap.set(phone, conversation);
    }
    if (row.direction === "incoming" && (!control?.last_read_at || new Date(String(row.created_at)).getTime() > new Date(String(control.last_read_at)).getTime())) {
      conversation.unread += 1;
    }
  }

  const matchedClients = [...conversationMap.keys()].map((phone) => {
    const variants = phoneVariants(phone);
    return clients.find((client) => variants.includes(String(client.phone ?? "")));
  }).filter(Boolean);
  const clientIds = [...new Set(matchedClients.map((client) => String(client!.id)))];
  const vehicleResult = clientIds.length
    ? await supabase.from("vehicles").select("id,client_id,license_plate,make,model,model_year").in("client_id", clientIds).eq("status", "active").limit(500)
    : { data: [] };
  if ("error" in vehicleResult && vehicleResult.error) {
    return NextResponse.json({ error: "Não foi possível carregar os veículos dos clientes." }, { status: 503, headers: CHAT_NO_STORE });
  }
  const vehicles = vehicleResult.data ?? [];
  const vehicleMap = new Map<string, typeof vehicles>();
  for (const vehicle of vehicles) {
    const id = String(vehicle.client_id ?? "");
    vehicleMap.set(id, [...(vehicleMap.get(id) ?? []), vehicle]);
  }

  const conversations = [...conversationMap.values()].map((conversation) => {
    const control = controlMap.get(conversation.phone);
    const client = clients.find((row) => phoneVariants(conversation.phone).includes(String(row.phone ?? ""))) ?? null;
    return {
      ...conversation,
      client: client ? {
        id: String(client.id),
        name: String(client.full_name ?? ""),
        vehicles: (vehicleMap.get(String(client.id)) ?? []).map((vehicle) => ({
          id: String(vehicle.id),
          plate: String(vehicle.license_plate ?? ""),
          make: vehicle.make ? String(vehicle.make) : null,
          model: String(vehicle.model ?? ""),
          year: vehicle.model_year ? Number(vehicle.model_year) : null,
        })),
      } : null,
      control: {
        aiPaused: Boolean(control?.ai_paused && (!control.ai_paused_until || new Date(String(control.ai_paused_until)).getTime() > Date.now())),
        aiPausedUntil: control?.ai_paused_until ? String(control.ai_paused_until) : null,
        archived: Boolean(control?.is_archived),
        assignedTo: control?.assigned_to ? String(control.assigned_to) : null,
        note: control?.internal_note ? String(control.internal_note) : "",
        lastReadAt: control?.last_read_at ? String(control.last_read_at) : null,
      },
    };
  });

  return NextResponse.json({
    conversations,
    members,
    bot: bot ? { status: bot.status, profileName: bot.profile_name, phoneConnected: bot.phone_connected, lastHeartbeat: bot.last_heartbeat } : null,
  }, { headers: CHAT_NO_STORE });
}
