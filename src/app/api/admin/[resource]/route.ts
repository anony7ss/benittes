import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOMAIN_TABLE_BY_MODULE, fromDomainRow, toDomainPayload } from "../../../../lib/domainTables";
import { pricingModeForService, resolveServicePrice, vehiclePriceProfileFromRow } from "../../../../lib/servicePricing";
import { consumeRateLimit, databaseErrorResponse, isSameOriginRequest, readBoundedJson } from "../../../../lib/security/http";
import { getServiceSupabase, hasPanelPermission, requirePanelStaff } from "../../../../lib/supabaseAdmin";
import { getAdminSession, migrateAdminSession, signOutAdminSession } from "../../../../lib/adminSessionApi";

const TABLE_ALIASES: Record<string, string> = {
  contacts: "contact_messages",
  contact_messages: "contact_messages",
  members: "panel_members",
  panel_members: "panel_members",
  audit: "audit_logs",
  audit_logs: "audit_logs",
  content: "site_content",
  site_content: "site_content",
  panel_records: "panel_records",
};

function defaultOrderForTable(table: string): string | null {
  if (table === "workshop_settings") return "updated_at.desc";
  if (table === "site_content") return "key.asc";
  if (table === "panel_members") return "created_at.asc";
  return "created_at.desc";
}

function resolveTable(resource: string): { domainTable: string | undefined; table: string | undefined } {
  const domainTable = Object.hasOwn(DOMAIN_TABLE_BY_MODULE, resource)
    ? DOMAIN_TABLE_BY_MODULE[resource]
    : undefined;
  const alias = Object.hasOwn(TABLE_ALIASES, resource) ? TABLE_ALIASES[resource] : undefined;
  return { domainTable, table: domainTable ?? alias };
}

function idColumnForTable(table: string): string {
  if (table === "workshop_settings" || table === "site_content") return "key";
  if (table === "panel_members") return "user_id";
  return "id";
}

function returningColumnsForTable(table: string): string {
  return table === "panel_members"
    ? "user_id,email,full_name,role,active,created_at,updated_at,phone,two_factor_enabled"
    : "*";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function applyMessageTemplate(template: unknown, values: Record<string, string>): string {
  return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => values[key] ?? "").trim();
}

