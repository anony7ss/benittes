import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse, invalidOriginResponse, isSameOriginRequest, readBoundedJson } from "../../../../../lib/security/http";
import { getServiceSupabase, hasPanelPermission, requirePanelStaff } from "../../../../../lib/supabaseAdmin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!hasPanelPermission(staff.member, "agents", "write")) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const parsed = await readBoundedJson<{ proposal_id?: unknown; decision?: unknown }>(request, 2048);
  if (!parsed.ok) return parsed.response;
  const proposalId = typeof parsed.value.proposal_id === "string" ? parsed.value.proposal_id : "";
  const decision = parsed.value.decision;
  if (!UUID_RE.test(proposalId) || (decision !== "approve" && decision !== "reject")) {
    return NextResponse.json({ error: "Confirmação inválida." }, { status: 400 });
  }

  const service = getServiceSupabase();
  const { data: proposal, error: proposalError } = await service.from("panel_agent_change_proposals")
    .select("id,agent_key,created_by,change_type,payload,status,expires_at")
    .eq("id", proposalId).eq("created_by", staff.user.id).maybeSingle();
  if (proposalError) return databaseErrorResponse(proposalError);
  if (!proposal) return NextResponse.json({ error: "Proposta não encontrada." }, { status: 404 });
  if (proposal.status !== "pending") return NextResponse.json({ error: "Esta proposta já foi resolvida." }, { status: 409 });
  if (new Date(proposal.expires_at).getTime() <= Date.now()) {
    await service.from("panel_agent_change_proposals").update({ status: "expired", resolved_at: new Date().toISOString() }).eq("id", proposalId).eq("status", "pending");
    return NextResponse.json({ error: "A proposta expirou. Peça novamente no chat." }, { status: 410 });
  }

  if (decision === "reject") {
    const { data: rejected, error } = await service.from("panel_agent_change_proposals").update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", proposalId).eq("created_by", staff.user.id).eq("status", "pending").select("id,status").maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!rejected) return NextResponse.json({ error: "A proposta já foi resolvida." }, { status: 409 });
    return NextResponse.json({ proposal: rejected });
  }

  const { data: claimed, error: claimError } = await service.from("panel_agent_change_proposals").update({ status: "applying" })
    .eq("id", proposalId).eq("created_by", staff.user.id).eq("status", "pending").select("id").maybeSingle();
  if (claimError) return databaseErrorResponse(claimError);
  if (!claimed) return NextResponse.json({ error: "A proposta já está sendo processada." }, { status: 409 });

  const rollbackProposal = () => service.from("panel_agent_change_proposals").update({ status: "pending" }).eq("id", proposalId).eq("status", "applying");
  const { data: profile, error: profileError } = await service.from("panel_agent_profiles")
    .select("objectives,agreements,memories,alerts,routines,revision").eq("agent_key", proposal.agent_key).maybeSingle();
  if (profileError || !profile) {
    await rollbackProposal();
    return profileError ? databaseErrorResponse(profileError) : NextResponse.json({ error: "Perfil do agente não encontrado." }, { status: 404 });
  }

  const payload = proposal.payload as Record<string, unknown>;
  const text = typeof payload.text === "string" ? payload.text : "";
  const change = String(proposal.change_type);
  const next: Record<string, unknown> = { revision: Number(profile.revision) + 1, updated_by: staff.user.id, updated_at: new Date().toISOString() };
  const updateTextList = (field: "objectives" | "agreements" | "memories", add: boolean) => {
    const current = Array.isArray(profile[field]) ? [...profile[field]] as string[] : [];
    if (add) {
      if (!text || current.includes(text) || current.length >= 40) throw new Error("Esse item já existe ou o perfil atingiu o limite.");
      next[field] = [...current, text];
    } else {
      if (!current.includes(text)) throw new Error("Esse item não existe mais no perfil.");
      next[field] = current.filter((item) => item !== text);
    }
  };

  try {
    if (change === "objective_add" || change === "objective_remove") updateTextList("objectives", change.endsWith("add"));
    else if (change === "agreement_add" || change === "agreement_remove") updateTextList("agreements", change.endsWith("add"));
    else if (change === "memory_add") updateTextList("memories", true);
    else if (change === "alert_add") {
      const current = Array.isArray(profile.alerts) ? [...profile.alerts] as Array<Record<string, unknown>> : [];
      if (!text || current.some((item) => item.text === text) || current.length >= 30) throw new Error("Este alerta já existe ou o perfil atingiu o limite.");
      next.alerts = [...current, { id: payload.id, text, created_at: payload.created_at }];
    } else if (change === "alert_remove") {
      const current = Array.isArray(profile.alerts) ? [...profile.alerts] as Array<Record<string, unknown>> : [];
      const filtered = current.filter((item) => item.id !== text);
      if (filtered.length === current.length) throw new Error("Este alerta não existe mais no perfil.");
      next.alerts = filtered;
    } else if (change === "routine_create") {
      const routine = payload.routine as Record<string, unknown> | undefined;
      const current = Array.isArray(profile.routines) ? [...profile.routines] as Array<Record<string, unknown>> : [];
      if (!routine || typeof routine.id !== "string" || current.length >= 20) throw new Error("A rotina é inválida ou o perfil atingiu o limite.");
      next.routines = [...current, routine];
    } else if (change === "routine_remove" || change === "routine_set_enabled") {
      const current = Array.isArray(profile.routines) ? [...profile.routines] as Array<Record<string, unknown>> : [];
      const index = current.findIndex((item) => item.id === text);
      if (index < 0) throw new Error("Esta rotina não existe mais no perfil.");
      if (change === "routine_remove") next.routines = current.filter((item) => item.id !== text);
      else {
        if (typeof payload.enabled !== "boolean") throw new Error("O novo estado da rotina é inválido.");
        current[index] = { ...current[index], enabled: payload.enabled };
        next.routines = current;
      }
    } else {
      throw new Error("Tipo de alteração desconhecido.");
    }
  } catch (error) {
    await rollbackProposal();
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível aplicar a alteração." }, { status: 409 });
  }

  const { data: updated, error: updateError } = await service.from("panel_agent_profiles").update(next)
    .eq("agent_key", proposal.agent_key).eq("revision", profile.revision)
    .select("agent_key,enabled,objectives,knowledge,agreements,memories,alerts,routines,revision,updated_at").maybeSingle();
  if (updateError || !updated) {
    await rollbackProposal();
    return updateError ? databaseErrorResponse(updateError) : NextResponse.json({ error: "O perfil mudou. Atualize e confirme a proposta novamente." }, { status: 409 });
  }

  const { data: approved, error: approvalError } = await service.from("panel_agent_change_proposals").update({ status: "approved", resolved_at: new Date().toISOString() })
    .eq("id", proposalId).eq("status", "applying").select("id,status").maybeSingle();
  if (approvalError || !approved) {
    return NextResponse.json({ error: "A alteração foi aplicada, mas não foi possível atualizar o estado da confirmação." }, { status: 500 });
  }
  void service.from("audit_logs").insert({ actor_user_id: staff.user.id, actor_email: staff.user.email ?? null, action: "updated", module: "agents", record_id: proposal.agent_key, record_title: `Proposta aplicada: ${change}` });
  return NextResponse.json({ proposal: approved, profile: updated }, { headers: { "Cache-Control": "no-store" } });
}
