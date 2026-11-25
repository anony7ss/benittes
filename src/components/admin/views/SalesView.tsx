"use client";

import { SkeletonTable } from "../Skeletons";
import { useMemo, useState, type FormEvent } from "react";
import { FileText, Pencil, Plus, Receipt, RefreshCw, Search, ShoppingBag, Trash2, TrendingUp, X } from "lucide-react";
import { type PanelRecord } from "../../../lib/supabase";
import { AdminStatusBadge } from "../StatusBadge";
import { AreaTrendChart, DonutBreakdownChart } from "../AdminCharts";
import { asText, dateText, detail, money, todayIso, useModuleRecords, modalBackdropProps } from "../utils";
import {
  ClientPicker,
  ServicePicker,
  VehiclePicker,
  clientDisplayName,
  ensureClientAndVehicle,
  useClientVehicleCatalog,
  vehiclePlate,
} from "../QuickPickers";

const PAYMENT_METHODS = ["Pix", "Cartão Crédito", "Cartão Débito", "Dinheiro", "Boleto"] as const;

const STATUS_FILTERS = [
  { id: "all", label: "Todas" },
  { id: "concluido", label: "Concluídas" },
  { id: "aguardando", label: "Aguardando" },
  { id: "em_andamento", label: "Em andamento" },
  { id: "cancelado", label: "Canceladas" },
] as const;

type SaleForm = {
  title: string;
  customer_name: string;
  vehicle: string;
  amount: string;
  forma_pagamento: string;
  itens: string;
  status: string;
  description: string;
};

const emptyForm = (): SaleForm => ({
  title: "",
  customer_name: "",
  vehicle: "",
  amount: "",
  forma_pagamento: "Pix",
  itens: "",
  status: "concluido",
  description: "",
});

