"use client";

import { SkeletonKanban } from "../Skeletons";
import { useMemo, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  ExternalLink,
  GripVertical,
  Link2,
  MessageCircle,
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
import { AdminStatusBadge } from "../StatusBadge";
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
});

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
  const [notice, setNotice] = useState("");
  const [waMode, setWaMode] = useState<"confirm" | "link">("confirm");

  const serviceVehicleProfile = mergeVehiclePriceProfile(
    vehicles.find((vehicle) => vehiclePlate(vehicle) === form.vehicle.trim().toUpperCase()),
    { make: form.vehicle_make, model: form.vehicle_model, year: form.vehicle_year },
  );
  const currentService = services.find((service) => service.id === form.service_id)
    ?? services.find((service) => service.title.trim().toLowerCase() === form.title.trim().toLowerCase())
    ?? null;

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

  function serviceTitlePatch(previous: FormState, title: string) {
    const service = services.find((item) => item.title.trim().toLowerCase() === title.trim().toLowerCase()) ?? null;
    if (!service) {
      return {
        ...previous,
        title,
        service_id: "",
        pricing_mode: "",
        pricing_rule_id: "",
        amount: previous.pricing_mode === "vehicle" ? "" : previous.amount,
      };
    }
    const profile = mergeVehiclePriceProfile(
      vehicles.find((vehicle) => vehiclePlate(vehicle) === previous.vehicle.trim().toUpperCase()),
      { make: previous.vehicle_make, model: previous.vehicle_model, year: previous.vehicle_year },
    );
    const resolution = resolveServicePrice(service, priceRules, profile);
    return {
      ...previous,
      title,
      service_id: service.id,
      pricing_mode: resolution.mode,
      pricing_rule_id: resolution.rule?.id ?? "",
      amount: resolution.amount === null ? "" : String(resolution.amount),
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
    setNotice(
      `Orçamento "${row.title}" aprovado. Clique em "Gerar OS" quando o veículo entrar na oficina.`,
    );
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

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    setEditing(row);
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
    setForm({
      title: row.title ?? "",
      customer_name: row.customer_name ?? "",
      phone: row.phone ?? "",
      vehicle: row.vehicle ?? "",
      amount: row.amount !== null && row.amount !== undefined ? String(row.amount) : "",
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
    });
    setModalOpen(true);
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
      const sum = nextItems.reduce((acc, it) => acc + it.qty * it.unit_price, 0);
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
      const sum = nextItems.reduce((acc, it) => acc + it.qty * it.unit_price, 0);
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
      await saveRecord(editing, {
        title: form.title.trim(),
        customer_name: form.customer_name.trim() || null,
        phone: form.phone.trim() || null,
        vehicle: form.vehicle.trim().toUpperCase() || null,
        amount: form.amount.trim() ? Number(form.amount.replace(",", ".")) : null,
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
          price_pending: !(Number(form.amount) > 0),
        },
      });
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
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar orçamento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">PROPOSTAS COMERCIAIS</p>
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
        <div className="admin-kanban admin-data-enter">
          {QUOTE_LANES.map((lane) => {
            const laneRows = filtered.filter((r) =>
              (lane.statuses as readonly string[]).includes(r.status),
            );
            return (
              <div
                key={lane.key}
                className={`admin-lane ${dragOverLane === lane.key ? "drag-over" : ""}`}
                {...laneDropProps(lane.key)}
              >
                <div className="admin-lane-head">
                  <span>{lane.label}</span>
                  <span className="admin-lane-count">{laneRows.length}</span>
                </div>

                {laneRows.length === 0 ? (
                  <div className="admin-empty" style={{ padding: "24px 12px" }}>
                    Sem orçamentos
                  </div>
                ) : (
                  laneRows.map((row) => {
                    const aprovacao = String(detail(row, "aprovacao") ?? "pendente");
                    const isApproved = aprovacao === "aprovado";
                    const isRejected = aprovacao === "recusado" || row.status === "cancelado";
                    return (
                    <div
                      key={row.id}
                      className={`admin-kanban-card ${draggingId === row.id ? "dragging" : ""}`}
                      {...cardDragProps(row)}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          flexWrap: "wrap",
                          gap: 8,
                        }}
                      >
                        <strong style={{ fontSize: 14, lineHeight: 1.3, minWidth: 0, wordBreak: "break-word" }}>
                          {row.title}
                        </strong>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <span
                            className="admin-drag-handle"
                            title="Arrastar orçamento"
                            {...handleTouchProps(row)}
                          >
                            <GripVertical size={14} />
                          </span>
                          <AdminStatusBadge
                            status={isApproved ? "concluido" : isRejected ? "cancelado" : "aguardando"}
                            label={isApproved ? "Aprovado" : isRejected ? "Recusado" : "Aguardando"}
                          />
                        </div>
                      </div>

                      <div style={{ fontSize: 12.5, color: "var(--admin-muted)", display: "grid", gap: 3 }}>
                        <span>Cliente: {asText(row.customer_name)}</span>
                        <span>Veículo: {asText(row.vehicle)}</span>
                        <span>Validade: {dateText(detail(row, "validade"))}</span>
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <button
                          type="button"
                          className="admin-secondary"
                          style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5 }}
                          onClick={() => void sendQuoteWhatsApp(row)}
                          title="Enviar orçamento e link da ficha pelo WhatsApp"
                        >
                          <MessageCircle size={12} /> WhatsApp
                        </button>
                        <button
                          type="button"
                          className="admin-secondary"
                          style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5 }}
                          onClick={() => void openPublicSheet(row)}
                          title="Abrir ficha online do cliente"
                        >
                          <ExternalLink size={12} /> Ficha Online
                        </button>
                        <button
                          type="button"
                          className="admin-secondary"
                          style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5 }}
                          onClick={() => void copyPublicLink(row)}
                          title="Copiar link da ficha online"
                        >
                          <Link2 size={12} /> Copiar Link
                        </button>
                        {!isApproved && !isRejected && (
                          <button
                            type="button"
                            className="admin-secondary"
                            style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5, color: "#22c55e" }}
                            onClick={() => void approveQuote(row)}
                          >
                            <CheckCircle2 size={12} /> Aprovar
                          </button>
                        )}
                        {!isApproved && !isRejected && (
                          <button
                            type="button"
                            className="admin-secondary"
                            style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5, color: "#ef4444" }}
                            onClick={() => void rejectQuote(row)}
                          >
                            <XCircle size={12} /> Recusar
                          </button>
                        )}
                        {isApproved && !detail(row, "os_gerada") && (
                          <button
                            type="button"
                            className="admin-secondary"
                            style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5 }}
                            onClick={() => void convertQuoteToOs(row)}
                          >
                            <Wrench size={12} /> Gerar OS
                          </button>
                        )}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          paddingTop: 8,
                          borderTop: "1px solid var(--admin-line)",
                          gap: 8,
                        }}
                      >
                        <strong style={{ fontSize: 13.5 }}>{Number(row.amount) > 0 ? money(row.amount) : "A definir"}</strong>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button
                            type="button"
                            className="admin-icon-btn"
                            title="Editar orçamento"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="admin-ghost-danger"
                            title="Remover orçamento"
                            onClick={() => void removeRecord(row)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}

      {touchGhost && (
        <div className="admin-drag-ghost" style={{ left: touchGhost.x, top: touchGhost.y }}>
          {touchGhost.label}
        </div>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar Orçamento" : "Novo Orçamento"}</h2>
                <p>Informe valores, prazo de validade e descrição dos serviços.</p>
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

            <form onSubmit={(e) => void handleSubmit(e)}>
              <div className="admin-form-grid">
                <div className="admin-field wide">
                  <label>Título do orçamento *</label>
                  <ServicePicker
                    services={services}
                    priceRules={priceRules}
                    value={form.title}
                    vehicleProfile={serviceVehicleProfile}
                    onSelectService={(picked, resolution) => {
                      if (!picked) {
                        setForm((prev) => serviceTitlePatch(prev, ""));
                        return;
                      }
                      setForm((prev) => ({
                        ...prev,
                        service_id: picked.id,
                        pricing_mode: resolution?.mode ?? "",
                        pricing_rule_id: resolution?.rule?.id ?? "",
                        title: picked.title,
                        amount: resolution?.amount === null || !resolution ? "" : String(resolution.amount),
                        description: prev.description || picked.description || "",
                      }));
                    }}
                  />
                  <input
                    className="admin-input"
                    required
                    placeholder="Ex: Troca de embreagem + retífica do volante"
                    value={form.title}
                    onChange={(e) => setForm((prev) => serviceTitlePatch(prev, e.target.value))} id="admin-views-quotesview-773"
                  />
                </div>

                <div className="admin-field">
                  <label>Cliente</label>
                  <ClientPicker
                    clients={clients}
                    value={form.customer_name}
                    onSelectClient={(picked) => {
                      if (!picked) {
                        setForm({ ...form, customer_name: "" });
                        return;
                      }
                      const name = clientDisplayName(picked);
                      const matchVeh = vehicles.find(
                        (v) => (v.customer_name ?? "").trim().toLowerCase() === name.toLowerCase(),
                      );
                      setForm((prev) => ({
                        ...prev,
                        customer_name: name,
                        phone: picked.phone ?? prev.phone,
                        ...(matchVeh && !prev.vehicle ? vehicleFormPatch(prev, vehiclePlate(matchVeh), matchVeh) : {}),
                      }));
                    }}
                  />
                  <input
                    className="admin-input"
                    placeholder="Nome do cliente"
                    value={form.customer_name}
                    onChange={(e) => setForm({ ...form, customer_name: e.target.value })} id="admin-views-quotesview-804"
                  />
                </div>

                <div className="admin-field">
                  <label>Veículo / Placa</label>
                  <VehiclePicker
                    vehicles={vehicles}
                    value={form.vehicle}
                    clientName={form.customer_name}
                    onSelectVehicle={(picked) => {
                      if (!picked) { applySelectedVehicle(null); return; }
                      const ownerName = (picked.customer_name ?? "").trim();
                      const ownerClient = ownerName
                        ? clients.find(
                            (c) => clientDisplayName(c).toLowerCase() === ownerName.toLowerCase(),
                          )
                        : undefined;
                      setForm((prev) => ({
                        ...prev,
                        ...vehicleFormPatch(prev, vehiclePlate(picked), picked),
                        customer_name: form.customer_name || ownerName,
                        phone: form.phone || ownerClient?.phone || "",
                      }));
                    }}
                  />
                  <input
                    className="admin-input"
                    placeholder="ABC1D23"
                    value={form.vehicle}
                    onChange={(e) => setForm((prev) => ({ ...prev, ...vehicleFormPatch(prev, e.target.value) }))} id="admin-views-quotesview-834"
                  />
                </div>

                <div className="admin-field wide">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <label style={{ margin: 0 }}>Itens do orçamento (permite aprovação parcial)</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="admin-secondary"
                        style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5 }}
                        onClick={() => addLineItem("servico")}
                      >
                        <Plus size={12} /> Serviço
                      </button>
                      <button
                        type="button"
                        className="admin-secondary"
                        style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5 }}
                        onClick={() => addLineItem("peca")}
                      >
                        <Plus size={12} /> Peça
                      </button>
                    </div>
                  </div>
                  {form.items.length > 0 && (
                    <div style={{ display: "grid", gap: 8, marginBottom: 6 }}>
                      {form.items.map((item) => (
                        <div
                          key={item.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "92px 1fr 64px 104px 32px",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <select
                            className="admin-select"
                            id={`admin-quote-item-type-${item.id}`}
                            style={{ minHeight: 36, padding: "6px 8px", fontSize: 12 }}
                            value={item.type}
                            onChange={(e) =>
                              updateLineItem(item.id, {
                                type: e.target.value === "peca" ? "peca" : "servico",
                              })
                            }
                          >
                            <option value="servico">Serviço</option>
                            <option value="peca">Peça</option>
                          </select>
                          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                            {item.type === "servico" && (
                              <ServicePicker
                                services={services}
                                priceRules={priceRules}
                                value={item.name}
                                vehicleProfile={serviceVehicleProfile}
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
                              className="admin-input"
                              id={`admin-quote-item-description-${item.id}`}
                              style={{ minHeight: 36, padding: "6px 10px", fontSize: 12.5 }}
                              placeholder="Descrição do item"
                              value={item.name}
                              onChange={(e) => updateLineItem(item.id, { name: e.target.value, service_id: "", pricing_mode: undefined })}
                            />
                          </div>
                          <input
                            type="number"
                            min={1}
                            id={`admin-quote-item-quantity-${item.id}`}
                            className="admin-input"
                            style={{ minHeight: 36, padding: "6px 8px", fontSize: 12.5 }}
                            value={item.qty}
                            onChange={(e) =>
                              updateLineItem(item.id, { qty: Math.max(1, Number(e.target.value) || 1) })
                            }
                          />
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            id={`admin-quote-item-price-${item.id}`}
                            className="admin-input"
                            style={{ minHeight: 36, padding: "6px 8px", fontSize: 12.5 }}
                            placeholder="R$"
                            value={item.unit_price || ""}
                            onChange={(e) =>
                              updateLineItem(item.id, {
                                unit_price: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                          />
                          <button
                            type="button"
                            className="admin-ghost-danger"
                            onClick={() => removeLineItem(item.id)}
                            title="Remover item"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  className="admin-field wide"
                  style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}
                >
                  <div className="admin-field">
                    <label>Telefone</label>
                    <input
                      className="admin-input"
                      placeholder="(11) 99999-9999"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })} id="admin-views-quotesview-959"
                    />
                  </div>
                  <div className="admin-field">
                    <label>Valor (R$)</label>
                    <input
                      className="admin-input"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0,00"
                      value={form.amount}
                      onChange={(e) => setForm({ ...form, amount: e.target.value })} id="admin-views-quotesview-968"
                    />
                  </div>
                  <div className="admin-field">
                    <label>Validade</label>
                    <input
                      type="date"
                      className="admin-input"
                      value={form.validade}
                      onChange={(e) => setForm({ ...form, validade: e.target.value })} id="admin-views-quotesview-980"
                    />
                  </div>
                </div>

                <div className="admin-field wide">
                  <label>Descrição / Peças e Mão de Obra</label>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    placeholder="Detalhe peças, serviços inclusos e condições..."
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })} id="admin-views-quotesview-991"
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