async function normalizeQuotePayload(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  isUpdate: boolean,
): Promise<string | null> {
  if (!isPlainObject(payload.details)) return "Os detalhes do orçamento são inválidos.";

  const details = { ...payload.details };
  const discountType = details.desconto_tipo === "fixo" ? "fixo" : "percentual";
  const rawDiscount = details.desconto_valor ?? 0;
  const discountValue = typeof rawDiscount === "string"
    ? Number(rawDiscount.trim().replace(",", "."))
    : Number(rawDiscount);
  if (!Number.isFinite(discountValue) || discountValue < 0 || (discountType === "percentual" && discountValue > 100) || discountValue > 10_000_000) {
    return "Informe um desconto válido.";
  }

  details.desconto_tipo = discountType;
  details.desconto_valor = Math.round(discountValue * 100) / 100;
  details.forma_pagamento = typeof details.forma_pagamento === "string"
    ? details.forma_pagamento.trim().slice(0, 48)
    : "A combinar";
  details.permitir_aprovacao_parcial = details.permitir_aprovacao_parcial !== false;

  const hasItems = Object.hasOwn(details, "items");
  if (hasItems && !Array.isArray(details.items)) return "A lista de itens do orçamento é inválida.";
  if (Array.isArray(details.items)) {
    if (details.items.length > 200) return "O orçamento pode ter no máximo 200 itens.";

    const items = details.items as unknown[];
    const normalizedItems: Array<Record<string, unknown>> = [];
    const itemIds = new Set<string>();
    const serviceIds = new Set<string>();

    for (const [index, value] of items.entries()) {
      if (!isPlainObject(value)) return "Um dos itens do orçamento é inválido.";
      const name = typeof value.name === "string" ? value.name.trim().slice(0, 160) : "";
      const type = value.type === "peca" ? "peca" : value.type === "servico" ? "servico" : null;
      const id = typeof value.id === "string" ? value.id.trim().slice(0, 100) : `item-${index + 1}`;
      const qty = Number(value.qty ?? 1);
      const unitPrice = Number(value.unit_price ?? 0);
      const serviceId = typeof value.service_id === "string" ? value.service_id.trim() : "";
      if (!name || !type || !id || itemIds.has(id)) return "Confira a descrição e a identificação dos itens do orçamento.";
      if (!Number.isInteger(qty) || qty < 1 || qty > 1000) return "A quantidade de um item do orçamento é inválida.";
      if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000) return "O valor unitário de um item é inválido.";
      if (serviceId.length > 100 || (type === "servico" && serviceId && !/^[0-9a-f-]{36}$/i.test(serviceId))) {
        return "O serviço associado a um item é inválido.";
      }
      itemIds.add(id);
      if (type === "servico" && serviceId) serviceIds.add(serviceId);
      normalizedItems.push({
        id,
        name,
        type,
        qty,
        unit_price: Math.round(unitPrice * 100) / 100,
        price_pending: value.price_pending === true || unitPrice <= 0,
        approved: value.approved === false ? false : true,
        ...(type === "servico" && serviceId ? { service_id: serviceId } : {}),
      });
    }

    const servicesById = new Map<string, ReturnType<typeof fromDomainRow>>();
    const rulesByService = new Map<string, ReturnType<typeof fromDomainRow>[]>();
    if (serviceIds.size > 0) {
      const ids = [...serviceIds];
      const [{ data: serviceRows, error: serviceError }, { data: ruleRows, error: ruleError }] = await Promise.all([
        supabase.from("services").select("*").in("id", ids).limit(200),
        supabase.from("service_price_rules").select("*").in("service_id", ids).eq("active", true).limit(5000),
      ]);
      if (serviceError || ruleError) return "Não foi possível validar os serviços e preços do orçamento.";
      for (const row of serviceRows ?? []) {
        const service = fromDomainRow("services", row as unknown as Record<string, unknown>);
        servicesById.set(service.id, service);
      }
      for (const row of ruleRows ?? []) {
        const rule = fromDomainRow("prices", row as unknown as Record<string, unknown>);
        const serviceId = String((rule.details as Record<string, unknown> | undefined)?.service_id ?? "");
        if (!serviceId) continue;
        rulesByService.set(serviceId, [...(rulesByService.get(serviceId) ?? []), rule]);
      }
      if (ids.some((id) => !servicesById.has(id))) return "Um dos serviços selecionados não está mais disponível no catálogo.";
    }

    const needsVehicle = [...serviceIds].some((id) => {
      const service = servicesById.get(id);
      return service?.status !== "cancelado" && service && pricingModeForService(service) === "vehicle";
    });
    let trustedVehicle: ReturnType<typeof fromDomainRow> | null = null;
    const plate = typeof payload.vehicle_plate === "string" ? payload.vehicle_plate.trim().toUpperCase() : "";
    if (needsVehicle && plate) {
      const { data: vehicleRow, error: vehicleError } = await supabase
        .from("vehicles")
        .select("*")
        .eq("license_plate", plate)
        .maybeSingle();
      if (vehicleError) return "Não foi possível validar o veículo do orçamento.";
      if (vehicleRow) trustedVehicle = fromDomainRow("vehicles", vehicleRow as unknown as Record<string, unknown>);
    }

    for (const item of normalizedItems) {
      if (item.type !== "servico") continue;
      const serviceId = String(item.service_id ?? "");
      if (!serviceId) continue;
      const service = servicesById.get(serviceId);
      if (!service || service.status === "cancelado") return "Um dos serviços selecionados está inativo.";
      const vehicleProfile = needsVehicle ? vehiclePriceProfileFromRow(trustedVehicle) : null;
      const resolution = resolveServicePrice(service, rulesByService.get(serviceId) ?? [], vehicleProfile);
      const finalPrice = resolution.amount !== null && Number.isFinite(resolution.amount) && resolution.amount > 0
        ? Math.round(resolution.amount * 100) / 100
        : 0;
      const manuallySetPrice = finalPrice <= 0
        && item.price_pending !== true
        && Number(item.unit_price) > 0;
      item.unit_price = finalPrice > 0
        ? finalPrice
        : manuallySetPrice
          ? Math.round(Number(item.unit_price) * 100) / 100
          : 0;
      item.price_pending = finalPrice <= 0 && !manuallySetPrice;
      item.pricing_mode = resolution.mode;
      if (resolution.rule?.id) item.pricing_rule_id = resolution.rule.id;
    }

    const fullSubtotal = normalizedItems.reduce((sum, item) => sum + Number(item.qty) * Number(item.unit_price), 0);
    const approvedSubtotal = normalizedItems
      .filter((item) => item.approved !== false)
      .reduce((sum, item) => sum + Number(item.qty) * Number(item.unit_price), 0);
    if (!Number.isFinite(fullSubtotal) || fullSubtotal > 10_000_000) return "O total dos itens ultrapassa o limite permitido.";

    const discountAmount = discountType === "percentual"
      ? approvedSubtotal * discountValue / 100
      : fullSubtotal > 0
        ? discountValue * approvedSubtotal / fullSubtotal
        : 0;
    payload.total = Math.max(0, Math.round((approvedSubtotal - discountAmount) * 100) / 100);
    details.items = normalizedItems;
  } else if (Object.hasOwn(payload, "total")) {
    const subtotal = Number(payload.total);
    if (!Number.isFinite(subtotal) || subtotal < 0 || subtotal > 10_000_000) return "O valor do orçamento é inválido.";
    const discountAmount = discountType === "percentual"
      ? subtotal * discountValue / 100
      : discountValue;
    payload.total = Math.max(0, Math.round((subtotal - Math.min(subtotal, discountAmount)) * 100) / 100);
  } else if (!isUpdate) {
    payload.total = 0;
  }

  payload.details = details;
  return null;
}

