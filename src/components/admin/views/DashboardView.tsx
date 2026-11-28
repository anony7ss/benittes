"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Car,
  ClipboardList,
  Clock,
  DollarSign,
  Package,
  RefreshCw,
  Wallet,
  Wrench,
} from "lucide-react";
import {
  fetchDashboard,
  type ContactMessage,
  type PanelRecord,
} from "../../../lib/supabase";
import { routeFor } from "../../../admin/navigation";
import { AdminStatusBadge } from "../StatusBadge";
import { RevenueChart, type RevenuePeriod } from "../RevenueChart";
import { SkeletonChart, SkeletonDashboardRows, SkeletonStatCards } from "../Skeletons";
import { dateText, detail, money, todayIso } from "../utils";

export function DashboardView() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [workOrders, setWorkOrders] = useState<PanelRecord[]>([]);
  const [workOrdersForRevenue, setWorkOrdersForRevenue] = useState<PanelRecord[]>([]);
  const [inventory, setInventory] = useState<PanelRecord[]>([]);
  const [sales, setSales] = useState<PanelRecord[]>([]);
  const [finance, setFinance] = useState<PanelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartPeriod, setChartPeriod] = useState<RevenuePeriod>(6);
  const [error, setError] = useState("");
  const [counts, setCounts] = useState({ todayAppointments: 0, activeWorkOrders: 0, waitingWorkOrders: 0 });

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchDashboard();
        setMessages(res.messages);
        setWorkOrders(res.workOrders);
        setWorkOrdersForRevenue(res.workOrdersForRevenue);
        setInventory(res.inventory);
        setSales(res.sales);
        setFinance(res.finance);
        setCounts(res.counts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar os dados do painel.");
      setMessages([]);
      setWorkOrders([]);
      setWorkOrdersForRevenue([]);
      setInventory([]);
      setSales([]);
      setFinance([]);
      setCounts({ todayAppointments: 0, activeWorkOrders: 0, waitingWorkOrders: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const today = todayIso();
  const currentMonthKey = today.slice(0, 7);
  const lowStock = inventory.filter((item) => {
    const qty = Number(detail(item, "quantity") ?? 0);
    const min = Number(detail(item, "minimum_stock") ?? 0);
    return min > 0 && qty <= min;
  });

  const monthlyRevenue = useMemo(() => {
    const concludedOrders = workOrdersForRevenue.filter(
      (row) => row.status === "concluido" && String(detail(row, "finalized_at") ?? row.updated_at ?? row.created_at).slice(0, 7) === currentMonthKey,
    );
    const linkedOrderIds = new Set(concludedOrders.map((row) => row.id));
    const standaloneSales = sales.filter((row) => !linkedOrderIds.has(String(detail(row, "source_work_order_id") ?? "")));
    const concluded = [...concludedOrders, ...standaloneSales].filter(
      (row) => row.status === "concluido" && String(detail(row, "finalized_at") ?? row.updated_at ?? row.created_at).slice(0, 7) === currentMonthKey,
    );
    return {
      total: concluded.reduce((acc, row) => acc + Number(row.amount ?? 0), 0),
      count: concluded.length,
    };
  }, [workOrdersForRevenue, sales, currentMonthKey]);

  const receivables = useMemo(() => {
    const openFinance = finance.filter(
      (row) =>
        String(detail(row, "tipo") ?? "receber") === "receber" &&
        row.status !== "concluido" &&
        row.status !== "cancelado",
    );
    const openOsAndSales = [...workOrders, ...sales].filter(
      (row) => row.status !== "concluido" && row.status !== "cancelado" && Number(row.amount ?? 0) > 0,
    );
    const all = [...openFinance, ...openOsAndSales];
    return {
      total: all.reduce((acc, row) => acc + Number(row.amount ?? 0), 0),
      count: all.length,
    };
  }, [finance, workOrders, sales]);

  const chartData = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: chartPeriod }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (chartPeriod - 1 - i), 1);
      return {
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        month: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        value: 0,
      };
    });

    const concludedOrders = workOrdersForRevenue.filter((row) => row.status === "concluido");
    const linkedOrderIds = new Set(concludedOrders.map((row) => row.id));
    [...concludedOrders, ...sales.filter((row) => !linkedOrderIds.has(String(detail(row, "source_work_order_id") ?? "")))]
      .filter((row) => row.status === "concluido")
      .forEach((row) => {
        const key = String(detail(row, "finalized_at") ?? row.updated_at ?? row.created_at).slice(0, 7);
        const bucket = months.find((m) => m.key === key);
        if (bucket) bucket.value += Number(row.amount ?? 0);
      });

    return months.map((m) => ({
      month: m.month,
      value: m.value,
      label: money(m.value),
    }));
  }, [workOrdersForRevenue, sales, chartPeriod]);

  return (
    <>
      <div className="admin-page-title">
        <div>
          <h1>Visão geral</h1>
        </div>
        <div className="admin-title-actions">
          <a className="admin-secondary" href={routeFor("ordens-de-servico")}>
            <ClipboardList size={15} /> Abrir OS
          </a>
          <a className="admin-primary admin-dashboard-new-appointment" href={routeFor("agenda")}>
            Novo horário <ArrowRight className="admin-dashboard-appointment-arrow" size={16} aria-hidden="true" />
          </a>
        </div>
      </div>

      {error && (
        <div className="admin-form-error" role="alert" style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span>{error}</span>
          <button type="button" className="admin-secondary" onClick={() => void loadDashboard()} disabled={loading}>
            <RefreshCw size={14} /> Tentar novamente
          </button>
        </div>
      )}

      {loading ? <SkeletonStatCards count={4} /> : (
      <section className="admin-stat-grid">
        <a href={routeFor("relatorios")} className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">Faturamento do Mês</span>
            <div className="admin-stat-icon green">
              <DollarSign size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{money(monthlyRevenue.total)}</div>
            <p className="admin-stat-sub">
              {monthlyRevenue.count} {monthlyRevenue.count === 1 ? "serviço concluído" : "serviços concluídos"}
            </p>
          </div>
        </a>

        <a href={routeFor("financeiro")} className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">A Receber</span>
            <div className={`admin-stat-icon ${receivables.total > 0 ? "orange" : "blue"}`}>
              <Wallet size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{money(receivables.total)}</div>
            <p className="admin-stat-sub">
              {receivables.count} {receivables.count === 1 ? "lançamento em aberto" : "lançamentos em aberto"}
            </p>
          </div>
        </a>

        <a href={routeFor("ordens-de-servico")} className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">OS no Box</span>
            <div className="admin-stat-icon orange">
              <Wrench size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{counts.activeWorkOrders}</div>
            <p className="admin-stat-sub">Veículos em execução ou diagnóstico</p>
          </div>
        </a>

        <a href={routeFor("agenda")} className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">Agenda Hoje</span>
            <div className={`admin-stat-icon ${counts.todayAppointments > 0 ? "green" : ""}`}>
              <Clock size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{counts.todayAppointments}</div>
            <p className="admin-stat-sub">Entradas previstas para hoje</p>
          </div>
        </a>
      </section>
      )}

      <div className="admin-bento">
        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Últimos 6 meses (OS + Balcão)</h2>
            </div>
            <a href={routeFor("financeiro")}>
              Ver finanças <ArrowUpRight size={14} />
            </a>
          </div>
          {loading ? (
            <SkeletonChart variant="bars" height={228} />
          ) : (
            <div className="admin-data-enter">
              <RevenueChart
                data={chartData}
                period={chartPeriod}
                onPeriodChange={setChartPeriod}
              />
            </div>
          )}
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Atenção operacional</h2>
            </div>
          </div>
          {loading ? <SkeletonDashboardRows count={4} variant="alert" /> : (
            <div className="admin-dashboard-data-list admin-dashboard-alert-list">
              <a href={routeFor("estoque")} className="admin-data-enter admin-dashboard-alert-row">
                <span className="admin-dashboard-alert-icon"><Package size={15} aria-hidden="true" /></span>
                <span className="admin-dashboard-alert-copy">
                  <strong>Peças abaixo do mínimo</strong>
                  <small>Estoque da oficina</small>
                </span>
                <strong className="admin-dashboard-alert-value">{lowStock.length}</strong>
              </a>

              <a href={routeFor("ordens-de-servico")} className="admin-data-enter admin-dashboard-alert-row">
                <span className="admin-dashboard-alert-icon"><Car size={15} aria-hidden="true" /></span>
                <span className="admin-dashboard-alert-copy">
                  <strong>Aguardando aprovação ou peça</strong>
                  <small>Ordens de serviço</small>
                </span>
                <strong className="admin-dashboard-alert-value">
                  {counts.waitingWorkOrders}
                </strong>
              </a>

              <a href={routeFor("agenda")} className="admin-data-enter admin-dashboard-alert-row">
                <span className="admin-dashboard-alert-icon"><CalendarDays size={15} aria-hidden="true" /></span>
                <span className="admin-dashboard-alert-copy">
                  <strong>Entradas previstas hoje</strong>
                  <small>Agenda da oficina</small>
                </span>
                <strong className="admin-dashboard-alert-value">{counts.todayAppointments}</strong>
              </a>

              <a href={routeFor("financeiro")} className="admin-data-enter admin-dashboard-alert-row">
                <span className="admin-dashboard-alert-icon"><Wallet size={15} aria-hidden="true" /></span>
                <span className="admin-dashboard-alert-copy">
                  <strong>Em aberto</strong>
                  <small>
                    {receivables.count} {receivables.count === 1 ? "lançamento a receber" : "lançamentos a receber"}
                  </small>
                </span>
                <strong className="admin-dashboard-alert-value">{money(receivables.total)}</strong>
              </a>
            </div>
          )}
        </section>
      </div>

      <div className="admin-two-col admin-dashboard-lower">
        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Ordens recentes</h2>
            </div>
            <a href={routeFor("ordens-de-servico")}>
              Abrir quadro <ArrowUpRight size={14} />
            </a>
          </div>
          {loading ? (
            <SkeletonDashboardRows count={3} />
          ) : workOrders.length === 0 ? (
            <div className="admin-empty admin-data-enter">
              <strong>Nenhuma ordem de serviço</strong>
              <p>Abra uma OS para acompanhar diagnóstico, peças e execução.</p>
            </div>
          ) : (
            <div className="admin-dashboard-data-list admin-dashboard-work-orders">
              {workOrders.slice(0, 5).map((os) => {
                const technician = String(detail(os, "tecnico") ?? "").trim();
                const bay = String(detail(os, "box") ?? "").trim();
                const approved = String(detail(os, "aprovacao") ?? "pendente") === "aprovado";

                return (
                  <article key={os.id} className="admin-data-enter admin-dashboard-work-order">
                    <div className="admin-dashboard-work-order-main">
                      <strong className="admin-dashboard-work-order-title">
                        {os.title || "Serviço sem nome"}
                      </strong>
                      <div className="admin-dashboard-work-order-context">
                        <span>{os.vehicle ? `Placa ${os.vehicle.trim().toUpperCase()}` : "Veículo não informado"}</span>
                        <span>{os.customer_name || "Cliente não informado"}</span>
                      </div>
                      <div className="admin-dashboard-work-order-meta">
                        <span className={approved ? "is-approved" : "is-pending"}>
                          {approved ? "Aprovado pelo cliente" : "Aguardando aprovação"}
                        </span>
                        <span>{technician ? `Técnico: ${technician}` : "Técnico a definir"}</span>
                        {bay && <span>Box: {bay}</span>}
                        <span>{dateText(os.created_at, { dateStyle: "short" })}</span>
                      </div>
                    </div>
                    <div className="admin-dashboard-work-order-side">
                      <AdminStatusBadge status={os.status} />
                      <strong className="admin-dashboard-work-order-amount">{money(os.amount)}</strong>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Mensagens recentes</h2>
            </div>
            <a href={routeFor("contatos")}>
              Ver caixa <ArrowUpRight size={14} />
            </a>
          </div>
          {loading ? (
            <SkeletonDashboardRows count={3} />
          ) : messages.length === 0 ? (
            <div className="admin-empty admin-data-enter">
              <strong>Nenhuma mensagem</strong>
              <p>Contatos enviados pelo formulário público aparecerão aqui.</p>
            </div>
          ) : (
            <div className="admin-dashboard-data-list">
              {messages.slice(0, 5).map((msg) => (
                <div
                  key={msg.id}
                  className="admin-data-enter"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 6,
                    background: "var(--admin-soft)",
                    border: "1px solid var(--admin-line)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 13, display: "block" }}>{msg.name}</strong>
                    <span style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                      {msg.email} · {dateText(msg.created_at, { dateStyle: "short" })}
                    </span>
                  </div>
                  <AdminStatusBadge status={msg.status} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
