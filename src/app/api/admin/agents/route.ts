import { NextRequest, NextResponse } from "next/server";
import { AGENT_CATALOG, getAgent, type AgentKey } from "../../../../admin/agents";
import { databaseErrorResponse, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, rateLimitedResponse, readBoundedJson } from "../../../../lib/security/http";
import { cleanAgentProfile } from "../../../../lib/agents/server";
import { getServiceSupabase, hasPanelPermission, requirePanelStaff } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!hasPanelPermission(staff.member, "agents", "read")) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const service = getServiceSupabase();
  const [{ data: profileRows, error: profileError }, { data: conversations, error: conversationError }, { data: runs }] = await Promise.all([
    service.from("panel_agent_profiles").select("agent_key,enabled,objectives,knowledge,agreements,memories,alerts,routines,revision,updated_at").order("agent_key"),
    service.from("panel_agent_conversations").select("id,agent_key,title,updated_at,last_message_at").eq("user_id", staff.user.id).order("last_message_at", { ascending: false }).limit(50),
    service.from("panel_agent_routine_runs").select("id,agent_key,routine_id,routine_name,run_date,status,result,has_alert,started_at").order("started_at", { ascending: false }).limit(50),
  ]);
  if (profileError) return databaseErrorResponse(profileError);
  if (conversationError) return databaseErrorResponse(conversationError);

  const profiles = (profileRows ?? []).flatMap((row) => {
    const profile = cleanAgentProfile(row as Record<string, unknown>);
    return profile ? [profile] : [];
  });
  const allowedKeys = new Set(profiles.map((profile) => profile.agent_key));
  const visibleRuns = (runs ?? []).filter((run) => {
    const module = run.agent_key === "gabriel" ? "services" : run.agent_key === "nathalia" ? "appointments" : run.agent_key === "caio" ? "work-orders" : run.agent_key === "marina" ? "finance" : "";
    return module && hasPanelPermission(staff.member, module, "read");
  });
  return NextResponse.json({
    agents: AGENT_CATALOG.filter((agent) => allowedKeys.has(agent.key as AgentKey)),
    profiles,
    conversations: (conversations ?? []).filter((conversation) => getAgent(conversation.agent_key)),
    runs: visibleRuns,
    canConfigure: hasPanelPermission(staff.member, "agents", "write"),
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!hasPanelPermission(staff.member, "agents", "read")) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const limited = await enforceRateLimits([
    { scope: "agents-conversation-user", subject: staff.user.id, maxHits: 30, windowSeconds: 3600 },
  ]).catch(() => null);
  if (limited === null) return NextResponse.json({ error: "Agentes temporariamente indisponíveis." }, { status: 503 });
  if (!limited) return rateLimitedResponse();

  const parsed = await readBoundedJson<{ agent_key?: unknown }>(request, 2048);
  if (!parsed.ok) return parsed.response;
  const agentKey = typeof parsed.value.agent_key === "string" ? parsed.value.agent_key : "";
  if (!getAgent(agentKey)) return NextResponse.json({ error: "Agente inválido." }, { status: 400 });

  const service = getServiceSupabase();
  const { data: profile } = await service.from("panel_agent_profiles").select("enabled").eq("agent_key", agentKey).maybeSingle();
  if (!profile?.enabled) return NextResponse.json({ error: "Este agente está desativado." }, { status: 409 });
  const { data, error } = await service.from("panel_agent_conversations").insert({ agent_key: agentKey, user_id: staff.user.id, title: "Nova conversa" })
    .select("id,agent_key,title,updated_at,last_message_at").single();
  if (error || !data) return databaseErrorResponse(error ?? { code: "" });
  return NextResponse.json({ conversation: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
