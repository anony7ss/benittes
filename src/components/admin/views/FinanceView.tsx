"use client";

import { SkeletonChart, SkeletonStatCards, SkeletonTable } from "../Skeletons";
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  FileSpreadsheet,
  ListOrdered,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { type PanelRecord } from "../../../lib/supabase";
import { AdminStatusBadge } from "../StatusBadge";
import { CashflowBarChart, DonutBreakdownChart } from "../AdminCharts";
import { asText, dateText, detail, money, todayIso, useModuleRecords, modalBackdropProps } from "../utils";
import { ClientPicker, clientDisplayName, useClientVehicleCatalog } from "../QuickPickers";

type FinanceTab = "all" | "receber" | "pagar" | "fluxo";
type FinanceTipo = "receber" | "pagar";

type FinanceForm = {
  title: string;
  tipo: FinanceTipo;
  amount: string;
  vencimento: string;
  categoria: string;
  customer_name: string;
  status: string;
  description: string;
};

const TABS: { id: FinanceTab; label: string }[] = [
  { id: "all", label: "Visão geral" },
  { id: "receber", label: "A receber" },
  { id: "pagar", label: "A pagar" },
  { id: "fluxo", label: "Fluxo de caixa" },
];

type BankStatementLine = {
  id: string;
  date: string;
  description: string;
  amount: number;
  tipo: FinanceTipo;
  matchedId: string | null;
  reconciled: boolean;
};

function parseBankStatement(content: string): BankStatementLine[] {
  const lines: BankStatementLine[] = [];
  if (content.includes("<STMTTRN>")) {
    const blocks = content.split("<STMTTRN>").slice(1);
    blocks.forEach((block, idx) => {
      const amtMatch = block.match(/<TRNAMT>([-+]?\d+(?:[.,]\d+)?)/i);
      const dateMatch = block.match(/<DTPOSTED>(\d{8})/i);
      const memoMatch = block.match(/<MEMO>([^<\r\n]+)/i);
      const rawAmt = amtMatch ? Number(amtMatch[1].replace(",", ".")) : 0;
      if (!rawAmt) return;
      const d = dateMatch?.[1]
        ? `${dateMatch[1].slice(0, 4)}-${dateMatch[1].slice(4, 6)}-${dateMatch[1].slice(6, 8)}`
        : todayIso();
      lines.push({
        id: `ofx-${idx}-${Date.now()}`,
        date: d,
        description: (memoMatch?.[1] ?? "Lançamento bancário").trim(),
        amount: Math.abs(rawAmt),
        tipo: rawAmt >= 0 ? "receber" : "pagar",
        matchedId: null,
        reconciled: false,
      });
    });
    return lines;
  }

  content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, idx) => {
      const sep = line.includes(";") ? ";" : ",";
      const cols = line.split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
      if (cols.length < 3) return;
      const rawAmt = Number(cols[cols.length - 1].replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(rawAmt) || rawAmt === 0) return;
      lines.push({
        id: `csv-${idx}-${Date.now()}`,
        date: cols[0].slice(0, 10) || todayIso(),
        description: cols.slice(1, -1).join(" · ") || "Lançamento CSV",
        amount: Math.abs(rawAmt),
        tipo: rawAmt >= 0 ? "receber" : "pagar",
        matchedId: null,
        reconciled: false,
      });
    });
  return lines;
}

const emptyForm = (): FinanceForm => ({
  title: "",
  tipo: "receber",
  amount: "",
  vencimento: todayIso(),
  categoria: "",
  customer_name: "",
  status: "aguardando",
  description: "",
});

function rowTipo(row: PanelRecord): FinanceTipo {
  return detail(row, "tipo") === "pagar" ? "pagar" : "receber";
}

