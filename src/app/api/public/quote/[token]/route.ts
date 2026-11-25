import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

async function buildPublicPayload(supabase: ReturnType<typeof getAdminClient>, token: string) {
  const { data: quote, error: quoteErr } = await supabase
    .from("quotes")
    .select("*")
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
  const { data: workOrder } = await supabase
    .from("work_orders")
    .select("id, reference, status, diagnosis, notes, total, details, created_at, updated_at")
    .contains("details", { orcamento_id: quote.id })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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
      items: Array.isArray(quoteDetails.items) ? quoteDetails.items : [],
      created_at: quote.created_at,
      updated_at: quote.updated_at,
    },
    workOrder: workOrder
      ? {
          id: workOrder.id,
          reference: workOrder.reference ?? quote.reference ?? "Ordem de Serviço",
          status: workOrder.status ?? "novo",
          diagnosis: workOrder.diagnosis ?? null,
          notes: workOrder.notes ?? null,
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
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const cleanToken = String(token ?? "").trim();
    if (!cleanToken || cleanToken.length < 8 || cleanToken.length > 64) {
      return NextResponse.json({ error: "Link inválido." }, { status: 400 });
    }

    const supabase = getAdminClient();
    const payload = await buildPublicPayload(supabase, cleanToken);
    if (!payload) {
      return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao carregar ficha." },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const cleanToken = String(token ?? "").trim();
    if (!cleanToken || cleanToken.length < 8 || cleanToken.length > 64) {
      return NextResponse.json({ error: "Link inválido." }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      note?: unknown;
      approved_item_ids?: unknown;
    } | null;

    const action = body?.action === "approve" || body?.action === "reject" ? body.action : null;
    if (!action) {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }

    const note = String(body?.note ?? "").trim().slice(0, 500);
    const approvedItemIds = Array.isArray(body?.approved_item_ids)
      ? body.approved_item_ids.map((id) => String(id))
      : null;
    const supabase = getAdminClient();

    const { data: quote, error: quoteErr } = await supabase
      .from("quotes")
      .select("*")
      .contains("details", { public_token: cleanToken })
      .maybeSingle();

    if (quoteErr) {
      return NextResponse.json({ error: quoteErr.message }, { status: 500 });
    }
    if (!quote) {
      return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
    }

    const existingDetails = asObj(quote.details);
    const currentApproval = String(existingDetails.aprovacao ?? "pendente");

    if (currentApproval === "aprovado" || quote.status === "concluido") {
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
      let nextItems = rawItems;
      let nextTotal = Number(quote.total ?? 0);
      let isPartial = false;

      if (rawItems.length > 0 && approvedItemIds) {
        if (approvedItemIds.length === 0) {
          return NextResponse.json(
            { error: "Selecione pelo menos um item para aprovar." },
            { status: 400 },
          );
        }
        nextItems = rawItems.map((it) => ({
          ...it,
          approved: approvedItemIds.includes(String(it.id ?? "")),
        }));
        const approvedOnly = nextItems.filter((it) => it.approved === true);
        nextTotal = approvedOnly.reduce(
          (acc, it) => acc + Math.max(1, Number(it.qty ?? 1)) * Math.max(0, Number(it.unit_price ?? 0)),
          0,
        );
        isPartial = approvedOnly.length < rawItems.length;
      }

      const { error: updErr } = await supabase
        .from("quotes")
        .update({
          status: "concluido",
          total: nextTotal,
          details: {
            ...existingDetails,
            ...(rawItems.length > 0 ? { items: nextItems } : {}),
            aprovacao: "aprovado",
            aprovacao_parcial: isPartial,
            aprovado_em: isoDate,
            aprovado_via: "ficha_online",
            ...(note ? { observacao_cliente: note } : {}),
          },
        })
        .eq("id", quote.id);

      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
    } else {
      const { error: updErr } = await supabase
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
        .eq("id", quote.id);

      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
    }

    const updatedPayload = await buildPublicPayload(supabase, cleanToken);
    return NextResponse.json(updatedPayload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao processar resposta." },
      { status: 500 },
    );
  }
}
