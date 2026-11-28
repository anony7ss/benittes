"use client";

import { SkeletonKanban } from "../Skeletons";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  GripVertical,
  Link2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { insertRow, type PanelRecord } from "../../../lib/supabase";
import { mergeVehiclePriceProfile, resolveServicePrice, type PricingMode } from "../../../lib/servicePricing";
import {
  asText,
  dateText,
  detail,
  money,
  todayIso,
  useKanbanDrag,
  useModuleRecords,
  modalBackdropProps,
  whatsappApprovalUrl,
} from "../utils";
import {
  ClientPicker,
  ServicePicker,
  VehiclePicker,
  clientDisplayName,
  ensureClientAndVehicle,
  useClientVehicleCatalog,
  vehiclePlate,
} from "../QuickPickers";

const QUOTE_LANES = [
  { key: "pendentes", label: "Pendentes", targetStatus: "novo", statuses: ["novo", "aguardando"] },
  {
    key: "aprovados",
    label: "Aprovados",
    targetStatus: "concluido",
    statuses: ["em_andamento", "concluido"],
  },
  { key: "recusados", label: "Recusados", targetStatus: "cancelado", statuses: ["cancelado"] },
] as const;

type QuoteLineItem = {
  id: string;
  name: string;
  type: "servico" | "peca";
  qty: number;
  unit_price: number;
  service_id?: string;
  pricing_mode?: PricingMode;
  price_pending?: boolean;
  approved?: boolean;
};

type FormState = {
  title: string;
  customer_name: string;
  phone: string;
  vehicle: string;
  amount: string;
  validade: string;
  status: string;
  description: string;
  items: QuoteLineItem[];
  service_id: string;
  pricing_mode: string;
  pricing_rule_id: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: string;
  discount_type: "percentual" | "fixo";
  discount_value: string;
  payment_method: string;
  allow_partial_approval: boolean;
};

const emptyForm = (): FormState => ({
  title: "",
  customer_name: "",
  phone: "",
  vehicle: "",
  amount: "",
  validade: "",
  status: "novo",
  description: "",
  items: [],
  service_id: "",
  pricing_mode: "",
  pricing_rule_id: "",
  vehicle_make: "",
  vehicle_model: "",
  vehicle_year: "",
  discount_type: "percentual",
  discount_value: "0",
  payment_method: "A combinar",
  allow_partial_approval: false,
});

function quoteItemsForRow(row: PanelRecord): QuoteLineItem[] {
  const rawItems = detail(row, "items");
  if (!Array.isArray(rawItems)) return [];

  return rawItems.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    return [{
      id: String(item.id ?? `item-${index}`),
      name: String(item.name ?? "Item do orçamento"),
      type: item.type === "peca" ? "peca" : "servico",
      qty: Math.max(1, Number(item.qty) || 1),
      unit_price: Math.max(0, Number(item.unit_price) || 0),
      approved: item.approved !== false,
    }];
  });
}

function displayQuoteTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed !== trimmed.toLocaleUpperCase("pt-BR")) return trimmed;
  return trimmed
    .toLocaleLowerCase("pt-BR")
    .replace(/^(\p{L})/u, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function quoteHasExpired(row: PanelRecord): boolean {
  const validity = String(detail(row, "validade") ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(validity) && validity < todayIso();
}

export function QuotesView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, patchRecord, removeRecord } = useModuleRecords(
    "quotes",
    session.user.id,
  );
  const { clients, vehicles, services, priceRules, reload: reloadCatalog } = useClientVehicleCatalog();
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [customClient, setCustomClient] = useState(false);
  const [customVehicle, setCustomVehicle] = useState(false);
  const [notice, setNotice] = useState("");
  const [waMode, setWaMode] = useState<"confirm" | "link">("confirm");
  const [openQuoteMenuId, setOpenQuoteMenuId] = useState<string | null>(null);
  const [quoteMenuPlacement, setQuoteMenuPlacement] = useState<"above" | "below">("below");
  const [quoteMenuPosition, setQuoteMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [approvedItemsQuote, setApprovedItemsQuote] = useState<PanelRecord | null>(null);

  useEffect(() => {
    if (!openQuoteMenuId) return;

    function closeMenuOnOutsideClick(event: PointerEvent) {
      if (!(event.target instanceof Element) || !event.target.closest("[data-quote-actions], [data-quote-menu]")) {
        setOpenQuoteMenuId(null);
        setQuoteMenuPosition(null);
      }
    }

    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenQuoteMenuId(null);
        setQuoteMenuPosition(null);
      }
    }

    document.addEventListener("pointerdown", closeMenuOnOutsideClick);
    document.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenuOnOutsideClick);
      document.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [openQuoteMenuId]);

  const serviceVehicleProfile = mergeVehiclePriceProfile(
    vehicles.find((vehicle) => vehiclePlate(vehicle) === form.vehicle.trim().toUpperCase()),
    { make: form.vehicle_make, model: form.vehicle_model, year: form.vehicle_year },
  );
  const quoteServicesSubtotal = form.items
    .filter((item) => item.type === "servico" && item.approved !== false)
    .reduce((sum, item) => sum + item.qty * item.unit_price, 0);
  const quotePartsSubtotal = form.items
    .filter((item) => item.type === "peca" && item.approved !== false)
    .reduce((sum, item) => sum + item.qty * item.unit_price, 0);
  const quoteFullSubtotal = form.items.length > 0
    ? form.items.reduce((sum, item) => sum + item.qty * item.unit_price, 0)
    : Math.max(0, Number(form.amount) || 0);
  const quoteSubtotal = form.items.length > 0
    ? quoteServicesSubtotal + quotePartsSubtotal
    : Math.max(0, Number(form.amount) || 0);
  const rawDiscount = Math.max(0, Number(form.discount_value.replace(",", ".")) || 0);
  const requestedDiscount = form.discount_type === "percentual"
    ? Math.min(100, rawDiscount)
    : Math.min(10_000_000, rawDiscount);
  const quoteDiscount = form.discount_type === "percentual"
    ? Math.min(quoteSubtotal, quoteSubtotal * Math.min(100, requestedDiscount) / 100)
    : Math.min(quoteSubtotal, quoteFullSubtotal > 0 ? requestedDiscount * quoteSubtotal / quoteFullSubtotal : 0);
  const quoteTotal = Math.max(0, Math.round((quoteSubtotal - quoteDiscount) * 100) / 100);

  function quoteRowHasFinalPrice(row: PanelRecord): boolean {
    if (!(Number(row.amount) > 0)) return false;
    const items = detail(row, "items");
    if (!Array.isArray(items)) return true;
    return items
      .filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).approved !== false)
      .every((item) => {
        const price = Number((item as Record<string, unknown>).unit_price);
        return Number.isFinite(price) && price > 0;
      });
  }

  function applySelectedVehicle(picked: PanelRecord | null) {
    const plate = picked ? vehiclePlate(picked) : "";
    setForm((previous) => ({ ...previous, ...vehicleFormPatch(previous, plate, picked) }));
  }

  function vehicleFormPatch(previous: FormState, plate: string, picked?: PanelRecord | null, overrides?: { make?: unknown; model?: unknown; year?: unknown }) {
    const normalizedPlate = plate.trim().toUpperCase();
    const savedVehicle = picked ?? vehicles.find((vehicle) => vehiclePlate(vehicle) === normalizedPlate) ?? null;
    const profile = mergeVehiclePriceProfile(savedVehicle, overrides);
    const service = services.find((item) => item.id === previous.service_id)
      ?? services.find((item) => item.title.trim().toLowerCase() === previous.title.trim().toLowerCase())
      ?? null;
    const resolution = resolveServicePrice(service, priceRules, profile);
    const variable = resolution.mode === "vehicle";
    return {
      vehicle: normalizedPlate,
      vehicle_make: String(profile?.make ?? ""),
      vehicle_model: String(profile?.model ?? ""),
      vehicle_year: String(profile?.year ?? ""),
      amount: variable ? (resolution.amount === null ? "" : String(resolution.amount)) : previous.amount,
      pricing_rule_id: variable ? resolution.rule?.id ?? "" : previous.pricing_rule_id,
      items: previous.items.map((line) => {
        if (line.type !== "servico" || !line.service_id) return line;
        const lineService = services.find((item) => item.id === line.service_id);
        if (!lineService) return line;
        const linePrice = resolveServicePrice(lineService, priceRules, profile);
        if (linePrice.mode !== "vehicle") return line;
        return {
          ...line,
          unit_price: linePrice.amount ?? 0,
          pricing_mode: linePrice.mode,
          price_pending: linePrice.amount === null,
        };
      }),
    };
  }

  const { draggingId, dragOverLane, touchGhost, cardDragProps, handleTouchProps, laneDropProps } =
    useKanbanDrag((rowId, laneKey) => {
      const row = rows.find((r) => r.id === rowId);
      const lane = QUOTE_LANES.find((l) => l.key === laneKey);
      if (!row || !lane) return;
      if ((lane.statuses as readonly string[]).includes(row.status)) return;
      if (lane.key === "aprovados") {
        void approveQuote(row);
      } else if (lane.key === "recusados") {
        void rejectQuote(row);
      } else {
        const existingDetails =
          row.details && typeof row.details === "object" ? row.details : {};
        void patchRecord(row.id, {
          status: "novo",
          details: { ...existingDetails, aprovacao: "pendente" },
        });
      }
    });

  async function approveQuote(row: PanelRecord) {
    if (!quoteRowHasFinalPrice(row)) {
      setNotice("Defina um valor final para todos os itens aprovados antes de confirmar este orçamento.");
      return;
    }
    const existingDetails =
      row.details && typeof row.details === "object" ? row.details : {};

    await patchRecord(row.id, {
      status: "concluido",
      details: {
        ...existingDetails,
        aprovacao: "aprovado",
        aprovado_em: todayIso(),
      },
    });
    setNotice(`Orçamento "${row.title}" aprovado.`);
  }

  async function rejectQuote(row: PanelRecord) {
    const existingDetails =
      row.details && typeof row.details === "object" ? row.details : {};
    await patchRecord(row.id, {
      status: "cancelado",
      details: {
        ...existingDetails,
        aprovacao: "recusado",
      },
    });
    setNotice(`Orçamento "${row.title}" marcado como recusado.`);
  }

  async function convertQuoteToOs(row: PanelRecord) {
    const existingDetails =
      row.details && typeof row.details === "object" ? row.details : {};
    await insertRow<PanelRecord>("panel_records", {
      module: "work-orders",
      title: row.title,
      customer_name: row.customer_name,
      phone: row.phone,
      vehicle: row.vehicle,
      amount: row.amount,
      status: "novo",
      description: row.description,
      details: {
        aprovacao: "aprovado",
        aprovado_em: todayIso(),
        orcamento_id: row.id,
      },
      created_by: session.user.id,
    });
    await patchRecord(row.id, {
      status: "concluido",
      details: {
        ...existingDetails,
        aprovacao: "aprovado",
        os_gerada: true,
      },
    });
    setNotice(`OS criada a partir do orçamento "${row.title}".`);
  }

  function generatePublicToken(): string {
    if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
      throw new Error("Este navegador não oferece geração segura de links.");
    }
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function ensurePublicToken(row: PanelRecord): Promise<string> {
    const existing = String(detail(row, "public_token") ?? "").trim();
    if (/^[a-f0-9]{64}$/i.test(existing)) return existing;
    const token = generatePublicToken();
    const existingDetails =
      row.details && typeof row.details === "object" ? row.details : {};
    await patchRecord(row.id, {
      details: { ...existingDetails, public_token: token },
    });
    return token;
  }

  async function openPublicSheet(row: PanelRecord) {
    const token = await ensurePublicToken(row);
    window.open(`/orcamento/${token}`, "_blank", "noopener,noreferrer");
  }

  async function copyPublicLink(row: PanelRecord) {
    const token = await ensurePublicToken(row);
    const url = `${window.location.origin}/orcamento/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice(`Link da ficha online de "${row.title}" copiado!`);
    } catch {
      setNotice(`Link da ficha: ${url}`);
    }
  }

  async function sendQuoteWhatsApp(row: PanelRecord) {
    if (!quoteRowHasFinalPrice(row)) {
      setNotice("Este orçamento ainda tem valores em definição. Complete os preços antes de pedir aprovação pelo WhatsApp.");
      return;
    }
    const baseUrl = whatsappApprovalUrl(row, "orcamento");
    if (waMode === "link") {
      const token = await ensurePublicToken(row);
      const sheetUrl = `${window.location.origin}/orcamento/${token}`;
      const separator = baseUrl.includes("?text=") ? "%0A%0A" : "";
      const extraText = encodeURIComponent(
        `Acesse sua ficha online para aprovar ou acompanhar o serviço em tempo real:\n${sheetUrl}`,
      );
      window.open(
        separator ? `${baseUrl}${separator}${extraText}` : baseUrl,
        "_blank",
        "noopener,noreferrer",
      );
    } else {
      window.open(baseUrl, "_blank", "noopener,noreferrer");
    }
    if (row.status === "novo") {
      const existingDetails =
        row.details && typeof row.details === "object" ? row.details : {};
      void patchRecord(row.id, {
        status: "aguardando",
        details: { ...existingDetails, aprovacao: "pendente" },
      });
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.title, row.customer_name, row.vehicle, row.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const quoteLaneSummaries = useMemo(
    () =>
      QUOTE_LANES.map((lane) => {
        const laneRows = filtered.filter((row) =>
          (lane.statuses as readonly string[]).includes(row.status),
        );
        return {
          ...lane,
          count: laneRows.length,
          amount: laneRows.reduce((sum, row) => {
            const amount = Number(row.amount);
            return sum + (Number.isFinite(amount) ? Math.max(0, amount) : 0);
          }, 0),
        };
      }),
    [filtered],
  );

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setCustomClient(clients.length === 0);
    setCustomVehicle(vehicles.length === 0);
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    setEditing(row);
    setCustomClient(!clients.some((client) => clientDisplayName(client).toLowerCase() === (row.customer_name ?? "").trim().toLowerCase()));
    setCustomVehicle(!vehicles.some((vehicle) => vehiclePlate(vehicle) === (row.vehicle ?? "").trim().toUpperCase()));
    const rowDetails = row.details && typeof row.details === "object" ? row.details : {};
    const rawItems = detail(row, "items");
    const parsedItems: QuoteLineItem[] = Array.isArray(rawItems)
      ? rawItems.map((it: Record<string, unknown>, idx: number) => ({
          id: String(it.id ?? `item-${idx}`),
          name: String(it.name ?? ""),
          type: it.type === "peca" ? "peca" : "servico",
          qty: Math.max(1, Number(it.qty ?? 1)),
          unit_price: Math.max(0, Number(it.unit_price ?? 0)),
          service_id: String(it.service_id ?? ""),
          pricing_mode: it.pricing_mode === "fixed" || it.pricing_mode === "vehicle" || it.pricing_mode === "assessment" ? it.pricing_mode : undefined,
          price_pending: Boolean(it.price_pending) || Number(it.unit_price ?? 0) <= 0,
          approved: typeof it.approved === "boolean" ? it.approved : true,
        }))
      : [];
    const discountType = rowDetails.desconto_tipo === "fixo" ? "fixo" : "percentual";
    const discountValue = Math.max(0, Number(rowDetails.desconto_valor ?? 0) || 0);
    const savedTotal = Math.max(0, Number(row.amount ?? 0) || 0);
    const discountMultiplier = discountType === "percentual" ? Math.min(100, discountValue) / 100 : 0;
    const baseAmount = parsedItems.length > 0
      ? savedTotal
      : discountType === "fixo"
        ? savedTotal + discountValue
        : discountMultiplier < 1
          ? savedTotal / (1 - discountMultiplier)
          : savedTotal;
    setForm({
      title: row.title ?? "",
      customer_name: row.customer_name ?? "",
      phone: row.phone ?? "",
      vehicle: row.vehicle ?? "",
      amount: String(baseAmount),
      validade: String(detail(row, "validade") ?? "").slice(0, 10),
      status: row.status ?? "novo",
      description: row.description ?? "",
      items: parsedItems,
      service_id: String(detail(row, "service_id") ?? services.find((service) => service.title.trim().toLowerCase() === (row.title ?? "").trim().toLowerCase())?.id ?? ""),
      pricing_mode: String(detail(row, "pricing_mode") ?? ""),
      pricing_rule_id: String(detail(row, "pricing_rule_id") ?? ""),
      vehicle_make: String(detail(row, "marca") ?? ""),
      vehicle_model: String(detail(row, "modelo") ?? ""),
      vehicle_year: String(detail(row, "ano") ?? ""),
      discount_type: discountType,
      discount_value: String(discountValue),
      payment_method: String(rowDetails.forma_pagamento ?? "A combinar"),
      allow_partial_approval: rowDetails.permitir_aprovacao_parcial === true,
    });
    setModalOpen(true);
  }

  function reviewQuote(row: PanelRecord) {
    const existingDetails = row.details && typeof row.details === "object" ? row.details : {};
    openEdit({
      ...row,
      status: "novo",
      details: { ...existingDetails, aprovacao: "pendente", aprovacao_parcial: false },
    });
  }

  async function renewQuoteValidity(row: PanelRecord) {
    const [year, month, day] = todayIso().split("-").map(Number);
    const renewedThrough = new Date(year, month - 1, day, 12);
    renewedThrough.setDate(renewedThrough.getDate() + 30);
    const validity = [
      renewedThrough.getFullYear(),
      String(renewedThrough.getMonth() + 1).padStart(2, "0"),
      String(renewedThrough.getDate()).padStart(2, "0"),
    ].join("-");
    const existingDetails = row.details && typeof row.details === "object" ? row.details : {};

    await patchRecord(row.id, { details: { ...existingDetails, validade: validity } });
    setNotice(`Validade do orçamento "${row.title}" renovada por 30 dias.`);
  }

  function addLineItem(type: "servico" | "peca" = "servico") {
    setForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: `it-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: "",
          type,
          qty: 1,
          unit_price: 0,
          price_pending: true,
          approved: true,
        },
      ],
    }));
  }

  function updateLineItem(id: string, patch: Partial<QuoteLineItem>) {
    setForm((prev) => {
      const nextItems = prev.items.map((it) => {
        if (it.id !== id) return it;
        const updated = { ...it, ...patch };
        return Object.hasOwn(patch, "unit_price")
          ? { ...updated, price_pending: !(Number(updated.unit_price) > 0) }
          : updated;
      });
      const sum = nextItems.filter((it) => it.approved !== false).reduce((acc, it) => acc + it.qty * it.unit_price, 0);
      return {
        ...prev,
        items: nextItems,
        amount: nextItems.length > 0 ? sum.toFixed(2) : prev.amount,
      };
    });
  }

  function removeLineItem(id: string) {
    setForm((prev) => {
      const nextItems = prev.items.filter((it) => it.id !== id);
      const sum = nextItems.filter((it) => it.approved !== false).reduce((acc, it) => acc + it.qty * it.unit_price, 0);
      return {
        ...prev,
        items: nextItems,
        amount: nextItems.length > 0 ? sum.toFixed(2) : prev.amount,
      };
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const existingDetails =
        editing?.details && typeof editing.details === "object" ? editing.details : {};
      await ensureClientAndVehicle({
        userId: session.user.id,
        clients,
        vehicles,
        customerName: form.customer_name,
        phone: form.phone,
        vehicle: form.vehicle,
        vehicleDetails: { marca: form.vehicle_make, modelo: form.vehicle_model, ano: form.vehicle_year },
        reload: reloadCatalog,
      });
      await saveRecord(editing, {
        title: form.title.trim(),
        customer_name: form.customer_name.trim() || null,
        phone: form.phone.trim() || null,
        vehicle: form.vehicle.trim().toUpperCase() || null,
        amount: quoteSubtotal > 0 ? quoteSubtotal : form.amount.trim() ? 0 : null,
        status: form.status,
        description: form.description.trim() || null,
        details: {
          ...existingDetails,
          validade: form.validade || null,
          items: form.items.filter((it) => it.name.trim() !== ""),
          public_token: String(existingDetails.public_token || generatePublicToken()),
          service_id: form.service_id || null,
          pricing_mode: form.pricing_mode || null,
          pricing_rule_id: form.pricing_rule_id || null,
          marca: form.vehicle_make || null,
          modelo: form.vehicle_model || null,
          ano: form.vehicle_year || null,
          desconto_tipo: form.discount_type,
          desconto_valor: requestedDiscount,
          forma_pagamento: form.payment_method,
          permitir_aprovacao_parcial: form.allow_partial_approval,
          price_pending: !(quoteTotal > 0),
        },
      });
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar orçamento.");
    } finally {
      setSaving(false);
    }
  }

  function renderQuoteCard(row: PanelRecord) {
    const approval = String(detail(row, "aprovacao") ?? "pendente");
    const isRejected = approval === "recusado" || row.status === "cancelado";
    const isApproved = approval === "aprovado" || row.status === "em_andamento" || row.status === "concluido";
    const items = quoteItemsForRow(row);
    const approvedItems = items.filter((item) => item.approved !== false);
    const isPartial = isApproved && (
      detail(row, "aprovacao_parcial") === true
      || (approvedItems.length > 0 && approvedItems.length < items.length)
    );
    const isExpired = !isApproved && !isRejected && quoteHasExpired(row);
    const validity = String(detail(row, "validade") ?? "");
    const plate = (row.vehicle ?? "").trim().toUpperCase();
    const vehicle = vehicles.find((item) => vehiclePlate(item) === plate);
    const vehicleDetails = vehicle ?? row;
    const vehicleLabel = [detail(vehicleDetails, "marca"), detail(vehicleDetails, "modelo")]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ") || (plate ? `Veículo ${plate}` : "Veículo não informado");
    const statusLabel = isRejected
      ? "Recusado pelo cliente"
      : isPartial
        ? "Aprovado parcialmente"
        : isApproved
          ? "Aprovado pelo cliente"
          : isExpired
            ? "Validade expirada"
            : "Aguardando aprovação";
    const hasGeneratedOrder = Boolean(detail(row, "os_gerada"));
    const showMenu = openQuoteMenuId === row.id;

    return (
      <div
        key={row.id}
        className={`admin-kanban-card admin-workorder-card admin-quote-board-card ${showMenu ? "has-open-menu" : ""}`}
        {...cardDragProps(row)}
      >
        <div className="admin-workorder-card-head">
          <span
            className="admin-workorder-eyebrow admin-workorder-touch-handle"
            title="Toque e arraste para mover o orçamento"
            {...handleTouchProps(row)}
          >
            Orçamento
          </span>
          <div className="admin-workorder-actions" data-quote-actions>
            <span
              className="admin-drag-handle"
              title="Arrastar orçamento"
              {...handleTouchProps(row)}
            >
              <GripVertical size={14} />
            </span>
            <button
              type="button"
              className="admin-icon-btn admin-workorder-more"
              aria-label={`Ações do orçamento ${row.title}`}
              aria-haspopup="menu"
              aria-expanded={showMenu}
              onClick={(event) => {
                if (showMenu) {
                  setOpenQuoteMenuId(null);
                  setQuoteMenuPosition(null);
                  return;
                }
                const trigger = event.currentTarget.getBoundingClientRect();
                const spaceBelow = window.innerHeight - trigger.bottom;
                const spaceAbove = trigger.top;
                const placement = spaceBelow >= 220 || spaceBelow >= spaceAbove ? "below" : "above";
                setQuoteMenuPlacement(placement);
                setQuoteMenuPosition({
                  top: placement === "below" ? trigger.bottom + 7 : trigger.top - 7,
                  right: Math.max(8, window.innerWidth - trigger.right),
                });
                setOpenQuoteMenuId(row.id);
              }}
            >
              <MoreHorizontal size={17} />
            </button>
          </div>
        </div>

        {showMenu && quoteMenuPosition && typeof document !== "undefined" && createPortal(
          <div
            className="admin-appointment-actions-menu admin-workorder-actions-menu admin-quote-actions-menu"
            data-quote-menu
            data-placement={quoteMenuPlacement}
            role="menu"
            aria-label="Ações do orçamento"
            style={{
              position: "fixed",
              top: quoteMenuPosition.top,
              right: quoteMenuPosition.right,
              bottom: "auto",
              zIndex: 10000,
              transform: quoteMenuPlacement === "above" ? "translateY(-100%)" : undefined,
            }}
          >
            <button type="button" role="menuitem" onClick={() => { setOpenQuoteMenuId(null); setQuoteMenuPosition(null); void copyPublicLink(row); }}>
              <Link2 size={15} /> Copiar link
            </button>
            {!isApproved && !isRejected && !isExpired && (
              <>
                <button type="button" role="menuitem" onClick={() => { setOpenQuoteMenuId(null); setQuoteMenuPosition(null); void approveQuote(row); }}>
                  <CheckCircle2 size={15} /> Marcar como aprovado
                </button>
                <button type="button" role="menuitem" onClick={() => { setOpenQuoteMenuId(null); setQuoteMenuPosition(null); void rejectQuote(row); }}>
                  <XCircle size={15} /> Marcar como recusado
                </button>
              </>
            )}
            <div className="admin-appointment-actions-divider" role="separator" />
            <button type="button" role="menuitem" onClick={() => { setOpenQuoteMenuId(null); setQuoteMenuPosition(null); openEdit(row); }}>
              <Pencil size={15} /> Editar orçamento
            </button>
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => { setOpenQuoteMenuId(null); setQuoteMenuPosition(null); void removeRecord(row); }}
            >
              <Trash2 size={15} /> Excluir orçamento
            </button>
          </div>,
          document.querySelector(".admin-root") ?? document.body,
        )}

        <div className="admin-workorder-vehicle">
          {plate && (
            <div className="mercosul-plate admin-workorder-plate">
              <div className="mercosul-plate-top">BRASIL</div>
              <div className="mercosul-plate-code">{plate}</div>
            </div>
          )}
          <div className="admin-workorder-vehicle-copy">
            <strong>{asText(row.customer_name) || "Cliente não informado"}</strong>
            <span>{vehicleLabel}</span>
          </div>
        </div>

        <div className="admin-workorder-service admin-quote-service">
          <strong>{displayQuoteTitle(row.title) || "Proposta"}</strong>
          <span className={`admin-quote-approval ${isRejected ? "is-rejected" : isPartial || isApproved ? "is-approved" : isExpired ? "is-expired" : "is-pending"}`}>
            {isRejected || isExpired ? <XCircle size={12} aria-hidden="true" /> : isApproved ? <CheckCircle2 size={12} aria-hidden="true" /> : <Clock3 size={12} aria-hidden="true" />}
            {statusLabel}
          </span>
          {isPartial && (
            <small className="admin-quote-approved-count">{approvedItems.length} de {items.length} itens aprovados</small>
          )}
        </div>

        <div className="admin-quote-price-row">
          <div className="admin-quote-price-approved">
            <span>{isApproved ? "Valor aprovado" : "Valor total"}</span>
            <strong>{Number(row.amount) > 0 ? money(row.amount) : "A definir"}</strong>
          </div>
          <div className="admin-quote-validity">
            <span>Válido até</span>
            <strong>{validity ? dateText(validity) : "—"}</strong>
          </div>
        </div>

        <div className="admin-workorder-card-footer admin-quote-card-footer">
          <button
            type="button"
            className="admin-icon-btn admin-workorder-whatsapp"
            aria-label="Enviar orçamento pelo WhatsApp"
            title="WhatsApp"
            onClick={() => void sendQuoteWhatsApp(row)}
          >
            <MessageCircle size={14} />
          </button>
          <button
            type="button"
            className="admin-icon-btn admin-workorder-whatsapp admin-quote-sheet-link"
            aria-label="Abrir ficha online"
            title="Ficha online"
            onClick={() => void openPublicSheet(row)}
          >
            <ExternalLink size={14} />
          </button>
          <button
            type="button"
            className="admin-workorder-advance admin-quote-primary-action"
            disabled={isApproved && !isPartial && hasGeneratedOrder}
            onClick={() => {
              if (isExpired) void renewQuoteValidity(row);
              else if (isRejected) reviewQuote(row);
              else if (isPartial) setApprovedItemsQuote(row);
              else if (isApproved) void convertQuoteToOs(row);
              else void sendQuoteWhatsApp(row);
            }}
          >
            {isRejected ? (
              <><Pencil size={14} /> Revisar orçamento</>
            ) : isExpired ? (
              <><Clock3 size={14} /> Renovar validade</>
            ) : isPartial ? (
              <><CheckCircle2 size={14} /> Ver itens aprovados</>
            ) : isApproved ? (
              hasGeneratedOrder ? "OS gerada" : <><Wrench size={14} /> Gerar ordem de serviço <span aria-hidden="true">→</span></>
            ) : (
              <><MessageCircle size={14} /> Enviar ao cliente</>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <h1>Orçamentos</h1>
        </div>
        <div className="admin-title-actions">
          <button type="button" className="admin-primary" onClick={openCreate}>
            <Plus size={16} /> Novo orçamento
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-form-error" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-form-success" style={{ marginBottom: 16 }}>
          {notice}
        </p>
      )}

      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            className="admin-search"
            placeholder="Buscar por título, cliente ou placa..."
            value={query}
            onChange={(e) => setQuery(e.target.value)} id="admin-views-quotesview-527"
          />
        </div>

        <div className="admin-filter-pills admin-toolbar-right" title="Formato da mensagem ao clicar em WhatsApp">
          <span style={{ fontSize: 12, color: "var(--admin-muted)", paddingRight: 4, alignSelf: "center" }}>
            WhatsApp:
          </span>
          <button
            type="button"
            className={`admin-pill ${waMode === "confirm" ? "active" : ""}`}
            onClick={() => setWaMode("confirm")}
          >
            Pedir confirmação
          </button>
          <button
            type="button"
            className={`admin-pill ${waMode === "link" ? "active" : ""}`}
            onClick={() => setWaMode("link")}
          >
            Mandar com link
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonKanban columns={3} />
      ) : (
        <div className="admin-kanban admin-quote-board admin-data-enter">
          {quoteLaneSummaries.map((summary) => {
            const lane = QUOTE_LANES.find((item) => item.key === summary.key);
            if (!lane) return null;
            const laneRows = filtered.filter((row) =>
              (lane.statuses as readonly string[]).includes(row.status),
            );

            return (
              <section
                key={lane.key}
                className={`admin-lane admin-quote-lane admin-quote-status-card-${lane.key} ${dragOverLane === lane.key ? "drag-over" : ""}`}
                {...laneDropProps(lane.key)}
              >
                <div className="admin-lane-head admin-quote-board-head">
                  <span className="admin-quote-status-card-label">
                    <span className="admin-quote-status-dot" aria-hidden="true" />
                    {summary.label}
                  </span>
                  <span className="admin-lane-count">{summary.count}</span>
                </div>
                <div className="admin-quote-status-card-amount">{money(summary.amount)}</div>
                <div className="admin-quote-board-cards">
                  {laneRows.length === 0 ? (
                    <div className="admin-quote-board-empty">Sem orçamentos</div>
                  ) : (
                    laneRows.map(renderQuoteCard)
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {touchGhost && (
        <div className="admin-drag-ghost" style={{ left: touchGhost.x, top: touchGhost.y }}>
          {touchGhost.label}
        </div>
      )}

      {approvedItemsQuote && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setApprovedItemsQuote(null))}>
          <section className="admin-modal admin-quote-approved-items-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>Itens aprovados</h2>
                <p>{approvedItemsQuote.title}</p>
              </div>
              <button type="button" className="admin-icon-btn" aria-label="Fechar" onClick={() => setApprovedItemsQuote(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="admin-quote-approved-items-list">
              {quoteItemsForRow(approvedItemsQuote).filter((item) => item.approved !== false).length > 0 ? (
                quoteItemsForRow(approvedItemsQuote).filter((item) => item.approved !== false).map((item) => (
                  <div className="admin-quote-approved-item-row" key={item.id}>
                    <span>{item.qty} × {item.name}</span>
                    <strong>{money(item.qty * item.unit_price)}</strong>
                  </div>
                ))
              ) : (
                <p className="admin-quote-approved-items-empty">Não há itens aprovados registrados.</p>
              )}
            </div>
            <div className="admin-quote-approved-total">
              <span>Valor aprovado</span>
              <strong>{Number(approvedItemsQuote.amount) > 0 ? money(approvedItemsQuote.amount) : "A definir"}</strong>
            </div>
            <div className="admin-modal-actions">
              <button type="button" className="admin-secondary" onClick={() => setApprovedItemsQuote(null)}>Fechar</button>
            </div>
          </section>
        </div>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className="admin-modal admin-quote-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar orçamento" : "Novo orçamento"}</h2>
                <p>Defina os serviços, peças e condições do orçamento.</p>
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

            <form className="admin-quote-form" onSubmit={(e) => void handleSubmit(e)}>
              <div className="admin-quote-grid">
                <h3 className="admin-quote-section is-first">Informações gerais</h3>
                <div className="admin-field wide">
                  <label htmlFor="quote-title">Título do orçamento *</label>
                  <input
                    id="quote-title"
                    className="admin-input"
                    required
                    placeholder="Ex: Troca de embreagem e retífica do volante"
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value, service_id: "", pricing_mode: "", pricing_rule_id: "" }))}
                  />
                </div>

                <div className="admin-field">
                  <label htmlFor="quote-client">Cliente</label>
                  {!customClient && clients.length > 0 ? (
                    <ClientPicker
                      id="quote-client"
                      clients={clients}
                      value={form.customer_name}
                      placeholder="Buscar cliente..."
                      onSelectClient={(picked) => {
                        if (!picked) {
                          setForm((prev) => ({ ...prev, customer_name: "" }));
                          return;
                        }
                        setCustomClient(false);
                        const name = clientDisplayName(picked);
                        const matchVeh = vehicles.find((v) => (v.customer_name ?? "").trim().toLowerCase() === name.toLowerCase());
                        setForm((prev) => ({
                          ...prev,
                          customer_name: name,
                          phone: picked.phone ?? prev.phone,
                          ...(matchVeh && !prev.vehicle ? vehicleFormPatch(prev, vehiclePlate(matchVeh), matchVeh) : {}),
                        }));
                      }}
                    />
                  ) : (
                    <input
                      id="quote-client"
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
                    <button type="button" className="admin-quote-link" onClick={() => setCustomClient((value) => !value)}>
                      {customClient ? "+ Buscar cliente salvo" : "+ Novo cliente"}
                    </button>
                  )}
                </div>

                <div className="admin-field">
                  <label htmlFor="quote-phone">Telefone</label>
                  <input
                    id="quote-phone"
                    className="admin-input"
                    type="tel"
                    placeholder="(51) 99999-9999"
                    value={form.phone}
                    onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                </div>

                <div className="admin-field">
                  <label htmlFor="quote-vehicle">Veículo / placa</label>
                  {!customVehicle && vehicles.length > 0 ? (
                    <VehiclePicker
                      id="quote-vehicle"
                      vehicles={vehicles}
                      value={form.vehicle}
                      clientName={form.customer_name}
                      placeholder="Buscar veículo..."
                      onSelectVehicle={(picked) => {
                        if (!picked) { applySelectedVehicle(null); return; }
                        setCustomVehicle(false);
                        const ownerName = (picked.customer_name ?? "").trim();
                        const ownerClient = ownerName
                          ? clients.find((client) => clientDisplayName(client).toLowerCase() === ownerName.toLowerCase())
                          : undefined;
                        setForm((prev) => ({
                          ...prev,
                          ...vehicleFormPatch(prev, vehiclePlate(picked), picked),
                          customer_name: prev.customer_name || ownerName,
                          phone: prev.phone || ownerClient?.phone || "",
                        }));
                      }}
                    />
                  ) : (
                    <input
                      id="quote-vehicle"
                      className="admin-input"
                      placeholder="Informe a placa"
                      value={form.vehicle}
                      onChange={(e) => {
                        setCustomVehicle(true);
                        setForm((prev) => ({ ...prev, ...vehicleFormPatch(prev, e.target.value) }));
                      }}
                    />
                  )}
                  {vehicles.length > 0 && (
                    <button type="button" className="admin-quote-link" onClick={() => setCustomVehicle((value) => !value)}>
                      {customVehicle ? "+ Buscar veículo salvo" : "+ Novo veículo"}
                    </button>
                  )}
                </div>

                <div className="admin-field">
                  <label htmlFor="quote-validity">Válido até</label>
                  <input
                    id="quote-validity"
                    type="date"
                    className="admin-input"
                    value={form.validade}
                    onChange={(e) => setForm((prev) => ({ ...prev, validade: e.target.value }))}
                  />
                </div>

                <div className="admin-quote-items-heading">
                  <h3 className="admin-quote-section">Itens do orçamento</h3>
                  <div className="admin-quote-add-actions">
                    <button type="button" className="admin-secondary" onClick={() => addLineItem("servico")}><Plus size={12} /> Serviço</button>
                    <button type="button" className="admin-secondary" onClick={() => addLineItem("peca")}><Plus size={12} /> Peça</button>
                  </div>
                </div>

                <div className="admin-field wide admin-quote-items-field">
                  <div className="admin-quote-item-table">
                    <div className="admin-quote-item-header" aria-hidden="true">
                      <span>Descrição</span><span>Qtd.</span><span>Valor unitário</span><span>Total</span><span />
                    </div>
                    {form.items.length > 0 ? form.items.map((item) => (
                      <div className="admin-quote-item-row" key={item.id}>
                        <div className="admin-quote-item-description">
                          {item.type === "servico" && services.length > 0 && (
                            <ServicePicker
                              id={`quote-service-${item.id}`}
                              services={services}
                              priceRules={priceRules}
                              value={item.name}
                              vehicleProfile={serviceVehicleProfile}
                              placeholder="Selecionar serviço"
                              onSelectService={(picked, resolution) => updateLineItem(item.id, picked
                                ? {
                                    service_id: picked.id,
                                    pricing_mode: resolution?.mode,
                                    price_pending: resolution?.amount === null || !resolution,
                                    name: picked.title,
                                    unit_price: resolution?.amount ?? 0,
                                  }
                                : { service_id: "", pricing_mode: undefined, price_pending: false })}
                            />
                          )}
                          <input
                            id={`quote-item-description-${item.id}`}
                            className="admin-input"
                            aria-label={`Descrição do item ${item.type === "peca" ? "peça" : "serviço"}`}
                            placeholder={item.type === "peca" ? "Nome da peça" : "Nome do serviço"}
                            value={item.name}
                            onChange={(e) => updateLineItem(item.id, { name: e.target.value, service_id: "", pricing_mode: undefined })}
                          />
                          <small>{item.type === "peca" ? "Peça" : "Serviço"}</small>
                        </div>
                        <div className="admin-quote-item-cell">
                          <small>Qtd.</small>
                          <input
                            id={`quote-item-quantity-${item.id}`}
                            className="admin-input admin-quote-item-quantity"
                            aria-label="Quantidade"
                            type="number"
                            min={1}
                            value={item.qty}
                            onChange={(e) => updateLineItem(item.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                          />
                        </div>
                        <div className="admin-quote-item-cell">
                          <small>Unitário</small>
                          <input
                            id={`quote-item-price-${item.id}`}
                            className="admin-input admin-quote-item-price"
                            aria-label="Valor unitário em reais"
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="R$ 0,00"
                            value={item.unit_price || ""}
                            onChange={(e) => updateLineItem(item.id, { unit_price: Math.max(0, Number(e.target.value) || 0) })}
                          />
                        </div>
                        <div className="admin-quote-item-cell admin-quote-item-total-cell">
                          <small>Total</small>
                          <strong className="admin-quote-item-total">{money(item.qty * item.unit_price)}</strong>
                        </div>
                        <button
                          type="button"
                          className="admin-quote-remove-item"
                          aria-label={`Remover ${item.name || "item"}`}
                          onClick={() => removeLineItem(item.id)}
                        ><Trash2 size={13} /></button>
                      </div>
                    )) : (
                      <div className="admin-quote-empty-items">Adicione serviços ou peças ao orçamento.</div>
                    )}
                  </div>
                  <label className="admin-quote-partial-option">
                    <input
                      type="checkbox"
                      checked={form.allow_partial_approval}
                      onChange={(e) => setForm((prev) => ({ ...prev, allow_partial_approval: e.target.checked }))}
                    />
                    Permitir aprovação parcial dos itens
                  </label>
                </div>

                <h3 className="admin-quote-section">Condições comerciais</h3>
                <div className="admin-quote-commercial">
                  <div className="admin-quote-commercial-fields">
                    <div className="admin-field">
                      <label htmlFor="quote-discount">Desconto</label>
                      <div className="admin-quote-discount-control">
                        <input
                          id="quote-discount"
                          className="admin-input"
                          type="number"
                          min={0}
                          max={form.discount_type === "percentual" ? 100 : undefined}
                          step="0.01"
                          value={form.discount_value}
                          onChange={(e) => setForm((prev) => ({ ...prev, discount_value: e.target.value }))}
                        />
                        <select
                          className="admin-select"
                          aria-label="Tipo de desconto"
                          value={form.discount_type}
                          onChange={(e) => setForm((prev) => ({ ...prev, discount_type: e.target.value === "fixo" ? "fixo" : "percentual" }))}
                        >
                          <option value="percentual">%</option>
                          <option value="fixo">R$</option>
                        </select>
                      </div>
                    </div>
                    <div className="admin-field">
                      <label htmlFor="quote-payment-method">Forma de pagamento</label>
                      <select
                        id="quote-payment-method"
                        className="admin-select"
                        value={form.payment_method}
                        onChange={(e) => setForm((prev) => ({ ...prev, payment_method: e.target.value }))}
                      >
                        <option>A combinar</option>
                        <option>À vista</option>
                        <option>Pix</option>
                        <option>Cartão de débito</option>
                        <option>Cartão de crédito</option>
                        <option>Parcelado</option>
                      </select>
                    </div>
                  </div>
                  <div className="admin-quote-summary" aria-live="polite">
                    <div><span>Serviços</span><strong>{money(quoteServicesSubtotal)}</strong></div>
                    <div><span>Peças</span><strong>{money(quotePartsSubtotal)}</strong></div>
                    <div><span>Desconto</span><strong>− {money(quoteDiscount)}</strong></div>
                    <div className="admin-quote-summary-total"><span>Valor total</span><strong>{money(quoteTotal)}</strong></div>
                  </div>
                </div>

                <div className="admin-field wide">
                  <div className="admin-quote-observations-label">
                    <label htmlFor="quote-description">Observações e condições</label>
                    <small>Opcional</small>
                  </div>
                  <textarea
                    id="quote-description"
                    className="admin-textarea"
                    rows={3}
                    placeholder="Prazo de execução, garantia e condições adicionais..."
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  />
                </div>
              </div>

              <div className="admin-modal-actions admin-quote-modal-actions">
                <div className="admin-quote-final-amount"><span>Valor do orçamento</span><strong>{money(quoteTotal)}</strong></div>
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={() => setModalOpen(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="admin-primary" disabled={saving}>
                  {saving ? "Salvando..." : editing ? "Salvar alterações" : "Criar orçamento"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
