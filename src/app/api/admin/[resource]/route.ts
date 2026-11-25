import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOMAIN_TABLE_BY_MODULE, fromDomainRow, toDomainPayload } from "../../../../lib/domainTables";
import { consumeRateLimit, databaseErrorResponse, isSameOriginRequest, readBoundedJson } from "../../../../lib/security/http";
import { getServiceSupabase, requirePanelStaff } from "../../../../lib/supabaseAdmin";

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

  try {
    const staff = await requirePanelStaff(request);
    if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    const supabase = staff.supabase as unknown as SupabaseClient;

    if (resource === "me") {
      return NextResponse.json({ member: staff.member }, { headers: { "Cache-Control": "no-store" } });
    }

    if (resource === "dashboard") {
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
    const payload = domainTable ? toDomainPayload(resource, body, false) : body;
    const supabase = staff.supabase as unknown as SupabaseClient;

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
      };
      const digits = String(created.phone || "").replace(/\D/g, "");
      if (digits.length >= 10) {
        try {
          const maySend = await consumeRateLimit("quote-message-user", staff.user.id, 40, 86400).catch(() => false)
            && await consumeRateLimit("quote-message-record", created.id, 1, 86400).catch(() => false);
          const service = getServiceSupabase();
          const { data: botCfg } = await service
            .from("whatsapp_bot_session")
            .select("auto_send_quotes")
            .eq("id", "default")
            .maybeSingle();

          if (maySend && botCfg?.auto_send_quotes !== false) {
            const normalized =
              digits.length <= 11 && !digits.startsWith("55") ? `55${digits}` : digits;
            const moneyText = Number(created.amount ?? 0).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            });
            const tipoLabel = resource === "work-orders" ? "Ordem de Serviço" : "Orçamento";
            const msg = [
              `Olá${created.customer_name ? `, *${created.customer_name}*` : ""}! 👋`,
              `Aqui é da *Benittes Oficina Mecânica*.`,
              "",
              `Preparamos o orçamento da sua ${tipoLabel}:`,
              created.vehicle ? `🚗 *Veículo:* ${created.vehicle}` : null,
              `🔧 *Serviço:* ${created.title}`,
              `💰 *Valor:* ${moneyText}`,
              "",
              `Você aprova a execução deste serviço?`,
              `Responda aqui com *Sim / Aprovar* ou *Não / Recusar*.`,
            ]
              .filter((line) => line !== null)
              .join("\n");

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
    const payload = domainTable ? toDomainPayload(resource, body, true) : body;
    const supabase = staff.supabase as unknown as SupabaseClient;
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
