"use client";

import { SkeletonCards, SkeletonTable } from "../Skeletons";
import { useMemo, useState, type FormEvent } from "react";
import { LayoutGrid, List, Pencil, Plus, Power, Search, Tag, Trash2, Wrench, X } from "lucide-react";
import type { PanelRecord } from "../../../lib/supabase";
import { pricingModeForService } from "../../../lib/servicePricing";
import { AdminStatusBadge } from "../StatusBadge";
import { asText, detail, money, useModuleRecords, usePersistedViewMode, modalBackdropProps } from "../utils";

type ServiceForm = {
  title: string;
  categoria: string;
  amount: string;
  preco_promo: string;
  duracao: string;
  status: string;
  description: string;
  pricing_mode: "fixed" | "vehicle" | "assessment";
};

const emptyForm: ServiceForm = {
  title: "",
  categoria: "Mecânica Geral",
  amount: "",
  preco_promo: "",
  duracao: "",
  status: "concluido",
  description: "",
  pricing_mode: "assessment",
};

const DEFAULT_CATEGORIES = [
  "Mecânica Geral",
  "Revisão Preventiva",
  "Freios",
  "Suspensão e Direção",
  "Motor e Câmbio",
  "Injeção Eletrônica",
  "Arrefecimento",
  "Elétrica e Bateria",
  "Alinhamento e Balanceamento",
  "Ar-condicionado",
  "Troca de Óleo e Filtros",
  "Diagnóstico Computadorizado",
];

const CUSTOM_CATEGORY_VALUE = "__custom__";

