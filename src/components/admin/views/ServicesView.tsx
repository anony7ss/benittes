"use client";

import { SkeletonCards, SkeletonTable } from "../Skeletons";
import { useMemo, useState, type FormEvent } from "react";
import { BatteryCharging, CarFront, Check, CircleDot, ClipboardCheck, Clock3, Cog, Cpu, Disc3, Droplets, Gauge, Info, LayoutGrid, List, Pencil, Plus, Power, Search, Snowflake, Tag, Thermometer, Trash2, Wrench, X } from "lucide-react";
import type { PanelRecord } from "../../../lib/supabase";
import { AdminActionMenu } from "../ActionMenu";
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

const CATEGORY_ICON_OPTIONS = [
  { id: "wrench", label: "Mecânica", Icon: Wrench },
  { id: "car", label: "Veículo", Icon: CarFront },
  { id: "cog", label: "Motor", Icon: Cog },
  { id: "battery", label: "Elétrica", Icon: BatteryCharging },
  { id: "oil", label: "Óleo e fluidos", Icon: Droplets },
  { id: "cooling", label: "Climatização", Icon: Snowflake },
  { id: "brakes", label: "Freios", Icon: Disc3 },
  { id: "diagnostic", label: "Diagnóstico", Icon: Cpu },
  { id: "temperature", label: "Arrefecimento", Icon: Thermometer },
  { id: "alignment", label: "Alinhamento", Icon: CircleDot },
  { id: "inspection", label: "Revisão", Icon: ClipboardCheck },
  { id: "general", label: "Geral", Icon: Gauge },
] as const;

type CategoryIconId = (typeof CATEGORY_ICON_OPTIONS)[number]["id"];

