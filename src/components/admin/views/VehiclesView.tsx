"use client";

import { SkeletonCards, SkeletonTable } from "../Skeletons";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { Archive, ArchiveRestore, ArrowUpRight, CalendarPlus, Car, ChevronRight, ClipboardCheck, History, LayoutGrid, List, Pencil, Plus, Printer, QrCode, Search, Tag, Trash2, UserRound, Wrench, X } from "lucide-react";
import { selectRows, type PanelRecord } from "../../../lib/supabase";
import { routeFor } from "../../../admin/navigation";
import { AdminActionMenu } from "../ActionMenu";
import { AdminStatusBadge } from "../StatusBadge";
import { usePagination } from "../Pagination";
import { asText, dateText, detail, money, todayIso, saveVehicleActionPrefill, saveVehicleOwnerLookup, useModuleRecords, usePersistedViewMode, modalBackdropProps } from "../utils";
import { ClientPicker, clientDisplayName, ensureClientAndVehicle, useClientVehicleCatalog } from "../QuickPickers";
import {
  customCatalogKeyForBrand,
  customModelsForBrand,
  findFipeBrandByName,
  mergeVehicleBrands,
  mergeVehicleModels,
  normalizeVehicleCatalogName,
  type VehicleCatalogOption,
} from "./vehicleCatalog";

type VehicleForm = {
  vehicle: string;
  title: string;
  marca: string;
  modelo: string;
  versao: string;
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
  versao: "",
  ano: "",
  km: "",
  combustivel: "Flex",
  cor: "",
  chassi: "",
  customer_name: "",
  status: "novo",
};