export function ServicesView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, patchRecord, removeRecord } =
    useModuleRecords("services", session.user.id);
  const {
    rows: settingsRows,
    saveRecord: saveSettingsRecord,
  } = useModuleRecords("settings", session.user.id);

  const [subPage, setSubPage] = useState<"services" | "catalog">("services");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("todas");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [savingCat, setSavingCat] = useState(false);
  const [viewMode, setViewMode] = usePersistedViewMode("services", "list", ["list", "cards"] as const);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<ServiceForm>(emptyForm);
  const [customCategoryMode, setCustomCategoryMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const customCatRecord = useMemo(
    () => settingsRows.find((r) => r.title === "__categorias_servicos__") ?? null,
    [settingsRows],
  );

  const savedCustomCategories = useMemo(() => {
    const raw = customCatRecord?.details;
    if (!raw || typeof raw !== "object") return [] as string[];
    const list = (raw as { categories?: unknown }).categories;
    return Array.isArray(list) ? list.map((c) => String(c).trim()).filter(Boolean) : [];
  }, [customCatRecord]);

  const usedCategories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => {
      const cat = String(detail(row, "categoria") ?? "").trim();
      if (cat) set.add(cat);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows]);

  const categories = useMemo(() => {
    const set = new Set<string>([...DEFAULT_CATEGORIES, ...savedCustomCategories, ...usedCategories]);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [savedCustomCategories, usedCategories]);

  async function persistCustomCategories(next: string[]) {
    setSavingCat(true);
    setError("");
    try {
      await saveSettingsRecord(customCatRecord, {
        title: "__categorias_servicos__",
        description: "Categorias personalizadas de serviços",
        status: "ativo",
        details: { categories: next },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar categoria.");
    } finally {
      setSavingCat(false);
    }
  }

  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault();
    const clean = newCategoryName.trim();
    if (!clean) return;
    if (!categories.some((c) => c.toLowerCase() === clean.toLowerCase())) {
      await persistCustomCategories([...savedCustomCategories, clean]);
    }
    setNewCategoryName("");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const cat = String(detail(row, "categoria") ?? "").trim();
      if (categoryFilter !== "todas" && cat !== categoryFilter) return false;
      if (!q) return true;
      const haystack = [row.title, cat, row.description].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, categoryFilter]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setCustomCategoryMode(false);
    setError("");
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    const cat = String(detail(row, "categoria") ?? "Mecânica Geral");
    setEditing(row);
    setForm({
      title: row.title ?? "",
      categoria: cat,
      amount: row.amount !== null && row.amount !== undefined ? String(row.amount) : "",
      preco_promo: String(detail(row, "preco_promo") ?? ""),
      duracao: String(detail(row, "duracao") ?? ""),
      status: row.status || "concluido",
      description: row.description ?? "",
      pricing_mode: pricingModeForService(row),
    });
    setCustomCategoryMode(Boolean(cat && !categories.includes(cat)));
    setError("");
    setModalOpen(true);
  }

  async function toggleActive(row: PanelRecord) {
    const nextStatus = row.status === "concluido" ? "cancelado" : "concluido";
    try {
      await patchRecord(row.id, { status: nextStatus });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao atualizar status.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    const basePrice = Number(form.amount.replace(",", "."));
    if (form.pricing_mode === "fixed" && (!Number.isFinite(basePrice) || basePrice <= 0)) {
      setError("Informe um preço fixo maior que zero ou escolha outro modelo de cobrança.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const existingDetails =
        editing?.details && typeof editing.details === "object" ? editing.details : {};
      await saveRecord(editing, {
        title: form.title.trim(),
        amount: form.pricing_mode === "fixed" ? basePrice : null,
        status: form.status,
        description: form.description.trim() || null,
        details: {
          ...existingDetails,
          categoria: form.categoria.trim(),
          preco_promo: form.pricing_mode === "fixed" && form.preco_promo.trim() !== "" ? Number(form.preco_promo) : null,
          duracao: form.duracao.trim(),
          pricing_mode: form.pricing_mode,
        },
      });
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar serviço.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">CATÁLOGO DA OFICINA</p>
          <h1>{subPage === "services" ? "Serviços" : "Categorias de serviço"}</h1>
        </div>
        {subPage === "services" && (
          <div className="admin-title-actions">
            <a href="/painel/precos/" className="admin-secondary" style={{ textDecoration: "none" }}>
              Preços por veículo
            </a>
            <button type="button" className="admin-primary" onClick={openCreate}>
              <Plus size={16} /> Novo serviço
            </button>
          </div>
        )}
      </div>

      <div className="admin-toolbar" style={{ marginBottom: 16 }}>
        <div className="admin-filter-pills">
          <button
            type="button"
            className={`admin-pill ${subPage === "services" ? "active" : ""}`}
            onClick={() => setSubPage("services")}
          >
            <Wrench size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
            Serviços ({rows.length})
          </button>
          <button
            type="button"
            className={`admin-pill ${subPage === "catalog" ? "active" : ""}`}
            onClick={() => setSubPage("catalog")}
          >
            <Tag size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
            Categorias ({categories.length})
          </button>
        </div>
      </div>

      {error && <p className="admin-form-error" style={{ marginBottom: 16 }}>{error}</p>}

      {subPage === "catalog" ? (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <h2>Categorias de serviço ({categories.length})</h2>
          </div>
          <form
            onSubmit={(e) => void handleCreateCategory(e)}
            style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}
          >
            <input
              className="admin-input"
              style={{ flex: "1 1 240px", maxWidth: 360 }}
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="Ex: Estética Automotiva, Funilaria..."
              required
            />
            <button type="submit" className="admin-primary" disabled={savingCat}>
              <Plus size={15} /> {savingCat ? "Salvando..." : "Criar categoria"}
            </button>
          </form>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {categories.map((cat) => {
              const isCustom = savedCustomCategories.includes(cat);
              return (
                <span
                  key={cat}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 11px",
                    borderRadius: 999,
                    fontSize: 12.5,
                    border: "1px solid var(--admin-line)",
                    color: isCustom ? "var(--admin-orange)" : "var(--admin-ink)",
                  }}
                >
                  {cat}
                  {isCustom && (
                    <button
                      type="button"
                      onClick={() =>
                        void persistCustomCategories(
                          savedCustomCategories.filter((c) => c !== cat),
                        )
                      }
                      title="Remover categoria personalizada"
                      style={{
                        border: 0,
                        background: "transparent",
                        color: "inherit",
                        cursor: "pointer",
                        padding: 0,
                        display: "inline-flex",
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        <>

      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            className="admin-search"
            placeholder="Buscar serviço ou categoria..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="admin-filter-pills">
            <button
              type="button"
              className={`admin-pill ${viewMode === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
            >
              <List size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
              Lista
            </button>
            <button
              type="button"
              className={`admin-pill ${viewMode === "cards" ? "active" : ""}`}
              onClick={() => setViewMode("cards")}
            >
              <LayoutGrid size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
              Cards
            </button>
          </div>
          <div className="admin-filter-pills">
            <button
              type="button"
              className={`admin-pill ${categoryFilter === "todas" ? "active" : ""}`}
              onClick={() => setCategoryFilter("todas")}
            >
              Todas ({rows.length})
            </button>
            {usedCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`admin-pill ${categoryFilter === cat ? "active" : ""}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        viewMode === "list" ? (
          <SkeletonTable rows={5} />
        ) : (
          <SkeletonCards count={6} />
        )
      ) : filtered.length === 0 ? (
        <div className="admin-empty">
          <Wrench size={24} />
          <strong>Nenhum serviço encontrado</strong>
          <p>Adicione um serviço ao catálogo ou altere os filtros.</p>
        </div>
      ) : viewMode === "list" ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Serviço</th>
                <th>Categoria</th>
                <th>Duração</th>
                <th>Valor</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const categoria = detail(row, "categoria");
                const duracao = detail(row, "duracao");
                const promo = detail(row, "preco_promo");
                const pricingMode = pricingModeForService(row);
                const amountLabel = pricingMode === "vehicle"
                  ? "Por veículo"
                  : pricingMode === "assessment"
                    ? "Sob avaliação"
                    : row.amount !== null && row.amount !== undefined && row.amount > 0
                      ? money(row.amount)
                      : "Valor pendente";
                const isActive = row.status === "concluido";
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.title}</strong>
                      {row.description && (
                        <div style={{ fontSize: 11.5, color: "var(--admin-muted)", marginTop: 2 }}>
                          {row.description}
                        </div>
                      )}
                    </td>
                    <td>{asText(categoria)}</td>
                    <td>{asText(duracao)}</td>
                    <td>
                      <strong>{amountLabel}</strong>
                      {pricingMode === "fixed" && promo !== undefined && promo !== null && promo !== "" && Number(promo) > 0 && (
                        <div style={{ fontSize: 11, color: "var(--admin-orange)" }}>
                          Promo: {money(promo)}
                        </div>
                      )}
                    </td>
                    <td>
                      <AdminStatusBadge
                        status={row.status}
                        label={isActive ? "Ativo" : row.status === "cancelado" ? "Inativo" : undefined}
                      />
                    </td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <button
                          type="button"
                          className="admin-icon-btn"
                          title={isActive ? "Desativar serviço" : "Ativar serviço"}
                          onClick={() => void toggleActive(row)}
                        >
                          <Power size={14} />
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
      ) : (
        <div className="admin-three-col">
          {filtered.map((row) => {
            const categoria = detail(row, "categoria");
            const duracao = detail(row, "duracao");
            const promo = detail(row, "preco_promo");
                const pricingMode = pricingModeForService(row);
                const amountLabel = pricingMode === "vehicle"
                  ? "Por veículo"
                  : pricingMode === "assessment"
                    ? "Sob avaliação"
                    : row.amount !== null && row.amount !== undefined && row.amount > 0
                      ? money(row.amount)
                      : "Valor pendente";
            const isActive = row.status === "concluido";

            return (
              <div key={row.id} className="admin-panel" style={{ marginTop: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  <AdminStatusBadge
                    status={row.status}
                    label={isActive ? "Ativo" : row.status === "cancelado" ? "Inativo" : undefined}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="admin-icon-btn"
                      title={isActive ? "Desativar serviço" : "Ativar serviço"}
                      onClick={() => void toggleActive(row)}
                    >
                      <Power size={14} />
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
                </div>

                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{row.title}</div>
                <div style={{ fontSize: 12, color: "var(--admin-muted)", marginBottom: 12 }}>
                  {asText(categoria)} {duracao ? `• ${String(duracao)}` : ""}
                </div>

                {row.description && (
                  <p
                    style={{
                      fontSize: 12.5,
                      color: "var(--admin-muted)",
                      marginBottom: 14,
                      lineHeight: 1.45,
                    }}
                  >
                    {row.description}
                  </p>
                )}

                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    paddingTop: 12,
                    borderTop: "1px solid var(--admin-line)",
                  }}
                >
                  <span style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                    {pricingMode === "fixed" ? "Valor fixo" : "Modelo de preço"}
                  </span>
                  <div style={{ textAlign: "right" }}>
                    <strong style={{ fontSize: 17 }}>{amountLabel}</strong>
                    {pricingMode === "fixed" && promo !== null && promo !== undefined && promo !== "" && Number(promo) > 0 && (
                      <div style={{ fontSize: 11, color: "var(--admin-orange)" }}>
                        Promo: {money(promo)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar serviço" : "Novo serviço"}</h2>
                <p>Defina se o valor é fixo, varia por veículo ou depende de avaliação.</p>
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
                  <label>Nome do serviço</label>
                  <input
                    className="admin-input"
                    required
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Ex: Revisão completa de freios"
                  />
                </div>
                <div className="admin-field">
                  <label>Categoria</label>
                  <select
                    className="admin-select"
                    value={customCategoryMode ? CUSTOM_CATEGORY_VALUE : form.categoria}
                    onChange={(e) => {
                      if (e.target.value === CUSTOM_CATEGORY_VALUE) {
                        setCustomCategoryMode(true);
                        setForm({ ...form, categoria: "" });
                      } else {
                        setCustomCategoryMode(false);
                        setForm({ ...form, categoria: e.target.value });
                      }
                    }}
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                    <option value={CUSTOM_CATEGORY_VALUE}>+ Criar nova categoria…</option>
                  </select>
                  {customCategoryMode && (
                    <input
                      className="admin-input"
                      style={{ marginTop: 8 }}
                      required
                      autoFocus
                      value={form.categoria}
                      onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                      placeholder="Digite o nome da nova categoria"
                    />
                  )}
                </div>
                <div className="admin-field">
                  <label>Duração estimada</label>
                  <input
                    className="admin-input"
                    value={form.duracao}
                    onChange={(e) => setForm({ ...form, duracao: e.target.value })}
                    placeholder="Ex: 1h30"
                  />
                </div>
                <div className="admin-field wide">
                  <label>Como este serviço é cobrado?</label>
                  <select
                    className="admin-select"
                    value={form.pricing_mode}
                    onChange={(e) => setForm({ ...form, pricing_mode: e.target.value as ServiceForm["pricing_mode"] })}
                  >
                    <option value="fixed">Preço fixo para qualquer veículo</option>
                    <option value="vehicle">Preço varia por veículo</option>
                    <option value="assessment">Definir após avaliação</option>
                  </select>
                  {form.pricing_mode === "vehicle" && (
                    <small style={{ display: "block", marginTop: 7 }}>
                      O catálogo não mostrará um preço genérico. Cadastre as tarifas por carro em{" "}
                      <a href="/painel/precos/">Preços por veículo</a>.
                    </small>
                  )}
                  {form.pricing_mode === "assessment" && (
                    <small style={{ display: "block", marginTop: 7 }}>
                      O cliente verá “Sob avaliação” até a equipe definir o valor final no orçamento.
                    </small>
                  )}
                </div>
                {form.pricing_mode === "fixed" && (
                  <>
                <div className="admin-field">
                  <label>Valor base (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="admin-input"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="250.00"
                  />
                </div>
                <div className="admin-field">
                  <label>Preço promocional (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="admin-input"
                    value={form.preco_promo}
                    onChange={(e) => setForm({ ...form, preco_promo: e.target.value })}
                    placeholder="199.90"
                  />
                </div>
                <div
                  className="admin-field wide"
                  style={{
                    border: "1px solid var(--admin-line)",
                    borderRadius: 8,
                    padding: 12,
                    background: "var(--admin-soft)",
                  }}
                >
                  <label style={{ marginBottom: 8 }}>Calculadora rápida de mão de obra</label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="admin-input"
                      placeholder="R$/hora (ex: 120)"
                      onChange={(e) => {
                        const rate = Number(e.target.value) || 0;
                        const match = form.duracao.match(/(\d+(?:[.,]\d+)?)/);
                        const hours = match ? Number(match[1].replace(",", ".")) || 1 : 1;
                        if (rate > 0) {
                          setForm((prev) => ({ ...prev, amount: (rate * hours).toFixed(2) }));
                        }
                      }}
                    />
                    <input
                      type="number"
                      min="0.25"
                      step="0.25"
                      className="admin-input"
                      placeholder="Horas (ex: 1.5)"
                      onChange={(e) => {
                        const hrs = Number(e.target.value) || 0;
                        if (hrs > 0) {
                          setForm((prev) => ({ ...prev, duracao: `${hrs}h` }));
                        }
                      }}
                    />
                  </div>
                  <small style={{ marginTop: 6 }}>
                    Informe o valor/hora e as horas estimadas para preencher o valor base automaticamente.
                  </small>
                </div>
                  </>
                )}
                <div className="admin-field wide">
                  <label>Descrição</label>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Itens inclusos no serviço e observações..."
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
    </>
  );
}
