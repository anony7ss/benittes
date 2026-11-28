import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clientAddress, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, readBoundedJson, rateLimitedResponse } from "../../../../../lib/security/http";
import { ensureWorkOrderForApprovedQuote, markQuoteWorkOrderGenerated } from "../../../../../lib/quoteWorkOrderAutomation";

function getAdminClient() {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceKey) {
    throw new Error("Configuração do servidor incompleta para ficha pública.");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function asObj(val: unknown): Record<string, unknown> {
  return val && typeof val === "object" && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function publicQuoteItems(value: unknown): Array<{ id: string; name: string; type: "servico" | "peca"; qty: number; unit_price: number; approved?: boolean }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((item) => {
    const row = asObj(item);
    const id = typeof row.id === "string" ? row.id.slice(0, 100) : "";
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 180) : "";
    const qty = Number(row.qty ?? 1);
    const unitPrice = Number(row.unit_price ?? 0);
    if (!id || !name || !Number.isInteger(qty) || qty < 1 || qty > 1000 || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000) return [];
    return [{
      id,
      name,
      type: row.type === "peca" ? "peca" : "servico",
      qty,
      unit_price: unitPrice,
      ...(typeof row.approved === "boolean" ? { approved: row.approved } : {}),
    }];
  });
}

function quoteDiscount(details: Record<string, unknown>) {
  const type = details.desconto_tipo === "fixo" ? "fixo" : "percentual";
  const raw = Number(details.desconto_valor ?? 0);
  const value = Number.isFinite(raw) && raw > 0
    ? Math.min(type === "percentual" ? 100 : 10_000_000, raw)
    : 0;
  return { type, value };
}

function totalAfterQuoteDiscount(subtotal: number, fullSubtotal: number, details: Record<string, unknown>) {
  const discount = quoteDiscount(details);
  const discountAmount = discount.type === "percentual"
    ? subtotal * discount.value / 100
    : fullSubtotal > 0
      ? discount.value * subtotal / fullSubtotal
      : 0;
  return Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
}