export function FinanceView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, load, saveRecord, patchRecord, removeRecord } = useModuleRecords(
    "finance",
    session.user.id,
  );
  const { rows: workOrderRows, loading: workOrdersLoading } = useModuleRecords("work-orders", session.user.id);
  const { clients } = useClientVehicleCatalog();

  const [tab, setTab] = useState<FinanceTab>("all");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<FinanceForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [bankLines, setBankLines] = useState<BankStatementLine[]>([]);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);

  async function handleBankFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    const parsed = parseBankStatement(text).map((line) => {
      const match = rows.find((r) => {
        const rTipo = (detail(r, "tipo") as FinanceTipo | undefined) ?? "receber";
        return (
          rTipo === line.tipo &&
          Math.abs(Number(r.amount ?? 0) - line.amount) < 0.05 &&
          r.status !== "cancelado"
        );
      });
      return {
        ...line,
        matchedId: match?.id ?? null,
        reconciled: Boolean(match && match.status === "concluido" && detail(match, "conciliado")),
      };
    });
    setBankLines(parsed);
  }

  async function reconcileLine(line: BankStatementLine) {
    setReconcilingId(line.id);
    try {
      if (line.matchedId) {
        const existing = rows.find((r) => r.id === line.matchedId);
        const d = existing?.details && typeof existing.details === "object" ? existing.details : {};
        await patchRecord(line.matchedId, {
          status: "concluido",
          details: { ...d, conciliado: true, conciliado_em: todayIso() },
        });
      } else {
        await saveRecord(null, {
          title: line.description.slice(0, 80),
          amount: line.amount,
          status: "concluido",
          details: {
            tipo: line.tipo,
            vencimento: line.date,
            categoria: "Conciliação Bancária",
            conciliado: true,
            conciliado_em: todayIso(),
          },
        });
      }
      setBankLines((prev) =>
        prev.map((l) => (l.id === line.id ? { ...l, reconciled: true } : l)),
      );
    } finally {
      setReconcilingId(null);
    }
  }

  const stats = useMemo(() => {
    let receberConcluido = 0;
    let pagarConcluido = 0;
    let receberAberto = 0;
    let pagarAberto = 0;

    for (const row of rows) {
      const amount = Number(row.amount ?? 0);
      const tipo = rowTipo(row);
      if (row.status === "concluido") {
        if (tipo === "receber") receberConcluido += amount;
        else pagarConcluido += amount;
      } else if (row.status !== "cancelado") {
        if (tipo === "receber") receberAberto += amount;
        else pagarAberto += amount;
      }
    }

    for (const os of workOrderRows) {
      if (os.status === "concluido" || os.status === "cancelado") continue;
      if (detail(os, "finance_synced")) continue;
      receberAberto += Number(os.amount ?? 0);
    }

    return {
      saldo: receberConcluido - pagarConcluido,
      receberAberto,
      pagarAberto,
      total: rows.length,
    };
  }, [rows, workOrderRows]);

  const { cashflowData, categorySlices, totalMovimentado } = useMemo(() => {
    const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const now = new Date();
    const months: { key: string; label: string; inflow: number; outflow: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({ key, label: monthNames[d.getMonth()], inflow: 0, outflow: 0 });
    }

    const catMap = new Map<string, number>();
    let sumAll = 0;

    for (const row of rows) {
      if (row.status === "cancelado") continue;
      const val = Number(row.amount ?? 0);
      if (val <= 0) continue;
      sumAll += val;

      const dateStr = String(detail(row, "vencimento") || row.created_at).slice(0, 7);
      const bucket = months.find((m) => m.key === dateStr);
      const tipo = rowTipo(row);
      if (bucket) {
        if (tipo === "receber") bucket.inflow += val;
        else bucket.outflow += val;
      }

      const cat = String(detail(row, "categoria") ?? "").trim() || (tipo === "receber" ? "Receitas" : "Despesas");
      catMap.set(cat, (catMap.get(cat) ?? 0) + val);
    }

    const palette = ["#22c55e", "#174b88", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6"];
    const slices = [...catMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value], i) => ({
        label,
        value,
        color: palette[i % palette.length],
      }));

    return {
      cashflowData: months.map(({ label, inflow, outflow }) => ({ label, inflow, outflow })),
      categorySlices: slices,
      totalMovimentado: sumAll,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = rows.filter((row) => {
      const tipo = rowTipo(row);
      if (tab === "receber" && tipo !== "receber") return false;
      if (tab === "pagar" && tipo !== "pagar") return false;
      if (tab === "fluxo" && row.status === "cancelado") return false;
      if (!query) return true;
      const categoria = String(detail(row, "categoria") ?? "").toLowerCase();
      return (
        row.title.toLowerCase().includes(query) ||
        (row.customer_name ?? "").toLowerCase().includes(query) ||
        categoria.includes(query)
      );
    });

    if (tab === "fluxo") {
      return [...list].sort((a, b) => {
        const da = String(detail(a, "vencimento") || a.created_at);
        const db = String(detail(b, "vencimento") || b.created_at);
        return db.localeCompare(da);
      });
    }
    return list;
  }, [rows, tab, search]);

  function openNew() {
    setEditing(null);
    setForm({
      ...emptyForm(),
      tipo: tab === "pagar" ? "pagar" : "receber",
    });
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    setEditing(row);
    setForm({
      title: row.title,
      tipo: rowTipo(row),
      amount: row.amount !== null && row.amount !== undefined ? String(row.amount) : "",
      vencimento: String(detail(row, "vencimento") ?? row.created_at.slice(0, 10)),
      categoria: String(detail(row, "categoria") ?? ""),
      customer_name: row.customer_name ?? "",
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
        amount: Number.isNaN(parsedAmount) ? 0 : parsedAmount,
        customer_name: form.customer_name.trim() || null,
        status: form.status,
        description: form.description.trim() || null,
        details: {
          ...(editing?.details ?? {}),
          tipo: form.tipo,
          vencimento: form.vencimento || todayIso(),
          categoria: form.categoria.trim(),
        },
      });
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar o lançamento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkSettled(row: PanelRecord) {
    setError("");
    try {
      await patchRecord(row.id, { status: "concluido" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o lançamento.");
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">CONTROLE FINANCEIRO</p>
          <h1>Financeiro</h1>
        </div>
        <div className="admin-title-actions">
          <button type="button" className="admin-secondary" onClick={() => setReconcileOpen(true)}>
            <FileSpreadsheet size={15} /> Conciliar Extrato
          </button>
          <button type="button" className="admin-secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} /> Atualizar
          </button>
          <button type="button" className="admin-primary" onClick={openNew}>
            <Plus size={16} /> Novo lançamento
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-form-error" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      {loading || workOrdersLoading ? <SkeletonStatCards count={4} /> : (
      <section className="admin-stat-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">Saldo</span>
            <div className={`admin-stat-icon ${stats.saldo >= 0 ? "green" : "orange"}`}>
              <Wallet size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{money(stats.saldo)}</div>
            <p className="admin-stat-sub">Recebido menos pago concluído</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">A receber em aberto</span>
            <div className="admin-stat-icon blue">
              <ArrowDownLeft size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{money(stats.receberAberto)}</div>
            <p className="admin-stat-sub">Entradas previstas pendentes</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">A pagar em aberto</span>
            <div className="admin-stat-icon orange">
              <ArrowUpRight size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{money(stats.pagarAberto)}</div>
            <p className="admin-stat-sub">Compromissos pendentes</p>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-card-head">
            <span className="admin-stat-label">Total de lançamentos</span>
            <div className="admin-stat-icon">
              <ListOrdered size={15} />
            </div>
          </div>
          <div>
            <div className="admin-stat-number">{stats.total}</div>
            <p className="admin-stat-sub">Registros financeiros cadastrados</p>
          </div>
        </div>
      </section>
      )}

      <section className="admin-two-col" style={{ marginBottom: 20 }}>
        <div className="admin-panel">
          <div className="admin-panel-head">
            <h2>Entradas vs Saídas (6 meses)</h2>
          </div>
          {loading ? (
            <SkeletonChart variant="bars" />
          ) : (
            <div className="admin-data-enter"><CashflowBarChart data={cashflowData} /></div>
          )}
        </div>

        <div className="admin-panel">
          <div className="admin-panel-head">
            <h2>Distribuição por categoria</h2>
          </div>
          {loading ? (
            <SkeletonChart variant="donut" />
          ) : (
            <div className="admin-data-enter">
              <DonutBreakdownChart
                slices={categorySlices}
                centerLabel="Movimentado"
                centerValue={money(totalMovimentado)}
                emptyText="Cadastre lançamentos para ver a distribuição"
              />
            </div>
          )}
        </div>
      </section>

      <div className="admin-toolbar">
        <div className="admin-filter-pills">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`admin-pill${tab === item.id ? " active" : ""}`}
              onClick={() => setTab(item.id)}
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
            placeholder="Buscar descrição, categoria ou cliente..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={5} />
      ) : filtered.length === 0 ? (
        <div className="admin-empty">
          <strong>Nenhum lançamento encontrado</strong>
          <p>Crie um novo lançamento ou ajuste os filtros da visualização.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Categoria</th>
                <th>Valor</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const tipo = rowTipo(row);
                const canSettle = row.status !== "concluido" && row.status !== "cancelado";
                return (
                  <tr key={row.id}>
                    <td>{dateText(detail(row, "vencimento") || row.created_at)}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.title}</div>
                      {row.customer_name && (
                        <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>{row.customer_name}</div>
                      )}
                    </td>
                    <td>
                      <AdminStatusBadge
                        status={tipo === "receber" ? "ativo" : "em_andamento"}
                        label={tipo === "receber" ? "A receber" : "A pagar"}
                      />
                    </td>
                    <td>{asText(detail(row, "categoria"))}</td>
                    <td style={{ fontWeight: 600 }}>{money(row.amount)}</td>
                    <td>
                      <AdminStatusBadge status={row.status} />
                    </td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        {canSettle && (
                          <button
                            type="button"
                            className="admin-secondary"
                            style={{ minHeight: 34, padding: "0 10px", fontSize: 12 }}
                            onClick={() => void handleMarkSettled(row)}
                          >
                            <CheckCircle2 size={14} /> {tipo === "receber" ? "Recebido" : "Pago"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="admin-icon-btn"
                          title="Editar"
                          onClick={() => openEdit(row)}
                        >
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar lançamento" : "Novo lançamento"}</h2>
                <p>Informe os dados da movimentação financeira.</p>
              </div>
              <button type="button" className="admin-icon-btn" onClick={() => setModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={(event) => void handleSubmit(event)}>
              <div className="admin-form-grid">
                <label className="admin-field wide">
                  Descrição
                  <input
                    className="admin-input"
                    required
                    value={form.title}
                    onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
                    placeholder="Ex: Pagamento de peça, Recebimento OS #104..."
                  />
                </label>

                <label className="admin-field">
                  Tipo
                  <select
                    className="admin-select"
                    value={form.tipo}
                    onChange={(event) => setForm((f) => ({ ...f, tipo: event.target.value as FinanceTipo }))}
                  >
                    <option value="receber">A receber</option>
                    <option value="pagar">A pagar</option>
                  </select>
                </label>

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
                  Vencimento
                  <input
                    className="admin-input"
                    type="date"
                    value={form.vencimento}
                    onChange={(event) => setForm((f) => ({ ...f, vencimento: event.target.value }))}
                  />
                </label>

                <label className="admin-field">
                  Categoria
                  <input
                    className="admin-input"
                    value={form.categoria}
                    onChange={(event) => setForm((f) => ({ ...f, categoria: event.target.value }))}
                    placeholder="Ex: Peças, Serviços, Aluguel"
                  />
                </label>

                <div className="admin-field">
                  <label>Cliente / Fornecedor</label>
                  <ClientPicker
                    clients={clients}
                    value={form.customer_name}
                    onSelectClient={(picked) =>
                      setForm((f) => ({
                        ...f,
                        customer_name: picked ? clientDisplayName(picked) : "",
                      }))
                    }
                  />
                  <input
                    className="admin-input"
                    value={form.customer_name}
                    onChange={(event) => setForm((f) => ({ ...f, customer_name: event.target.value }))}
                    placeholder="Nome do cliente ou fornecedor"
                  />
                </div>

                <label className="admin-field">
                  Status
                  <select
                    className="admin-select"
                    value={form.status}
                    onChange={(event) => setForm((f) => ({ ...f, status: event.target.value }))}
                  >
                    <option value="novo">Novo</option>
                    <option value="aguardando">Aguardando</option>
                    <option value="concluido">Concluído</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </label>

                <label className="admin-field wide">
                  Observações
                  <textarea
                    className="admin-textarea"
                    value={form.description}
                    onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
                    placeholder="Notas adicionais sobre este lançamento..."
                  />
                </label>
              </div>

              <div className="admin-modal-actions">
                <button type="button" className="admin-secondary" onClick={() => setModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="admin-primary" disabled={saving}>
                  {saving ? "Salvando..." : editing ? "Salvar alterações" : "Criar lançamento"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {reconcileOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setReconcileOpen(false))}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>Conciliação Bancária (OFX / CSV)</h2>
                <p>Importe seu extrato bancário para conciliar ou lançar movimentações.</p>
              </div>
              <button type="button" className="admin-icon-btn" onClick={() => setReconcileOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label className="admin-secondary" style={{ cursor: "pointer", display: "inline-flex" }}>
                <Upload size={15} /> Selecionar arquivo .OFX ou .CSV
                <input
                  type="file"
                  accept=".ofx,.csv,text/csv"
                  onChange={(e) => void handleBankFile(e)}
                  style={{ display: "none" }}
                />
              </label>
            </div>

            {bankLines.length === 0 ? (
              <div className="admin-empty">
                Nenhum extrato carregado ainda. Aceita arquivos OFX bancários ou CSV (data;descrição;valor).
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8, maxHeight: "50vh", overflowY: "auto" }}>
                {bankLines.map((line) => (
                  <div
                    key={line.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      border: "1px solid var(--admin-line)",
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{line.description}</div>
                      <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                        {dateText(line.date)} · {line.matchedId ? "Correspondência encontrada" : "Novo lançamento"}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <strong style={{ color: line.tipo === "receber" ? "var(--admin-green)" : "var(--admin-red)" }}>
                        {line.tipo === "receber" ? "+" : "-"}
                        {money(line.amount)}
                      </strong>
                      {line.reconciled ? (
                        <AdminStatusBadge status="concluido" label="Conciliado" />
                      ) : (
                        <button
                          type="button"
                          className="admin-secondary"
                          style={{ height: 30, minHeight: 30, padding: "0 10px", fontSize: 12 }}
                          disabled={reconcilingId === line.id}
                          onClick={() => void reconcileLine(line)}
                        >
                          {line.matchedId ? "Conciliar" : "Importar"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
