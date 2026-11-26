"use client";

import { SkeletonCards, SkeletonTable } from "../Skeletons";
import { useMemo, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { Car, History, LayoutGrid, List, Pencil, Plus, Printer, QrCode, Search, Tag, Trash2, X } from "lucide-react";
import { selectRows, type PanelRecord } from "../../../lib/supabase";
import { AdminStatusBadge } from "../StatusBadge";
import { asText, dateText, detail, money, useModuleRecords, usePersistedViewMode, modalBackdropProps } from "../utils";
import { ClientPicker, clientDisplayName, ensureClientAndVehicle, useClientVehicleCatalog } from "../QuickPickers";
import { DEFAULT_VEHICLE_CATALOG, mergeVehicleCatalog } from "./vehicleCatalog";

type VehicleForm = {
  vehicle: string;
  title: string;
  marca: string;
  modelo: string;
  ano: string;
  km: string;
  combustivel: string;
  cor: string;
  chassi: string;
  customer_name: string;
  status: string;
};

const emptyForm: VehicleForm = {
  vehicle: "",
  title: "",
  marca: "",
  modelo: "",
  ano: "",
  km: "",
  combustivel: "Flex",
  cor: "",
  chassi: "",
  customer_name: "",
  status: "novo",
};

export function VehiclesView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, removeRecord } = useModuleRecords(
    "vehicles",
    session.user.id,
  );
  const {
    rows: settingsRows,
    saveRecord: saveSettingsRecord,
  } = useModuleRecords("settings", session.user.id);
  const { clients, vehicles, reload: reloadCatalog } = useClientVehicleCatalog();
  const [subPage, setSubPage] = useState<"vehicles" | "catalog">("vehicles");
  const [search, setSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newModel, setNewModel] = useState("");
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [customBrandInput, setCustomBrandInput] = useState(false);
  const [customModelInput, setCustomModelInput] = useState(false);
  const [viewMode, setViewMode] = usePersistedViewMode("vehicles", "list", ["list", "cards"] as const);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<VehicleForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [lookingUpPlate, setLookingUpPlate] = useState(false);
  const [plateNotice, setPlateNotice] = useState("");
  const [historyVehicle, setHistoryVehicle] = useState<PanelRecord | null>(null);
  const [historyItems, setHistoryItems] = useState<Array<{ kind: string; title: string; date: string; status: string; amount?: number | null }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [qrVehicle, setQrVehicle] = useState<PanelRecord | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [nextOilKm, setNextOilKm] = useState("");
  const [nextOilDate, setNextOilDate] = useState("");

  async function handleLookupPlate() {
    const clean = form.vehicle.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length < 7) {
      setPlateNotice("Informe os 7 caracteres da placa para preencher.");
      return;
    }
    setLookingUpPlate(true);
    setPlateNotice("");
    try {
      const res = await fetch("/api/admin/vehicles/plate-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ plate: clean }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        plate?: string;
        marca?: string | null;
        modelo?: string | null;
        versao?: string | null;
        titulo?: string | null;
        ano?: string | null;
        cor?: string | null;
        combustivel?: string | null;
        chassi?: string | null;
        notice?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setPlateNotice(json.error || "Placa não encontrada na consulta.");
        return;
      }
      const marca = json.marca || form.marca;
      const modelo = json.modelo || form.modelo;
      const summary = json.titulo || [marca, json.versao || modelo].filter(Boolean).join(" ").trim();
      setCustomBrandInput(Boolean(marca));
      setCustomModelInput(Boolean(modelo));
      setForm((prev) => ({
        ...prev,
        vehicle: json.plate || clean,
        marca: marca || prev.marca,
        modelo: modelo || prev.modelo,
        title: summary || prev.title,
        ano: json.ano || prev.ano,
        cor: json.cor || prev.cor,
        combustivel: json.combustivel || prev.combustivel,
        chassi: json.chassi || prev.chassi,
      }));
      setPlateNotice(json.notice || "Consulta concluída. Confira os campos preenchidos e complete o que não veio na base.");
    } catch {
      setPlateNotice("Erro de conexão ao consultar placa.");
    } finally {
      setLookingUpPlate(false);
    }
  }

  async function openHistory(row: PanelRecord) {
    setHistoryVehicle(row);
    setHistoryLoading(true);
    setHistoryItems([]);
    const plate = (row.vehicle || row.title || "").trim().toUpperCase();
    try {
      const [osRows, quoteRows, apptRows, inspRows] = await Promise.all([
        selectRows<PanelRecord>("panel_records", { module: "eq.work-orders", limit: "200" }).catch(() => []),
        selectRows<PanelRecord>("panel_records", { module: "eq.quotes", limit: "200" }).catch(() => []),
        selectRows<PanelRecord>("panel_records", { module: "eq.appointments", limit: "200" }).catch(() => []),
        selectRows<PanelRecord>("panel_records", { module: "eq.inspections", limit: "200" }).catch(() => []),
      ]);
      const match = (r: PanelRecord) =>
        plate && (r.vehicle ?? "").trim().toUpperCase() === plate;
      const combined = [
        ...osRows.filter(match).map((r) => ({ kind: "OS", title: r.title, date: r.created_at, status: r.status, amount: r.amount })),
        ...quoteRows.filter(match).map((r) => ({ kind: "Orçamento", title: r.title, date: r.created_at, status: r.status, amount: r.amount })),
        ...apptRows.filter(match).map((r) => ({ kind: "Agenda", title: r.title, date: r.created_at, status: r.status, amount: null })),
        ...inspRows.filter(match).map((r) => ({ kind: "Vistoria", title: r.title, date: r.created_at, status: r.status, amount: null })),
      ].sort((a, b) => b.date.localeCompare(a.date));
      setHistoryItems(combined);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openQrSticker(row: PanelRecord) {
    setQrVehicle(row);
    const currentKm = Number(detail(row, "km") ?? 0);
    setNextOilKm(currentKm > 0 ? String(currentKm + 10000) : "");
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 6);
    setNextOilDate(nextDate.toISOString().slice(0, 10));
    const url = `${window.location.origin}/painel/veiculos?placa=${encodeURIComponent(row.vehicle || row.title)}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 180, margin: 1 });
    setQrDataUrl(dataUrl);
  }

  const catalogRecord = useMemo(
    () => settingsRows.find((r) => r.title === "__marcas_modelos__") ?? null,
    [settingsRows],
  );

  const customCatalog = useMemo(() => {
    const raw = catalogRecord?.details;
    if (!raw || typeof raw !== "object") return {} as Record<string, string[]>;
    return raw as Record<string, string[]>;
  }, [catalogRecord]);

  const vehicleCatalog = useMemo(() => mergeVehicleCatalog(customCatalog), [customCatalog]);

  const sortedBrands = useMemo(
    () => Object.keys(vehicleCatalog).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [vehicleCatalog],
  );

  const modelsForSelectedBrand = useMemo(() => {
    if (!form.marca.trim()) return [];
    return [...(vehicleCatalog[form.marca.trim()] ?? [])].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );
  }, [vehicleCatalog, form.marca]);

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return sortedBrands
      .map((brand) => {
        const models = vehicleCatalog[brand] ?? [];
        if (!q) return { brand, models };
        if (brand.toLowerCase().includes(q)) return { brand, models };
        const matchedModels = models.filter((m) => m.toLowerCase().includes(q));
        return matchedModels.length > 0 ? { brand, models: matchedModels } : null;
      })
      .filter((item): item is { brand: string; models: string[] } => item !== null);
  }, [sortedBrands, vehicleCatalog, catalogSearch]);

  async function saveCustomCatalog(nextCustom: Record<string, string[]>) {
    setCatalogSaving(true);
    setError("");
    try {
      await saveSettingsRecord(catalogRecord, {
        title: "__marcas_modelos__",
        description: "Catálogo personalizado de marcas e modelos",
        status: "ativo",
        details: nextCustom,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar marcas e modelos.");
    } finally {
      setCatalogSaving(false);
    }
  }

  async function handleAddBrandModel(e: FormEvent) {
    e.preventDefault();
    const b = newBrand.trim();
    const m = newModel.trim();
    if (!b || !m) return;
    const existingBrand =
      Object.keys(vehicleCatalog).find((k) => k.toLowerCase() === b.toLowerCase()) ?? b;
    const currentCustom = [...(customCatalog[existingBrand] ?? [])];
    if (!currentCustom.some((item) => item.toLowerCase() === m.toLowerCase())) {
      currentCustom.push(m);
    }
    await saveCustomCatalog({
      ...customCatalog,
      [existingBrand]: currentCustom,
    });
    setNewModel("");
  }

  async function handleRemoveCustomModel(brand: string, model: string) {
    const currentCustom = customCatalog[brand] ?? [];
    const nextList = currentCustom.filter((m) => m !== model);
    const nextCustom = { ...customCatalog };
    if (nextList.length > 0) {
      nextCustom[brand] = nextList;
    } else {
      delete nextCustom[brand];
    }
    await saveCustomCatalog(nextCustom);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const haystack = [
        row.vehicle,
        row.title,
        row.customer_name,
        detail(row, "marca"),
        detail(row, "modelo"),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setCustomBrandInput(false);
    setCustomModelInput(false);
    setError("");
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    const m = String(detail(row, "marca") ?? "");
    const mod = String(detail(row, "modelo") ?? "");
    const brandKnown = Boolean(!m || vehicleCatalog[m]);
    const modelKnown = Boolean(!mod || (vehicleCatalog[m] ?? []).includes(mod));
    setEditing(row);
    setForm({
      vehicle: row.vehicle ?? "",
      title: row.title ?? "",
      marca: m,
      modelo: mod,
      ano: String(detail(row, "ano") ?? ""),
      km: String(detail(row, "km") ?? ""),
      combustivel: String(detail(row, "combustivel") ?? "Flex"),
      cor: String(detail(row, "cor") ?? ""),
      chassi: String(detail(row, "chassi") ?? ""),
      customer_name: row.customer_name ?? "",
      status: row.status || "novo",
    });
    setCustomBrandInput(!brandKnown);
    setCustomModelInput(!modelKnown);
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const plate = form.vehicle.trim().toUpperCase();
    const title = form.title.trim() || `${form.marca} ${form.modelo}`.trim() || plate;
    if (!title) return;
    setSaving(true);
    setError("");
    try {
      const existingDetails =
        editing?.details && typeof editing.details === "object" ? editing.details : {};
      await saveRecord(editing, {
        vehicle: plate || null,
        title,
        customer_name: form.customer_name.trim() || null,
        status: form.status,
        details: {
          ...existingDetails,
          marca: form.marca.trim(),
          modelo: form.modelo.trim(),
          ano: form.ano.trim(),
          km: form.km.trim(),
          combustivel: form.combustivel.trim(),
          cor: form.cor.trim(),
          chassi: form.chassi.trim().toUpperCase(),
        },
      });
      await ensureClientAndVehicle({
        userId: session.user.id,
        clients,
        vehicles,
        customerName: form.customer_name,
        reload: reloadCatalog,
      });
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar veículo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">FROTA E VEÍCULOS</p>
          <h1>{subPage === "vehicles" ? "Veículos" : "Marcas e modelos"}</h1>
        </div>
        {subPage === "vehicles" && (
          <div className="admin-title-actions">
            <button type="button" className="admin-primary" onClick={openCreate}>
              <Plus size={16} /> Novo veículo
            </button>
          </div>
        )}
      </div>

      <div className="admin-toolbar" style={{ marginBottom: 16 }}>
        <div className="admin-filter-pills">
          <button
            type="button"
            className={`admin-pill ${subPage === "vehicles" ? "active" : ""}`}
            onClick={() => setSubPage("vehicles")}
          >
            <Car size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
            Veículos ({rows.length})
          </button>
          <button
            type="button"
            className={`admin-pill ${subPage === "catalog" ? "active" : ""}`}
            onClick={() => setSubPage("catalog")}
          >
            <Tag size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
            Marcas e modelos ({sortedBrands.length})
          </button>
        </div>
      </div>

      {error && <p className="admin-form-error" style={{ marginBottom: 16 }}>{error}</p>}

      {subPage === "catalog" ? (
        <div style={{ display: "grid", gap: 18 }}>
          <div className="admin-panel">
            <div className="admin-panel-head">
              <h2>Adicionar marca ou modelo</h2>
            </div>
            <form onSubmit={(e) => void handleAddBrandModel(e)}>
              <div className="admin-form-grid">
                <div className="admin-field">
                  <label>Marca *</label>
                  <input
                    className="admin-input"
                    list="catalog-brands-datalist"
                    required
                    value={newBrand}
                    onChange={(e) => setNewBrand(e.target.value)}
                    placeholder="Ex: Honda ou nova marca" id="admin-views-vehiclesview-395"
                  />
                  <datalist id="catalog-brands-datalist">
                    {sortedBrands.map((b) => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                </div>
                <div className="admin-field">
                  <label>Modelo *</label>
                  <input
                    className="admin-input"
                    required
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    placeholder="Ex: Civic Touring" id="admin-views-vehiclesview-411"
                  />
                </div>
              </div>
              <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
                <button type="submit" className="admin-primary" disabled={catalogSaving}>
                  <Plus size={15} /> {catalogSaving ? "Adicionando..." : "Adicionar ao catálogo"}
                </button>
              </div>
            </form>
          </div>

          <div className="admin-panel">
            <div className="admin-panel-head" style={{ flexWrap: "wrap", gap: 12 }}>
              <h2>Catálogo ({filteredCatalog.length} marcas)</h2>
              <div className="admin-search-wrap" style={{ maxWidth: 280 }}>
                <Search size={14} />
                <input
                  className="admin-search"
                  placeholder="Filtrar marca ou modelo..."
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)} id="admin-views-vehiclesview-433"
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 14,
              }}
            >
              {filteredCatalog.map(({ brand, models }) => {
                const defaults = new Set(DEFAULT_VEHICLE_CATALOG[brand] ?? []);
                return (
                  <div
                    key={brand}
                    style={{
                      border: "1px solid var(--admin-line)",
                      borderRadius: 12,
                      padding: 14,
                      display: "grid",
                      gap: 10,
                      alignContent: "start",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ fontSize: 14.5 }}>{brand}</strong>
                      <span style={{ fontSize: 12, color: "var(--admin-muted)" }}>
                        {models.length} {models.length === 1 ? "modelo" : "modelos"}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {models.map((mod) => {
                        const isCustom = !defaults.has(mod);
                        return (
                          <span
                            key={mod}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              padding: "4px 9px",
                              borderRadius: 999,
                              fontSize: 12,
                              border: "1px solid var(--admin-line)",
                              color: isCustom ? "var(--admin-orange)" : "var(--admin-ink)",
                            }}
                          >
                            {mod}
                            {isCustom && (
                              <button
                                type="button"
                                onClick={() => void handleRemoveCustomModel(brand, mod)}
                                title="Remover modelo personalizado"
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
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <>

      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            className="admin-search"
            placeholder="Buscar por placa, modelo ou proprietário..."
            value={search}
            onChange={(e) => setSearch(e.target.value)} id="admin-views-vehiclesview-520"
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
          <span style={{ fontSize: 12, color: "var(--admin-muted)" }}>
            {filtered.length} {filtered.length === 1 ? "veículo" : "veículos"}
          </span>
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
          <Car size={24} />
          <strong>Nenhum veículo encontrado</strong>
          <p>Cadastre um veículo ou ajuste os termos de busca.</p>
        </div>
      ) : viewMode === "list" ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Placa</th>
                <th>Marca / Modelo</th>
                <th>Proprietário</th>
                <th>Ano</th>
                <th>KM</th>
                <th>Combustível</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const marca = detail(row, "marca");
                const modelo = detail(row, "modelo");
                const ano = detail(row, "ano");
                const km = detail(row, "km");
                const combustivel = detail(row, "combustivel");
                const makeModel = [marca, modelo].filter(Boolean).join(" ") || row.title;
                return (
                  <tr key={row.id}>
                    <td>
                      <strong style={{ fontFamily: "monospace", letterSpacing: "0.06em" }}>
                        {row.vehicle || row.title}
                      </strong>
                    </td>
                    <td>{makeModel}</td>
                    <td>{asText(row.customer_name)}</td>
                    <td>{asText(ano)}</td>
                    <td>{km ? `${km} km` : "—"}</td>
                    <td>{asText(combustivel)}</td>
                    <td>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
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
            const marca = detail(row, "marca");
            const modelo = detail(row, "modelo");
            const ano = detail(row, "ano");
            const km = detail(row, "km");
            const combustivel = detail(row, "combustivel");
            const makeModel = [marca, modelo].filter(Boolean).join(" ") || row.title;

            return (
              <div key={row.id} className="admin-panel" style={{ marginTop: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 14,
                  }}
                >
                  <div className="mercosul-plate">
                    <div className="mercosul-plate-top">BRASIL</div>
                    <div className="mercosul-plate-code">{row.vehicle || row.title}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="admin-icon-btn"
                      title="Histórico do veículo"
                      onClick={() => void openHistory(row)}
                    >
                      <History size={14} />
                    </button>
                    <button
                      type="button"
                      className="admin-icon-btn"
                      title="Etiqueta de manutenção QR"
                      onClick={() => void openQrSticker(row)}
                    >
                      <QrCode size={14} />
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

                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{makeModel}</div>
                  <div style={{ fontSize: 12.5, color: "var(--admin-muted)", marginTop: 2 }}>
                    Proprietário: {asText(row.customer_name)}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 8,
                    paddingTop: 12,
                    borderTop: "1px solid var(--admin-line)",
                    fontSize: 12,
                  }}
                >
                  <div>
                    <div style={{ color: "var(--admin-muted)", fontSize: 10.5 }}>Ano</div>
                    <div style={{ fontWeight: 600 }}>{asText(ano)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--admin-muted)", fontSize: 10.5 }}>KM</div>
                    <div style={{ fontWeight: 600 }}>{km ? `${km} km` : "—"}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--admin-muted)", fontSize: 10.5 }}>Combustível</div>
                    <div style={{ fontWeight: 600 }}>{asText(combustivel)}</div>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <AdminStatusBadge status={row.status} />
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
                <h2>{editing ? "Editar veículo" : "Novo veículo"}</h2>
                <p>Informe os dados da placa, modelo e proprietário.</p>
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
                <div className="admin-field">
                  <label>Placa</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      className="admin-input"
                      value={form.vehicle}
                      onChange={(e) => setForm({ ...form, vehicle: e.target.value.toUpperCase() })}
                      placeholder="ABC1D23" id="admin-views-vehiclesview-749"
                    />
                    <button
                      type="button"
                      className="admin-secondary"
                      style={{ flexShrink: 0, padding: "0 12px" }}
                      onClick={() => void handleLookupPlate()}
                      disabled={lookingUpPlate}
                      title="Consultar placa e preencher dados automaticamente"
                    >
                      <Search size={13} />
                      {lookingUpPlate ? "Buscando..." : "Preencher"}
                    </button>
                  </div>
                  {plateNotice && <small>{plateNotice}</small>}
                </div>
                <div className="admin-field">
                  <label>Modelo resumido</label>
                  <input
                    className="admin-input"
                    required
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Ex: Civic EXL 2.0" id="admin-views-vehiclesview-771"
                  />
                </div>
                <div className="admin-field">
                  <label>Marca</label>
                  <select
                    className="admin-select"
                    value={customBrandInput ? "__custom__" : form.marca}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__custom__") {
                        setCustomBrandInput(true);
                        setCustomModelInput(true);
                        setForm({ ...form, marca: "", modelo: "" });
                      } else {
                        setCustomBrandInput(false);
                        setCustomModelInput(false);
                        setForm({ ...form, marca: val, modelo: "" });
                      }
                    }} id="admin-views-vehiclesview-781"
                  >
                    <option value="">Selecionar marca...</option>
                    {sortedBrands.map((brand) => (
                      <option key={brand} value={brand}>
                        {brand}
                      </option>
                    ))}
                    <option value="__custom__">+ Outra marca (digitar)</option>
                  </select>
                  {customBrandInput && (
                    <input
                      className="admin-input"
                      value={form.marca}
                      onChange={(e) => setForm({ ...form, marca: e.target.value })}
                      placeholder="Digite a marca" id="admin-views-vehiclesview-806"
                    />
                  )}
                </div>
                <div className="admin-field">
                  <label>Modelo</label>
                  <select
                    className="admin-select"
                    value={customModelInput ? "__custom__" : form.modelo}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__custom__") {
                        setCustomModelInput(true);
                        setForm({ ...form, modelo: "" });
                      } else {
                        setCustomModelInput(false);
                        const autoTitle =
                          !form.title || form.title === `${form.marca} ${form.modelo}`.trim()
                            ? `${form.marca} ${val}`.trim()
                            : form.title;
                        setForm({ ...form, modelo: val, title: autoTitle });
                      }
                    }}
                    disabled={!form.marca.trim() && !customBrandInput} id="admin-views-vehiclesview-816"
                  >
                    <option value="">
                      {form.marca.trim() ? "Selecionar modelo..." : "Escolha a marca primeiro"}
                    </option>
                    {modelsForSelectedBrand.map((mod) => (
                      <option key={mod} value={mod}>
                        {mod}
                      </option>
                    ))}
                    <option value="__custom__">+ Outro modelo (digitar)</option>
                  </select>
                  {customModelInput && (
                    <input
                      className="admin-input"
                      value={form.modelo}
                      onChange={(e) => setForm({ ...form, modelo: e.target.value })}
                      placeholder="Digite o modelo" id="admin-views-vehiclesview-846"
                    />
                  )}
                </div>
                <div className="admin-field">
                  <label>Ano</label>
                  <input
                    className="admin-input"
                    value={form.ano}
                    onChange={(e) => setForm({ ...form, ano: e.target.value })}
                    placeholder="2022" id="admin-views-vehiclesview-856"
                  />
                </div>
                <div className="admin-field">
                  <label>Quilometragem (KM)</label>
                  <input
                    className="admin-input"
                    value={form.km}
                    onChange={(e) => setForm({ ...form, km: e.target.value })}
                    placeholder="45000" id="admin-views-vehiclesview-865"
                  />
                </div>
                <div className="admin-field">
                  <label>Combustível</label>
                  <select
                    className="admin-select"
                    value={form.combustivel}
                    onChange={(e) => setForm({ ...form, combustivel: e.target.value })} id="admin-views-vehiclesview-874"
                  >
                    <option value="Flex">Flex</option>
                    <option value="Gasolina">Gasolina</option>
                    <option value="Etanol">Etanol</option>
                    <option value="Diesel">Diesel</option>
                    <option value="GNV">GNV</option>
                    <option value="Híbrido">Híbrido</option>
                    <option value="Elétrico">Elétrico</option>
                    {!['Flex', 'Gasolina', 'Etanol', 'Diesel', 'GNV', 'Híbrido', 'Elétrico'].includes(form.combustivel) && form.combustivel && <option value={form.combustivel}>{form.combustivel}</option>}
                  </select>
                </div>
                <div className="admin-field">
                  <label>Cor</label>
                  <input
                    className="admin-input"
                    value={form.cor}
                    onChange={(e) => setForm({ ...form, cor: e.target.value })}
                    placeholder="Prata" id="admin-views-vehiclesview-891"
                  />
                </div>
                <div className="admin-field">
                  <label>Chassi</label>
                  <input
                    className="admin-input"
                    value={form.chassi}
                    onChange={(e) => setForm({ ...form, chassi: e.target.value.toUpperCase() })}
                    placeholder="9BWZZZ377VT004251" id="admin-views-vehiclesview-900"
                  />
                </div>
                <div className="admin-field">
                  <label>Proprietário</label>
                  <ClientPicker
                    clients={clients}
                    value={form.customer_name}
                    onSelectClient={(picked) =>
                      setForm({
                        ...form,
                        customer_name: picked ? clientDisplayName(picked) : "",
                      })
                    }
                  />
                  <input
                    className="admin-input"
                    value={form.customer_name}
                    onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                    placeholder="Nome do cliente" id="admin-views-vehiclesview-919"
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
      {historyVehicle && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setHistoryVehicle(null))}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>Histórico · {historyVehicle.vehicle || historyVehicle.title}</h2>
                <p>Ordens de serviço, orçamentos, agenda e vistorias deste veículo.</p>
              </div>
              <button type="button" className="admin-icon-btn" onClick={() => setHistoryVehicle(null)}>
                <X size={16} />
              </button>
            </div>
            {historyLoading ? (
              <p style={{ fontSize: 13, color: "var(--admin-muted)" }}>Carregando histórico...</p>
            ) : historyItems.length === 0 ? (
              <div className="admin-empty">Nenhuma passagem registrada para esta placa ainda.</div>
            ) : (
              <div style={{ display: "grid", gap: 8, maxHeight: "55vh", overflowY: "auto" }}>
                {historyItems.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 12px",
                      border: "1px solid var(--admin-line)",
                      borderRadius: 6,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        [{item.kind}] {item.title}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                        {dateText(item.date)}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {item.amount ? <strong style={{ fontSize: 13 }}>{money(item.amount)}</strong> : null}
                      <AdminStatusBadge status={item.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {qrVehicle && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setQrVehicle(null))}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="admin-modal-head">
              <div>
                <h2>Etiqueta de Manutenção QR</h2>
                <p>Imprima para colar no para-brisa ou porta do veículo.</p>
              </div>
              <button type="button" className="admin-icon-btn" onClick={() => setQrVehicle(null)}>
                <X size={16} />
              </button>
            </div>

            <div className="admin-form-grid" style={{ marginBottom: 14 }}>
              <div className="admin-field">
                <label>Próxima troca (KM)</label>
                <input
                  className="admin-input"
                  value={nextOilKm}
                  onChange={(e) => setNextOilKm(e.target.value)}
                  placeholder="Ex: 55000" id="admin-views-vehiclesview-1010"
                />
              </div>
              <div className="admin-field">
                <label>Próxima revisão (Data)</label>
                <input
                  type="date"
                  className="admin-input"
                  value={nextOilDate}
                  onChange={(e) => setNextOilDate(e.target.value)} id="admin-views-vehiclesview-1019"
                />
              </div>
            </div>

            <div
              style={{
                border: "1px dashed var(--admin-line)",
                borderRadius: 8,
                padding: 16,
                display: "flex",
                alignItems: "center",
                gap: 14,
                background: "#ffffff",
                color: "#11110f",
                marginBottom: 16,
              }}
            >
              {qrDataUrl && (
                <img src={qrDataUrl} alt="QR Manutenção" style={{ width: 96, height: 96, flexShrink: 0 }} />
              )}
              <div style={{ fontSize: 12.5, display: "grid", gap: 3 }}>
                <strong style={{ fontSize: 14 }}>Benittes Oficina Mecânica</strong>
                <span>Placa: <strong>{qrVehicle.vehicle || qrVehicle.title}</strong></span>
                <span>Próx. KM: <strong>{nextOilKm || "—"}</strong></span>
                <span>Próx. Data: <strong>{nextOilDate ? dateText(nextOilDate) : "—"}</strong></span>
              </div>
            </div>

            <div className="admin-modal-actions">
              <button type="button" className="admin-secondary" onClick={() => setQrVehicle(null)}>
                Fechar
              </button>
              <button type="button" className="admin-primary" onClick={() => window.print()}>
                <Printer size={15} /> Imprimir etiqueta
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