export function SalesView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, load, saveRecord, removeRecord } = useModuleRecords(
    "sales",
    session.user.id,
  );
  const { rows: financeRows } = useModuleRecords("finance", session.user.id);
  const { clients, vehicles, services, reload: reloadCatalog } = useClientVehicleCatalog();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fiscalRow, setFiscalRow] = useState<PanelRecord | null>(null);
  const [fiscalDocType, setFiscalDocType] = useState<"nfce" | "nfse" | "nfe">("nfce");
  const [fiscalDocCpf, setFiscalDocCpf] = useState("");
  const [fiscalLoading, setFiscalLoading] = useState(false);
  const [fiscalError, setFiscalError] = useState("");
  const [fiscalResult, setFiscalResult] = useState<Record<string, unknown> | null>(null);

  function openFiscalModal(row: PanelRecord) {
    setFiscalRow(row);
    const existing = detail(row, "fiscal");
    if (existing && typeof existing === "object") {
      setFiscalResult(existing as Record<string, unknown>);
    } else {
      setFiscalResult(null);
    }
    setFiscalDocType("nfce");
    setFiscalDocCpf("");
    setFiscalError("");
  }

  async function handleEmitFiscal(event: FormEvent) {
    event.preventDefault();
    if (!fiscalRow) return;
    setFiscalLoading(true);
    setFiscalError("");
    try {
      const response = await fetch("/api/admin/fiscal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: "sales",
          id: fiscalRow.id,
          docType: fiscalDocType,
          customerCpfCnpj: fiscalDocCpf.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Erro ao emitir nota fiscal.");
      }
      setFiscalResult(data.fiscal || data);
      await load();
    } catch (reason) {
      setFiscalError(reason instanceof Error ? reason.message : "Erro ao emitir nota fiscal.");
    } finally {
      setFiscalLoading(false);
    }
  }
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<SaleForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const today = todayIso();

  const combinedRevenueRows = useMemo(() => {
    const saleIds = new Set(rows.map((r) => r.id));
    const saleOsIds = new Set(
      rows
        .map((r) => String(detail(r, "source_work_order_id") ?? ""))
        .filter(Boolean),
    );
    const extraFromFinance = financeRows.filter((f) => {
      if (f.status !== "concluido") return false;
      if (detail(f, "tipo") === "pagar") return false;
      const srcSale = String(detail(f, "source_sale_id") ?? "");
      if (srcSale && saleIds.has(srcSale)) return false;
      const srcOs = String(detail(f, "source_work_order_id") ?? "");
      if (srcOs && saleOsIds.has(srcOs)) return false;
      return true;
    });
    return [...rows, ...extraFromFinance];
  }, [rows, financeRows]);

  const stats = useMemo(() => {
    const validSales = combinedRevenueRows.filter((r) => r.status !== "cancelado");
    const concludedSales = combinedRevenueRows.filter((r) => r.status === "concluido");
    const totalRevenue = concludedSales.reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
    const todaySales = validSales.filter((r) => r.created_at.slice(0, 10) === today);
    const todayRevenue = todaySales.reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
    const avgTicket = concludedSales.length > 0 ? totalRevenue / concludedSales.length : 0;

    return {
      totalRevenue,
      concludedCount: concludedSales.length,
      todayCount: todaySales.length,
      todayRevenue,
      avgTicket,
    };
  }, [combinedRevenueRows, today]);

  const { trendData, paymentSlices, validRevenue } = useMemo(() => {
    const days: { iso: string; label: string; value: number; count: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const label = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      days.push({ iso, label, value: 0, count: 0 });
    }

    const payMap = new Map<string, { value: number; count: number }>();
    let sumValid = 0;

    for (const row of combinedRevenueRows) {
      if (row.status === "cancelado") continue;
      const val = Number(row.amount ?? 0);

      sumValid += val;

      const dayIso = row.created_at.slice(0, 10);
      const dayBucket = days.find((d) => d.iso === dayIso);
      if (dayBucket) {
        dayBucket.value += val;
        dayBucket.count += 1;
      }

      const method =
        String(detail(row, "forma_pagamento") ?? detail(row, "categoria") ?? "Outros").trim() ||
        "Outros";
      const cur = payMap.get(method) ?? { value: 0, count: 0 };
      cur.value += val;
      cur.count += 1;
      payMap.set(method, cur);
    }

    const methodColors: Record<string, string> = {
      Pix: "#22c55e",
      "Cartão Crédito": "#174b88",
      "Cartão Débito": "#06b6d4",
      Dinheiro: "#f59e0b",
      Boleto: "#8b5cf6",
      "Ordem de Serviço": "#22c55e",
    };
    const fallbackPalette = ["#174b88", "#22c55e", "#f59e0b", "#06b6d4", "#8b5cf6"];

    const slices = [...payMap.entries()]
      .sort((a, b) => b[1].value - a[1].value)
      .map(([label, data], idx) => ({
        label,
        value: data.value,
        count: data.count,
        color: methodColors[label] ?? fallbackPalette[idx % fallbackPalette.length],
      }));

    return {
      trendData: days.map(({ label, value, count }) => ({ label, value, count })),
      paymentSlices: slices,
      validRevenue: sumValid,
    };
  }, [combinedRevenueRows]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!query) return true;
      const payment = String(detail(row, "forma_pagamento") ?? "").toLowerCase();
      return (
        row.title.toLowerCase().includes(query) ||
        (row.customer_name ?? "").toLowerCase().includes(query) ||
        (row.vehicle ?? "").toLowerCase().includes(query) ||
        payment.includes(query)
      );
    });
  }, [rows, statusFilter, search]);

  function openNew() {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    setEditing(row);
    setForm({
      title: row.title,
      customer_name: row.customer_name ?? "",
      vehicle: row.vehicle ?? "",
      amount: row.amount !== null && row.amount !== undefined ? String(row.amount) : "",
      forma_pagamento: String(detail(row, "forma_pagamento") ?? "Pix"),
      itens: String(detail(row, "itens") ?? ""),
      status: row.status,
      description: row.description ?? "",
    });
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const parsedAmount = form.amount.trim() === "" ? 0 : Number(form.amount);
      await saveRecord(editing, {
        title: form.title.trim(),
        customer_name: form.customer_name.trim() || null,
        vehicle: form.vehicle.trim() || null,
        amount: Number.isNaN(parsedAmount) ? 0 : parsedAmount,
        status: form.status,
        description: form.description.trim() || null,
        details: {
          ...(editing?.details ?? {}),
          forma_pagamento: form.forma_pagamento,
          itens: form.itens.trim(),
        },
      });
      await ensureClientAndVehicle({
        userId: session.user.id,
        clients,
        vehicles,
        customerName: form.customer_name,
        vehicle: form.vehicle,
        reload: reloadCatalog,
      });
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar a venda.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">BALCÃO E COMANDAS</p>
          <h1>Vendas</h1>
        </div>
        <div className="admin-title-actions">
          <button type="button" className="admin-secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} /> Atualizar
          </button>
          <button type="button" className="admin-primary" onClick={openNew}>
            <Plus size={16} /> Nova venda
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-form-error" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      <section className="admin-stat-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">Faturamento Total</span>
            <div className="admin-stat-icon green">
              <TrendingUp size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{money(stats.totalRevenue)}</div>
            <p className="admin-stat-sub">{stats.concludedCount} venda(s) concluída(s)</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">Vendas Hoje</span>
            <div className="admin-stat-icon orange">
              <ShoppingBag size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{stats.todayCount}</div>
            <p className="admin-stat-sub">{money(stats.todayRevenue)} movimentados hoje</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">Ticket Médio</span>
            <div className="admin-stat-icon blue">
              <Receipt size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{money(stats.avgTicket)}</div>
            <p className="admin-stat-sub">Média por venda concluída</p>
          </div>
        </div>
      </section>

      <section className="admin-two-col" style={{ marginBottom: 20 }}>
        <div className="admin-panel">
          <div className="admin-panel-head">
            <h2>Faturamento dos últimos 7 dias</h2>
          </div>
          <AreaTrendChart data={trendData} />
        </div>

        <div className="admin-panel">
          <div className="admin-panel-head">
            <h2>Vendas por forma de pagamento</h2>
          </div>
          <DonutBreakdownChart
            slices={paymentSlices}
            centerLabel="Movimentado"
            centerValue={money(validRevenue)}
            emptyText="Registre vendas para ver as formas de pagamento"
          />
        </div>
      </section>

      <div className="admin-toolbar">
        <div className="admin-filter-pills">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`admin-pill${statusFilter === item.id ? " active" : ""}`}
              onClick={() => setStatusFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            type="search"
            className="admin-search"
            placeholder="Buscar comanda, cliente, veículo ou pagamento..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={5} />
      ) : filtered.length === 0 ? (
        <div className="admin-empty">
          <strong>Nenhuma venda encontrada</strong>
          <p>Registre uma nova venda ou ajuste os filtros aplicados.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Comanda / Título</th>
                <th>Cliente</th>
                <th>Pagamento</th>
                <th>Valor</th>
                <th>Data</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{row.title}</div>
                    {row.vehicle && (
                      <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>{row.vehicle}</div>
                    )}
                  </td>
                  <td>{asText(row.customer_name)}</td>
                  <td>{asText(detail(row, "forma_pagamento"))}</td>
                  <td style={{ fontWeight: 600 }}>{money(row.amount)}</td>
                  <td>{dateText(row.created_at)}</td>
                  <td>
                    <AdminStatusBadge status={row.status} />
                  </td>
                  <td>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, alignItems: "center" }}>
                      {Boolean(detail(row, "fiscal") && typeof detail(row, "fiscal") === "object") && (
                        <span className="admin-tag" style={{ fontSize: 10.5 }}>
                          NF #{String((detail(row, "fiscal") as Record<string, unknown>).numero || "emitida")}
                        </span>
                      )}
                      <button
                        type="button"
                        className="admin-icon-btn"
                        title="Emitir Nota Fiscal (NF-e / NFS-e / NFC-e)"
                        onClick={() => openFiscalModal(row)}
                      >
                        <FileText size={14} />
                      </button>
                      <button type="button" className="admin-icon-btn" title="Editar" onClick={() => openEdit(row)}>
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="admin-icon-btn danger"
                        title="Excluir"
                        onClick={() => void removeRecord(row)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar venda" : "Nova venda"}</h2>
                <p>Preencha os detalhes da comanda ou venda de balcão.</p>
              </div>
              <button type="button" className="admin-icon-btn" onClick={() => setModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={(event) => void handleSubmit(event)}>
              <div className="admin-form-grid">
                <div className="admin-field wide">
                  <label>Descrição / Comanda</label>
                  <ServicePicker
                    services={services}
                    value={form.title}
                    onSelectService={(picked) => {
                      if (!picked) {
                        setForm((f) => ({ ...f, title: "" }));
                        return;
                      }
                      const promo = detail(picked, "preco_promo");
                      const price =
                        promo !== undefined && promo !== null && promo !== ""
                          ? String(promo)
                          : picked.amount !== null && picked.amount !== undefined
                            ? String(picked.amount)
                            : form.amount;
                      setForm((f) => ({
                        ...f,
                        title: picked.title,
                        amount: price,
                        itens: f.itens || picked.title,
                        description: f.description || picked.description || "",
                      }));
                    }}
                  />
                  <input
                    className="admin-input"
                    required
                    value={form.title}
                    onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
                    placeholder="Ex: Comanda #42 - Troca de óleo e filtros"
                  />
                </div>

                <div className="admin-field">
                  <label>Cliente</label>
                  <ClientPicker
                    clients={clients}
                    value={form.customer_name}
                    onSelectClient={(picked) => {
                      if (!picked) {
                        setForm((f) => ({ ...f, customer_name: "" }));
                        return;
                      }
                      const name = clientDisplayName(picked);
                      const matchVeh = vehicles.find(
                        (v) => (v.customer_name ?? "").trim().toLowerCase() === name.toLowerCase(),
                      );
                      setForm((f) => ({
                        ...f,
                        customer_name: name,
                        vehicle: matchVeh && !f.vehicle ? vehiclePlate(matchVeh) : f.vehicle,
                      }));
                    }}
                  />
                  <input
                    className="admin-input"
                    value={form.customer_name}
                    onChange={(event) => setForm((f) => ({ ...f, customer_name: event.target.value }))}
                    placeholder="Nome do cliente"
                  />
                </div>

                <div className="admin-field">
                  <label>Veículo</label>
                  <VehiclePicker
                    vehicles={vehicles}
                    value={form.vehicle}
                    clientName={form.customer_name}
                    onSelectVehicle={(picked) => {
                      if (!picked) {
                        setForm((f) => ({ ...f, vehicle: "" }));
                        return;
                      }
                      setForm((f) => ({
                        ...f,
                        vehicle: vehiclePlate(picked),
                        customer_name: f.customer_name || (picked.customer_name ?? "").trim(),
                      }));
                    }}
                  />
                  <input
                    className="admin-input"
                    value={form.vehicle}
                    onChange={(event) => setForm((f) => ({ ...f, vehicle: event.target.value }))}
                    placeholder="Modelo / Placa"
                  />
                </div>

                <label className="admin-field">
                  Valor (R$)
                  <input
                    className="admin-input"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={form.amount}
                    onChange={(event) => setForm((f) => ({ ...f, amount: event.target.value }))}
                    placeholder="0,00"
                  />
                </label>

                <label className="admin-field">
                  Forma de pagamento
                  <select
                    className="admin-select"
                    value={form.forma_pagamento}
                    onChange={(event) => setForm((f) => ({ ...f, forma_pagamento: event.target.value }))}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="admin-field">
                  Status
                  <select
                    className="admin-select"
                    value={form.status}
                    onChange={(event) => setForm((f) => ({ ...f, status: event.target.value }))}
                  >
                    <option value="novo">Novo</option>
                    <option value="em_andamento">Em andamento</option>
                    <option value="aguardando">Aguardando</option>
                    <option value="concluido">Concluído</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </label>

                <label className="admin-field wide">
                  Itens da venda
                  <textarea
                    className="admin-textarea"
                    value={form.itens}
                    onChange={(event) => setForm((f) => ({ ...f, itens: event.target.value }))}
                    placeholder="Liste produtos ou serviços incluídos..."
                  />
                </label>

                <label className="admin-field wide">
                  Observações
                  <textarea
                    className="admin-textarea"
                    value={form.description}
                    onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
                    placeholder="Informações adicionais..."
                  />
                </label>
              </div>

              <div className="admin-modal-actions">
                <button type="button" className="admin-secondary" onClick={() => setModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="admin-primary" disabled={saving}>
                  {saving ? "Salvando..." : editing ? "Salvar alterações" : "Registrar venda"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {fiscalRow && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setFiscalRow(null))}>
          <div className="admin-modal" style={{ maxWidth: 520 }} onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>Emissão Fiscal</h2>
                <p>{fiscalRow.title} · {money(fiscalRow.amount)}</p>
              </div>
              <button type="button" className="admin-icon-btn" onClick={() => setFiscalRow(null)}>
                <X size={16} />
              </button>
            </div>

            {fiscalError && <p className="admin-form-error" style={{ marginBottom: 12 }}>{fiscalError}</p>}

            {fiscalResult ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="admin-panel" style={{ padding: 14, display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>{String(fiscalResult.tipo || "NF-e").toUpperCase()} #{String(fiscalResult.numero || "-")}</strong>
                    <span className="admin-tag">{String(fiscalResult.status || "emitida")}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--admin-muted)", wordBreak: "break-all" }}>
                    Chave: {String(fiscalResult.chave_acesso || "-")}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--admin-muted)" }}>
                    Protocolo: {String(fiscalResult.protocolo || "-")} · Emissão: {String(fiscalResult.emitida_em || "-")}
                  </div>
                  {Boolean(fiscalResult.mensagem) && (
                    <div style={{ fontSize: 12, color: "var(--admin-muted)" }}>
                      {String(fiscalResult.mensagem)}
                    </div>
                  )}
                </div>
                <div className="admin-modal-actions">
                  <button type="button" className="admin-secondary" onClick={() => setFiscalResult(null)}>
                    Emitir outro documento
                  </button>
                  <button type="button" className="admin-primary" onClick={() => setFiscalRow(null)}>
                    Fechar
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={(event) => void handleEmitFiscal(event)}>
                <div className="admin-form-grid">
                  <label className="admin-field wide">
                    Tipo de documento
                    <select
                      className="admin-select"
                      value={fiscalDocType}
                      onChange={(event) => setFiscalDocType(event.target.value as "nfce" | "nfse" | "nfe")}
                    >
                      <option value="nfce">NFC-e (Consumidor / Balcão)</option>
                      <option value="nfse">NFS-e (Prestação de Serviço)</option>
                      <option value="nfe">NF-e (Produto / Peças)</option>
                    </select>
                  </label>
                  <label className="admin-field wide">
                    CPF / CNPJ do tomador (opcional)
                    <input
                      className="admin-input"
                      value={fiscalDocCpf}
                      onChange={(event) => setFiscalDocCpf(event.target.value)}
                      placeholder="000.000.000-00 ou 00.000.000/0001-00"
                    />
                  </label>
                </div>
                <div className="admin-modal-actions">
                  <button type="button" className="admin-secondary" onClick={() => setFiscalRow(null)}>
                    Cancelar
                  </button>
                  <button type="submit" className="admin-primary" disabled={fiscalLoading}>
                    {fiscalLoading ? "Emitindo..." : "Emitir documento"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
