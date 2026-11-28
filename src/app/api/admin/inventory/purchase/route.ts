import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse, isSameOriginRequest, readBoundedJson } from "../../../../../lib/security/http";
import { hasPanelPermission, requirePanelStaff } from "../../../../../lib/supabaseAdmin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Origem da requisição inválida." }, { status: 403 });
  }
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!hasPanelPermission(staff.member, "inventory", "write")) {
    return NextResponse.json({ error: "Acesso negado ao estoque." }, { status: 403 });
  }

  const parsed = await readBoundedJson<{
    request_id?: unknown;
    item_id?: unknown;
    quantity?: unknown;
    total_cost?: unknown;
    supplier_name?: unknown;
    create_payable?: unknown;
  }>(request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  const quantity = Number(body.quantity);
  const totalCost = Number(body.total_cost);
  const supplierName = typeof body.supplier_name === "string" ? body.supplier_name.trim() : "";
  const createPayable = body.create_payable === true;

  if (typeof body.request_id !== "string" || !UUID_RE.test(body.request_id)
      || typeof body.item_id !== "string" || !UUID_RE.test(body.item_id)
      || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100000
      || !Number.isFinite(totalCost) || totalCost < 0 || totalCost > 100000000
      || supplierName.length > 180) {
    return NextResponse.json({ error: "Confira os dados e os limites da compra." }, { status: 400 });
  }

  if (createPayable && totalCost > 0 && !hasPanelPermission(staff.member, "finance", "write")) {
    return NextResponse.json({ error: "Seu perfil não pode criar contas a pagar." }, { status: 403 });
  }

  const { data, error } = await staff.supabase.rpc("register_inventory_purchase", {
    p_request_id: body.request_id,
    p_inventory_item_id: body.item_id,
    p_quantity: quantity,
    p_total_cost: totalCost,
    p_supplier_name: supplierName || null,
    p_create_payable: createPayable,
  });
  if (error) return databaseErrorResponse(error);
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