export function VehiclesView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, patchRecord, removeRecord } = useModuleRecords(
    "vehicles",
    session.user.id,
  );
  const {
    rows: settingsRows,
    saveRecord: saveSettingsRecord,
  } = useModuleRecords("settings", session.user.id);
  const { clients, vehicles, reload: reloadCatalog } = useClientVehicleCatalog();
  const [subPage, setSubPage] = useState<"vehicles" | "archived" | "catalog">("vehicles");
  const [search, setSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [selectedCatalogBrand, setSelectedCatalogBrand] = useState("");
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [catalogEntryMode, setCatalogEntryMode] = useState<"brand" | "model">("brand");
  const [catalogBrandName, setCatalogBrandName] = useState("");
  const [catalogEntryBrand, setCatalogEntryBrand] = useState("");
  const [catalogEntryModel, setCatalogEntryModel] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [fipeBrands, setFipeBrands] = useState<VehicleCatalogOption[]>([]);
  const [fipeBrandsLoading, setFipeBrandsLoading] = useState(true);
  const [fipeBrandsError, setFipeBrandsError] = useState("");
  const [fipeBrandsRetry, setFipeBrandsRetry] = useState(0);
  const [fipeModelsByBrand, setFipeModelsByBrand] = useState<Record<string, VehicleCatalogOption[]>>({});
  const [fipeModelsLoading, setFipeModelsLoading] = useState<string[]>([]);
  const [fipeModelsErrors, setFipeModelsErrors] = useState<Record<string, string>>({});
  const fipeModelRequests = useRef(new Map<string, Promise<void>>());
  const [customBrandInput, setCustomBrandInput] = useState(false);
  const [customModelInput, setCustomModelInput] = useState(false);
  const [viewMode, setViewMode] = usePersistedViewMode("vehicles", "list", ["list", "cards"] as const);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<VehicleForm>(emptyForm);
  const [customClient, setCustomClient] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lookingUpPlate, setLookingUpPlate] = useState(false);
  const [plateNotice, setPlateNotice] = useState("");
  const [historyVehicle, setHistoryVehicle] = useState<PanelRecord | null>(null);
  const [historyItems, setHistoryItems] = useState<Array<{ kind: string; title: string; date: string; status: string; amount?: number | null }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewingVehicle, setViewingVehicle] = useState<PanelRecord | null>(null);
  const [workOrders, setWorkOrders] = useState<PanelRecord[]>([]);
  const [workOrdersLoaded, setWorkOrdersLoaded] = useState(false);
  const [workOrdersLoadFailed, setWorkOrdersLoadFailed] = useState(false);
  const [qrVehicle, setQrVehicle] = useState<PanelRecord | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [nextOilKm, setNextOilKm] = useState("");
  const [nextOilDate, setNextOilDate] = useState("");

  useEffect(() => {
    if (subPage !== "vehicles" || viewMode !== "cards" || workOrdersLoaded) return;
    let active = true;
    void selectRows<PanelRecord>("work-orders", { order: "created_at.desc", limit: "500" })
      .then((records) => {
        if (active) setWorkOrders(records);
      })
      .catch(() => {
        if (active) {
          setWorkOrders([]);
          setWorkOrdersLoadFailed(true);
        }
      })
      .finally(() => {
        if (active) setWorkOrdersLoaded(true);
      });
    return () => { active = false; };
  }, [subPage, viewMode, workOrdersLoaded]);

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
        versao: json.versao || prev.versao,
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

  useEffect(() => {
    let active = true;
    setFipeBrandsLoading(true);
    setFipeBrandsError("");
    void fetch("/api/vehicle-catalog", { credentials: "same-origin" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as unknown;
        if (!response.ok || !Array.isArray(payload)) {
          const message = payload && typeof payload === "object" && "error" in payload
            ? String(payload.error)
            : "Não foi possível carregar as marcas da FIPE.";
          throw new Error(message);
        }
        const options = payload.filter((item): item is VehicleCatalogOption =>
          Boolean(item && typeof item === "object"
            && "code" in item && (typeof item.code === "string" || typeof item.code === "number")
            && "name" in item && typeof item.name === "string"),
        ).map((item) => ({ code: String(item.code), name: item.name.trim() })).filter((item) => item.name);
        if (!options.length) throw new Error("A FIPE não retornou marcas disponíveis.");
        if (active) setFipeBrands(options);
      })
      .catch((reason: unknown) => {
        if (active) setFipeBrandsError(reason instanceof Error ? reason.message : "Não foi possível carregar as marcas da FIPE.");
      })
      .finally(() => {
        if (active) setFipeBrandsLoading(false);
      });
    return () => { active = false; };
  }, [fipeBrandsRetry]);

  const loadFipeModels = useCallback((brandName: string) => {
    const brand = findFipeBrandByName(fipeBrands, brandName);
    if (!brand || fipeModelsByBrand[brand.code]) return Promise.resolve();
    const pending = fipeModelRequests.current.get(brand.code);
    if (pending) return pending;

    setFipeModelsLoading((current) => current.includes(brand.code) ? current : [...current, brand.code]);
    setFipeModelsErrors((current) => {
      if (!current[brand.code]) return current;
      const next = { ...current };
      delete next[brand.code];
      return next;
    });
    const request = fetch(`/api/vehicle-catalog?brandId=${encodeURIComponent(brand.code)}`, { credentials: "same-origin" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as unknown;
        if (!response.ok || !Array.isArray(payload)) {
          const message = payload && typeof payload === "object" && "error" in payload
            ? String(payload.error)
            : "Não foi possível carregar os modelos da FIPE.";
          throw new Error(message);
        }
        const options = payload.filter((item): item is VehicleCatalogOption =>
          Boolean(item && typeof item === "object"
            && "code" in item && (typeof item.code === "string" || typeof item.code === "number")
            && "name" in item && typeof item.name === "string"),
        ).map((item) => ({ code: String(item.code), name: item.name.trim() })).filter((item) => item.name);
        setFipeModelsByBrand((current) => ({ ...current, [brand.code]: options }));
      })
      .catch((reason: unknown) => {
        setFipeModelsErrors((current) => ({
          ...current,
          [brand.code]: reason instanceof Error ? reason.message : "Não foi possível carregar os modelos da FIPE.",
        }));
      })
      .finally(() => {
        fipeModelRequests.current.delete(brand.code);
        setFipeModelsLoading((current) => current.filter((code) => code !== brand.code));
      });
    fipeModelRequests.current.set(brand.code, request);
    return request;
  }, [fipeBrands, fipeModelsByBrand]);

  const vehicleCatalog = useMemo(() => {
    const catalog: Record<string, string[]> = {};
    for (const brand of mergeVehicleBrands(fipeBrands, customCatalog)) {
      const fipeBrand = findFipeBrandByName(fipeBrands, brand);
      catalog[brand] = mergeVehicleModels(
        fipeBrand ? fipeModelsByBrand[fipeBrand.code] ?? [] : [],
        customModelsForBrand(customCatalog, brand),
      );
    }
    return catalog;
  }, [customCatalog, fipeBrands, fipeModelsByBrand]);

  const sortedBrands = useMemo(
    () => Object.keys(vehicleCatalog).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [vehicleCatalog],
  );

  const modelsForSelectedBrand = useMemo(() => {
    if (!form.marca.trim()) return [];
    const loaded = vehicleCatalog[form.marca.trim()] ?? [];
    return form.modelo && !loaded.some((model) => normalizeVehicleCatalogName(model) === normalizeVehicleCatalogName(form.modelo))
      ? mergeVehicleModels([], [...loaded, form.modelo])
      : loaded;
  }, [vehicleCatalog, form.marca, form.modelo]);

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return sortedBrands
      .map((brand) => {
        const models = vehicleCatalog[brand] ?? [];
        return !q || brand.toLowerCase().includes(q) ? { brand, models } : null;
      })
      .filter((item): item is { brand: string; models: string[] } => item !== null);
  }, [sortedBrands, vehicleCatalog, catalogSearch]);
  const { pageItems: catalogBrandPage, controls: catalogBrandsPagination } = usePagination(filteredCatalog, 18);

  const selectedCatalogEntry =
    filteredCatalog.find((entry) => entry.brand === selectedCatalogBrand) ?? filteredCatalog[0] ?? null;
  const visibleCatalogModels = selectedCatalogEntry?.models ?? [];
  const { pageItems: catalogModelPage, controls: catalogModelsPagination } = usePagination(visibleCatalogModels, 16);
  const selectedCatalogFipeBrand = selectedCatalogEntry
    ? findFipeBrandByName(fipeBrands, selectedCatalogEntry.brand)
    : undefined;
  const selectedCatalogModelsLoading = Boolean(selectedCatalogFipeBrand && fipeModelsLoading.includes(selectedCatalogFipeBrand.code));
  const selectedCatalogModelsError = selectedCatalogFipeBrand ? fipeModelsErrors[selectedCatalogFipeBrand.code] : "";
  const formFipeBrand = form.marca ? findFipeBrandByName(fipeBrands, form.marca) : undefined;
  const formModelsLoading = Boolean(formFipeBrand && fipeModelsLoading.includes(formFipeBrand.code));
  const formModelsError = formFipeBrand ? fipeModelsErrors[formFipeBrand.code] : "";

  useEffect(() => {
    if (form.marca && !customBrandInput) void loadFipeModels(form.marca);
  }, [customBrandInput, form.marca, loadFipeModels]);

  useEffect(() => {
    if (selectedCatalogEntry) void loadFipeModels(selectedCatalogEntry.brand);
  }, [loadFipeModels, selectedCatalogEntry?.brand]);

  useEffect(() => {
    if (!selectedCatalogBrand && sortedBrands.length) setSelectedCatalogBrand(sortedBrands[0]);
  }, [selectedCatalogBrand, sortedBrands]);

  async function saveCustomCatalog(nextCustom: Record<string, string[]>) {
    setCatalogSaving(true);
    setError("");
    setCatalogError("");
    try {
      await saveSettingsRecord(catalogRecord, {
        title: "__marcas_modelos__",
        description: "Catálogo personalizado de marcas e modelos",
        status: "ativo",
        details: nextCustom,
      });
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Erro ao salvar marcas e modelos.";
      setError(message);
      setCatalogError(message);
      return false;
    } finally {
      setCatalogSaving(false);
    }
  }

  function openCatalogModal(mode: "brand" | "model") {
    setCatalogEntryMode(mode);
    setCatalogBrandName("");
    setCatalogEntryBrand(selectedCatalogEntry?.brand ?? sortedBrands[0] ?? "");
    setCatalogEntryModel("");
    setCatalogError("");
    setCatalogModalOpen(true);
  }

  async function handleSaveCatalogEntry(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (catalogEntryMode === "brand") {
      const brand = catalogBrandName.trim();
      if (!brand) return;
      if (sortedBrands.some((item) => normalizeVehicleCatalogName(item) === normalizeVehicleCatalogName(brand))) {
        setCatalogError("Essa marca já está no catálogo.");
        return;
      }
      const saved = await saveCustomCatalog({ ...customCatalog, [brand]: [] });
      if (saved) {
        setCatalogSearch("");
        setSelectedCatalogBrand(brand);
        setCatalogModalOpen(false);
      }
      return;
    }

    const brand = catalogEntryBrand.trim();
    const model = catalogEntryModel.trim();
    if (!brand || !model) return;
    const existingModels = [
      ...customModelsForBrand(customCatalog, brand),
      ...(findFipeBrandByName(fipeBrands, brand)
        ? fipeModelsByBrand[findFipeBrandByName(fipeBrands, brand)!.code]?.map((item) => item.name) ?? []
        : []),
    ];
    if (existingModels.some((item) => normalizeVehicleCatalogName(item) === normalizeVehicleCatalogName(model))) {
      setCatalogError("Esse modelo já está cadastrado para a marca selecionada.");
      return;
    }
    const customKey = customCatalogKeyForBrand(customCatalog, brand) ?? brand;
    const saved = await saveCustomCatalog({
      ...customCatalog,
      [customKey]: [...customModelsForBrand(customCatalog, brand), model],
    });
    if (saved) {
      setCatalogSearch("");
      setSelectedCatalogBrand(brand);
      setCatalogModalOpen(false);
    }
  }

  async function handleRemoveCustomModel(brand: string, model: string) {
    const key = customCatalogKeyForBrand(customCatalog, brand);
    if (!key) return;
    const currentCustom = customCatalog[key] ?? [];
    const nextList = currentCustom.filter((m) => m !== model);
    const nextCustom = { ...customCatalog };
    if (nextList.length > 0) {
      nextCustom[key] = nextList;
    } else {
      delete nextCustom[key];
    }
    await saveCustomCatalog(nextCustom);
  }

  const activeRows = useMemo(() => rows.filter((row) => !detail(row, "archived")), [rows]);
  const archivedRows = useMemo(() => rows.filter((row) => Boolean(detail(row, "archived"))), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = subPage === "archived" ? archivedRows : activeRows;
    if (!q) return source;
    return source.filter((row) => {
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
  }, [activeRows, archivedRows, search, subPage]);
  const { pageItems: vehiclePageItems, controls: vehiclesPagination } = usePagination(filtered);

  const latestServiceByPlate = useMemo(() => {
    const latest = new Map<string, PanelRecord>();
    for (const workOrder of workOrders) {
      const plate = String(workOrder.vehicle ?? "").trim().toUpperCase();
      if (plate && !latest.has(plate)) latest.set(plate, workOrder);
    }
    return latest;
  }, [workOrders]);

  function vehiclePlate(row: PanelRecord) {
    return (row.vehicle || row.title || "").trim().toUpperCase();
  }

  function navigateToVehicleAction(path: string, row: PanelRecord) {
    const ownerName = String(row.customer_name ?? "").trim();
    const owner = clients.find((client) =>
      clientDisplayName(client).trim().toLocaleLowerCase("pt-BR") === ownerName.toLocaleLowerCase("pt-BR"),
    );
    saveVehicleActionPrefill({
      plate: vehiclePlate(row),
      customerName: ownerName,
      make: String(detail(row, "marca") ?? ""),
      model: String(detail(row, "modelo") ?? ""),
      year: String(detail(row, "ano") ?? ""),
      phone: String(owner?.phone ?? ""),
    });
    const href = `${routeFor(path)}?novo=1`;
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function openOwner(row: PanelRecord) {
    const ownerName = String(row.customer_name ?? "").trim();
    if (!ownerName) return;
    saveVehicleOwnerLookup(ownerName);
    const href = `${routeFor("clientes")}?ver-proprietario=1`;
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  async function setVehicleArchived(row: PanelRecord, archived: boolean) {
    try {
      setError("");
      await patchRecord(row.id, {
        details: {
          ...(row.details && typeof row.details === "object" ? row.details : {}),
          archived,
          archived_at: archived ? todayIso() : null,
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o veículo.");
    }
  }

  function vehicleActions(row: PanelRecord) {
    const isArchived = Boolean(detail(row, "archived"));
    return [
      { label: "Editar veículo", icon: <Pencil size={14} />, onSelect: () => openEdit(row) },
      { label: "Nova ordem de serviço", icon: <Wrench size={14} />, onSelect: () => navigateToVehicleAction("ordens-de-servico", row) },
      { label: "Novo agendamento", icon: <CalendarPlus size={14} />, onSelect: () => navigateToVehicleAction("agenda", row) },
      { label: "Nova vistoria", icon: <ClipboardCheck size={14} />, onSelect: () => navigateToVehicleAction("inspecoes", row) },
      { label: "Histórico de serviços", icon: <History size={14} />, onSelect: () => void openHistory(row) },
      { label: "Ver proprietário", icon: <UserRound size={14} />, onSelect: () => openOwner(row), disabled: !String(row.customer_name ?? "").trim() },
      { label: isArchived ? "Restaurar veículo" : "Arquivar veículo", icon: isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />, onSelect: () => void setVehicleArchived(row, !isArchived), separatorBefore: true },
      { label: "Excluir veículo", icon: <Trash2 size={14} />, onSelect: () => void removeRecord(row), destructive: true },
    ];
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setCustomBrandInput(false);
    setCustomModelInput(false);
    setCustomClient(false);
    setError("");
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    const m = String(detail(row, "marca") ?? "");
    const mod = String(detail(row, "modelo") ?? "");
    const fipeBrand = findFipeBrandByName(fipeBrands, m);
    if (fipeBrand) void loadFipeModels(m);
    const brandKnown = Boolean(!m || customCatalogKeyForBrand(customCatalog, m) || fipeBrand || fipeBrandsLoading);
    const loadedModels = fipeBrand ? fipeModelsByBrand[fipeBrand.code] : undefined;
    const modelKnown = Boolean(!mod
      || customModelsForBrand(customCatalog, m).some((model) => normalizeVehicleCatalogName(model) === normalizeVehicleCatalogName(mod))
      || loadedModels?.some((model) => normalizeVehicleCatalogName(model.name) === normalizeVehicleCatalogName(mod))
      || fipeBrandsLoading
      || (fipeBrand && !loadedModels));
    setEditing(row);
    setForm({
      vehicle: row.vehicle ?? "",
      title: row.title ?? "",
      marca: m,
      modelo: mod,
      versao: String(detail(row, "versao") ?? ""),
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
    setCustomClient(false);
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const plate = form.vehicle.trim().toUpperCase();
    const title = [form.marca.trim(), form.modelo.trim(), form.versao.trim()].filter(Boolean).join(" ") || plate;
    if (!plate || !form.marca.trim() || !form.modelo.trim() || !title) return;
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
          versao: form.versao.trim(),
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
          <h1>Veículos</h1>
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
            className={`admin-pill ${subPage !== "catalog" ? "active" : ""}`}
            onClick={() => setSubPage("vehicles")}
          >
            <Car size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
            Veículos ({activeRows.length})
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
        {subPage !== "catalog" && (
          <div className="admin-filter-pills admin-toolbar-right" aria-label="Filtrar veículos">
            <button
              type="button"
              className={`admin-pill ${subPage === "vehicles" ? "active" : ""}`}
              onClick={() => setSubPage("vehicles")}
            >
              Ativos ({activeRows.length})
            </button>
            <button
              type="button"
              className={`admin-pill ${subPage === "archived" ? "active" : ""}`}
              onClick={() => setSubPage("archived")}
            >
              Arquivados ({archivedRows.length})
            </button>
          </div>
        )}
      </div>

      {error && <p className="admin-form-error" style={{ marginBottom: 16 }}>{error}</p>}

      {subPage === "catalog" ? (
        <div className="admin-vehicle-catalog">
          <header className="admin-vehicle-catalog-header">
            <div>
              <h2>Catálogo de veículos</h2>
            </div>
          </header>

          <div className="admin-vehicle-catalog-layout">
            <aside className="admin-vehicle-catalog-sidebar">
              <div className="admin-vehicle-catalog-sidebar-title">
                <strong>Marcas</strong>
                <span>{filteredCatalog.length}</span>
              </div>
              <div className="admin-search-wrap admin-vehicle-catalog-search">
                <Search size={14} aria-hidden="true" />
                <input
                  className="admin-search"
                  placeholder="Buscar marca..."
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                        aria-label="Buscar marca"
                  id="admin-views-vehiclesview-433"
                />
              </div>
              <nav className="admin-vehicle-catalog-brands" aria-label="Marcas do catálogo">
                {catalogBrandPage.map(({ brand }) => (
                  <button
                    key={brand}
                    type="button"
                    className={`admin-vehicle-catalog-brand ${selectedCatalogEntry?.brand === brand ? "is-selected" : ""}`}
                    onClick={() => setSelectedCatalogBrand(brand)}
                    aria-current={selectedCatalogEntry?.brand === brand ? "true" : undefined}
                  >
                    <span>{brand}</span>
                    <small>
                      {findFipeBrandByName(fipeBrands, brand)
                        ? fipeModelsByBrand[findFipeBrandByName(fipeBrands, brand)!.code]?.length ?? "—"
                        : customModelsForBrand(customCatalog, brand).length}
                    </small>
                    <ChevronRight size={13} aria-hidden="true" />
                  </button>
                ))}
                {fipeBrandsLoading && <p className="admin-vehicle-catalog-no-brands">Carregando marcas da FIPE...</p>}
                {!fipeBrandsLoading && fipeBrandsError && (
                  <p className="admin-form-error">
                    {fipeBrandsError} <button type="button" className="admin-secondary" onClick={() => setFipeBrandsRetry((count) => count + 1)}>Tentar novamente</button>
                  </p>
                )}
                {filteredCatalog.length === 0 && (
                  <p className="admin-vehicle-catalog-no-brands">Nenhuma marca encontrada.</p>
                )}
              </nav>
              {catalogBrandsPagination}
            </aside>

            <section className="admin-vehicle-catalog-content" aria-label="Modelos da marca selecionada">
              {selectedCatalogEntry ? (
                <>
                  <header className="admin-vehicle-catalog-brand-head">
                    <div>
                      <h3>{selectedCatalogEntry.brand}</h3>
                      <p>
                        {selectedCatalogModelsLoading
                          ? "Carregando modelos da FIPE..."
                          : `${vehicleCatalog[selectedCatalogEntry.brand]?.length ?? 0} modelos cadastrados`}
                      </p>
                    </div>
                  </header>
                  <div className="admin-vehicle-catalog-models-head">
                    <h4>Modelos</h4>
                  </div>
                  <div className="admin-vehicle-catalog-models">
                    {selectedCatalogModelsError && (
                      <p className="admin-form-error">
                        {selectedCatalogModelsError} <button type="button" className="admin-secondary" onClick={() => void loadFipeModels(selectedCatalogEntry.brand)}>Tentar novamente</button>
                      </p>
                    )}
                    {catalogModelPage.map((model) => {
                      const selectedFipeModels = selectedCatalogFipeBrand
                        ? fipeModelsByBrand[selectedCatalogFipeBrand.code] ?? []
                        : [];
                      const isCustom = !selectedFipeModels.some((item) => normalizeVehicleCatalogName(item.name) === normalizeVehicleCatalogName(model));
                      return (
                        <article className="admin-vehicle-catalog-model" key={model}>
                          <span>{model}</span>
                          {isCustom && (
                            <AdminActionMenu
                              label={`Ações do modelo ${model}`}
                              actions={[
                                {
                                  label: "Remover modelo personalizado",
                                  icon: <Trash2 size={14} />,
                                  onSelect: () => void handleRemoveCustomModel(selectedCatalogEntry.brand, model),
                                  destructive: true,
                                },
                              ]}
                            />
                          )}
                        </article>
                      );
                    })}
                    {visibleCatalogModels.length === 0 && !selectedCatalogModelsError && (
                      <p className="admin-vehicle-catalog-no-models">
                        {selectedCatalogModelsLoading
                          ? "Buscando modelos..."
                          : catalogSearch
                            ? "Nenhum modelo corresponde à busca."
                            : "Nenhum modelo cadastrado para esta marca."}
                      </p>
                    )}
                  </div>
                  {catalogModelsPagination}
                </>
              ) : (
                <div className="admin-vehicle-catalog-no-models">Selecione uma marca para ver os modelos.</div>
              )}
            </section>
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
          <strong>{subPage === "archived" ? "Nenhum veículo arquivado" : "Nenhum veículo encontrado"}</strong>
          <p>{subPage === "archived" ? "Veículos arquivados aparecerão aqui." : "Cadastre um veículo ou ajuste os termos de busca."}</p>
        </div>
      ) : viewMode === "list" ? (
        <div className="admin-table-wrap">
          <table className="admin-table admin-vehicles-table">
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
              {vehiclePageItems.map((row) => {
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
                      <AdminActionMenu
                        label={`Ações do veículo ${row.vehicle || row.title}`}
                        actions={vehicleActions(row)}
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
          {vehiclePageItems.map((row) => {
            const marca = detail(row, "marca");
            const modelo = detail(row, "modelo");
            const ano = detail(row, "ano");
            const km = detail(row, "km");
            const combustivel = detail(row, "combustivel");
            const makeModel = [marca, modelo].filter(Boolean).join(" ") || row.title;

            return (
              <article key={row.id} className="admin-vehicle-card">
                <div className="admin-vehicle-card-top">
                  <div className="mercosul-plate">
                    <div className="mercosul-plate-top">BRASIL</div>
                    <div className="mercosul-plate-code">{row.vehicle || row.title}</div>
                  </div>
                  <AdminActionMenu
                    label={`Ações do veículo ${row.vehicle || row.title}`}
                    actions={vehicleActions(row)}
                  />
                </div>

                <div className="admin-vehicle-card-identity">
                  <div>{makeModel}</div>
                  <div><UserRound size={12} />{asText(row.customer_name)}</div>
                </div>

                <div className="admin-vehicle-card-specs">
                  <div><span>Ano</span><strong>{asText(ano)}</strong></div>
                  <div><span>Quilometragem</span><strong>{km ? `${km} km` : "—"}</strong></div>
                  <div><span>Combustível</span><strong>{asText(combustivel)}</strong></div>
                </div>

                <div className="admin-vehicle-card-last-service">
                  <Wrench size={13} />
                  <div>
                    <span>Último serviço</span>
                    <strong>
                      {(() => {
                        const service = latestServiceByPlate.get(vehiclePlate(row));
                        if (!workOrdersLoaded) return "Carregando histórico...";
                        if (workOrdersLoadFailed) return "Histórico indisponível";
                        return service?.title || "Nenhum serviço registrado";
                      })()}
                    </strong>
                  </div>
                </div>

                <div className="admin-vehicle-card-footer">
                  <button type="button" className="admin-vehicle-history-link" onClick={() => void openHistory(row)}>
                    <History size={12} /> Histórico
                  </button>
                  <button type="button" className="admin-secondary admin-vehicle-view-button" onClick={() => setViewingVehicle(row)}>
                    Ver veículo <ArrowUpRight size={13} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!loading && vehiclesPagination}
        </>
      )}

      {catalogModalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setCatalogModalOpen(false))}>
          <div className="admin-modal admin-vehicle-catalog-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>Adicionar ao catálogo</h2>
                <p>Cadastre uma nova marca ou inclua um modelo.</p>
              </div>
              <button type="button" className="admin-icon-btn" onClick={() => setCatalogModalOpen(false)} aria-label="Fechar">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={(e) => void handleSaveCatalogEntry(e)}>
              <div className="admin-vehicle-catalog-mode-switch" role="group" aria-label="Tipo de cadastro">
                <button
                  type="button"
                  aria-pressed={catalogEntryMode === "brand"}
                  className={catalogEntryMode === "brand" ? "is-active" : ""}
                  onClick={() => { setCatalogEntryMode("brand"); setCatalogError(""); }}
                >
                  Nova marca
                </button>
                <button
                  type="button"
                  aria-pressed={catalogEntryMode === "model"}
                  className={catalogEntryMode === "model" ? "is-active" : ""}
                  onClick={() => { setCatalogEntryMode("model"); setCatalogError(""); }}
                >
                  Novo modelo
                </button>
              </div>

              {catalogEntryMode === "brand" ? (
                <div className="admin-field">
                  <label htmlFor="vehicle-catalog-new-brand">Nome da marca *</label>
                  <input
                    id="vehicle-catalog-new-brand"
                    className="admin-input"
                    required
                    autoFocus
                    value={catalogBrandName}
                    onChange={(e) => setCatalogBrandName(e.target.value)}
                    placeholder="Ex.: Honda"
                  />
                </div>
              ) : (
                <div className="admin-vehicle-catalog-model-form">
                  <div className="admin-field">
                    <label htmlFor="vehicle-catalog-model-brand">Marca *</label>
                    <select
                      id="vehicle-catalog-model-brand"
                      className="admin-select"
                      required
                      value={catalogEntryBrand}
                      onChange={(e) => setCatalogEntryBrand(e.target.value)}
                    >
                      <option value="" disabled>Selecionar marca</option>
                      {sortedBrands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                    </select>
                  </div>
                  <div className="admin-field">
                    <label htmlFor="vehicle-catalog-new-model">Nome do modelo *</label>
                    <input
                      id="vehicle-catalog-new-model"
                      className="admin-input"
                      required
                      autoFocus
                      value={catalogEntryModel}
                      onChange={(e) => setCatalogEntryModel(e.target.value)}
                      placeholder="Ex.: Civic Touring"
                    />
                  </div>
                </div>
              )}

              {catalogError && <p className="admin-form-error admin-vehicle-catalog-modal-error">{catalogError}</p>}

              <div className="admin-modal-actions">
                <button type="button" className="admin-secondary" onClick={() => setCatalogModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="admin-primary" disabled={catalogSaving}>
                  {catalogSaving ? "Salvando..." : catalogEntryMode === "brand" ? "Cadastrar marca" : "Cadastrar modelo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className="admin-modal admin-vehicle-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head admin-vehicle-modal-head">
              <div>
                <h2>{editing ? "Editar veículo" : "Novo veículo"}</h2>
                <p>Cadastre um veículo e vincule seu proprietário.</p>
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
            <form className="admin-vehicle-form" onSubmit={handleSubmit}>
              <section className="admin-vehicle-form-section admin-vehicle-identity-section">
                <h3>Identificação do veículo</h3>
                <div className="admin-vehicle-plate-panel">
                  <div className="admin-vehicle-plate-layout">
                    <label className="admin-field admin-vehicle-plate-field">
                      <span>Placa do veículo *</span>
                      <span className="admin-vehicle-plate-input">
                        <span>BRASIL</span>
                        <input
                          required
                          maxLength={7}
                          value={form.vehicle}
                          onChange={(e) => setForm({ ...form, vehicle: e.target.value.toUpperCase() })}
                          placeholder="ABC1D23"
                          id="admin-views-vehiclesview-749"
                        />
                      </span>
                    </label>
                    <div className="admin-vehicle-plate-lookup">
                      <button
                        type="button"
                        className="admin-primary"
                        onClick={() => void handleLookupPlate()}
                        disabled={lookingUpPlate}
                        title="Consultar placa e preencher dados automaticamente"
                      >
                        <Search size={13} />
                        {lookingUpPlate ? "Consultando..." : "Consultar placa"}
                      </button>
                    </div>
                  </div>
                  {plateNotice && <small className="admin-vehicle-plate-notice">{plateNotice}</small>}
                </div>
              </section>

              <section className="admin-vehicle-form-section admin-vehicle-data-section">
                <h3>Dados do veículo</h3>
                <div className="admin-form-grid admin-vehicle-fields">
                  <div className="admin-field">
                    <label htmlFor={customBrandInput ? "admin-views-vehiclesview-806" : "admin-views-vehiclesview-781"}>Marca *</label>
                    {customBrandInput ? (
                      <input
                        className="admin-input"
                        required
                        value={form.marca}
                        onChange={(e) => setForm({ ...form, marca: e.target.value })}
                        placeholder="Digite a marca"
                        id="admin-views-vehiclesview-806"
                      />
                    ) : (
                      <select
                        className="admin-select"
                        required
                        disabled={fipeBrandsLoading && sortedBrands.length === 0}
                        value={form.marca}
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
                        }}
                        id="admin-views-vehiclesview-781"
                      >
                        <option value="">
                          {fipeBrandsLoading && sortedBrands.length === 0 ? "Carregando marcas..." : "Selecionar marca"}
                        </option>
                        {sortedBrands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                        <option value="__custom__">+ Outra marca (digitar)</option>
                      </select>
                    )}
                    {!customBrandInput && fipeBrandsError && (
                      <small className="admin-form-error">
                        {fipeBrandsError} Você ainda pode digitar uma marca manualmente. <button type="button" className="admin-secondary" onClick={() => setFipeBrandsRetry((count) => count + 1)}>Tentar novamente</button>
                      </small>
                    )}
                  </div>

                  <div className="admin-field">
                    <label htmlFor={customModelInput ? "admin-views-vehiclesview-846" : "admin-views-vehiclesview-816"}>Modelo *</label>
                    {customModelInput ? (
                      <input
                        className="admin-input"
                        required
                        value={form.modelo}
                        onChange={(e) => setForm({ ...form, modelo: e.target.value })}
                        placeholder="Digite o modelo"
                        id="admin-views-vehiclesview-846"
                      />
                    ) : (
                      <select
                        className="admin-select"
                        required
                        value={form.modelo}
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
                        disabled={(!form.marca.trim() && !customBrandInput) || formModelsLoading}
                        id="admin-views-vehiclesview-816"
                      >
                        <option value="">
                          {!form.marca.trim() ? "Escolha a marca primeiro" : formModelsLoading ? "Carregando modelos..." : "Selecionar modelo"}
                        </option>
                        {modelsForSelectedBrand.map((model) => <option key={model} value={model}>{model}</option>)}
                        <option value="__custom__">+ Outro modelo (digitar)</option>
                      </select>
                    )}
                    {!customModelInput && formModelsError && (
                      <small className="admin-form-error">{formModelsError} Você pode informar o modelo manualmente.</small>
                    )}
                  </div>

                  <label className="admin-field">
                    <span>Versão / motorização</span>
                    <input
                      className="admin-input"
                      value={form.versao}
                      onChange={(e) => setForm({ ...form, versao: e.target.value })}
                      placeholder="Ex: EXL 2.0"
                      id="admin-views-vehiclesview-771"
                    />
                  </label>
                  <label className="admin-field">
                    <span>Ano</span>
                    <input
                      className="admin-input"
                      value={form.ano}
                      onChange={(e) => setForm({ ...form, ano: e.target.value })}
                      placeholder="2022"
                      id="admin-views-vehiclesview-856"
                    />
                  </label>

                  <label className="admin-field">
                    <span>Combustível</span>
                    <select
                      className="admin-select"
                      value={form.combustivel}
                      onChange={(e) => setForm({ ...form, combustivel: e.target.value })}
                      id="admin-views-vehiclesview-874"
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
                  </label>
                  <label className="admin-field">
                    <span>Cor</span>
                    <input
                      className="admin-input"
                      value={form.cor}
                      onChange={(e) => setForm({ ...form, cor: e.target.value })}
                      placeholder="Prata"
                      id="admin-views-vehiclesview-891"
                    />
                  </label>

                  <label className="admin-field">
                    <span>Quilometragem</span>
                    <span className="admin-vehicle-mileage-input">
                      <input
                        className="admin-input"
                        inputMode="numeric"
                        value={form.km}
                        onChange={(e) => setForm({ ...form, km: e.target.value.replace(/\D/g, "") })}
                        placeholder="45.000"
                        id="admin-views-vehiclesview-865"
                      />
                      <small>km</small>
                    </span>
                  </label>
                  <label className="admin-field">
                    <span>Chassi</span>
                    <input
                      className="admin-input"
                      value={form.chassi}
                      onChange={(e) => setForm({ ...form, chassi: e.target.value.toUpperCase() })}
                      placeholder="Número do chassi"
                      id="admin-views-vehiclesview-900"
                    />
                  </label>
                </div>
              </section>

              <section className="admin-vehicle-form-section is-separated">
                <h3>Proprietário</h3>
                <div className="admin-field">
                  <label htmlFor="admin-views-vehiclesview-919">Cliente vinculado</label>
                  {!customClient && clients.length > 0 ? (
                    <ClientPicker
                      clients={clients}
                      value={form.customer_name}
                      id="admin-views-vehiclesview-919"
                      placeholder="Buscar cliente..."
                      onSelectClient={(picked) => {
                        if (!picked) {
                          setForm((prev) => ({ ...prev, customer_name: "" }));
                          return;
                        }
                        setCustomClient(false);
                        setForm((prev) => ({
                          ...prev,
                          customer_name: clientDisplayName(picked),
                        }));
                      }}
                    />
                  ) : (
                    <input
                      id="admin-views-vehiclesview-919"
                      className="admin-input"
                      placeholder="Nome do cliente"
                      value={form.customer_name}
                      onChange={(e) => {
                        setCustomClient(true);
                        setForm((prev) => ({ ...prev, customer_name: e.target.value }));
                      }}
                    />
                  )}
                  {clients.length > 0 && (
                    <button
                      type="button"
                      className="admin-vehicle-new-client-link"
                      onClick={() => setCustomClient((current) => !current)}
                    >
                      <Plus size={12} />
                      {customClient ? "Selecionar cliente existente" : "Cadastrar novo cliente"}
                    </button>
                  )}
                </div>
              </section>

              <div className="admin-vehicle-modal-footer">
                <small>* Campos obrigatórios</small>
                <div>
                  <button type="button" className="admin-secondary" onClick={() => setModalOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="admin-primary" disabled={saving}>
                    {saving ? "Salvando..." : editing ? "Salvar veículo" : "Cadastrar veículo"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      {viewingVehicle && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setViewingVehicle(null))}>
          <div className="admin-modal admin-vehicle-details-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{[detail(viewingVehicle, "marca"), detail(viewingVehicle, "modelo")].filter(Boolean).join(" ") || viewingVehicle.title}</h2>
                <p>Ficha do veículo · {viewingVehicle.vehicle || viewingVehicle.title}</p>
              </div>
              <button type="button" className="admin-icon-btn" aria-label="Fechar ficha do veículo" onClick={() => setViewingVehicle(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="admin-vehicle-details-grid">
              <div><span>Proprietário</span><strong>{asText(viewingVehicle.customer_name)}</strong></div>
              <div><span>Ano</span><strong>{asText(detail(viewingVehicle, "ano"))}</strong></div>
              <div><span>Quilometragem</span><strong>{detail(viewingVehicle, "km") ? `${detail(viewingVehicle, "km")} km` : "—"}</strong></div>
              <div><span>Combustível</span><strong>{asText(detail(viewingVehicle, "combustivel"))}</strong></div>
              <div><span>Versão</span><strong>{asText(detail(viewingVehicle, "versao"))}</strong></div>
              <div><span>Cor</span><strong>{asText(detail(viewingVehicle, "cor"))}</strong></div>
              <div><span>Chassi</span><strong>{asText(detail(viewingVehicle, "chassi"))}</strong></div>
            </div>
            <div className="admin-modal-actions">
              <button type="button" className="admin-secondary" onClick={() => void openQrSticker(viewingVehicle)}>
                <QrCode size={14} /> Etiqueta QR
              </button>
              <button type="button" className="admin-secondary" onClick={() => void openHistory(viewingVehicle)}>
                <History size={14} /> Histórico
              </button>
              <button type="button" className="admin-primary" onClick={() => { const row = viewingVehicle; setViewingVehicle(null); openEdit(row); }}>
                <Pencil size={14} /> Editar veículo
              </button>
            </div>
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
                border: "1px solid var(--admin-line)",
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