function categoryIconId(category: string, saved: Record<string, CategoryIconId>): CategoryIconId {
  const configured = saved[category];
  if (configured && CATEGORY_ICON_OPTIONS.some((option) => option.id === configured)) return configured;
  const normalized = category.toLocaleLowerCase("pt-BR");
  if (normalized.includes("alinhamento")) return "alignment";
  if (normalized.includes("ar-condicionado") || normalized.includes("ar condicionado")) return "cooling";
  if (normalized.includes("arrefecimento")) return "temperature";
  if (normalized.includes("bateria") || normalized.includes("elétrica")) return "battery";
  if (normalized.includes("freio")) return "brakes";
  if (normalized.includes("injeção") || normalized.includes("diagnóstico")) return "diagnostic";
  if (normalized.includes("embreagem") || normalized.includes("motor") || normalized.includes("câmbio")) return "cog";
  if (normalized.includes("óleo")) return "oil";
  if (normalized.includes("revisão")) return "inspection";
  if (normalized.includes("suspensão")) return "car";
  return "wrench";
}

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
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryIcon, setCategoryIcon] = useState<CategoryIconId>("wrench");
  const [savingCat, setSavingCat] = useState(false);
  const [viewMode, setViewMode] = usePersistedViewMode("services", "list", ["list", "cards"] as const);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<ServiceForm>(emptyForm);
  const [customCategoryMode, setCustomCategoryMode] = useState(false);
  const [categoryBeforeCustomMode, setCategoryBeforeCustomMode] = useState(emptyForm.categoria);
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

  const savedCategoryIcons = useMemo(() => {
    const raw = customCatRecord?.details;
    if (!raw || typeof raw !== "object") return {} as Record<string, CategoryIconId>;
    const map = (raw as { categoryIcons?: unknown }).categoryIcons;
    if (!map || typeof map !== "object" || Array.isArray(map)) return {} as Record<string, CategoryIconId>;
    const validIds = new Set<string>(CATEGORY_ICON_OPTIONS.map((option) => option.id));
    return Object.fromEntries(
      Object.entries(map as Record<string, unknown>).filter((entry): entry is [string, CategoryIconId] =>
        typeof entry[1] === "string" && validIds.has(entry[1]),
      ),
    );
  }, [customCatRecord]);

  const hiddenCategories = useMemo(() => {
    const raw = customCatRecord?.details;
    if (!raw || typeof raw !== "object") return [] as string[];
    const list = (raw as { hiddenCategories?: unknown }).hiddenCategories;
    return Array.isArray(list) ? list.map((item) => String(item).trim()).filter(Boolean) : [];
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
    const hidden = new Set(hiddenCategories);
    const visibleDefaults = DEFAULT_CATEGORIES.filter((category) => !hidden.has(category));
    const set = new Set<string>([...visibleDefaults, ...savedCustomCategories, ...usedCategories]);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [savedCustomCategories, usedCategories, hiddenCategories]);

  async function persistCategorySettings(
    nextCategories: string[],
    nextIcons: Record<string, CategoryIconId>,
    nextHidden: string[],
  ): Promise<boolean> {
    setSavingCat(true);
    setError("");
    try {
      await saveSettingsRecord(customCatRecord, {
        title: "__categorias_servicos__",
        description: "Categorias personalizadas de serviços",
        status: "ativo",
        details: {
          categories: nextCategories,
          categoryIcons: nextIcons,
          hiddenCategories: nextHidden,
        },
      });
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar categoria.");
      return false;
    } finally {
      setSavingCat(false);
    }
  }

  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault();
    const clean = newCategoryName.trim();
    if (!clean) return;
    if (categories.some((category) => category.toLocaleLowerCase("pt-BR") === clean.toLocaleLowerCase("pt-BR"))) {
      setError("Já existe uma categoria com esse nome.");
      return;
    }
    const saved = await persistCategorySettings(
      [...savedCustomCategories, clean],
      { ...savedCategoryIcons, [clean]: categoryIcon },
      hiddenCategories.filter((category) => category !== clean),
    );
    if (!saved) return;
    setNewCategoryName("");
    setCategoryIcon("wrench");
    setCategoryModalOpen(false);
  }

  async function removeCategory(category: string) {
    if (rows.some((row) => String(detail(row, "categoria") ?? "").trim() === category)) {
      setError("Esta categoria ainda está vinculada a serviços. Reclassifique esses serviços antes de removê-la.");
      return;
    }
    const nextCategories = savedCustomCategories.filter((item) => item !== category);
    const nextIcons = { ...savedCategoryIcons };
    delete nextIcons[category];
    const nextHidden = DEFAULT_CATEGORIES.includes(category)
      ? [...new Set([...hiddenCategories, category])]
      : hiddenCategories;
    const saved = await persistCategorySettings(nextCategories, nextIcons, nextHidden);
    if (saved && categoryFilter === category) setCategoryFilter("todas");
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
    setCategoryBeforeCustomMode(emptyForm.categoria);
    setError("");
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    const cat = String(detail(row, "categoria") ?? "Mecânica Geral");
    setEditing(row);
    setCategoryBeforeCustomMode(cat);
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
          <h1>Serviços</h1>
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

      {error && !categoryModalOpen && <p className="admin-form-error" style={{ marginBottom: 16 }}>{error}</p>}

      {subPage === "catalog" ? (
        <section className="admin-panel admin-service-category-panel">
          <div className="admin-service-category-header">
            <div>
              <h2>Categorias de serviço</h2>
              <p>{categories.length} {categories.length === 1 ? "categoria cadastrada" : "categorias cadastradas"}</p>
            </div>
            <button
              type="button"
              className="admin-primary"
              onClick={() => {
                setNewCategoryName("");
                setCategoryIcon("wrench");
                setError("");
                setCategoryModalOpen(true);
              }}
            >
              <Plus size={15} /> Nova categoria
            </button>
          </div>

          {categories.length === 0 ? (
            <div className="admin-service-category-empty">Nenhuma categoria cadastrada.</div>
          ) : (
            <div className="admin-service-category-grid">
              {categories.map((category) => {
                const Icon = CATEGORY_ICON_OPTIONS.find((option) => option.id === categoryIconId(category, savedCategoryIcons))?.Icon ?? Wrench;
                return (
                  <div className="admin-service-category-item" key={category}>
                    <Icon size={15} aria-hidden="true" />
                    <span title={category}>{category}</span>
                    <AdminActionMenu
                      label={`Ações da categoria ${category}`}
                      actions={[
                        {
                          label: "Excluir categoria",
                          icon: <Trash2 size={14} />,
                          onSelect: () => void removeCategory(category),
                          destructive: true,
                        },
                      ]}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <>

      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            className="admin-search"
            placeholder="Buscar serviço ou categoria..."
            value={search}
            onChange={(e) => setSearch(e.target.value)} id="admin-views-servicesview-317"
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
                      <AdminActionMenu
                        label={`Ações do serviço ${row.title}`}
                        actions={[
                          { label: isActive ? "Desativar serviço" : "Ativar serviço", icon: <Power size={14} />, onSelect: () => void toggleActive(row) },
                          { label: "Editar serviço", icon: <Pencil size={14} />, onSelect: () => openEdit(row), separatorBefore: true },
                          { label: "Remover serviço", icon: <Trash2 size={14} />, onSelect: () => void removeRecord(row), destructive: true },
                        ]}
                      />
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
                  <AdminActionMenu
                    label={`Ações do serviço ${row.title}`}
                    actions={[
                      { label: isActive ? "Desativar serviço" : "Ativar serviço", icon: <Power size={14} />, onSelect: () => void toggleActive(row) },
                      { label: "Editar serviço", icon: <Pencil size={14} />, onSelect: () => openEdit(row), separatorBefore: true },
                      { label: "Remover serviço", icon: <Trash2 size={14} />, onSelect: () => void removeRecord(row), destructive: true },
                    ]}
                  />
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

      {categoryModalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setCategoryModalOpen(false))}>
          <div className="admin-modal admin-service-category-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>Nova categoria</h2>
                <p>Organize os serviços oferecidos pela oficina.</p>
              </div>
              <button
                type="button"
                className="admin-icon-btn"
                aria-label="Fechar"
                onClick={() => setCategoryModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={(event) => void handleCreateCategory(event)}>
              <label className="admin-field admin-service-category-name">
                <span>Nome da categoria *</span>
                <input
                  className="admin-input"
                  required
                  autoFocus
                  maxLength={60}
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="Ex.: Estética automotiva"
                  name="service-category-name"
                  id="admin-service-category-name"
                />
              </label>
              <fieldset className="admin-service-category-icon-fieldset">
                <legend>Ícone da categoria</legend>
                <div className="admin-service-category-icon-options">
                  {CATEGORY_ICON_OPTIONS.slice(0, 6).map(({ id, label, Icon }) => (
                    <button
                      type="button"
                      key={id}
                      className={`admin-service-category-icon-option${categoryIcon === id ? " is-selected" : ""}`}
                      aria-label={label}
                      aria-pressed={categoryIcon === id}
                      title={label}
                      onClick={() => setCategoryIcon(id)}
                    >
                      <Icon size={15} />
                      {categoryIcon === id && <Check size={10} className="admin-service-category-icon-check" />}
                    </button>
                  ))}
                </div>
              </fieldset>
              {error && <p className="admin-form-error" role="alert">{error}</p>}
              <div className="admin-service-category-modal-actions">
                <button type="button" className="admin-secondary" onClick={() => setCategoryModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="admin-primary" disabled={savingCat}>
                  {savingCat ? "Salvando..." : "Criar categoria"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className="admin-modal admin-service-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head admin-service-modal-head">
              <div>
                <h2>{editing ? "Editar serviço" : "Novo serviço"}</h2>
                <p>Cadastre um serviço e defina suas condições de cobrança.</p>
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
            <form className="admin-service-form" onSubmit={handleSubmit}>
              <section className="admin-service-form-section">
                <h3>Informações do serviço</h3>
                <div className="admin-form-grid">
                  <div className="admin-field wide">
                    <label>Nome do serviço *</label>
                    <input
                      className="admin-input"
                      required
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder="Ex: Revisão completa de freios"
                      id="admin-views-servicesview-591"
                    />
                  </div>
                  <div className="admin-field">
                    <label>Categoria</label>
                    {customCategoryMode ? (
                      <input
                        className="admin-input"
                        required
                        autoFocus
                        onFocus={(e) => e.currentTarget.select()}
                        value={form.categoria}
                        onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                        placeholder="Digite o nome da categoria"
                        id="admin-views-servicesview-622"
                      />
                    ) : (
                      <select
                        className="admin-select"
                        value={form.categoria}
                        onChange={(e) => {
                          setForm({ ...form, categoria: e.target.value });
                          setCategoryBeforeCustomMode(e.target.value);
                        }}
                        id="admin-views-servicesview-601"
                      >
                        {categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                    )}
                    <button
                      type="button"
                      className="admin-service-add-category"
                      onClick={() => {
                        if (customCategoryMode) {
                          setForm((prev) => ({ ...prev, categoria: categoryBeforeCustomMode }));
                          setCustomCategoryMode(false);
                          return;
                        }
                        setCategoryBeforeCustomMode(form.categoria);
                        setCustomCategoryMode(true);
                      }}
                    >
                      {customCategoryMode ? "+ Selecionar categoria existente" : "+ Nova categoria"}
                    </button>
                  </div>
                  <div className="admin-field">
                    <label>Duração estimada</label>
                    <div className="admin-service-duration-input">
                      <input
                        className="admin-input"
                        value={form.duracao}
                        onChange={(e) => setForm({ ...form, duracao: e.target.value })}
                        placeholder="Ex: 1h30"
                        id="admin-views-servicesview-635"
                      />
                      <Clock3 size={14} aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </section>

              <section className="admin-service-form-section is-separated">
                <h3>Modelo de cobrança</h3>
                <p className="admin-service-section-description">Selecione como o preço deste serviço será definido.</p>
                <div className="admin-service-pricing-options" role="radiogroup" aria-label="Modelo de cobrança">
                  <label className={`admin-service-pricing-option${form.pricing_mode === "fixed" ? " is-selected" : ""}`}>
                    <input
                      type="radio"
                      name="service-pricing-mode"
                      value="fixed"
                      checked={form.pricing_mode === "fixed"}
                      onChange={() => setForm((prev) => ({ ...prev, pricing_mode: "fixed" }))}
                    />
                    <Tag size={15} aria-hidden="true" />
                    <span className="admin-service-pricing-copy">
                      <strong>Preço fixo</strong>
                      <small>Mesmo valor para todos os veículos.</small>
                    </span>
                    <span className="admin-service-radio-indicator" aria-hidden="true" />
                  </label>
                  <label className={`admin-service-pricing-option${form.pricing_mode === "vehicle" ? " is-selected" : ""}`}>
                    <input
                      type="radio"
                      name="service-pricing-mode"
                      value="vehicle"
                      checked={form.pricing_mode === "vehicle"}
                      onChange={() => setForm((prev) => ({ ...prev, pricing_mode: "vehicle" }))}
                    />
                    <CarFront size={15} aria-hidden="true" />
                    <span className="admin-service-pricing-copy">
                      <strong>Preço por veículo</strong>
                      <small>Valores diferentes conforme marca e modelo.</small>
                    </span>
                    <span className="admin-service-radio-indicator" aria-hidden="true" />
                  </label>
                  <label className={`admin-service-pricing-option${form.pricing_mode === "assessment" ? " is-selected" : ""}`}>
                    <input
                      type="radio"
                      name="service-pricing-mode"
                      value="assessment"
                      checked={form.pricing_mode === "assessment"}
                      onChange={() => setForm((prev) => ({ ...prev, pricing_mode: "assessment" }))}
                    />
                    <ClipboardCheck size={15} aria-hidden="true" />
                    <span className="admin-service-pricing-copy">
                      <strong>Sob avaliação</strong>
                      <small>Valor definido após análise do mecânico.</small>
                    </span>
                    <span className="admin-service-radio-indicator" aria-hidden="true" />
                  </label>
                </div>

                {form.pricing_mode === "vehicle" && (
                  <p className="admin-service-pricing-note">
                    <Info size={13} aria-hidden="true" />
                    <span>Cadastre os valores por carro em <a href="/painel/precos/">Preços por veículo</a>.</span>
                  </p>
                )}
                {form.pricing_mode === "assessment" && (
                  <p className="admin-service-pricing-note">
                    <Info size={13} aria-hidden="true" />
                    <span>O cliente verá “Sob avaliação” até que a equipe defina o valor no orçamento.</span>
                  </p>
                )}

                {form.pricing_mode === "fixed" && (
                  <div className="admin-service-fixed-fields">
                    <div className="admin-form-grid">
                      <label className="admin-field">
                        <span>Valor base (R$)</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="admin-input"
                          value={form.amount}
                          onChange={(e) => setForm({ ...form, amount: e.target.value })}
                          placeholder="250,00"
                          id="admin-views-servicesview-669"
                        />
                      </label>
                      <label className="admin-field">
                        <span>Preço promocional (R$)</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="admin-input"
                          value={form.preco_promo}
                          onChange={(e) => setForm({ ...form, preco_promo: e.target.value })}
                          placeholder="199,90"
                          id="admin-views-servicesview-681"
                        />
                      </label>
                      <div className="admin-field wide admin-service-labor-calculator">
                        <strong>Calculadora rápida de mão de obra</strong>
                        <div>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="admin-input"
                            placeholder="R$/hora (ex: 120)"
                            aria-label="Valor por hora de mão de obra"
                            onChange={(e) => {
                              const rate = Number(e.target.value) || 0;
                              const match = form.duracao.match(/(\d+(?:[.,]\d+)?)/);
                              const hours = match ? Number(match[1].replace(",", ".")) || 1 : 1;
                              if (rate > 0) setForm((prev) => ({ ...prev, amount: (rate * hours).toFixed(2) }));
                            }}
                            id="admin-views-servicesview-702"
                          />
                          <input
                            type="number"
                            min="0.25"
                            step="0.25"
                            className="admin-input"
                            placeholder="Horas (ex: 1.5)"
                            aria-label="Horas estimadas de mão de obra"
                            onChange={(e) => {
                              const hrs = Number(e.target.value) || 0;
                              if (hrs > 0) setForm((prev) => ({ ...prev, duracao: `${hrs}h` }));
                            }}
                            id="admin-views-servicesview-717"
                          />
                        </div>
                        <small>Informe o valor/hora e as horas para preencher o valor base automaticamente.</small>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="admin-service-form-section is-separated">
                <h3>Informações adicionais <span>Opcional</span></h3>
                <label className="admin-field">
                  <span>Descrição do serviço</span>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Itens inclusos, condições e observações..."
                    id="admin-views-servicesview-739"
                  />
                </label>
              </section>

              <div className="admin-service-modal-footer">
                <small>* Campo obrigatório</small>
                <div>
                  <button type="button" className="admin-secondary" onClick={() => setModalOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="admin-primary" disabled={saving}>
                    {saving ? "Salvando..." : editing ? "Salvar serviço" : "Cadastrar serviço"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
