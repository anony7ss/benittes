"use client";

import { SkeletonBox, SkeletonChart, SkeletonStatCards, SkeletonTable } from "../Skeletons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, DollarSign, Download, FileSpreadsheet, Percent, RefreshCw } from "lucide-react";
import { selectRows, type PanelRecord } from "../../../lib/supabase";
import { AdminStatusBadge, statusLabels } from "../StatusBadge";
import { AreaTrendChart } from "../AdminCharts";
import { DateRangeBar, type PeriodPreset } from "../DateRangeBar";
import { asText, dateText, detail, money, todayIso } from "../utils";

const MODULES = [
  { id: "work-orders", label: "Ordens de Serviço" },
  { id: "quotes", label: "Orçamentos" },
  { id: "appointments", label: "Agenda" },
  { id: "clients", label: "Clientes" },
  { id: "vehicles", label: "Veículos" },
  { id: "finance", label: "Financeiro" },
  { id: "sales", label: "Vendas" },
  { id: "inventory", label: "Estoque" },
] as const;

type ReportModule = (typeof MODULES)[number]["id"];

function brDateOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  const escaped = str.replaceAll('"', '""');
  return `"${escaped}"`;
}

export function ReportsView() {
  const [selectedModule, setSelectedModule] = useState<ReportModule>("work-orders");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [rows, setRows] = useState<PanelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportTab, setReportTab] = useState<"geral" | "dre" | "comissoes">("geral");
  const [commissionPct, setCommissionPct] = useState(10);
  const [dreRows, setDreRows] = useState<{ os: PanelRecord[]; sales: PanelRecord[]; finance: PanelRecord[] }>({
    os: [],
    sales: [],
    finance: [],
  });
  const [inventoryMovements, setInventoryMovements] = useState<Array<{
    work_order_id: string | null;
    quantity_delta: number;
    unit_cost: number;
    created_at: string;
  }>>([]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const range = (field: string) => {
        const result: Record<string, string> = {};
        if (startDate) result[`${field}_from`] = new Date(`${startDate}T00:00:00-03:00`).toISOString();
        if (endDate) {
          const endExclusive = new Date(`${endDate}T00:00:00-03:00`);
          endExclusive.setDate(endExclusive.getDate() + 1);
          result[`${field}_before`] = endExclusive.toISOString();
        }
        return result;
      };
      const period = range("created_at");
      const [data, osData, salesData, finData, movementData] = await Promise.all([
        selectRows<PanelRecord>(selectedModule, {
          ...period,
          order: "created_at.desc",
          limit: "500",
        }),
        selectRows<PanelRecord>("work-orders", { ...range("updated_at"), status: "eq.concluido", order: "updated_at.desc", limit: "500" }),
        selectRows<PanelRecord>("sales", { ...period, status: "eq.concluido", order: "created_at.desc", limit: "500" }),
        selectRows<PanelRecord>("finance", { ...period, status: "eq.concluido", order: "created_at.desc", limit: "500" }),
        selectRows<{ work_order_id: string | null; quantity_delta: number; unit_cost: number; created_at: string }>("inventory-movements", {
          ...period,
          source_type: "eq.work_order",
          select: "work_order_id,quantity_delta,unit_cost,created_at",
          order: "created_at.desc",
          limit: "500",
        }),
      ]);
      setDreRows({ os: osData, sales: salesData, finance: finData });
      setInventoryMovements(movementData);
      if (selectedModule === "sales") {
        const saleIds = new Set(data.map((r) => r.id));
        const saleOsIds = new Set(
          data.map((r) => String(detail(r, "source_work_order_id") ?? "")).filter(Boolean),
        );
        const extra = finData.filter((f) => {
          if (f.status !== "concluido") return false;
          if (detail(f, "tipo") === "pagar") return false;
          const srcSale = String(detail(f, "source_sale_id") ?? "");
          if (srcSale && saleIds.has(srcSale)) return false;
          const srcOs = String(detail(f, "source_work_order_id") ?? "");
          if (srcOs && saleOsIds.has(srcOs)) return false;
          return true;
        });
        setRows([...data, ...extra]);
      } else {
        setRows(data);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar os dados do relatório.");
      setRows([]);
      setDreRows({ os: [], sales: [], finance: [] });
      setInventoryMovements([]);
    } finally {
      setLoading(false);
    }
  }, [selectedModule, startDate, endDate]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const dateOnly = brDateOnly(row.created_at);
      if (startDate && dateOnly < startDate) return false;
      if (endDate && dateOnly > endDate) return false;
      if (responsibleFilter && String(detail(row, "tecnico") ?? detail(row, "responsavel") ?? detail(row, "mecanico") ?? "") !== responsibleFilter) return false;
      if (categoryFilter && String(detail(row, "categoria") ?? detail(row, "category") ?? "") !== categoryFilter) return false;
      return true;
    });
  }, [rows, startDate, endDate, responsibleFilter, categoryFilter]);

  const reportFilters = useMemo(() => {
    const responsibles = new Set<string>();
    const categories = new Set<string>();
    for (const row of rows) {
      const responsible = String(detail(row, "tecnico") ?? detail(row, "responsavel") ?? detail(row, "mecanico") ?? "").trim();
      const category = String(detail(row, "categoria") ?? detail(row, "category") ?? "").trim();
      if (responsible) responsibles.add(responsible);
      if (category) categories.add(category);
    }
    return { responsibles: [...responsibles].sort(), categories: [...categories].sort() };
  }, [rows]);

  const osMargins = useMemo(() => {
    const costs = new Map<string, number>();
    for (const movement of inventoryMovements) {
      if (!movement.work_order_id || movement.quantity_delta >= 0) continue;
      costs.set(movement.work_order_id, (costs.get(movement.work_order_id) ?? 0) + Math.abs(Number(movement.quantity_delta)) * Number(movement.unit_cost));
    }
    return dreRows.os
      .filter((row) => row.status === "concluido")
      .filter((row) => {
        const day = brDateOnly(String(detail(row, "finalized_at") ?? row.updated_at ?? row.created_at));
        const responsible = String(detail(row, "tecnico") ?? detail(row, "responsavel") ?? detail(row, "mecanico") ?? "");
        const category = String(detail(row, "categoria") ?? detail(row, "category") ?? "");
        return (!startDate || day >= startDate) && (!endDate || day <= endDate)
          && (!responsibleFilter || responsible === responsibleFilter)
          && (!categoryFilter || category === categoryFilter);
      })
      .map((row) => {
        const materialCost = costs.get(row.id) ?? 0;
        const total = Number(row.amount ?? 0);
        return { row, materialCost, resultAfterMaterials: total - materialCost };
      });
  }, [dreRows.os, inventoryMovements, startDate, endDate, responsibleFilter, categoryFilter]);

  const kpis = useMemo(() => {
    let totalAmount = 0;
    let completed = 0;
    for (const row of filtered) {
      totalAmount += Number(row.amount ?? 0);
      if (row.status === "concluido") completed += 1;
    }
    return {
      totalRecords: filtered.length,
      totalAmount,
      completed,
    };
  }, [filtered]);

  const trendData = useMemo(() => {
    const byDay = new Map<string, { value: number; count: number }>();
    for (const row of filtered) {
      const day = brDateOnly(row.created_at);
      const prev = byDay.get(day) ?? { value: 0, count: 0 };
      prev.value += Number(row.amount ?? 0);
      prev.count += 1;
      byDay.set(day, prev);
    }
    const sorted = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
    return sorted.slice(-10).map(([day, info]) => {
      const [, m, d] = day.split("-");
      return {
        label: `${d}/${m}`,
        value: info.value,
        count: info.count,
      };
    });
  }, [filtered]);

  const dreSummary = useMemo(() => {
    const inPeriod = (r: PanelRecord) => {
      const day = brDateOnly(String(detail(r, "finalized_at") ?? r.updated_at ?? r.created_at));
      return (!startDate || day >= startDate) && (!endDate || day <= endDate);
    };
    const osConcluidas = dreRows.os.filter((r) => inPeriod(r) && r.status === "concluido");
    const osIds = new Set(osConcluidas.map((r) => r.id));
    const vendasConcluidas = dreRows.sales.filter((r) =>
      inPeriod(r) && r.status === "concluido" && !osIds.has(String(detail(r, "source_work_order_id") ?? "")),
    );
    const finPeriodo = dreRows.finance.filter((r) => inPeriod(r) && r.status === "concluido");

    const receitaServicos = osConcluidas.reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
    const receitaVendas = vendasConcluidas.reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
    const outrasEntradas = finPeriodo
      .filter((r) => String(detail(r, "tipo") ?? "receber") === "receber"
        && !osIds.has(String(detail(r, "source_work_order_id") ?? ""))
        && !vendasConcluidas.some((sale) => sale.id === String(detail(r, "source_sale_id") ?? "")))
      .reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
    const receitaBruta = receitaServicos + receitaVendas + outrasEntradas;

    const comprasPecas = finPeriodo
      .filter(
        (r) =>
          String(detail(r, "tipo") ?? "") === "pagar" &&
          String(detail(r, "categoria") ?? "").toLowerCase().includes("compra"),
      )
      .reduce((acc, r) => acc + Number(r.amount ?? 0), 0);

    const despesasOperacionais = finPeriodo
      .filter(
        (r) =>
          String(detail(r, "tipo") ?? "") === "pagar" &&
          !String(detail(r, "categoria") ?? "").toLowerCase().includes("compra"),
      )
      .reduce((acc, r) => acc + Number(r.amount ?? 0), 0);

    const custoPecasOs = inventoryMovements
      .filter((movement) => movement.work_order_id && osIds.has(movement.work_order_id) && movement.quantity_delta < 0)
      .reduce((sum, movement) => sum + Math.abs(Number(movement.quantity_delta)) * Number(movement.unit_cost), 0);
    // Compra adiciona valor ao estoque; o custo vira despesa quando a peça é usada numa OS.
    const lucroLiquido = receitaBruta - despesasOperacionais - custoPecasOs;
    const margem = receitaBruta > 0 ? (lucroLiquido / receitaBruta) * 100 : 0;

    return {
      receitaServicos,
      receitaVendas,
      outrasEntradas,
      receitaBruta,
      comprasPecas,
      custoPecasOs,
      despesasOperacionais,
      lucroLiquido,
      margem,
      comissaoTotal: (receitaServicos + receitaVendas) * (commissionPct / 100),
      osCount: osConcluidas.length,
      salesCount: vendasConcluidas.length,
    };
  }, [dreRows, inventoryMovements, startDate, endDate, commissionPct]);

  function handleExportCsv() {
    const headers = ["ID", "Módulo", "Título", "Status", "Cliente", "E-mail", "Telefone", "Veículo", "Valor", "Criado em", "Descrição"];
    const lines = [
      headers.map(escapeCsvCell).join(","),
      ...filtered.map((row) =>
        [
          row.id,
          row.module,
          row.title,
          statusLabels[row.status] ?? row.status,
          row.customer_name ?? "",
          row.customer_email ?? "",
          row.phone ?? "",
          row.vehicle ?? "",
          row.amount ?? "",
          row.created_at,
          row.description ?? "",
        ]
          .map(escapeCsvCell)
          .join(","),
      ),
    ];

    const csvContent = `\uFEFF${lines.join("\r\n")}`;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-${selectedModule}-${todayIso()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <h1>Relatórios</h1>
        </div>
        <div className="admin-title-actions">
          <button type="button" className="admin-secondary" onClick={() => void loadReport()} disabled={loading}>
            <RefreshCw size={15} /> Atualizar
          </button>
          <button
            type="button"
            className="admin-primary"
            onClick={handleExportCsv}
            disabled={loading || filtered.length === 0}
          >
            <Download size={16} /> Exportar CSV
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-form-error" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      <section className="admin-panel" style={{ marginBottom: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--admin-muted)" }}>Módulo</span>
            <select
              className="admin-select"
              style={{ minWidth: 180, minHeight: 38, height: 38, padding: "0 32px 0 12px" }}
              value={selectedModule}
              onChange={(event) => setSelectedModule(event.target.value as ReportModule)} id="admin-views-reportsview-264"
            >
              {MODULES.map((mod) => (
                <option key={mod.id} value={mod.id}>
                  {mod.label}
                </option>
              ))}
            </select>
          </label>

          <DateRangeBar
            preset={periodPreset}
            startDate={startDate}
            endDate={endDate}
            onChange={(next) => {
              setPeriodPreset(next.preset);
              setStartDate(next.startDate);
              setEndDate(next.endDate);
            }}
          />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--admin-muted)" }}>Responsável</span>
            <select className="admin-select" style={{ minWidth: 150, minHeight: 38, height: 38, padding: "0 30px 0 10px" }} value={responsibleFilter} onChange={(event) => setResponsibleFilter(event.target.value)}>
              <option value="">Todos</option>
              {reportFilters.responsibles.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--admin-muted)" }}>Categoria</span>
            <select className="admin-select" style={{ minWidth: 150, minHeight: 38, height: 38, padding: "0 30px 0 10px" }} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">Todas</option>
              {reportFilters.categories.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
      </section>

      {loading ? <SkeletonStatCards count={3} /> : (
      <section className="admin-stat-grid admin-stat-grid-trio">
        <div className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">Total de Registros</span>
            <div className="admin-stat-icon blue">
              <FileSpreadsheet size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{kpis.totalRecords}</div>
            <p className="admin-stat-sub">Itens no período selecionado</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">Valor Total</span>
            <div className="admin-stat-icon orange">
              <DollarSign size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{money(kpis.totalAmount)}</div>
            <p className="admin-stat-sub">Soma dos valores filtrados</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">Concluídos</span>
            <div className="admin-stat-icon green">
              <CheckCircle2 size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{kpis.completed}</div>
            <p className="admin-stat-sub">Registros com status concluído</p>
          </div>
        </div>
      </section>
      )}

      <div className="admin-toolbar" style={{ marginBottom: 14 }}>
        <div className="admin-filter-pills">
          <button
            type="button"
            className={`admin-pill ${reportTab === "geral" ? "active" : ""}`}
            onClick={() => setReportTab("geral")}
          >
            <FileSpreadsheet size={13} style={{ marginRight: 5 }} /> Relatório Geral
          </button>
          <button
            type="button"
            className={`admin-pill ${reportTab === "dre" ? "active" : ""}`}
            onClick={() => setReportTab("dre")}
          >
            <BarChart3 size={13} style={{ marginRight: 5 }} /> DRE
          </button>
          <button
            type="button"
            className={`admin-pill ${reportTab === "comissoes" ? "active" : ""}`}
            onClick={() => setReportTab("comissoes")}
          >
            <Percent size={13} style={{ marginRight: 5 }} /> Comissões
          </button>
        </div>
      </div>

      {reportTab === "dre" && (
        <section className="admin-panel" style={{ marginBottom: 18 }}>
          <div className="admin-panel-head">
            <h2>DRE — Demonstração do Resultado do Exercício</h2>
            <span style={{ fontSize: 12, color: "var(--admin-muted)" }}>
              Período selecionado
            </span>
          </div>
          {loading ? (
            <div style={{ display: "grid", gap: 10 }} role="status" aria-label="Carregando DRE" aria-busy="true">
              {["64%", "54%", "60%", "48%", "58%", "52%", "72%"].map((width, index) => (
                <div key={index} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0", borderBottom: "1px solid var(--admin-line)" }}>
                  <SkeletonBox width={width} height={index === 6 ? 16 : 13} />
                  <SkeletonBox width={88} height={14} />
                </div>
              ))}
            </div>
          ) : (
          <div className="admin-data-enter" style={{ display: "grid", gap: 10, fontSize: 13.5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--admin-line)" }}>
              <span>(+) Receita de Serviços (OS concluídas)</span>
              <strong style={{ color: "var(--admin-green)" }}>{money(dreSummary.receitaServicos)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--admin-line)" }}>
              <span>(+) Receita de Vendas</span>
              <strong style={{ color: "var(--admin-green)" }}>{money(dreSummary.receitaVendas)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--admin-line)" }}>
              <span>(+) Outras Entradas Financeiras</span>
              <strong style={{ color: "var(--admin-green)" }}>{money(dreSummary.outrasEntradas)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--admin-line)", fontWeight: 600 }}>
              <span>(=) Receita Bruta Total</span>
              <strong>{money(dreSummary.receitaBruta)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--admin-line)" }}>
              <span>Compras de estoque pagas (informativo)</span>
              <strong>{money(dreSummary.comprasPecas)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--admin-line)" }}>
              <span>(-) Custo real de peças usadas nas OS</span>
              <strong style={{ color: "var(--admin-red)" }}>-{money(dreSummary.custoPecasOs)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--admin-line)" }}>
              <span>(-) Despesas Operacionais</span>
              <strong style={{ color: "var(--admin-red)" }}>-{money(dreSummary.despesasOperacionais)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 16 }}>
              <strong>(=) Resultado Líquido ({dreSummary.margem.toFixed(1)}% margem)</strong>
              <strong style={{ color: dreSummary.lucroLiquido >= 0 ? "var(--admin-green)" : "var(--admin-red)" }}>
                {money(dreSummary.lucroLiquido)}
              </strong>
            </div>
          </div>
          )}
        </section>
      )}

      {reportTab === "dre" && (
        <section className="admin-panel" style={{ marginBottom: 18 }}>
          <div className="admin-panel-head">
            <h2>Resultado por ordem de serviço</h2>
            <span style={{ color: "var(--admin-muted)", fontSize: 12 }}>Após custo de peças registradas</span>
          </div>
          {loading ? <SkeletonTable rows={4} /> : osMargins.length === 0 ? (
            <div className="admin-empty"><p>Nenhuma OS concluída nesse período e filtro.</p></div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Serviço / OS</th><th>Responsável</th><th>Receita</th><th>Custo de peças</th><th>Após peças</th></tr></thead>
                <tbody>{osMargins.map(({ row, materialCost, resultAfterMaterials }) => (
                  <tr key={row.id}>
                    <td><strong>{row.title}</strong><div style={{ color: "var(--admin-muted)", fontSize: 11 }}>{row.customer_name || ""} · {row.vehicle || "Sem placa"}</div></td>
                    <td>{String(detail(row, "tecnico") ?? detail(row, "responsavel") ?? "—")}</td>
                    <td>{money(row.amount)}</td>
                    <td>{money(materialCost)}</td>
                    <td><strong style={{ color: resultAfterMaterials >= 0 ? "var(--admin-green)" : "var(--admin-red)" }}>{money(resultAfterMaterials)}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
              <p style={{ color: "var(--admin-muted)", fontSize: 11, margin: "8px 0 0" }}>Esse valor ainda não desconta mão de obra nem despesas gerais. Só considera peças vinculadas às OS no livro de estoque.</p>
            </div>
          )}
        </section>
      )}

      {reportTab === "comissoes" && (
        <section className="admin-panel" style={{ marginBottom: 18 }}>
          <div className="admin-panel-head" style={{ flexWrap: "wrap", gap: 10 }}>
            <h2>Apuração de Comissões</h2>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
              <span>Percentual (%):</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                className="admin-input"
                style={{ width: 84, minHeight: 34, padding: "4px 10px" }}
                value={commissionPct}
                onChange={(e) => setCommissionPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} id="admin-views-reportsview-420"
              />
            </label>
          </div>
          {loading ? <SkeletonStatCards count={2} /> : (
          <div className="admin-stat-grid" style={{ marginBottom: 0 }}>
            <div className="admin-stat-card">
              <div className="admin-stat-card-head">
                <span className="admin-stat-label">Base Comissionável</span>
              </div>
              <strong className="admin-stat-number">{money(dreSummary.receitaServicos + dreSummary.receitaVendas)}</strong>
              <span className="admin-stat-sub">{dreSummary.osCount} OS · {dreSummary.salesCount} vendas concluídas</span>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-card-head">
                <span className="admin-stat-label">Comissão Total ({commissionPct}%)</span>
              </div>
              <strong className="admin-stat-number" style={{ color: "var(--admin-green)" }}>
                {money(dreSummary.comissaoTotal)}
              </strong>
              <span className="admin-stat-sub">Calculado sobre serviços e vendas concluídos</span>
            </div>
          </div>
          )}
        </section>
      )}

      {loading ? (
        <section className="admin-panel" style={{ marginBottom: 14 }}>
          <SkeletonChart variant="bars" />
        </section>
      ) : trendData.length > 0 && (
        <section className="admin-panel" style={{ marginBottom: 14 }}>
          <div className="admin-data-enter">
            <AreaTrendChart
              data={trendData}
              subtitle={`Evolução diária · ${MODULES.find((m) => m.id === selectedModule)?.label ?? "Relatório"}`}
            />
          </div>
        </section>
      )}

      {loading ? (
        <SkeletonTable rows={5} />
      ) : filtered.length === 0 ? (
        <div className="admin-empty">
          <strong>Nenhum registro no período</strong>
          <p>Altere o módulo ou o intervalo de datas para visualizar os dados.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Cliente</th>
                <th>Veículo</th>
                <th>Valor</th>
                <th>Data</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontWeight: 600 }}>{row.title}</td>
                  <td>{asText(row.customer_name)}</td>
                  <td>{asText(row.vehicle)}</td>
                  <td style={{ fontWeight: 600 }}>{money(row.amount)}</td>
                  <td>{dateText(row.created_at)}</td>
                  <td>
                    <AdminStatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
