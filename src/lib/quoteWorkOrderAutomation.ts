import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type JsonObject = Record<string, unknown>;

export type ApprovedQuoteForWorkOrder = {
  id: string;
  reference?: string | null;
  notes?: string | null;
  total?: number | string | null;
  customer_name?: string | null;
  phone?: string | null;
  vehicle_plate?: string | null;
  client_id?: string | null;
  vehicle_id?: string | null;
  created_by?: string | null;
  details?: unknown;
};

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function isAutomaticWorkOrderOnQuoteApprovalEnabled(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("workshop_settings")
    .select("value")
    .eq("key", "estabelecimento")
    .maybeSingle();

  if (error) throw new Error("Não foi possível carregar a configuração de criação automática de OS.");

  const value = asObject(data?.value);
  const details = asObject(value.details);
  // Mantém o comportamento ativado em instalações que ainda não salvaram esta opção.
  return details.criar_os_automaticamente !== false;
}

export async function ensureWorkOrderForApprovedQuote(
  supabase: SupabaseClient,
  quote: ApprovedQuoteForWorkOrder,
): Promise<{ id: string } | null> {
  if (!(await isAutomaticWorkOrderOnQuoteApprovalEnabled(supabase))) return null;

  const { data: linkedOrder, error: linkedOrderError } = await supabase
    .from("work_orders")
    .select("id")
    .eq("quote_id", quote.id)
    .limit(1)
    .maybeSingle();

  if (linkedOrderError) throw new Error("Não foi possível verificar se o orçamento já tem uma OS.");
  if (linkedOrder?.id) return { id: String(linkedOrder.id) };

  // Compatibilidade com OS criadas pelo fluxo manual anterior, que só gravava o vínculo em details.
  const { data: legacyOrder, error: legacyOrderError } = await supabase
    .from("work_orders")
    .select("id")
    .contains("details", { orcamento_id: quote.id })
    .limit(1)
    .maybeSingle();

  if (legacyOrderError) throw new Error("Não foi possível verificar se o orçamento já tem uma OS.");
  if (legacyOrder?.id) return { id: String(legacyOrder.id) };

  const total = Number(quote.total ?? 0);
  if (!Number.isFinite(total) || total <= 0 || total > 10_000_000) {
    throw new Error("O orçamento aprovado não tem um total válido para gerar a OS.");
  }

  const quoteDetails = asObject(quote.details);
  const approvedItems = Array.isArray(quoteDetails.items)
    ? quoteDetails.items.slice(0, 200).flatMap((value) => {
        const item = asObject(value);
        if (item.approved === false) return [];
        const name = typeof item.name === "string" ? item.name.trim().slice(0, 180) : "";
        const qty = Number(item.qty ?? 1);
        const unitPrice = Number(item.unit_price ?? 0);
        if (!name || !Number.isInteger(qty) || qty < 1 || qty > 1000 || !Number.isFinite(unitPrice) || unitPrice <= 0) return [];
        return [{
          id: typeof item.id === "string" ? item.id.slice(0, 100) : undefined,
          name,
          type: item.type === "peca" ? "peca" : "servico",
          qty,
          unit_price: unitPrice,
          ...(typeof item.service_id === "string" ? { service_id: item.service_id.slice(0, 100) } : {}),
        }];
      })
    : [];

  const details: JsonObject = {
    aprovacao: "aprovado",
    aprovado_em: typeof quoteDetails.aprovado_em === "string" ? quoteDetails.aprovado_em : todayIso(),
    orcamento_id: quote.id,
    origem: "orcamento_aprovado",
    price_pending: false,
    items: approvedItems,
  };

  for (const key of ["service_id", "pricing_mode", "pricing_rule_id", "marca", "modelo", "ano"]) {
    const value = quoteDetails[key];
    if (typeof value === "string" && value.trim()) details[key] = value.slice(0, 180);
  }

  const { data: createdOrder, error: createError } = await supabase
    .from("work_orders")
    .insert({
      quote_id: quote.id,
      client_id: quote.client_id ?? null,
      vehicle_id: quote.vehicle_id ?? null,
      reference: String(quote.reference || "Ordem de Serviço").trim().slice(0, 80) || "Ordem de Serviço",
      notes: quote.notes ?? null,
      total,
      status: "novo",
      customer_name: quote.customer_name ?? null,
      phone: quote.phone ?? null,
      vehicle_plate: quote.vehicle_plate ?? null,
      created_by: quote.created_by ?? null,
      details,
    })
    .select("id")
    .single();

  if (createError || !createdOrder?.id) {
    // A aprovação pode ter sido processada simultaneamente; reler o vínculo deixa a operação repetível.
    const { data: racedOrder } = await supabase
      .from("work_orders")
      .select("id")
      .eq("quote_id", quote.id)
      .limit(1)
      .maybeSingle();
    if (racedOrder?.id) return { id: String(racedOrder.id) };
    throw new Error("Não foi possível criar a ordem de serviço do orçamento aprovado.");
  }

  return { id: String(createdOrder.id) };
}

export async function markQuoteWorkOrderGenerated(
  supabase: SupabaseClient,
  quoteId: string,
  workOrderId: string,
): Promise<void> {
  const { data: quote, error: readError } = await supabase
    .from("quotes")
    .select("details")
    .eq("id", quoteId)
    .maybeSingle();

  if (readError || !quote) throw new Error("A OS foi criada, mas não foi possível atualizar o vínculo no orçamento.");

  const details = asObject(quote.details);
  if (details.os_gerada === true && details.os_id === workOrderId) return;

  const { error: updateError } = await supabase
    .from("quotes")
    .update({
      details: {
        ...details,
        os_gerada: true,
        os_id: workOrderId,
        os_gerada_em: typeof details.os_gerada_em === "string" ? details.os_gerada_em : todayIso(),
      },
    })
    .eq("id", quoteId);

  if (updateError) throw new Error("A OS foi criada, mas não foi possível atualizar o vínculo no orçamento.");
}
