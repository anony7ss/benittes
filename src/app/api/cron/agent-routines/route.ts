import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cleanAgentProfile, getRoutineLabel } from "../../../../lib/agents/server";
import { getServiceSupabase } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function localDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(date);
  const get = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const weekday = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[get("weekday")] || 1;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, weekday };
}

function constantTimeMatch(expected: string, provided: string) {
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

function normalized(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function runRoutine(service: ReturnType<typeof getServiceSupabase>, agentKey: string, kind: string, now: Date) {
  if (kind === "services_without_price" && agentKey === "gabriel") {
    const { data: services, error } = await service.from("services").select("id,name,base_price").eq("active", true).limit(500);
    if (error) throw new Error("services unavailable");
    const ids = (services ?? []).filter((item) => Number(item.base_price) <= 0).map((item) => item.id);
    if (!ids.length) return { summary: "Nenhum serviço sem valor base ou regra específica foi encontrado.", count: 0, items: [] };
    const { data: rules, error: rulesError } = await service.from("service_price_rules").select("service_id").eq("active", true).in("service_id", ids).limit(1000);
    if (rulesError) throw new Error("price rules unavailable");
    const withRules = new Set((rules ?? []).map((item) => item.service_id));
    const missing = (services ?? []).filter((item) => Number(item.base_price) <= 0 && !withRules.has(item.id)).slice(0, 30);
    return { summary: missing.length ? `${missing.length} serviço(s) sem valor base ou regra específica cadastrada.` : "Todos os serviços sem valor base possuem regras específicas.", count: missing.length, items: missing.map((item) => ({ service: item.name })) };
  }

  if (kind === "agenda_daily" && agentKey === "nathalia") {
    const start = new Date(now);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const { data, error } = await service.from("appointments").select("title,service_type,starts_at,status,customer_name,vehicle_plate")
      .gte("starts_at", start.toISOString()).lte("starts_at", end.toISOString()).order("starts_at", { ascending: true }).limit(50);
    if (error) throw new Error("appointments unavailable");
    return { summary: `${data?.length ?? 0} compromisso(s) nas próximas 24 horas.`, count: data?.length ?? 0, items: (data ?? []).slice(0, 30) };
  }

  if (kind === "work_orders_stale" && agentKey === "caio") {
    const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const { data, error } = await service.from("work_orders").select("reference,status,updated_at,customer_name,vehicle_plate,diagnosis")
      .lt("updated_at", cutoff.toISOString()).order("updated_at", { ascending: true }).limit(80);
    if (error) throw new Error("work orders unavailable");
    const stale = (data ?? []).filter((item) => !["concluido", "concluida", "cancelado", "cancelada"].includes(normalized(item.status))).slice(0, 30);
    return { summary: stale.length ? `${stale.length} ordem(ns) sem atualização há pelo menos 48 horas.` : "Nenhuma ordem em andamento está há 48 horas sem atualização.", count: stale.length, items: stale };
  }

  if (kind === "finance_weekly" && agentKey === "marina") {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { data, error } = await service.from("finance_entries").select("direction,amount,status,due_at,created_at")
      .gte("created_at", start.toISOString()).order("created_at", { ascending: false }).limit(500);
    if (error) throw new Error("finance unavailable");
    const totals = { entradas: 0, saidas: 0, pendentes: 0, vencidas: 0 };
    for (const entry of data ?? []) {
      const status = normalized(entry.status);
      if (["entrada", "receber", "receita", "income", "in"].includes(normalized(entry.direction))) totals.entradas += Number(entry.amount) || 0;
      else totals.saidas += Number(entry.amount) || 0;
      const unpaid = !["pago", "paga", "paid", "quitado", "concluido"].includes(status);
      if (unpaid) totals.pendentes += 1;
      if (unpaid && entry.due_at && String(entry.due_at) < now.toISOString().slice(0, 10)) totals.vencidas += 1;
    }
    return { summary: `Resumo dos últimos sete dias: ${totals.entradas} em entradas, ${totals.saidas} em saídas e ${totals.pendentes} lançamento(s) em aberto.`, count: data?.length ?? 0, totals };
  }
  throw new Error("routine not allowed for this agent");
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || !constantTimeMatch(secret, bearer)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const service = getServiceSupabase();
  const { data: rows, error } = await service.from("panel_agent_profiles")
    .select("agent_key,enabled,objectives,knowledge,agreements,memories,alerts,routines,revision,updated_at").eq("enabled", true);
  if (error) return NextResponse.json({ error: "Rotinas temporariamente indisponíveis." }, { status: 503 });

  const now = new Date();
  const { day, weekday } = localDateParts(now);
  let started = 0;
  let completed = 0;
  let skipped = 0;
  for (const row of rows ?? []) {
    const profile = cleanAgentProfile(row as Record<string, unknown>);
    if (!profile?.enabled) continue;
    for (const routine of profile.routines.filter((item) => item.enabled)) {
      if (routine.frequency === "weekly" && routine.weekday !== weekday) continue;
      const { data: run, error: insertError } = await service.from("panel_agent_routine_runs").insert({
        routine_id: routine.id,
        agent_key: profile.agent_key,
        routine_name: routine.name || getRoutineLabel(routine.kind),
        run_date: day,
        status: "running",
      }).select("id").single();
      if (insertError?.code === "23505") { skipped += 1; continue; }
      if (insertError || !run) { skipped += 1; continue; }
      started += 1;
      try {
        const result = await runRoutine(service, profile.agent_key, routine.kind, now);
        const hasAlert = routine.kind !== "agenda_daily" && Number(result.count ?? 0) > 0 && routine.kind !== "finance_weekly";
        const financeAlert = routine.kind === "finance_weekly" && Number((result.totals as { vencidas?: number } | undefined)?.vencidas ?? 0) > 0;
        const { error: updateError } = await service.from("panel_agent_routine_runs").update({
          status: "completed",
          result,
          has_alert: hasAlert || financeAlert,
          completed_at: new Date().toISOString(),
        }).eq("id", run.id);
        if (updateError) throw new Error("run update failed");
        completed += 1;
      } catch {
        await service.from("panel_agent_routine_runs").update({ status: "failed", result: { summary: "A rotina falhou. Verifique as permissões ou tente novamente." }, completed_at: new Date().toISOString() }).eq("id", run.id);
      }
    }
  }
  return NextResponse.json({ ok: true, run_date: day, started, completed, skipped }, { headers: { "Cache-Control": "no-store" } });
}
