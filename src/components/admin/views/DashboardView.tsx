"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Car,
  ClipboardList,
  Clock,
  DollarSign,
  Package,
  Wallet,
  Wrench,
} from "lucide-react";
import {
  fetchDashboard,
  selectRows,
  type ContactMessage,
  type PanelRecord,
} from "../../../lib/supabase";
import { routeFor } from "../../../admin/navigation";
import { AdminStatusBadge } from "../StatusBadge";
import { RevenueChart, type RevenuePeriod } from "../RevenueChart";
import { dateText, detail, money, todayIso } from "../utils";

export function DashboardView() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [appointments, setAppointments] = useState<PanelRecord[]>([]);
  const [workOrders, setWorkOrders] = useState<PanelRecord[]>([]);
  const [inventory, setInventory] = useState<PanelRecord[]>([]);
  const [sales, setSales] = useState<PanelRecord[]>([]);
  const [finance, setFinance] = useState<PanelRecord[]>([]);
  const [chartPeriod, setChartPeriod] = useState<RevenuePeriod>(6);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([
      fetchDashboard(),
      selectRows<PanelRecord>("panel_records", {
        module: "eq.finance",
        order: "created_at.desc",
        limit: "200",
      }).catch(() => [] as PanelRecord[]),
    ])
      .then(([res, financeRows]) => {
        setMessages(res.messages);
        setAppointments(res.appointments);
        setWorkOrders(res.workOrders);
        setInventory(res.inventory);
        setSales(res.sales);
        setFinance(financeRows);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const today = todayIso();
  const currentMonthKey = today.slice(0, 7);
  const activeOs = workOrders.filter((w) => w.status === "em_andamento" || w.status === "aguardando");
  const todayAppointments = appointments.filter(
    (a) => String(detail(a, "starts_at") ?? "").slice(0, 10) === today && a.status !== "cancelado",
  );
  const lowStock = inventory.filter((item) => {
    const qty = Number(detail(item, "quantity") ?? 0);
    const min = Number(detail(item, "minimum_stock") ?? 0);
    return min > 0 && qty <= min;
  });

  const monthlyRevenue = useMemo(() => {
    const concluded = [...workOrders, ...sales].filter(
      (row) => row.status === "concluido" && row.created_at.slice(0, 7) === currentMonthKey,
    );
    return {
      total: concluded.reduce((acc, row) => acc + Number(row.amount ?? 0), 0),
      count: concluded.length,
    };
  }, [workOrders, sales, currentMonthKey]);

  const receivables = useMemo(() => {
    const openFinance = finance.filter(
      (row) =>
        String(detail(row, "tipo") ?? "entrada") === "entrada" &&
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

    [...workOrders, ...sales]
      .filter((row) => row.status === "concluido")
      .forEach((row) => {
        const key = row.created_at.slice(0, 7);
        const bucket = months.find((m) => m.key === key);
        if (bucket) bucket.value += Number(row.amount ?? 0);
      });

    return months.map((m) => ({
      month: m.month,
      value: m.value,
      label: money(m.value),
    }));
  }, [workOrders, sales, chartPeriod]);

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">BENITTES · OFICINA MECÂNICA</p>
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

      {error && <p className="admin-form-error" style={{ marginBottom: 16 }}>{error}</p>}

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
            <div className="admin-stat-number">{activeOs.length}</div>
            <p className="admin-stat-sub">Veículos em execução ou diagnóstico</p>
          </div>
        </a>

        <a href={routeFor("agenda")} className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">Agenda Hoje</span>
            <div className={`admin-stat-icon ${todayAppointments.length > 0 ? "green" : ""}`}>
              <Clock size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{todayAppointments.length}</div>
            <p className="admin-stat-sub">Entradas previstas para hoje</p>
          </div>
        </a>
      </section>

      <div className="admin-bento">
        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <p className="admin-kicker">FATURAMENTO REALIZADO</p>
              <h2>Últimos 6 meses (OS + Balcão)</h2>
            </div>
            <a href={routeFor("financeiro")}>
              Ver finanças <ArrowUpRight size={14} />
            </a>
          </div>
          <RevenueChart
            data={chartData}
            period={chartPeriod}
            onPeriodChange={setChartPeriod}
          />
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <p className="admin-kicker">ALERTAS DO DIA</p>
              <h2>Atenção operacional</h2>
            </div>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <a
              href={routeFor("estoque")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 12,
                borderRadius: 6,
                background: "var(--admin-soft)",
                border: "1px solid var(--admin-line)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 500 }}>
                <Package size={16} style={{ color: "var(--admin-orange)" }} />
                Peças abaixo do mínimo
              </span>
              <strong>{lowStock.length}</strong>
            </a>

            <a
              href={routeFor("veiculos")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 12,
                borderRadius: 6,
                background: "var(--admin-soft)",
                border: "1px solid var(--admin-line)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 500 }}>
                <Car size={16} style={{ color: "#3b82f6" }} />
                OS aguardando aprovação / peça
              </span>
              <strong>{workOrders.filter((w) => w.status === "aguardando").length}</strong>
            </a>

            <a
              href={routeFor("agenda")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 12,
                borderRadius: 6,
                background: "var(--admin-soft)",
                border: "1px solid var(--admin-line)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 500 }}>
                <CalendarDays size={16} style={{ color: "#22c55e" }} />
                Total de agendamentos ativos
              </span>
              <strong>{appointments.filter((a) => a.status !== "cancelado" && a.status !== "concluido").length}</strong>
            </a>
          </div>
        </section>
      </div>

      <div className="admin-two-col">
        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <p className="admin-kicker">BOX DA OFICINA</p>
              <h2>Ordens recentes</h2>
            </div>
            <a href={routeFor("ordens-de-servico")}>
              Abrir quadro <ArrowUpRight size={14} />
            </a>
          </div>
          {workOrders.length === 0 ? (
            <div className="admin-empty">
              <strong>Nenhuma ordem de serviço</strong>
              <p>Abra uma OS para acompanhar diagnóstico, peças e execução.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {workOrders.slice(0, 5).map((os) => (
                <div
                  key={os.id}
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
                    <strong style={{ fontSize: 13, display: "block" }}>{os.title} · {os.vehicle || "Veículo"}</strong>
                    <span style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                      {os.customer_name || "Cliente não informado"} · {money(os.amount)}
                    </span>
                  </div>
                  <AdminStatusBadge status={os.status} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <p className="admin-kicker">SITE INSTITUCIONAL</p>
              <h2>Mensagens recentes</h2>
            </div>
            <a href={routeFor("contatos")}>
              Ver caixa <ArrowUpRight size={14} />
            </a>
          </div>
          {messages.length === 0 ? (
            <div className="admin-empty">
              <strong>Nenhuma mensagem</strong>
              <p>Contatos enviados pelo formulário público aparecerão aqui.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {messages.slice(0, 5).map((msg) => (
                <div
                  key={msg.id}
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
