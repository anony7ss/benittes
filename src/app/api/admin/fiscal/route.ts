import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { clientAddress, enforceRateLimits, invalidOriginResponse, isSameOriginRequest, readBoundedJson, rateLimitedResponse } from "../../../../lib/security/http";
import { getServiceSupabase, hasPanelPermission, requirePanelStaff } from "../../../../lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return invalidOriginResponse();
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const parsed = await readBoundedJson<Record<string, unknown>>(request, 4 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  const docType = body.docType ?? body.tipo;
  if (docType !== "nfe" && docType !== "nfse" && docType !== "nfce") {
    return NextResponse.json({ error: "Tipo fiscal inválido." }, { status: 400 });
  }
  const sourceModule = body.module === "work-orders" || body.source_module === "work-orders" ? "work_orders" : "sales";
  const sourceId = String(body.id ?? body.source_id ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId)) {
    return NextResponse.json({ error: "Registro de origem inválido." }, { status: 400 });
  }

  const permissionModule = sourceModule === "sales" ? "sales" : "work-orders";
  if (!hasPanelPermission(staff.member, permissionModule, "write")) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const customerDoc = String(body.customerCpfCnpj ?? body.customer_doc ?? "").replace(/\D/g, "");
  if (customerDoc && !/^(?:\d{11}|\d{14})$/.test(customerDoc)) {
    return NextResponse.json({ error: "CPF ou CNPJ inválido." }, { status: 400 });
  }

  try {
    if (!(await enforceRateLimits([
      { scope: "fiscal-user", subject: staff.user.id, maxHits: 10, windowSeconds: 3600 },
      { scope: "fiscal-ip", subject: clientAddress(request), maxHits: 20, windowSeconds: 3600 },
    ]))) return rateLimitedResponse();

    const service = getServiceSupabase();
    const { data: source, error: sourceError } = await service.from(sourceModule)
      .select("id,reference,customer_name,total,details")
      .eq("id", sourceId)
      .maybeSingle();
    if (sourceError) return NextResponse.json({ error: "Não foi possível carregar o registro fiscal." }, { status: 503 });
    if (!source) return NextResponse.json({ error: "Registro não encontrado." }, { status: 404 });

    const amount = Number(source.total ?? 0);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) {
      return NextResponse.json({ error: "Valor do registro inválido." }, { status: 400 });
    }

    const fiscalDoc = {
      tipo: String(docType).toUpperCase(),
      ambiente: "simulacao_local",
      numero: randomBytes(6).toString("hex").toUpperCase(),
      chave_acesso: null,
      status: "simulacao_local",
      autorizada: false,
      transmitida: false,
      emitida_em: new Date().toISOString(),
      emitida_por: staff.member.full_name,
      valor_total: amount,
      destinatario: {
        nome: source.customer_name || "Consumidor Final",
        documento: customerDoc || null,
      },
      descricao: source.reference || "Serviço / Venda",
    };

    const details = source.details && typeof source.details === "object" && !Array.isArray(source.details)
      ? source.details as Record<string, unknown>
      : {};
    const { error: saveError } = await service.from(sourceModule)
      .update({ details: { ...details, fiscal: fiscalDoc } })
      .eq("id", source.id);
    if (saveError) return NextResponse.json({ error: "Não foi possível salvar a prévia fiscal." }, { status: 503 });

    return NextResponse.json({
      ok: true,
      fiscal: fiscalDoc,
      notice: "Prévia local criada. Este documento não tem validade fiscal e não foi transmitido.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Prévia fiscal temporariamente indisponível." }, { status: 503 });
  }
}
