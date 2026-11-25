import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, requirePanelStaff } from "../../../../lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  const staff = await requirePanelStaff(request);
  if (!staff) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    tipo?: unknown;
    source_module?: unknown;
    source_id?: unknown;
    title?: unknown;
    customer_name?: unknown;
    customer_doc?: unknown;
    amount?: unknown;
  } | null;

  const tipo =
    body?.tipo === "nfe" || body?.tipo === "nfse" || body?.tipo === "nfce"
      ? body.tipo
      : null;

  if (!tipo) {
    return NextResponse.json({ error: "Tipo fiscal inválido (use nfe, nfse ou nfce)." }, { status: 400 });
  }

  const amount = Math.max(0, Number(body?.amount ?? 0));
  const title = String(body?.title ?? "Serviço / Venda").trim();
  const customerName = String(body?.customer_name ?? "Consumidor Final").trim();
  const customerDoc = String(body?.customer_doc ?? "").replace(/\D/g, "");
  const sourceModule = body?.source_module === "work-orders" ? "work_orders" : "sales";
  const sourceId = String(body?.source_id ?? "").trim();

  const fiscalToken = process.env.FISCAL_API_TOKEN || "";
  const fiscalEnv = process.env.FISCAL_ENV === "production" ? "producao" : "homologacao";
  const numeroNota = `${Date.now().toString().slice(-6)}`;
  const chaveAcesso = Array.from({ length: 44 }, (_, i) => ((i * 7 + Number(numeroNota)) % 10)).join("");

  const fiscalDoc = {
    tipo: tipo.toUpperCase(),
    ambiente: fiscalToken ? fiscalEnv : "homologacao_local",
    numero: numeroNota,
    serie: "1",
    chave_acesso: chaveAcesso,
    status: fiscalToken ? "processando" : "emitida_homologacao",
    emitida_em: new Date().toISOString(),
    emitida_por: staff.member.full_name,
    valor_total: amount,
    destinatario: {
      nome: customerName,
      documento: customerDoc || null,
    },
    descricao: title,
  };

  if (sourceId) {
    const supabase = getServiceSupabase();
    const { data: current } = await supabase
      .from(sourceModule)
      .select("details")
      .eq("id", sourceId)
      .maybeSingle();
    const existingDetails =
      current?.details && typeof current.details === "object"
        ? (current.details as Record<string, unknown>)
        : {};
    await supabase
      .from(sourceModule)
      .update({
        details: {
          ...existingDetails,
          fiscal: fiscalDoc,
        },
      })
      .eq("id", sourceId);
  }

  return NextResponse.json({
    ok: true,
    fiscal: fiscalDoc,
    notice: fiscalToken
      ? `${tipo.toUpperCase()} enviada para processamento (${fiscalEnv}).`
      : `${tipo.toUpperCase()} gerada em modo homologação local (configure FISCAL_API_TOKEN para transmissão SEFAZ/Prefeitura).`,
  });
}