async function validatePricingPayload(
  supabase: SupabaseClient,
  resource: string,
  payload: Record<string, unknown>,
  isUpdate: boolean,
  recordId?: string,
): Promise<string | null> {
  if (resource === "services" && Object.hasOwn(payload, "details") && isPlainObject(payload.details)) {
    const details = payload.details;
    const mode = details.pricing_mode;
    if (mode !== undefined && mode !== "fixed" && mode !== "vehicle" && mode !== "assessment") {
      return "Escolha uma forma de precificação válida.";
    }
    if (mode === "vehicle" || mode === "assessment") {
      payload.base_price = 0;
    } else if (mode === "fixed") {
      let amount = payload.base_price;
      if (amount === undefined && isUpdate) {
        const { data, error } = await supabase.from("services").select("base_price").eq("id", recordId).maybeSingle();
        if (error) return "Não foi possível validar o valor do serviço.";
        amount = data?.base_price;
      }
      if (!(Number(amount) > 0) || !Number.isFinite(Number(amount))) {
        return "Um serviço com preço fixo precisa ter um valor maior que zero.";
      }
    }
  }

  if (resource !== "prices") return null;
  if (Object.hasOwn(payload, "price") && (!(Number(payload.price) > 0) || !Number.isFinite(Number(payload.price)) || Number(payload.price) > 1_000_000)) {
    return "Informe uma tarifa maior que zero e menor que R$ 1.000.000.";
  }
  if (!Object.hasOwn(payload, "service_id")) return null;

  const serviceId = typeof payload.service_id === "string" ? payload.service_id : "";
  const make = typeof payload.vehicle_make === "string" ? payload.vehicle_make.trim() : "";
  const model = typeof payload.vehicle_model === "string" ? payload.vehicle_model.trim() : "";
  const application = payload.vehicle_application;
  const yearFrom = payload.year_from == null ? null : Number(payload.year_from);
  const yearTo = payload.year_to == null ? null : Number(payload.year_to);
  if (!serviceId || (!make && !model) || make.length > 100 || model.length > 120) {
    return "Vincule a tarifa a um serviço e informe a marca ou modelo do veículo.";
  }
  if (application != null && (typeof application !== "string" || application.length > 512)) {
    return "Os dados de aplicação do veículo excedem o limite permitido.";
  }
  if ([yearFrom, yearTo].some((year) => year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200))) {
    return "Use anos inteiros entre 1900 e 2200.";
  }
  if (yearFrom !== null && yearTo !== null && yearTo < yearFrom) {
    return "A faixa final do ano precisa ser igual ou posterior à inicial.";
  }
  for (const key of ["valid_from", "valid_until"]) {
    const value = payload[key];
    if (value != null && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) {
      return "Informe datas de validade válidas.";
    }
  }
  if (typeof payload.valid_from === "string" && typeof payload.valid_until === "string" && payload.valid_until < payload.valid_from) {
    return "A validade final precisa ser igual ou posterior à inicial.";
  }

  const { data: service, error } = await supabase.from("services").select("id,active,base_price,details").eq("id", serviceId).maybeSingle();
  if (error) return "Não foi possível validar o serviço relacionado à tarifa.";
  if (!service || service.active === false || !isPlainObject(service.details) || service.details.pricing_mode !== "vehicle") {
    return "A tarifa precisa estar vinculada a um serviço ativo configurado para preço por aplicação.";
  }
  return null;
}

