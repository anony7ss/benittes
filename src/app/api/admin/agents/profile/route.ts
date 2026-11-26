import { NextRequest, NextResponse } from "next/server";
import { getAgent } from "../../../../../admin/agents";
import { databaseErrorResponse, invalidOriginResponse, isSameOriginRequest, readBoundedJson } from "../../../../../lib/security/http";
import { getServiceSupabase, hasPanelPermission, requirePanelStaff } from "../../../../../lib/supabaseAdmin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!hasPanelPermission(staff.member, "agents", "write")) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const parsed = await readBoundedJson<Record<string, unknown>>(request, 2048);
  if (!parsed.ok) return parsed.response;
  const agentKey = typeof parsed.value.agent_key === "string" ? parsed.value.agent_key : "";
  const action = parsed.value.action;
  if (!getAgent(agentKey)) return NextResponse.json({ error: "Agente inválido." }, { status: 400 });
  if (action !== "agent_enabled" && action !== "routine_enabled") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  if (typeof parsed.value.enabled !== "boolean") return NextResponse.json({ error: "Informe o novo estado." }, { status: 400 });

  const service = getServiceSupabase();
  const { data: profile, error: readError } = await service.from("panel_agent_profiles")
    .select("enabled,routines,revision").eq("agent_key", agentKey).maybeSingle();
  if (readError) return databaseErrorResponse(readError);
  if (!profile) return NextResponse.json({ error: "Perfil do agente não encontrado." }, { status: 404 });

  const update: Record<string, unknown> = { revision: Number(profile.revision) + 1, updated_by: staff.user.id, updated_at: new Date().toISOString() };
  let auditTitle = "Agente";
  if (action === "agent_enabled") {
    update.enabled = parsed.value.enabled;
    auditTitle = `${getAgent(agentKey)!.name} ${parsed.value.enabled ? "ativado" : "desativado"}`;
  } else {
    const routineId = typeof parsed.value.routine_id === "string" ? parsed.value.routine_id : "";
    if (!UUID_RE.test(routineId)) return NextResponse.json({ error: "Rotina inválida." }, { status: 400 });
    const routines = Array.isArray(profile.routines) ? [...profile.routines] as Array<Record<string, unknown>> : [];
    const index = routines.findIndex((routine) => routine?.id === routineId);
    if (index < 0) return NextResponse.json({ error: "Rotina não encontrada." }, { status: 404 });
    routines[index] = { ...routines[index], enabled: parsed.value.enabled };
    update.routines = routines;
    auditTitle = `${getAgent(agentKey)!.name}: rotina ${String(routines[index].name || "")}`.slice(0, 180);
  }

  const { data: updated, error: updateError } = await service.from("panel_agent_profiles").update(update)
    .eq("agent_key", agentKey).eq("revision", profile.revision)
    .select("agent_key,enabled,objectives,knowledge,agreements,memories,alerts,routines,revision,updated_at").maybeSingle();
  if (updateError) return databaseErrorResponse(updateError);
  if (!updated) return NextResponse.json({ error: "O perfil foi alterado por outra pessoa. Atualize e tente novamente." }, { status: 409 });

  void service.from("audit_logs").insert({ actor_user_id: staff.user.id, actor_email: staff.user.email ?? null, action: "updated", module: "agents", record_id: agentKey, record_title: auditTitle });
  return NextResponse.json({ profile: updated }, { headers: { "Cache-Control": "no-store" } });
}
