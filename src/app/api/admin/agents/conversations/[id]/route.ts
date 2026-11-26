import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "../../../../../../lib/security/http";
import { getServiceSupabase, hasPanelPermission, requirePanelStaff } from "../../../../../../lib/supabaseAdmin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!hasPanelPermission(staff.member, "agents", "read")) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });

  const service = getServiceSupabase();
  const { data: conversation, error: conversationError } = await service.from("panel_agent_conversations")
    .select("id,agent_key,title,updated_at,last_message_at").eq("id", id).eq("user_id", staff.user.id).maybeSingle();
  if (conversationError) return databaseErrorResponse(conversationError);
  if (!conversation) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  const [{ data: rows, error }, { data: proposals, error: proposalError }] = await Promise.all([
    service.from("panel_agent_messages").select("id,conversation_id,role,content,attachments,metadata,created_at")
      .eq("conversation_id", id).eq("user_id", staff.user.id).order("created_at", { ascending: false }).limit(50),
    service.from("panel_agent_change_proposals").select("id,agent_key,change_type,payload,status,expires_at,created_at")
      .eq("conversation_id", id).eq("created_by", staff.user.id).order("created_at", { ascending: true }),
  ]);
  if (error) return databaseErrorResponse(error);
  if (proposalError) return databaseErrorResponse(proposalError);

  const messages = (rows ?? []).reverse();
  const paths = [...new Set(messages.slice(-20).flatMap((message) => {
    if (!Array.isArray(message.attachments)) return [];
    return message.attachments.flatMap((attachment) => {
      if (!attachment || typeof attachment !== "object") return [];
      const path = (attachment as { path?: unknown }).path;
      return typeof path === "string" && path.startsWith(`${staff.user.id}/${id}/`) ? [path] : [];
    });
  }))].slice(0, 80);
  const signed = paths.length ? await service.storage.from("agent-chat-private").createSignedUrls(paths, 60) : { data: [], error: null };
  const urlByPath = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));

  const safeMessages = messages.map((message, index) => ({
    ...message,
    attachments: Array.isArray(message.attachments) ? message.attachments.slice(0, 5).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const attachment = entry as { path?: unknown; name?: unknown; mime_type?: unknown; size?: unknown; kind?: unknown };
      const path = typeof attachment.path === "string" ? attachment.path : "";
      const signedUrl = index >= messages.length - 20 ? urlByPath.get(path) ?? null : null;
      return [{
        name: typeof attachment.name === "string" ? attachment.name.slice(0, 180) : "Anexo",
        mime_type: typeof attachment.mime_type === "string" ? attachment.mime_type.slice(0, 80) : "application/octet-stream",
        size: Number.isSafeInteger(attachment.size) ? attachment.size : 0,
        kind: ["image", "video", "audio"].includes(String(attachment.kind)) ? attachment.kind : "image",
        signed_url: signedUrl,
      }];
    }) : [],
  }));

  return NextResponse.json({
    conversation,
    messages: safeMessages,
    proposals: proposals ?? [],
    media_urls_expire_in_seconds: 60,
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