async function syncFinalizedOrderOrSale(
  supabase: SupabaseClient,
  resource: string,
  row: {
    id: string;
    title: string;
    status: string;
    amount: number | null;
    customer_name: string | null;
    phone: string | null;
    vehicle: string | null;
    details: Record<string, unknown>;
  },
) {
  if ((resource !== "work-orders" && resource !== "sales") || row.status !== "concluido") {
    return row;
  }

  const details = row.details && typeof row.details === "object" ? { ...row.details } : {};
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;

  // 1. Contabilizar em Finanças (idempotente)
  const amount = Number(row.amount ?? 0);
  if (!details.finance_synced && amount > 0) {
    const isOs = resource === "work-orders";
    const descPrefix = isOs ? "OS" : "Venda";
    const plateTag = row.vehicle ? ` (${row.vehicle})` : "";
    const { error: finErr } = await supabase.from("finance_entries").insert({
      description: `${descPrefix}: ${row.title}${plateTag}`.slice(0, 240),
      direction: "receivable",
      category: isOs ? "Ordem de Serviço" : "Vendas / PDV",
      party_name: row.customer_name || null,
      due_at: today,
      paid_at: today,
      amount,
      payment_method: typeof details.forma_pagamento === "string" ? details.forma_pagamento : null,
      status: "concluido",
      details: {
        tipo: "receber",
        categoria: isOs ? "Ordem de Serviço" : "Vendas / PDV",
        vencimento: today,
        ...(isOs ? { source_work_order_id: row.id } : { source_sale_id: row.id }),
      },
    });
    if (!finErr) {
      details.finance_synced = true;
      changed = true;
    }
  }

  // 1b. Registrar em Vendas / PDV quando uma OS for finalizada (idempotente)
  if (resource === "work-orders" && !details.sale_synced && amount > 0) {
    const paymentMethod =
      typeof details.forma_pagamento === "string" && details.forma_pagamento.trim()
        ? details.forma_pagamento.trim()
        : "Pix";
    const { error: saleErr } = await supabase.from("sales").insert({
      reference: `OS: ${row.title}`.slice(0, 100),
      customer_name: row.customer_name || null,
      phone: row.phone || null,
      vehicle_plate: row.vehicle || null,
      total: amount,
      payment_method: paymentMethod,
      notes: row.vehicle ? `Ordem de serviço finalizada (${row.vehicle})` : "Ordem de serviço finalizada",
      status: "concluido",
      details: {
        source_work_order_id: row.id,
        forma_pagamento: paymentMethod,
        finance_synced: true,
      },
    });
    if (!saleErr) {
      details.sale_synced = true;
      changed = true;
    }
  }

  // 2. Dar baixa no estoque das peças envolvidas (idempotente)
  if (!details.inventory_deducted && Array.isArray(details.pecas) && details.pecas.length > 0) {
    for (const part of details.pecas as Array<{ id?: string; quantidade?: number }>) {
      if (!part?.id) continue;
      const qtyUsed = Math.max(0, Number(part.quantidade ?? 1));
      if (qtyUsed <= 0) continue;
      const { data: invItem } = await supabase
        .from("inventory_items")
        .select("id, quantity")
        .eq("id", part.id)
        .maybeSingle();
      if (invItem) {
        const nextQty = Math.max(0, Number(invItem.quantity ?? 0) - qtyUsed);
        await supabase.from("inventory_items").update({ quantity: nextQty }).eq("id", invItem.id);
      }
    }
    details.inventory_deducted = true;
    changed = true;
  }

  // 3. Avisar cliente no WhatsApp quando OS finalizar (direto, sem IA)
  if (resource === "work-orders" && !details.notified_finished) {
    const digits = String(row.phone || "").replace(/\D/g, "");
    if (digits.length >= 10) {
      try {
        const normalized = digits.length <= 11 && !digits.startsWith("55") ? `55${digits}` : digits;
        const msg = [
          `✅ *Serviço Finalizado — Benittes Oficina Mecânica*`,
          "",
          `Olá${row.customer_name ? `, *${row.customer_name}*` : ""}!`,
          row.vehicle ? `🚗 *Veículo:* ${row.vehicle}` : null,
          `🔧 *Serviço:* ${row.title}`,
          amount > 0
            ? `💰 *Valor:* ${amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
            : null,
          "",
          `Seu veículo já está pronto para retirada! Qualquer dúvida, responda por aqui.`,
        ]
          .filter((l) => l !== null)
          .join("\n");

        const mayNotify = await consumeRateLimit("os-finished-notice", row.id, 1, 86400).catch(() => false);
        if (mayNotify) {
          const { error: outboxError } = await getServiceSupabase().from("whatsapp_outbox").insert({
          phone: normalized,
          message: msg,
          kind: "os_finished",
          related_id: row.id,
          status: "pending",
        });
          if (!outboxError) {
            details.notified_finished = true;
            changed = true;
          }
        }
      } catch {
        // ignore outbox failure
      }
    }
  }

  if (changed) {
    const targetTable = resource === "work-orders" ? "work_orders" : "sales";
    await supabase.from(targetTable).update({ details }).eq("id", row.id);
    row = { ...row, details };
  }

  // 4. Pós-finalização configurável para OS (manter | arquivar | apagar)
  if (resource === "work-orders") {
    try {
      const { data: osCfgRow } = await supabase
        .from("workshop_settings")
        .select("value")
        .in("key", ["os_config", "os-config"])
        .limit(1)
        .maybeSingle();
      const action = String(
        (osCfgRow?.value as { details?: { pos_finalizacao?: string } } | null)?.details
          ?.pos_finalizacao || "manter",
      );

      if (action === "arquivar" && !details.archived) {
        const archivedDetails = { ...details, archived: true, archived_at: today };
        await supabase.from("work_orders").update({ details: archivedDetails }).eq("id", row.id);
        return { ...row, details: archivedDetails };
      }

      if (action === "apagar") {
        await supabase.from("work_orders").delete().eq("id", row.id);
        return { ...row, details: { ...details, deleted_after_finalize: true } };
      }
    } catch {
      // ignore settings read failure
    }
  }

  return row;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  const { resource } = await context.params;
  if (resource === "session") return getAdminSession(request);

  try {
    const staff = await requirePanelStaff(request);
    if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    const supabase = staff.supabase as unknown as SupabaseClient;

    if (resource === "me") {
      return NextResponse.json({ member: staff.member }, { headers: { "Cache-Control": "no-store" } });
    }

    if (resource === "dashboard") {
      if (!hasPanelPermission(staff.member, "dashboard", "read")) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
      const [msgs, cli, apts, os, inv, sls] = await Promise.all([
        supabase.from("contact_messages").select("*").order("created_at", { ascending: false }).limit(20),
        supabase.from("clients").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("appointments").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("work_orders").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("inventory_items").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("sales").select("*").order("created_at", { ascending: false }).limit(200),
      ]);
      return NextResponse.json({
        messages: msgs.data ?? [],
        clients: (cli.data ?? []).map((r) => fromDomainRow("clients", r as unknown as Record<string, unknown>)),
        appointments: (apts.data ?? []).map((r) => fromDomainRow("appointments", r as unknown as Record<string, unknown>)),
        workOrders: (os.data ?? []).map((r) => fromDomainRow("work-orders", r as unknown as Record<string, unknown>)),
        inventory: (inv.data ?? []).map((r) => fromDomainRow("inventory", r as unknown as Record<string, unknown>)),
        sales: (sls.data ?? []).map((r) => fromDomainRow("sales", r as unknown as Record<string, unknown>)),
      });
    }

    if (resource === "alerts") {
      if (!hasPanelPermission(staff.member, "dashboard", "read")) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
      const [msgs, apts, inv, fin] = await Promise.all([
        supabase.from("contact_messages").select("*").eq("status", "new").order("created_at", { ascending: false }).limit(5),
        supabase.from("appointments").select("*").eq("status", "novo").order("created_at", { ascending: false }).limit(5),
        supabase.from("inventory_items").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("finance_entries").select("*").order("created_at", { ascending: false }).limit(50),
      ]);
      return NextResponse.json({
        messages: msgs.data ?? [],
        appointments: (apts.data ?? []).map((r) => fromDomainRow("appointments", r as unknown as Record<string, unknown>)),
        inventory: (inv.data ?? []).map((r) => fromDomainRow("inventory", r as unknown as Record<string, unknown>)),
        finance: (fin.data ?? []).map((r) => fromDomainRow("finance", r as unknown as Record<string, unknown>)),
      });
    }

    const { domainTable, table } = resolveTable(resource);
    if (!table) {
      return NextResponse.json({ error: "Recurso não permitido." }, { status: 400 });
    }

    const searchParams = request.nextUrl.searchParams;
    const requestedOrder = searchParams.get("order");
    const requestedColumns = searchParams.get("select") ?? "*";
    const columns = table === "panel_members"
      ? "user_id,email,full_name,role,active,created_at,updated_at,phone,two_factor_enabled"
      : domainTable
        ? "*"
        : requestedColumns;
    if (!domainTable && table !== "panel_members" && !/^(?:\*|[A-Za-z_][A-Za-z0-9_]*(?:,[A-Za-z_][A-Za-z0-9_]*|,\*)*)$/.test(columns)) {
      return NextResponse.json({ error: "Seleção de campos inválida." }, { status: 400 });
    }
    const rawLimit = searchParams.get("limit") ?? "500";
    const requestedLimit = Number(rawLimit);
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
      return NextResponse.json({ error: "Limite inválido (use um número inteiro positivo)." }, { status: 400 });
    }
    // Keep large client requests compatible while bounding every database read.
    const limit = Math.min(requestedLimit, 500);

    type DynamicResult = { data: unknown[] | null; error: { message: string; code?: string } | null };
    type DynamicQuery = PromiseLike<DynamicResult> & {
      filter(column: string, operator: string, value: string): DynamicQuery;
      order(column: string, options: { ascending: boolean }): DynamicQuery;
      limit(count: number): DynamicQuery;
    };

    let query = supabase.from(table).select(columns) as unknown as DynamicQuery;
    if (!domainTable) {
      for (const [column, expression] of searchParams.entries()) {
        if (column === "select" || column === "order" || column === "limit") continue;
        const separator = expression.indexOf(".");
        if (separator < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
          return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
        }
        const operator = expression.slice(0, separator);
        const value = expression.slice(separator + 1);
        if (!["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"].includes(operator) || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
          return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
        }
        query = query.filter(column, operator as "eq", value);
      }
    }

    if (requestedOrder && !/^[A-Za-z_][A-Za-z0-9_]*\.(?:asc|desc)$/i.test(requestedOrder) && requestedOrder !== "title.asc") {
      return NextResponse.json({ error: "Ordenação inválida." }, { status: 400 });
    }
    const sqlOrder = domainTable ? defaultOrderForTable(table) : (requestedOrder ?? defaultOrderForTable(table));
    if (sqlOrder) {
      const [column, direction] = sqlOrder.split(".");
      query = query.order(column, { ascending: direction !== "desc" });
    }
    query = query.limit(limit);

    const { data, error } = await query;
    if (error) return databaseErrorResponse(error);

    if (domainTable) {
      let mapped = (data ?? []).map((r) => fromDomainRow(resource, r as unknown as Record<string, unknown>));
      if (requestedOrder === "title.asc") {
        mapped = mapped.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
      }
      return NextResponse.json({ data: mapped }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ data: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível concluir a operação." },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  const { resource } = await context.params;
  if (resource === "session") return migrateAdminSession(request);

  const { domainTable, table } = resolveTable(resource);
  if (!table) {
    return NextResponse.json({ error: "Recurso não permitido." }, { status: 400 });
  }
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origem da requisição inválida." }, { status: 403 });
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  try {
    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    const supabase = staff.supabase as unknown as SupabaseClient;
    const payload = domainTable ? toDomainPayload(resource, body, false) : body;
    if (resource === "quotes") {
      const quoteError = await normalizeQuotePayload(supabase, payload, false);
      if (quoteError) return NextResponse.json({ error: quoteError }, { status: 400 });
    }
    const pricingError = await validatePricingPayload(supabase, resource, payload, false);
    if (pricingError) return NextResponse.json({ error: pricingError }, { status: 400 });

    if (table === "workshop_settings") {
      const { data, error } = await supabase
        .from(table)
        .upsert(payload, { onConflict: "key" })
        .select(returningColumnsForTable(table));
      if (error) return databaseErrorResponse(error);
      return NextResponse.json({
        data: (data ?? []).map((r) => fromDomainRow(resource, r as unknown as Record<string, unknown>)),
      });
    }

    const { data, error } = await supabase.from(table).insert(payload).select(returningColumnsForTable(table));
    if (error) return databaseErrorResponse(error);

    const mapped = domainTable
      ? (data ?? []).map((r) => fromDomainRow(resource, r as unknown as Record<string, unknown>))
      : (data ?? []);

    if ((resource === "work-orders" || resource === "quotes") && mapped[0]) {
      const created = mapped[0] as {
        id: string;
        title: string;
        amount: number | null;
        customer_name: string | null;
        phone: string | null;
        vehicle: string | null;
        details?: Record<string, unknown>;
      };
      const digits = String(created.phone || "").replace(/\D/g, "");
      const quoteItems = Array.isArray(created.details?.items) ? created.details.items as Array<Record<string, unknown>> : [];
      const hasUnpricedItem = quoteItems.some((item) => item.approved !== false && !(Number(item.unit_price) > 0));
      const hasFinalPrice = Number(created.amount) > 0 && !hasUnpricedItem;
      if (digits.length >= 10 && hasFinalPrice) {
        try {
          const maySend = await consumeRateLimit("quote-message-user", staff.user.id, 40, 86400).catch(() => false)
            && await consumeRateLimit("quote-message-record", created.id, 1, 86400).catch(() => false);
          const service = getServiceSupabase();
          const { data: botCfg } = await service
            .from("whatsapp_bot_session")
            .select("automations_enabled,auto_send_quotes,auto_quote_message_template")
            .eq("id", "default")
            .maybeSingle();

          if (maySend && botCfg?.automations_enabled !== false && botCfg?.auto_send_quotes !== false) {
            const normalized =
              digits.length <= 11 && !digits.startsWith("55") ? `55${digits}` : digits;
            const moneyText = Number(created.amount ?? 0).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            });
            const tipoLabel = resource === "work-orders" ? "Ordem de Serviço" : "Orçamento";
            const msg = applyMessageTemplate(botCfg?.auto_quote_message_template, {
              nome: created.customer_name || "cliente",
              oficina: "Benittes Oficina Mecânica",
              servico: `${tipoLabel} · ${created.title}`,
              veiculo: created.vehicle || "veículo",
              placa: created.vehicle || "",
              valor: moneyText,
              link: "",
            });
            if (!msg) return NextResponse.json({ data: mapped });

            await service.from("whatsapp_outbox").insert({
              phone: normalized,
              message: msg,
              kind: resource === "work-orders" ? "os_quote" : "quote",
              related_id: created.id,
              status: "pending",
            });
          }
        } catch {
          // Não bloqueia a criação da OS/Orçamento se a fila outbox ainda não estiver configurada
        }
      }
    }

    if ((resource === "work-orders" || resource === "sales") && mapped[0]) {
      mapped[0] = (await syncFinalizedOrderOrSale(
        supabase,
        resource,
        mapped[0] as Parameters<typeof syncFinalizedOrderOrSale>[2],
      )) as (typeof mapped)[number];
    }

    return NextResponse.json({ data: mapped });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível concluir a operação." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  const { resource } = await context.params;
  const { domainTable, table } = resolveTable(resource);
  if (!table) {
    return NextResponse.json({ error: "Recurso não permitido." }, { status: 400 });
  }
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origem da requisição inválida." }, { status: 403 });
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  const idColumn = idColumnForTable(table);
  if (!id) return NextResponse.json({ error: "ID ausente." }, { status: 400 });

  try {
    const parsed = await readBoundedJson<Record<string, unknown>>(request, 1024 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    const supabase = staff.supabase as unknown as SupabaseClient;
    const payload = domainTable ? toDomainPayload(resource, body, true) : body;
    if (resource === "quotes" && Object.hasOwn(payload, "details")) {
      const quoteError = await normalizeQuotePayload(supabase, payload, true);
      if (quoteError) return NextResponse.json({ error: quoteError }, { status: 400 });
    }
    const pricingError = await validatePricingPayload(supabase, resource, payload, true, id);
    if (pricingError) return NextResponse.json({ error: pricingError }, { status: 400 });

    if (resource === "quotes" || resource === "work-orders") {
      const incomingDetails = body.details && typeof body.details === "object" && !Array.isArray(body.details)
        ? body.details as Record<string, unknown>
        : {};
      const requestsApproval = resource === "quotes"
        ? body.status === "concluido" || incomingDetails.aprovacao === "aprovado"
        : incomingDetails.aprovacao === "aprovado";
      if (requestsApproval) {
        const { data: current, error: currentError } = await supabase
          .from(table)
          .select("total,details")
          .eq(idColumn, id)
          .maybeSingle();
        if (currentError) return databaseErrorResponse(currentError);
        if (!current) return NextResponse.json({ error: "Registro não encontrado." }, { status: 404 });
        const nextAmount = Number(payload.total ?? current.total ?? 0);
        const currentDetails = current.details && typeof current.details === "object" && !Array.isArray(current.details)
          ? current.details as Record<string, unknown>
          : {};
        const nextDetails = { ...currentDetails, ...incomingDetails };
        const items = Array.isArray(nextDetails.items) ? nextDetails.items as Array<Record<string, unknown>> : [];
        const hasUnpricedItem = items.some((item) => item.approved !== false && !(Number(item.unit_price) > 0));
        if (!(nextAmount > 0) || hasUnpricedItem) {
          return NextResponse.json(
            { error: "Defina um valor final maior que zero para todos os itens aprovados antes de solicitar aprovação." },
            { status: 409 },
          );
        }
      }
    }

    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq(idColumn, id)
      .select(returningColumnsForTable(table));
    if (error) return databaseErrorResponse(error);
    const mapped = domainTable
      ? (data ?? []).map((r) => fromDomainRow(resource, r as unknown as Record<string, unknown>))
      : (data ?? []);

    if ((resource === "work-orders" || resource === "sales") && mapped[0]) {
      mapped[0] = (await syncFinalizedOrderOrSale(
        supabase,
        resource,
        mapped[0] as Parameters<typeof syncFinalizedOrderOrSale>[2],
      )) as (typeof mapped)[number];
    }

    return NextResponse.json({ data: mapped });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível concluir a operação." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ resource: string }> },
) {
  const { resource } = await context.params;
  if (resource === "session") return signOutAdminSession(request);

  const { table } = resolveTable(resource);
  if (!table) {
    return NextResponse.json({ error: "Recurso não permitido." }, { status: 400 });
  }
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origem da requisição inválida." }, { status: 403 });
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  const idColumn = idColumnForTable(table);
  if (!id) return NextResponse.json({ error: "ID ausente." }, { status: 400 });

  try {
    const supabase = staff.supabase;
    const { error } = await supabase.from(table).delete().eq(idColumn, id);
    if (error) return databaseErrorResponse(error);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível concluir a operação." },
      { status: 500 },
    );
  }
}
