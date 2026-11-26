"use client";

import { SkeletonTable } from "../Skeletons";
import { useMemo, useState } from "react";
import { AlertTriangle, Minus, Package, Pencil, Plus, Search, ShoppingBag, Trash2, X } from "lucide-react";
import { insertRow, type PanelRecord } from "../../../lib/supabase";
import { AdminStatusBadge } from "../StatusBadge";
import { asText, detail, money, todayIso, useModuleRecords, modalBackdropProps } from "../utils";

type InventoryForm = {
  title: string;
  sku: string;
  categoria: string;
  quantity: string;
  minimum_stock: string;
  amount: string;
  fornecedor: string;
  status: string;
  description: string;
};

const emptyForm: InventoryForm = {
  title: "",
  sku: "",
  categoria: "Peças",
  quantity: "0",
  minimum_stock: "2",
  amount: "",
  fornecedor: "",
  status: "concluido",
  description: "",
};

export function InventoryView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, patchRecord, removeRecord } =
    useModuleRecords("inventory", session.user.id);
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<InventoryForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseItemId, setPurchaseItemId] = useState("");
  const [purchaseSupplier, setPurchaseSupplier] = useState("");
  const [purchaseQty, setPurchaseQty] = useState("1");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [purchasePayable, setPurchasePayable] = useState(true);
  const [purchaseSaving, setPurchaseSaving] = useState(false);

  async function handlePurchaseSubmit(e: React.FormEvent) {
    e.preventDefault();
    const target = rows.find((r) => r.id === purchaseItemId);
    const qtyAdd = Math.max(1, Number(purchaseQty) || 1);
    const totalCost = Math.max(0, Number(purchaseCost.replace(",", ".")) || 0);
    if (!target) return;
    setPurchaseSaving(true);
    try {
      const existingDetails =
        target.details && typeof target.details === "object" ? target.details : {};
      const nextQty = Number(detail(target, "quantity") ?? 0) + qtyAdd;
      await patchRecord(target.id, {
        details: {
          ...existingDetails,
          quantity: nextQty,
          ...(purchaseSupplier.trim() ? { fornecedor: purchaseSupplier.trim() } : {}),
        },
      });
      if (purchasePayable && totalCost > 0) {
        await insertRow<PanelRecord>("panel_records", {
          module: "finance",
          title: `Compra: ${target.title} (${qtyAdd}x)`,
          customer_name: purchaseSupplier.trim() || String(detail(target, "fornecedor") ?? "") || null,
          amount: totalCost,
          status: "novo",
          details: {
            tipo: "pagar",
            categoria: "Compras / Fornecedores",
            vencimento: todayIso(),
          },
          created_by: session.user.id,
        });
      }
      setPurchaseOpen(false);
      setPurchaseQty("1");
      setPurchaseCost("");
    } finally {
      setPurchaseSaving(false);
    }
  }

  const isLowStock = (row: PanelRecord) => {
    const qty = Number(detail(row, "quantity") ?? 0);
    const min = Number(detail(row, "minimum_stock") ?? 0);
    return qty <= min;
  };

  const lowStockCount = useMemo(() => rows.filter(isLowStock).length, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (lowStockOnly && !isLowStock(row)) return false;
      if (!q) return true;
      const haystack = [
        row.title,
        detail(row, "sku"),
        detail(row, "categoria"),
        detail(row, "fornecedor"),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, lowStockOnly]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    setEditing(row);
    setForm({
      title: row.title ?? "",
      sku: String(detail(row, "sku") ?? ""),
      categoria: String(detail(row, "categoria") ?? "Peças"),
      quantity: String(detail(row, "quantity") ?? 0),
      minimum_stock: String(detail(row, "minimum_stock") ?? 0),
      amount: row.amount !== null && row.amount !== undefined ? String(row.amount) : "",
      fornecedor: String(detail(row, "fornecedor") ?? ""),
      status: row.status || "concluido",
      description: row.description ?? "",
    });
    setError("");
    setModalOpen(true);
  }

  async function adjustStock(row: PanelRecord, delta: number) {
    const current = Number(detail(row, "quantity") ?? 0);
    const nextQty = Math.max(0, current + delta);
    const existingDetails =
      row.details && typeof row.details === "object" ? row.details : {};
    try {
      await patchRecord(row.id, {
        details: {
          ...existingDetails,
          quantity: nextQty,
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao ajustar estoque.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const existingDetails =
        editing?.details && typeof editing.details === "object" ? editing.details : {};
      await saveRecord(editing, {
        title: form.title.trim(),
        amount: form.amount.trim() === "" ? null : Number(form.amount),
        status: form.status,
        description: form.description.trim() || null,
        details: {
          ...existingDetails,
          sku: form.sku.trim().toUpperCase(),
          categoria: form.categoria.trim(),
          quantity: Number(form.quantity || 0),
          minimum_stock: Number(form.minimum_stock || 0),
          fornecedor: form.fornecedor.trim(),
        },
      });
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">
            CONTROLE DE ESTOQUE
            {lowStockCount > 0 ? ` • ${lowStockCount} ITEM(NS) COM ESTOQUE BAIXO` : ""}
          </p>
          <h1>Estoque</h1>
        </div>
        <div className="admin-title-actions">
          <button
            type="button"
            className="admin-secondary"
            onClick={() => {
              setPurchaseItemId(rows[0]?.id ?? "");
              setPurchaseSupplier(String(detail(rows[0] ?? ({} as PanelRecord), "fornecedor") ?? ""));
              setPurchaseOpen(true);
            }}
            disabled={rows.length === 0}
          >
            <ShoppingBag size={15} /> Registrar compra
          </button>
          <button type="button" className="admin-primary" onClick={openCreate}>
            <Plus size={16} /> Novo item
          </button>
        </div>
      </div>

      {lowStockCount > 0 && (
        <div
          className="admin-form-error"
          style={{
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <AlertTriangle size={16} />
          <span>
            Atenção: {lowStockCount} {lowStockCount === 1 ? "item está" : "itens estão"} com
            quantidade igual ou abaixo do estoque mínimo.
          </span>
        </div>
      )}

      {error && <p className="admin-form-error" style={{ marginBottom: 16 }}>{error}</p>}

      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            className="admin-search"
            placeholder="Buscar por peça, SKU, categoria ou fornecedor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)} id="admin-views-inventoryview-241"
          />
        </div>
        <div className="admin-filter-pills">
          <button
            type="button"
            className={`admin-pill ${!lowStockOnly ? "active" : ""}`}
            onClick={() => setLowStockOnly(false)}
          >
            Todos ({rows.length})
          </button>
          <button
            type="button"
            className={`admin-pill ${lowStockOnly ? "active" : ""}`}
            onClick={() => setLowStockOnly(true)}
          >
            Estoque baixo ({lowStockCount})
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={6} />
      ) : filtered.length === 0 ? (
        <div className="admin-empty">
          <Package size={24} />
          <strong>Nenhum item encontrado</strong>
          <p>Cadastre peças ou insumos ou ajuste os filtros de busca.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Peça / Insumo</th>
                <th>SKU</th>
                <th>Categoria</th>
                <th>Qtd</th>
                <th>Mínimo</th>
                <th>Custo Unit.</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const qty = Number(detail(row, "quantity") ?? 0);
                const min = Number(detail(row, "minimum_stock") ?? 0);
                const low = qty <= min;

                return (
                  <tr key={row.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.title}</div>
                      {Boolean(detail(row, "fornecedor")) && (
                        <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                          Fornecedor: {String(detail(row, "fornecedor"))}
                        </div>
                      )}
                    </td>
                    <td>{asText(detail(row, "sku"))}</td>
                    <td>{asText(detail(row, "categoria"))}</td>
                    <td>
                      <span
                        style={{
                          fontWeight: 700,
                          color: low ? "#ef4444" : "inherit",
                        }}
                      >
                        {qty}
                      </span>
                    </td>
                    <td>{min}</td>
                    <td>{money(row.amount)}</td>
                    <td>
                      <AdminStatusBadge
                        status={low ? "aguardando" : row.status}
                        label={low ? "Estoque baixo" : undefined}
                      />
                    </td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <button
                          type="button"
                          className="admin-icon-btn"
                          title="Diminuir 1"
                          onClick={() => void adjustStock(row, -1)}
                        >
                          <Minus size={14} />
                        </button>
                        <button
                          type="button"
                          className="admin-icon-btn"
                          title="Adicionar 1"
                          onClick={() => void adjustStock(row, 1)}
                        >
                          <Plus size={14} />
                        </button>
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
                          title="Remover"
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
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar item de estoque" : "Novo item de estoque"}</h2>
                <p>Gerencie quantidades, estoque mínimo e custo unitário.</p>
              </div>
              <button
                type="button"
                className="admin-icon-btn"
                onClick={() => setModalOpen(false)}
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="admin-form-grid">
                <div className="admin-field wide">
                  <label>Peça / Insumo</label>
                  <input
                    className="admin-input"
                    required
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Ex: Pastilha de freio dianteira" id="admin-views-inventoryview-390"
                  />
                </div>
                <div className="admin-field">
                  <label>SKU</label>
                  <input
                    className="admin-input"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })}
                    placeholder="PF-001" id="admin-views-inventoryview-400"
                  />
                </div>
                <div className="admin-field">
                  <label>Categoria</label>
                  <input
                    className="admin-input"
                    value={form.categoria}
                    onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                    placeholder="Freios, Óleos, Filtros..." id="admin-views-inventoryview-409"
                  />
                </div>
                <div className="admin-field">
                  <label>Quantidade</label>
                  <input
                    type="number"
                    min="0"
                    className="admin-input"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })} id="admin-views-inventoryview-418"
                  />
                </div>
                <div className="admin-field">
                  <label>Estoque mínimo</label>
                  <input
                    type="number"
                    min="0"
                    className="admin-input"
                    value={form.minimum_stock}
                    onChange={(e) => setForm({ ...form, minimum_stock: e.target.value })} id="admin-views-inventoryview-428"
                  />
                </div>
                <div className="admin-field">
                  <label>Custo unitário (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="admin-input"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="89.90" id="admin-views-inventoryview-438"
                  />
                </div>
                <div className="admin-field">
                  <label>Fornecedor</label>
                  <input
                    className="admin-input"
                    value={form.fornecedor}
                    onChange={(e) => setForm({ ...form, fornecedor: e.target.value })}
                    placeholder="Distribuidora Auto Peças" id="admin-views-inventoryview-450"
                  />
                </div>
                <div className="admin-field wide">
                  <label>Observações</label>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Aplicação, localização na prateleira..." id="admin-views-inventoryview-459"
                  />
                </div>
              </div>
              <div className="admin-modal-actions">
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={() => setModalOpen(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="admin-primary" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {purchaseOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setPurchaseOpen(false))}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>Registrar Compra / Entrada</h2>
                <p>Atualiza o estoque automaticamente e lança em Contas a Pagar.</p>
              </div>
              <button type="button" className="admin-icon-btn" onClick={() => setPurchaseOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={(e) => void handlePurchaseSubmit(e)}>
              <div className="admin-form-grid">
                <div className="admin-field wide">
                  <label>Peça / Item *</label>
                  <select
                    className="admin-select"
                    required
                    value={purchaseItemId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setPurchaseItemId(id);
                      const picked = rows.find((r) => r.id === id);
                      if (picked) {
                        setPurchaseSupplier(String(detail(picked, "fornecedor") ?? ""));
                      }
                    }} id="admin-views-inventoryview-500"
                  >
                    {rows.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} (Atual: {String(detail(r, "quantity") ?? 0)})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="admin-field wide">
                  <label>Fornecedor</label>
                  <input
                    className="admin-input"
                    value={purchaseSupplier}
                    onChange={(e) => setPurchaseSupplier(e.target.value)}
                    placeholder="Nome do fornecedor / distribuidora" id="admin-views-inventoryview-522"
                  />
                </div>
                <div className="admin-field">
                  <label>Quantidade comprada *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    className="admin-input"
                    value={purchaseQty}
                    onChange={(e) => setPurchaseQty(e.target.value)} id="admin-views-inventoryview-531"
                  />
                </div>
                <div className="admin-field">
                  <label>Valor total da compra (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    className="admin-input"
                    value={purchaseCost}
                    onChange={(e) => setPurchaseCost(e.target.value)}
                    placeholder="0.00" id="admin-views-inventoryview-542"
                  />
                </div>
                <label className="admin-field wide" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={purchasePayable}
                    onChange={(e) => setPurchasePayable(e.target.checked)} id="admin-views-inventoryview-553"
                  />
                  <span>Lançar automaticamente em Contas a Pagar (Financeiro)</span>
                </label>
              </div>
              <div className="admin-modal-actions">
                <button type="button" className="admin-secondary" onClick={() => setPurchaseOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="admin-primary" disabled={purchaseSaving}>
                  {purchaseSaving ? "Registrando..." : "Confirmar compra"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