async function buildPublicPayload(supabase: ReturnType<typeof getAdminClient>, token: string) {
  const { data: quote, error: quoteErr } = await supabase
    .from("quotes")
    .select("id,reference,customer_name,phone,vehicle_plate,client_id,vehicle_id,created_by,total,notes,status,valid_until,details,created_at,updated_at")
    .contains("details", { public_token: token })
    .maybeSingle();

  if (quoteErr) {
    throw new Error(quoteErr.message);
  }
  if (!quote) {
    return null;
  }

  const quoteDetails = asObj(quote.details);

  // Busca OS vinculada a este orçamento (se já tiver sido aprovada/gerada)
  let { data: workOrder } = await supabase
    .from("work_orders")
    .select("id, reference, status, diagnosis, notes, total, details, created_at, updated_at")
    .eq("quote_id", quote.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Compatibility with OS criadas antes do vínculo passar a usar quote_id.
  if (!workOrder) {
    const legacy = await supabase
      .from("work_orders")
      .select("id, reference, status, diagnosis, notes, total, details, created_at, updated_at")
      .contains("details", { orcamento_id: quote.id })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    workOrder = legacy.data;
  }

  // Enriquece dados do veículo pela placa, se existir
  let vehicleInfo: {
    plate: string | null;
    make: string | null;
    model: string | null;
    model_year: number | null;
  } | null = null;

  if (quote.vehicle_plate) {
    const { data: veh } = await supabase
      .from("vehicles")
      .select("license_plate, make, model, model_year")
      .ilike("license_plate", String(quote.vehicle_plate).trim())
      .limit(1)
      .maybeSingle();

    if (veh) {
      vehicleInfo = {
        plate: veh.license_plate ?? quote.vehicle_plate,
        make: veh.make ?? null,
        model: veh.model ?? null,
        model_year: typeof veh.model_year === "number" ? veh.model_year : null,
      };
    }
  }

  const workshopWhatsapp =
    process.env.NEXT_PUBLIC_WHATSAPP || process.env.PUBLIC_WHATSAPP || "";

  return {
    quote: {
      id: quote.id,
      title: quote.reference ?? "Orçamento",
      customer_name: quote.customer_name ?? null,
      vehicle_plate: quote.vehicle_plate ?? null,
      vehicle_info: vehicleInfo,
      amount: Number(quote.total ?? 0),
      description: quote.notes ?? null,
      status: quote.status ?? "novo",
      valid_until: quote.valid_until ?? (quoteDetails.validade as string | null) ?? null,
      aprovacao: (quoteDetails.aprovacao as string | null) ?? "pendente",
      aprovado_em: (quoteDetails.aprovado_em as string | null) ?? null,
      recusado_em: (quoteDetails.recusado_em as string | null) ?? null,
      observacao_cliente: (quoteDetails.observacao_cliente as string | null) ?? null,
      motivo_recusa: (quoteDetails.motivo_recusa as string | null) ?? null,
      aprovacao_parcial: Boolean(quoteDetails.aprovacao_parcial),
      desconto_tipo: quoteDiscount(quoteDetails).type,
      desconto_valor: quoteDiscount(quoteDetails).value,
      permitir_aprovacao_parcial: quoteDetails.permitir_aprovacao_parcial !== false,
      items: publicQuoteItems(quoteDetails.items),
      created_at: quote.created_at,
      updated_at: quote.updated_at,
    },
    workOrder: workOrder
      ? {
          id: workOrder.id,
          reference: workOrder.reference ?? quote.reference ?? "Ordem de Serviço",
          status: workOrder.status ?? "novo",
          diagnosis: workOrder.diagnosis ?? null,
          notes: null,
          total: Number(workOrder.total ?? quote.total ?? 0),
          created_at: workOrder.created_at,
          updated_at: workOrder.updated_at,
        }
      : null,
    workshop: {
      name: "Benittes Oficina Mecânica",
      whatsapp: workshopWhatsapp.replace(/\D/g, ""),
    },
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const cleanToken = String(token ?? "").trim();
    if (!/^[a-f0-9]{64}$/i.test(cleanToken)) {
      return NextResponse.json({ error: "Link inválido." }, { status: 400 });
    }

    if (!(await enforceRateLimits([
      { scope: "public-quote-get-ip", subject: clientAddress(request), maxHits: 120, windowSeconds: 300 },
      { scope: "public-quote-get-token", subject: cleanToken.toLowerCase(), maxHits: 60, windowSeconds: 300 },
    ]))) return rateLimitedResponse();

    const supabase = getAdminClient();
    const payload = await buildPublicPayload(supabase, cleanToken);
    if (!payload) {
      return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar o orçamento." }, { status: 503 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  try {
    const { token } = await context.params;
    const cleanToken = String(token ?? "").trim();
    if (!/^[a-f0-9]{64}$/i.test(cleanToken)) {
      return NextResponse.json({ error: "Link inválido." }, { status: 400 });
    }

    if (!(await enforceRateLimits([
      { scope: "public-quote-response-ip", subject: clientAddress(request), maxHits: 20, windowSeconds: 900 },
      { scope: "public-quote-response-token", subject: cleanToken.toLowerCase(), maxHits: 8, windowSeconds: 900 },
    ]))) return rateLimitedResponse();

    const parsed = await readBoundedJson<{
      action?: unknown;
      note?: unknown;
      approved_item_ids?: unknown;
    } | null>(request, 8 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }

    const action = body?.action === "approve" || body?.action === "reject" ? body.action : null;
    if (!action) {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }

    const note = String(body?.note ?? "").trim().slice(0, 500);
    const approvedItemIds = Array.isArray(body?.approved_item_ids)
      ? body.approved_item_ids.map((id) => typeof id === "string" ? id : "")
      : null;
    if (approvedItemIds && (approvedItemIds.length > 200 || approvedItemIds.some((id) => !id || id.length > 100) || new Set(approvedItemIds).size !== approvedItemIds.length)) {
      return NextResponse.json({ error: "A lista de itens não é válida." }, { status: 400 });
    }
    const supabase = getAdminClient();

    const { data: quote, error: quoteErr } = await supabase
      .from("quotes")
      .select("id,reference,total,status,valid_until,details,updated_at,notes,customer_name,phone,vehicle_plate,client_id,vehicle_id,created_by")
      .contains("details", { public_token: cleanToken })
      .maybeSingle();

    if (quoteErr) {
      return NextResponse.json({ error: "Não foi possível carregar o orçamento." }, { status: 503 });
    }
    if (!quote) {
      return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
    }

    const existingDetails = asObj(quote.details);
    if (action === "approve" && approvedItemIds && existingDetails.permitir_aprovacao_parcial === false) {
      return NextResponse.json({ error: "Este orçamento deve ser aprovado por completo." }, { status: 400 });
    }
    const currentApproval = String(existingDetails.aprovacao ?? "pendente");
    const validity = quote.valid_until ?? (typeof existingDetails.validade === "string" ? existingDetails.validade : null);
    if (validity && Number.isFinite(new Date(validity).getTime()) && new Date(`${validity.slice(0, 10)}T23:59:59`).getTime() < Date.now()) {
      return NextResponse.json({ error: "A validade deste orçamento terminou." }, { status: 410 });
    }

    if (currentApproval === "aprovado" || quote.status === "concluido") {
      if (action === "approve") {
        const workOrder = await ensureWorkOrderForApprovedQuote(supabase, {
          ...quote,
          details: existingDetails,
        });
        if (workOrder) await markQuoteWorkOrderGenerated(supabase, quote.id, workOrder.id);
        const updatedPayload = await buildPublicPayload(supabase, cleanToken);
        return NextResponse.json(updatedPayload, { headers: { "Cache-Control": "no-store" } });
      }
      return NextResponse.json(
        { error: "Este orçamento já foi aprovado." },
        { status: 409 },
      );
    }
    if (currentApproval === "recusado" || quote.status === "cancelado") {
      return NextResponse.json(
        { error: "Este orçamento já foi recusado." },
        { status: 409 },
      );
    }

    const isoDate = todayIso();

    if (action === "approve") {
      const rawItems = Array.isArray(existingDetails.items)
        ? (existingDetails.items as Array<Record<string, unknown>>)
        : [];
      if (rawItems.length > 200) return NextResponse.json({ error: "Este orçamento contém itens demais para aprovação online." }, { status: 400 });
      let nextItems = rawItems;
      let nextTotal = Number(quote.total ?? 0);
      if (!Number.isFinite(nextTotal) || nextTotal < 0 || nextTotal > 10_000_000) {
        return NextResponse.json({ error: "Valor do orçamento inválido." }, { status: 400 });
      }
      let isPartial = false;

      if (rawItems.length > 0) {
        if (approvedItemIds) {
          const knownItemIds = new Set(rawItems.map((item) => String(item.id ?? "")));
          if (approvedItemIds.some((id) => !knownItemIds.has(id))) {
            return NextResponse.json({ error: "A lista contém itens que não pertencem a este orçamento." }, { status: 400 });
          }
          nextItems = rawItems.map((it) => ({
            ...it,
            approved: approvedItemIds.includes(String(it.id ?? "")),
          }));
        } else {
          nextItems = rawItems.map((it) => ({
            ...it,
            approved: it.approved !== false,
          }));
        }
        const approvedOnly = nextItems.filter((it) => it.approved !== false);
        if (approvedOnly.length === 0) {
          return NextResponse.json({ error: "Selecione pelo menos um item para aprovar." }, { status: 400 });
        }
        if (approvedOnly.some((it) => {
          const unitPrice = Number(it.unit_price ?? 0);
          return !Number.isFinite(unitPrice) || unitPrice <= 0;
        })) {
          return NextResponse.json(
            { error: "Há itens sem preço final. Solicite à oficina a atualização do orçamento antes de aprovar." },
            { status: 422 },
          );
        }
        if (approvedOnly.some((it) => {
          const qty = Number(it.qty ?? 1);
          return !Number.isInteger(qty) || qty < 1 || qty > 1000;
        })) {
          return NextResponse.json({ error: "A quantidade de um dos itens é inválida." }, { status: 400 });
        }
        const approvedSubtotal = approvedOnly.reduce((acc, it) => {
          const qty = Number(it.qty ?? 1);
          const unitPrice = Number(it.unit_price ?? 0);
          return acc + qty * unitPrice;
        }, 0);
        const fullSubtotal = rawItems.reduce((acc, it) => {
          const qty = Number(it.qty ?? 1);
          const unitPrice = Number(it.unit_price ?? 0);
          return Number.isInteger(qty) && qty > 0 && Number.isFinite(unitPrice) && unitPrice > 0
            ? acc + qty * unitPrice
            : acc;
        }, 0);
        nextTotal = totalAfterQuoteDiscount(approvedSubtotal, fullSubtotal, existingDetails);
        if (!Number.isFinite(nextTotal) || nextTotal <= 0 || nextTotal > 10_000_000) return NextResponse.json({ error: "O total aprovado precisa ter um valor final maior que zero." }, { status: 422 });
        isPartial = approvedOnly.length < rawItems.length;
      } else if (nextTotal <= 0) {
        return NextResponse.json(
          { error: "Este orçamento ainda não tem um valor final. Solicite a atualização à oficina antes de aprovar." },
          { status: 422 },
        );
      }

      const approvedDetails = {
        ...existingDetails,
        ...(rawItems.length > 0 ? { items: nextItems } : {}),
        aprovacao: "aprovado",
        aprovacao_parcial: isPartial,
        aprovado_em: isoDate,
        aprovado_via: "ficha_online",
        ...(note ? { observacao_cliente: note } : {}),
      };
      const { data, error: updErr } = await supabase
        .from("quotes")
        .update({
          status: "concluido",
          total: nextTotal,
          details: approvedDetails,
        })
        .eq("id", quote.id)
        .eq("status", quote.status)
        .eq("updated_at", quote.updated_at)
        .select("id")
        .maybeSingle();

      if (updErr || !data) {
        return NextResponse.json({ error: "Este orçamento recebeu outra resposta. Atualize a página." }, { status: 409 });
      }

      const workOrder = await ensureWorkOrderForApprovedQuote(supabase, {
        ...quote,
        total: nextTotal,
        details: approvedDetails,
      });
      if (workOrder) await markQuoteWorkOrderGenerated(supabase, quote.id, workOrder.id);
    } else {
      const { data, error: updErr } = await supabase
        .from("quotes")
        .update({
          status: "cancelado",
          details: {
            ...existingDetails,
            aprovacao: "recusado",
            recusado_em: isoDate,
            recusado_via: "ficha_online",
            ...(note ? { motivo_recusa: note } : {}),
          },
        })
        .eq("id", quote.id)
        .eq("status", quote.status)
        .eq("updated_at", quote.updated_at)
        .select("id")
        .maybeSingle();

      if (updErr || !data) {
        return NextResponse.json({ error: "Este orçamento recebeu outra resposta. Atualize a página." }, { status: 409 });
      }
    }

    const updatedPayload = await buildPublicPayload(supabase, cleanToken);
    return NextResponse.json(updatedPayload, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível processar a resposta." }, { status: 503 });
  }
}
