"use client";

import { SkeletonTable } from "../Skeletons";
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

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [data, osData, salesData, finData] = await Promise.all([
        selectRows<PanelRecord>(selectedModule, {
          order: "created_at.desc",
          limit: "500",
        }),
        selectRows<PanelRecord>("work-orders", { order: "created_at.desc", limit: "500" }).catch(() => []),
        selectRows<PanelRecord>("sales", { order: "created_at.desc", limit: "500" }).catch(() => []),
        selectRows<PanelRecord>("finance", { order: "created_at.desc", limit: "500" }).catch(() => []),
      ]);
      setDreRows({ os: osData, sales: salesData, finance: finData });
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
    } finally {
      setLoading(false);
    }
  }, [selectedModule]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const dateOnly = brDateOnly(row.created_at);
      if (startDate && dateOnly < startDate) return false;
      if (endDate && dateOnly > endDate) return false;
      return true;
    });
  }, [rows, startDate, endDate]);

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
      const day = brDateOnly(r.created_at);
      return (!startDate || day >= startDate) && (!endDate || day <= endDate);
    };
    const osConcluidas = dreRows.os.filter((r) => inPeriod(r) && r.status === "concluido");
    const vendasConcluidas = dreRows.sales.filter((r) => inPeriod(r) && r.status === "concluido");
    const finPeriodo = dreRows.finance.filter((r) => inPeriod(r) && r.status === "concluido");

    const receitaServicos = osConcluidas.reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
    const receitaVendas = vendasConcluidas.reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
    const outrasEntradas = finPeriodo
      .filter((r) => String(detail(r, "tipo") ?? "receber") === "receber")
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

    const lucroLiquido = receitaBruta - comprasPecas - despesasOperacionais;
    const margem = receitaBruta > 0 ? (lucroLiquido / receitaBruta) * 100 : 0;

    return {
      receitaServicos,
      receitaVendas,
      outrasEntradas,
      receitaBruta,
      comprasPecas,
      despesasOperacionais,
      lucroLiquido,
      margem,
      comissaoTotal: (receitaServicos + receitaVendas) * (commissionPct / 100),
      osCount: osConcluidas.length,
      salesCount: vendasConcluidas.length,
    };
  }, [dreRows, startDate, endDate, commissionPct]);

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
          <p className="admin-kicker">EXPORTAÇÃO E INDICADORES</p>
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
              onChange={(event) => setSelectedModule(event.target.value as ReportModule)}
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
        </div>
      </section>

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
          <div style={{ display: "grid", gap: 10, fontSize: 13.5 }}>
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
              <span>(-) Compras de Peças / Fornecedores</span>
              <strong style={{ color: "var(--admin-red)" }}>-{money(dreSummary.comprasPecas)}</strong>
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
                onChange={(e) => setCommissionPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              />
            </label>
          </div>
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
        </section>
      )}

      {trendData.length > 0 && (
        <section className="admin-panel" style={{ marginBottom: 14 }}>
          <AreaTrendChart
            data={trendData}
            subtitle={`Evolução diária · ${MODULES.find((m) => m.id === selectedModule)?.label ?? "Relatório"}`}
          />
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
