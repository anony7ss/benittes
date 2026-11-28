"use client";

import { SkeletonKanban } from "../Skeletons";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, ArrowRight, CheckCircle2, ClipboardList, Clock3, ExternalLink, Eye, MessageCircle, MoreHorizontal, Package, Pencil, Plus, Search, Trash2, Tv, X } from "lucide-react";
import type { PanelRecord } from "../../../lib/supabase";
import { selectRows } from "../../../lib/supabase";
import { mergeVehiclePriceProfile, resolveServicePrice } from "../../../lib/servicePricing";
import { AdminActionMenu } from "../ActionMenu";
import { AdminStatusBadge } from "../StatusBadge";
import {
  asText,
  detail,
  money,
  todayIso,
  consumeVehicleActionPrefill,
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

const LANES = [
  { key: "entrada", label: "Entrada", statuses: ["novo"] },
  { key: "no-box", label: "No Box", statuses: ["em_andamento"] },
  { key: "aguardando", label: "Aguardando", statuses: ["aguardando"] },
  { key: "finalizadas", label: "Finalizadas", statuses: ["concluido", "cancelado"] },
] as const;

type PartUsage = {
  id: string;
  nome: string;
  quantidade: number;
  valor_unitario: number;
};

type FormState = {
  title: string;
  customer_name: string;
  phone: string;
  vehicle: string;
  status: string;
  amount: string;
  description: string;
  tecnico: string;
  box: string;
  pecas: PartUsage[];
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
  status: "novo",
  amount: "",
  description: "",
  tecnico: "",
  box: "",
  pecas: [],
  service_id: "",
  pricing_mode: "",
  pricing_rule_id: "",
  vehicle_make: "",
  vehicle_model: "",
  vehicle_year: "",
});

function partsTotal(parts: PartUsage[]): number {
  return parts.reduce((total, part) => {
    const quantity = Math.max(0, Number(part.quantidade) || 0);
    const unitPrice = Math.max(0, Number(part.valor_unitario) || 0);
    return total + quantity * unitPrice;
  }, 0);
}

function amountInput(value: number): string {
  const rounded = Math.max(0, Math.round((value + Number.EPSILON) * 100) / 100);
  return rounded > 0 ? String(rounded) : "";
}

function serviceAndPartsTotal(serviceAmount: number | null, parts: PartUsage[]): string {
  const total = Math.max(0, serviceAmount ?? 0) + partsTotal(parts);
  return total > 0 ? String(Math.round((total + Number.EPSILON) * 100) / 100) : "";
}

export function WorkOrdersView({ session }: { session: { user: { id: string } } }) {
  const { rows, setRows, loading, error, setError, saveRecord, patchRecord, removeRecord } = useModuleRecords(
    "work-orders",
    session.user.id,
  );
  const { rows: inventoryRows } = useModuleRecords("inventory", session.user.id);
  const {
    rows: settingsRows,
    saveRecord: saveSettingsRecord,
  } = useModuleRecords("settings", session.user.id);
  const { clients, vehicles, services, priceRules, loading: catalogLoading, reload: reloadCatalog } = useClientVehicleCatalog();
  const [subPage, setSubPage] = useState<"board" | "archived">("board");
  const [selectedPartId, setSelectedPartId] = useState("");
  const [selectedPartQty, setSelectedPartQty] = useState("1");
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [actionMenuPlacement, setActionMenuPlacement] = useState<"above" | "below">("below");

  useEffect(() => {
    if (!openActionMenuId) return;

    function closeMenuOnOutsideClick(event: PointerEvent) {
      if (!(event.target instanceof Element) || !event.target.closest("[data-workorder-actions]")) {
        setOpenActionMenuId(null);
      }
    }

    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenActionMenuId(null);
    }

    document.addEventListener("pointerdown", closeMenuOnOutsideClick);
    document.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenuOnOutsideClick);
      document.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [openActionMenuId]);

  const osConfigRecord = useMemo(
    () => settingsRows.find((r) => r.title === "__os_config__") ?? null,
    [settingsRows],
  );

  const posFinalizacao = String(
    detail(osConfigRecord ?? ({ details: {} } as PanelRecord), "pos_finalizacao") ?? "manter",
  );

  async function updatePosFinalizacao(nextMode: string) {
    try {
      await saveSettingsRecord(osConfigRecord, {
        title: "__os_config__",
        description: "Comportamento ao finalizar OS",
        status: "ativo",
        details: { pos_finalizacao: nextMode },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar configuração de OS.");
    }
  }

  async function handleFinalizeOrPatch(id: string, updates: Record<string, unknown>) {
    const updated = await patchRecord(id, updates);
    if (updated && detail(updated, "deleted_after_finalize")) {
      setRows((current) => current.filter((r) => r.id !== id));
    }
  }
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [viewing, setViewing] = useState<PanelRecord | null>(null);
  const [viewEvents, setViewEvents] = useState<Array<{ id: string; event_type: string; summary: string; from_status: string | null; to_status: string | null; total: number | null; created_at: string }>>([]);
  const [viewInspections, setViewInspections] = useState<PanelRecord[]>([]);
  const [viewInspectionError, setViewInspectionError] = useState("");
  const [viewMovements, setViewMovements] = useState<Array<{ quantity_delta: number; unit_cost: number; memo: string | null; created_at: string }>>([]);
  const [viewMovementError, setViewMovementError] = useState("");
  const [viewHistoryLoading, setViewHistoryLoading] = useState(false);
  const [viewHistoryError, setViewHistoryError] = useState("");
  const viewRequestRef = useRef(0);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [customService, setCustomService] = useState(false);
  const [customClient, setCustomClient] = useState(false);
  const [customVehicle, setCustomVehicle] = useState(false);

  useEffect(() => {
    if (!viewing?.id) return;
    const requestId = ++viewRequestRef.current;
    setViewHistoryLoading(true);
    setViewHistoryError("");
    void Promise.all([
      selectRows<{ id: string; event_type: string; summary: string; from_status: string | null; to_status: string | null; total: number | null; created_at: string }>("work-order-events", {
        work_order_id: `eq.${viewing.id}`,
        select: "id,event_type,summary,from_status,to_status,total,created_at",
        order: "created_at.desc",
        limit: "100",
      }),
      selectRows<PanelRecord>("inspections", { work_order_id: `eq.${viewing.id}`, order: "created_at.desc", limit: "20" })
        .then((data) => ({ data, error: "" }))
        .catch((reason) => ({ data: [], error: reason instanceof Error ? reason.message : "Sem acesso às vistorias." })),
      selectRows<{ quantity_delta: number; unit_cost: number; memo: string | null; created_at: string }>("inventory-movements", {
        work_order_id: `eq.${viewing.id}`,
        select: "quantity_delta,unit_cost,memo,created_at",
        order: "created_at.desc",
        limit: "100",
      }).then((data) => ({ data, error: "" })).catch((reason) => ({ data: [], error: reason instanceof Error ? reason.message : "Sem acesso ao livro de estoque." })),
    ]).then(([events, inspections, movements]) => {
      if (requestId !== viewRequestRef.current) return;
      setViewEvents(events);
      setViewInspections(inspections.data);
      setViewInspectionError(inspections.error);
      setViewMovements(movements.data);
      setViewMovementError(movements.error);
    }).catch((reason) => {
      if (requestId === viewRequestRef.current) {
        setViewEvents([]);
        setViewInspections([]);
        setViewInspectionError("");
        setViewMovements([]);
        setViewMovementError("");
        setViewHistoryError(reason instanceof Error ? reason.message : "Não foi possível carregar o histórico da OS.");
      }
    }).finally(() => {
      if (requestId === viewRequestRef.current) setViewHistoryLoading(false);
    });
    return () => { viewRequestRef.current += 1; };
  }, [viewing?.id]);

  const serviceVehicleProfile = mergeVehiclePriceProfile(
    vehicles.find((vehicle) => vehiclePlate(vehicle) === form.vehicle.trim().toUpperCase()),
    { make: form.vehicle_make, model: form.vehicle_model, year: form.vehicle_year },
  );

  function workOrderVehiclePatch(previous: FormState, plate: string, picked?: PanelRecord | null, overrides?: { make?: unknown; model?: unknown; year?: unknown }) {
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
      amount: variable ? serviceAndPartsTotal(resolution.amount, previous.pecas) : previous.amount,
      pricing_rule_id: variable ? resolution.rule?.id ?? "" : previous.pricing_rule_id,
    };
  }

  function workOrderServicePatch(previous: FormState, title: string) {
    const service = services.find((item) => item.title.trim().toLowerCase() === title.trim().toLowerCase()) ?? null;
    if (!service) {
      return {
        ...previous,
        title,
        service_id: "",
        pricing_mode: "",
        pricing_rule_id: "",
        amount: previous.pricing_mode ? serviceAndPartsTotal(null, previous.pecas) : previous.amount,
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
      amount: serviceAndPartsTotal(resolution.amount, previous.pecas),
    };
  }

  const vehicleByPlate = useMemo(() => {
    const map = new Map<string, PanelRecord>();
    for (const v of vehicles) {
      const plate = vehiclePlate(v);
      if (plate) map.set(plate, v);
    }
    return map;
  }, [vehicles]);

  function getVehicleLabel(row: PanelRecord) {
    const plate = (row.vehicle ?? "").trim().toUpperCase();
    const matched = plate ? vehicleByPlate.get(plate) : undefined;
    if (matched) {
      const marca = String(detail(matched, "marca") ?? "").trim();
      const modelo = String(detail(matched, "modelo") ?? "").trim();
      const combined = [marca, modelo].filter(Boolean).join(" ").trim();
      if (combined) return combined;
      if (matched.title && matched.title.trim().toUpperCase() !== plate) {
        return matched.title.trim();
      }
    }
    return plate ? `Veículo ${plate}` : row.title;
  }

  const laneTargetStatus: Record<string, string> = {
    entrada: "novo",
    "no-box": "em_andamento",
    aguardando: "aguardando",
    finalizadas: "concluido",
  };

  const { draggingId, dragOverLane, touchGhost, cardDragProps, handleTouchProps, laneDropProps } =
    useKanbanDrag((rowId, laneKey) => {
      const targetStatus = laneTargetStatus[laneKey];
      const row = rows.find((r) => r.id === rowId);
      const lane = LANES.find((l) => l.key === laneKey);
      if (!targetStatus || !row || !lane) return;
      if ((lane.statuses as readonly string[]).includes(row.status)) return;
      void handleFinalizeOrPatch(row.id, { status: targetStatus });
    });

  const activeRows = useMemo(
    () => rows.filter((row) => !detail(row, "archived")),
    [rows],
  );

  const archivedRows = useMemo(
    () => rows.filter((row) => Boolean(detail(row, "archived"))),
    [rows],
  );

  const filtered = useMemo(() => {
    const source = subPage === "archived" ? archivedRows : activeRows;
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter((row) =>
      [row.title, row.vehicle, row.customer_name, detail(row, "tecnico"), detail(row, "box")]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [subPage, activeRows, archivedRows, query]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setCustomService(services.length === 0 && !catalogLoading);
    setCustomClient(clients.length === 0);
    setCustomVehicle(vehicles.length === 0);
    setSelectedPartId("");
    setSelectedPartQty("1");
    setModalOpen(true);
  }

  useEffect(() => {
    const prefill = consumeVehicleActionPrefill();
    if (!prefill) return;
    openCreate();
    setForm((current) => ({
      ...current,
      vehicle: prefill.plate,
      customer_name: prefill.customerName,
      phone: prefill.phone,
      vehicle_make: prefill.make,
      vehicle_model: prefill.model,
      vehicle_year: prefill.year,
    }));
  }, []);

  function openEdit(row: PanelRecord) {
    const rawParts = detail(row, "pecas");
    const parts = Array.isArray(rawParts) ? (rawParts as PartUsage[]) : [];
    const serviceId = String(detail(row, "service_id") ?? "");
    const serviceTitle = (row.title ?? "").trim().toLowerCase();
    const customerName = (row.customer_name ?? "").trim().toLowerCase();
    const vehicle = (row.vehicle ?? "").trim().toUpperCase();
    const selectedService = services.find((service) => service.id === serviceId)
      ?? services.find((service) => service.title.trim().toLowerCase() === serviceTitle)
      ?? null;
    const savedVehicle = vehicles.find((saved) => vehiclePlate(saved) === vehicle) ?? null;
    const serviceProfile = mergeVehiclePriceProfile(savedVehicle, {
      make: detail(row, "marca"),
      model: detail(row, "modelo"),
      year: detail(row, "ano"),
    });
    const resolvedAmount = resolveServicePrice(selectedService, priceRules, serviceProfile).amount;
    const savedAmount = Number(row.amount);
    setCustomService(!services.some((service) => service.id === serviceId || service.title.trim().toLowerCase() === serviceTitle));
    setCustomClient(!clients.some((client) => clientDisplayName(client).toLowerCase() === customerName));
    setCustomVehicle(!vehicles.some((savedVehicle) => vehiclePlate(savedVehicle) === vehicle));
    setEditing(row);
    setForm({
      title: row.title ?? "",
      customer_name: row.customer_name ?? "",
      phone: row.phone ?? "",
      vehicle: row.vehicle ?? "",
      status: row.status ?? "novo",
      amount: savedAmount > 0
        ? String(savedAmount)
        : serviceAndPartsTotal(resolvedAmount, parts),
      description: row.description ?? "",
      tecnico: String(detail(row, "tecnico") ?? ""),
      box: String(detail(row, "box") ?? ""),
      pecas: parts,
      service_id: serviceId || services.find((service) => service.title.trim().toLowerCase() === (row.title ?? "").trim().toLowerCase())?.id || "",
      pricing_mode: String(detail(row, "pricing_mode") ?? ""),
      pricing_rule_id: String(detail(row, "pricing_rule_id") ?? ""),
      vehicle_make: String(detail(row, "marca") ?? ""),
      vehicle_model: String(detail(row, "modelo") ?? ""),
      vehicle_year: String(detail(row, "ano") ?? ""),
    });
    setSelectedPartId("");
    setSelectedPartQty("1");
    setModalOpen(true);
  }

  function addPartToForm() {
    const item = inventoryRows.find((i) => i.id === selectedPartId);
    const qty = Math.max(1, Number(selectedPartQty) || 1);
    if (!item) return;
    const unit = Number(item.amount ?? 0);
    setForm((prev) => {
      const exists = prev.pecas.find((p) => p.id === item.id);
      const nextPecas = exists
        ? prev.pecas.map((p) =>
            p.id === item.id ? { ...p, quantidade: p.quantidade + qty } : p,
          )
        : [
            ...prev.pecas,
            { id: item.id, nome: item.title, quantidade: qty, valor_unitario: unit },
          ];
      return { ...prev, pecas: nextPecas, amount: amountInput(Number(prev.amount) + qty * unit) };
    });
    setSelectedPartId("");
    setSelectedPartQty("1");
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
        status: form.status,
        amount: form.amount.trim() ? Number(form.amount.replace(",", ".")) : null,
        description: form.description.trim() || null,
        details: {
          ...existingDetails,
          tecnico: form.tecnico.trim() || null,
          box: form.box.trim() || null,
          pecas: form.pecas,
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
      setError(reason instanceof Error ? reason.message : "Erro ao salvar ordem de serviço.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <h1>Ordens de Serviço</h1>
        </div>
        <div className="admin-title-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <a href="/tv" target="_blank" rel="noopener noreferrer" className="admin-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
            <Tv size={15} /> Painel TV
          </a>
          <button type="button" className="admin-primary" onClick={openCreate}>
            <Plus size={16} /> Nova OS
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-form-error" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      <div className="admin-toolbar" style={{ flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <div className="admin-search-wrap" style={{ flex: "1 1 260px", maxWidth: 360 }}>
          <Search size={15} />
          <input
            className="admin-search"
            placeholder="Buscar por serviço, placa ou cliente..."
            value={query}
            onChange={(e) => setQuery(e.target.value)} id="admin-views-workordersview-359"
          />
        </div>

        <div className="admin-filter-pills">
          <button
            type="button"
            className={`admin-pill ${subPage === "board" ? "active" : ""}`}
            onClick={() => setSubPage("board")}
          >
            <ClipboardList size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
            Quadro ativo ({activeRows.length})
          </button>
          <button
            type="button"
            className={`admin-pill ${subPage === "archived" ? "active" : ""}`}
            onClick={() => setSubPage("archived")}
          >
            <Archive size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
            Arquivadas ({archivedRows.length})
          </button>
        </div>

        <div className="admin-filter-pills admin-toolbar-right" title="Ação automática ao finalizar uma OS">
          <span style={{ fontSize: 12, color: "var(--admin-muted)", paddingRight: 4, alignSelf: "center" }}>
            Ao finalizar:
          </span>
          {(
            [
              { id: "manter", label: "Manter" },
              { id: "arquivar", label: "Arquivar" },
              { id: "apagar", label: "Apagar" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`admin-pill ${posFinalizacao === opt.id ? "active" : ""}`}
              onClick={() => void updatePosFinalizacao(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {subPage === "archived" ? (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <h2>Ordens de serviço arquivadas ({filtered.length})</h2>
          </div>
          {filtered.length === 0 ? (
            <div className="admin-empty">
              <strong>Nenhuma OS arquivada</strong>
              <p>OS arquivadas manualmente ou automaticamente ao finalizar aparecem aqui.</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Veículo / Placa</th>
                    <th>Serviço</th>
                    <th>Cliente</th>
                    <th>Valor</th>
                    <th>Status</th>
                    <th style={{ width: 72, textAlign: "right" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{getVehicleLabel(row)}</strong>
                        {row.vehicle && (
                          <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>{row.vehicle}</div>
                        )}
                      </td>
                      <td>{row.title}</td>
                      <td>{asText(row.customer_name)}</td>
                      <td><strong>{Number(row.amount) > 0 ? money(row.amount) : "A definir"}</strong></td>
                      <td><AdminStatusBadge status={row.status} /></td>
                      <td>
                        <AdminActionMenu
                          label={`Ações da ordem de serviço ${row.title}`}
                          actions={[
                            { label: "Ver detalhes", icon: <Eye size={14} />, onSelect: () => setViewing(row) },
                            {
                              label: "Restaurar para o quadro",
                              icon: <ArchiveRestore size={14} />,
                              onSelect: () => void patchRecord(row.id, {
                                details: {
                                  ...(row.details && typeof row.details === "object" ? row.details : {}),
                                  archived: false,
                                },
                              }),
                              separatorBefore: true,
                            },
                            { label: "Remover OS", icon: <Trash2 size={14} />, onSelect: () => void removeRecord(row), destructive: true },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : loading ? (
        <SkeletonKanban columns={3} />
      ) : (
        <div className="admin-kanban admin-data-enter">
          {LANES.map((lane) => {
            const laneRows = filtered.filter((r) =>
              (lane.statuses as readonly string[]).includes(r.status),
            );
            const laneTotal = laneRows.reduce((sum, row) => {
              const amount = Number(row.amount);
              return sum + (Number.isFinite(amount) ? Math.max(0, amount) : 0);
            }, 0);
            return (
              <div
                key={lane.key}
                className={`admin-lane admin-workorder-lane ${dragOverLane === lane.key ? "drag-over" : ""}`}
                {...laneDropProps(lane.key)}
              >
                <div className="admin-lane-head admin-workorder-lane-head">
                  <span className="admin-workorder-lane-label">
                    <span className={`admin-workorder-lane-indicator ${lane.key}`} aria-hidden="true" />
                    {lane.label}
                  </span>
                  <span className="admin-lane-count">{laneRows.length}</span>
                </div>
                <div className="admin-quote-status-card-amount">{money(laneTotal)}</div>

                {laneRows.length === 0 ? (
                  <div className="admin-empty" style={{ padding: "24px 12px" }}>
                    Nenhuma OS nesta etapa
                  </div>
                ) : (
                  laneRows.map((row) => {
                    const aprovacao = String(detail(row, "aprovacao") ?? "pendente");
                    const isApproved = aprovacao === "aprovado";
                    const existingDetails =
                      row.details && typeof row.details === "object" ? row.details : {};
                    const plate = (row.vehicle ?? "").trim().toUpperCase();
                    const matchedVehicle = plate ? vehicleByPlate.get(plate) : undefined;
                    const vehicleDetails = matchedVehicle ?? row;
                    const catalogVehicleLabel = [detail(vehicleDetails, "marca"), detail(vehicleDetails, "modelo")]
                      .map((value) => String(value ?? "").trim())
                      .filter(Boolean)
                      .join(" ");
                    const catalogVehicleTitle = matchedVehicle?.title?.trim();
                    const vehicleLabel = catalogVehicleLabel
                      || (catalogVehicleTitle && catalogVehicleTitle.toUpperCase() !== plate ? catalogVehicleTitle : "")
                      || (plate ? `Veículo ${plate}` : "Veículo não informado");
                    const vehicleLabelLoading = catalogLoading && Boolean(plate) && !catalogVehicleLabel && !catalogVehicleTitle;
                    const serviceTitle = row.title.trim();
                    const displayServiceTitle = serviceTitle === serviceTitle.toLocaleUpperCase("pt-BR")
                      ? serviceTitle
                          .toLocaleLowerCase("pt-BR")
                          .replace(/^(\p{L})/u, (letter) => letter.toLocaleUpperCase("pt-BR"))
                          .replace(/\b([a-z]{2,}\d+[a-z0-9]*)\b/giu, (code) => code.toLocaleUpperCase("pt-BR"))
                      : serviceTitle;
                    const canAdvance = row.status === "novo" || row.status === "aguardando";
                    const canFinish = row.status === "em_andamento";
                    return (
                      <div
                        key={row.id}
                        className={`admin-kanban-card admin-workorder-card ${draggingId === row.id ? "dragging" : ""}`}
                        {...cardDragProps(row)}
                      >
                        <div className="admin-workorder-card-head">
                          <span
                            className="admin-workorder-eyebrow admin-workorder-touch-handle"
                            title="Toque e arraste para mover a OS"
                            {...handleTouchProps(row)}
                          >
                            Ordem de serviço
                          </span>
                          <div className="admin-workorder-actions" data-workorder-actions>
                            <button
                              type="button"
                              className="admin-icon-btn admin-workorder-more"
                              aria-label={`Ações da ordem de serviço de ${asText(row.customer_name)}`}
                              aria-haspopup="menu"
                              aria-expanded={openActionMenuId === row.id}
                              onClick={(event) => {
                                if (openActionMenuId === row.id) {
                                  setOpenActionMenuId(null);
                                  return;
                                }
                                const trigger = event.currentTarget.getBoundingClientRect();
                                const spaceBelow = window.innerHeight - trigger.bottom;
                                const spaceAbove = trigger.top;
                                setActionMenuPlacement(spaceBelow >= 216 || spaceBelow >= spaceAbove ? "below" : "above");
                                setOpenActionMenuId(row.id);
                              }}
                            >
                              <MoreHorizontal size={17} />
                            </button>
                            {openActionMenuId === row.id && (
                              <div
                                className="admin-appointment-actions-menu admin-workorder-actions-menu"
                                data-placement={actionMenuPlacement}
                                role="menu"
                                aria-label="Ações da ordem de serviço"
                              >
                                <button type="button" role="menuitem" onClick={() => { setOpenActionMenuId(null); openEdit(row); }}>
                                  <Pencil size={15} /> Editar OS
                                </button>
                                {!isApproved && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      if (!(Number(row.amount) > 0)) {
                                        setError("Defina o valor final antes de aprovar a OS.");
                                        return;
                                      }
                                      void patchRecord(row.id, {
                                        status: row.status === "novo" ? "em_andamento" : row.status,
                                        details: {
                                          ...existingDetails,
                                          aprovacao: "aprovado",
                                          aprovado_em: todayIso(),
                                        },
                                      });
                                    }}
                                  >
                                    <CheckCircle2 size={15} /> Aprovar OS
                                  </button>
                                )}
                                {(row.status === "concluido" || row.status === "cancelado") && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      void patchRecord(row.id, {
                                        details: { ...existingDetails, archived: true, archived_at: todayIso() },
                                      });
                                    }}
                                  >
                                    <Archive size={15} /> Arquivar OS
                                  </button>
                                )}
                                <div className="admin-appointment-actions-divider" role="separator" />
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="is-danger"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    void removeRecord(row);
                                  }}
                                >
                                  <Trash2 size={15} /> Excluir OS
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="admin-workorder-vehicle">
                          {plate && (
                            <div className="mercosul-plate admin-workorder-plate">
                              <div className="mercosul-plate-top">BRASIL</div>
                              <div className="mercosul-plate-code">{plate}</div>
                            </div>
                          )}
                          <div className="admin-workorder-vehicle-copy">
                            <strong>
                              {vehicleLabelLoading ? (
                                <span className="admin-skeleton admin-workorder-vehicle-skeleton" role="status" aria-label="Carregando veículo" />
                              ) : vehicleLabel}
                            </strong>
                            <span>{asText(row.customer_name)}</span>
                          </div>
                        </div>

                        <div className="admin-workorder-service">
                          <strong>{displayServiceTitle || "Serviço não informado"}</strong>
                          <span className={isApproved ? "approved" : "pending"}>
                            {isApproved
                              ? <CheckCircle2 size={12} aria-hidden="true" />
                              : <Clock3 size={12} aria-hidden="true" />}
                            {isApproved ? "Aprovado pelo cliente" : "Aguardando aprovação"}
                          </span>
                        </div>

                        <div className="admin-workorder-price-row">
                          <strong>{Number(row.amount) > 0 ? money(row.amount) : "A definir"}</strong>
                          <button
                            type="button"
                            className="admin-workorder-details"
                            onClick={() => setViewing(row)}
                          >
                            Ver detalhes <ExternalLink size={12} />
                          </button>
                        </div>

                        <div className="admin-workorder-card-footer">
                          <button
                            type="button"
                            className="admin-icon-btn admin-workorder-whatsapp"
                            aria-label={`Abrir WhatsApp para ${asText(row.customer_name)}`}
                            title="Abrir WhatsApp para o cliente"
                            onClick={() => {
                              if (!(Number(row.amount) > 0)) {
                                setError("Defina o valor final antes de pedir aprovação pelo WhatsApp.");
                                return;
                              }
                              window.open(whatsappApprovalUrl(row, "os"), "_blank", "noopener,noreferrer");
                            }}
                          >
                            <MessageCircle size={14} />
                          </button>
                          {(canAdvance || canFinish) && (
                            <button
                              type="button"
                              className="admin-primary admin-workorder-advance"
                              onClick={() => canAdvance
                                ? void patchRecord(row.id, { status: "em_andamento" })
                                : void handleFinalizeOrPatch(row.id, { status: "concluido" })}
                              title={canAdvance ? "Mover para No Box" : "Finalizar OS"}
                            >
                              {canAdvance ? "Avançar etapa" : "Finalizar OS"} <ArrowRight size={14} />
                            </button>
                          )}
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
          <div
            className={`admin-modal admin-work-order-modal${editing ? "" : " admin-work-order-create-modal"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar ordem de serviço" : "Nova ordem de serviço"}</h2>
                <p>{editing ? "Atualize as informações do atendimento." : "Registre um novo atendimento na oficina."}</p>
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

            <form className="admin-work-order-form" onSubmit={(e) => void handleSubmit(e)}>
              <div className="admin-work-order-grid">
                <h3 className="admin-work-order-section is-first">Informações do serviço</h3>
                <div className="admin-field wide">
                  <label htmlFor="work-order-service">Serviço *</label>
                  {!customService && services.length > 0 ? (
                    <ServicePicker
                      services={services}
                      priceRules={priceRules}
                      value={form.title}
                      id="work-order-service"
                      vehicleProfile={serviceVehicleProfile}
                      placeholder="Buscar ou inserir serviço..."
                      required
                      onSelectService={(picked, resolution) => {
                        if (!picked) {
                          setForm((prev) => workOrderServicePatch(prev, ""));
                          return;
                        }
                        setCustomService(false);
                        setForm((prev) => ({
                          ...prev,
                          service_id: picked.id,
                          pricing_mode: resolution?.mode ?? "",
                          pricing_rule_id: resolution?.rule?.id ?? "",
                          title: picked.title,
                          amount: serviceAndPartsTotal(resolution?.amount ?? null, prev.pecas),
                          description: prev.description || picked.description || "",
                        }));
                      }}
                    />
                  ) : (
                    <input
                      id="work-order-service"
                      className="admin-input"
                      required
                      placeholder="Nome do serviço"
                      value={form.title}
                      onChange={(e) => {
                        setCustomService(true);
                        setForm((prev) => workOrderServicePatch(prev, e.target.value));
                      }}
                    />
                  )}
                  {services.length > 0 && (
                    <button type="button" className="admin-work-order-link" onClick={() => setCustomService((value) => !value)}>
                      {customService ? "+ Buscar no catálogo" : "+ Inserir serviço personalizado"}
                    </button>
                  )}
                </div>

                <h3 className="admin-work-order-section">Cliente e veículo</h3>
                <div className="admin-field">
                  <label htmlFor="work-order-client">Cliente</label>
                  {!customClient && clients.length > 0 ? (
                    <ClientPicker
                      clients={clients}
                      value={form.customer_name}
                      id="work-order-client"
                      placeholder="Buscar cliente..."
                      onSelectClient={(picked) => {
                        if (!picked) {
                          setForm((prev) => ({ ...prev, customer_name: "" }));
                          return;
                        }
                        setCustomClient(false);
                        const name = clientDisplayName(picked);
                        const matchVeh = vehicles.find(
                          (v) => (v.customer_name ?? "").trim().toLowerCase() === name.toLowerCase(),
                        );
                        setForm((prev) => ({
                          ...prev,
                          customer_name: name,
                          phone: picked.phone ?? prev.phone,
                          ...(matchVeh && !prev.vehicle ? workOrderVehiclePatch(prev, vehiclePlate(matchVeh), matchVeh) : {}),
                        }));
                      }}
                    />
                  ) : (
                    <input
                      id="work-order-client"
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
                    <button type="button" className="admin-work-order-link" onClick={() => setCustomClient((value) => !value)}>
                      {customClient ? "+ Buscar cliente salvo" : "+ Novo cliente"}
                    </button>
                  )}
                </div>

                <div className="admin-field">
                  <label htmlFor="work-order-phone">Telefone</label>
                  <input
                    id="work-order-phone"
                    className="admin-input"
                    type="tel"
                    placeholder="(51) 99999-9999"
                    value={form.phone}
                    onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                </div>

                <div className="admin-field wide">
                  <label htmlFor="work-order-vehicle">Veículo / placa</label>
                  {!customVehicle && vehicles.length > 0 ? (
                    <VehiclePicker
                      vehicles={vehicles}
                      value={form.vehicle}
                      clientName={form.customer_name}
                      id="work-order-vehicle"
                      placeholder="Buscar veículo ou informar placa..."
                      onSelectVehicle={(picked) => {
                        if (!picked) {
                          setForm((prev) => ({ ...prev, ...workOrderVehiclePatch(prev, "") }));
                          return;
                        }
                        setCustomVehicle(false);
                        const ownerName = (picked.customer_name ?? "").trim();
                        const ownerClient = ownerName
                          ? clients.find((c) => clientDisplayName(c).toLowerCase() === ownerName.toLowerCase())
                          : undefined;
                        setForm((prev) => ({
                          ...prev,
                          ...workOrderVehiclePatch(prev, vehiclePlate(picked), picked),
                          customer_name: prev.customer_name || ownerName,
                          phone: prev.phone || ownerClient?.phone || "",
                        }));
                      }}
                    />
                  ) : (
                    <input
                      id="work-order-vehicle"
                      className="admin-input"
                      placeholder="Informe a placa"
                      value={form.vehicle}
                      onChange={(e) => {
                        setCustomVehicle(true);
                        setForm((prev) => ({ ...prev, ...workOrderVehiclePatch(prev, e.target.value) }));
                      }}
                    />
                  )}
                  {vehicles.length > 0 && (
                    <button type="button" className="admin-work-order-link" onClick={() => setCustomVehicle((value) => !value)}>
                      {customVehicle ? "+ Buscar veículo salvo" : "+ Novo veículo"}
                    </button>
                  )}
                </div>

                <h3 className="admin-work-order-section">Execução do serviço</h3>
                <div className="admin-field">
                  <label htmlFor="work-order-technician">Técnico responsável</label>
                  <input
                    id="work-order-technician"
                    className="admin-input"
                    placeholder="Selecionar mecânico"
                    value={form.tecnico}
                    onChange={(e) => setForm((prev) => ({ ...prev, tecnico: e.target.value }))}
                  />
                </div>
                <div className="admin-field">
                  <label htmlFor="work-order-box">Box de atendimento</label>
                  <input
                    id="work-order-box"
                    className="admin-input"
                    placeholder="Selecionar box"
                    value={form.box}
                    onChange={(e) => setForm((prev) => ({ ...prev, box: e.target.value }))}
                  />
                </div>
                <div className="admin-field wide">
                  <label htmlFor="work-order-description">Diagnóstico / observações</label>
                  <textarea
                    id="work-order-description"
                    className="admin-textarea"
                    rows={3}
                    placeholder="Sintomas relatados, diagnóstico técnico e serviços previstos..."
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  />
                </div>

                <h3 className="admin-work-order-section admin-work-order-parts-heading">
                  <span>Peças e valores</span>
                  <small>Peças opcionais</small>
                </h3>
                <div className="admin-field wide admin-work-order-parts-picker">
                  <select
                    id="work-order-part"
                    className="admin-select"
                    aria-label="Buscar peça no estoque"
                    value={selectedPartId}
                    onChange={(e) => setSelectedPartId(e.target.value)}
                  >
                    <option value="">Buscar peça no estoque...</option>
                    {inventoryRows
                      .filter((i) => i.status !== "cancelado")
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title} (disp: {String(detail(item, "quantidade") ?? 0)} {String(detail(item, "unidade") ?? "un")} · {money(item.amount)})
                        </option>
                      ))}
                  </select>
                  <input
                    className="admin-input"
                    aria-label="Quantidade de peças"
                    type="number"
                    min="1"
                    value={selectedPartQty}
                    onChange={(e) => setSelectedPartQty(e.target.value)}
                  />
                  <button
                    type="button"
                    className="admin-work-order-add-part"
                    aria-label="Adicionar peça"
                    onClick={addPartToForm}
                    disabled={!selectedPartId}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <div className="admin-field wide admin-work-order-price-summary">
                  <div className="admin-work-order-part-list">
                    {form.pecas.length > 0 ? form.pecas.map((part) => (
                      <div className="admin-work-order-part-row" key={part.id}>
                        <span>{part.quantidade} × {part.nome}</span>
                        <strong>{money(part.quantidade * part.valor_unitario)}</strong>
                        <button
                          type="button"
                          aria-label={`Remover ${part.nome}`}
                          onClick={() => setForm((prev) => ({
                            ...prev,
                            pecas: prev.pecas.filter((item) => item.id !== part.id),
                            amount: amountInput(Number(prev.amount) - part.quantidade * part.valor_unitario),
                          }))}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )) : (
                      <div className="admin-work-order-empty-parts">Nenhuma peça adicionada</div>
                    )}
                  </div>
                  <div className="admin-work-order-labor-row">
                    <span>Mão de obra</span>
                    <strong>{money(Math.max(0, (Number(form.amount.replace(",", ".")) || 0) - partsTotal(form.pecas)))}</strong>
                  </div>
                  <label className="admin-work-order-amount-label" htmlFor="work-order-amount">Valor total da OS</label>
                  <div className="admin-work-order-amount-control">
                    <span>R$</span>
                    <input
                      id="work-order-amount"
                      className="admin-input"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0,00"
                      value={form.amount}
                      onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <div className="admin-modal-actions">
                <span className="admin-work-order-required-note">* Campos obrigatórios</span>
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={() => setModalOpen(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="admin-primary" disabled={saving}>
                  {saving ? "Salvando..." : editing ? "Salvar alterações" : "Criar ordem de serviço"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewing && (() => {
        const plate = (viewing.vehicle ?? "").trim().toUpperCase();
        const matchedVehicle = plate ? vehicleByPlate.get(plate) : undefined;
        const vLabel = getVehicleLabel(viewing);
        const vAno = matchedVehicle ? detail(matchedVehicle, "ano") : null;
        const vCor = matchedVehicle ? detail(matchedVehicle, "cor") : null;
        const vKm = matchedVehicle ? detail(matchedVehicle, "km") : null;
        const vTecnico = detail(viewing, "tecnico");
        const vBox = detail(viewing, "box");
        const vApproved = String(detail(viewing, "aprovacao") ?? "pendente") === "aprovado";
        const vApprovedAt = detail(viewing, "aprovado_em");
        return (
          <div className="admin-modal-backdrop" {...modalBackdropProps(() => setViewing(null))}>
            <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-head">
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <h2 style={{ margin: 0 }}>{vLabel}</h2>
                    <AdminStatusBadge status={viewing.status} />
                  </div>
                  {viewing.vehicle && (
                    <div className="mercosul-plate">
                      <div className="mercosul-plate-top">BRASIL</div>
                      <div className="mercosul-plate-code">{viewing.vehicle}</div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="admin-icon-btn"
                  onClick={() => setViewing(null)}
                  aria-label="Fechar"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="admin-form-grid" style={{ gap: 12 }}>
                <div className="admin-field wide">
                  <label>Serviço</label>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{viewing.title}</div>
                </div>
                <div className="admin-field">
                  <label>Cliente</label>
                  <div>{asText(viewing.customer_name)}</div>
                </div>
                <div className="admin-field">
                  <label>Telefone</label>
                  <div>{asText(viewing.phone)}</div>
                </div>
                <div className="admin-field">
                  <label>Valor</label>
                  <div style={{ fontWeight: 600 }}>{Number(viewing.amount) > 0 ? money(viewing.amount) : "A definir"}</div>
                </div>
                <div className="admin-field">
                  <label>Aprovação</label>
                  <div style={{ color: vApproved ? "var(--admin-green)" : "var(--admin-amber)", fontWeight: 500 }}>
                    {vApproved
                      ? `✓ Aprovado${vApprovedAt ? ` em ${String(vApprovedAt)}` : ""}`
                      : "• Aguardando aprovação"}
                  </div>
                </div>
                <div className="admin-field">
                  <label>Técnico</label>
                  <div>{vTecnico ? String(vTecnico) : "—"}</div>
                </div>
                <div className="admin-field">
                  <label>Box</label>
                  <div>{vBox ? String(vBox) : "—"}</div>
                </div>
                {Boolean(vAno || vCor || vKm) && (
                  <div className="admin-field wide">
                    <label>Dados do veículo</label>
                    <div style={{ color: "var(--admin-muted)", fontSize: 13 }}>
                      {[
                        vAno ? `Ano: ${String(vAno)}` : "",
                        vCor ? `Cor: ${String(vCor)}` : "",
                        vKm ? `KM: ${String(vKm)}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                )}
                <div className="admin-field wide">
                  <label>Peças do estoque (opcional)</label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      className="admin-select"
                      style={{ flex: "1 1 220px" }}
                      value={selectedPartId}
                      onChange={(e) => setSelectedPartId(e.target.value)} id="admin-views-workordersview-1072"
                    >
                      <option value="">Selecionar peça do estoque…</option>
                      {inventoryRows
                        .filter((i) => i.status !== "cancelado")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title} (disp: {String(detail(item, "quantidade") ?? 0)} {String(detail(item, "unidade") ?? "un")} · {money(item.amount)})
                          </option>
                        ))}
                    </select>
                    <input
                      className="admin-input"
                      type="number"
                      min="1"
                      style={{ width: 80 }}
                      value={selectedPartQty}
                      onChange={(e) => setSelectedPartQty(e.target.value)} id="admin-views-workordersview-1087"
                    />
                    <button
                      type="button"
                      className="admin-secondary"
                      onClick={addPartToForm}
                      disabled={!selectedPartId}
                    >
                      <Plus size={14} /> Incluir peça
                    </button>
                  </div>
                  {form.pecas.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {form.pecas.map((p) => (
                        <span
                          key={p.id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            border: "1px solid var(--admin-line)",
                          }}
                        >
                          <Package size={12} />
                          {p.quantidade}x {p.nome}
                          <button
                            type="button"
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                pecas: prev.pecas.filter((item) => item.id !== p.id),
                              }))
                            }
                            style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: 0 }}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="admin-field wide">
                  <label>Diagnóstico / Observações</label>
                  <div style={{ fontSize: 13.5, color: "var(--admin-muted)", whiteSpace: "pre-wrap" }}>
                    {viewing.description?.trim() || "Nenhuma observação registrada."}
                  </div>
                </div>
                {Array.isArray(detail(viewing, "pecas")) && (detail(viewing, "pecas") as PartUsage[]).length > 0 && (
                  <div className="admin-field wide">
                    <label>Peças utilizadas</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {(detail(viewing, "pecas") as PartUsage[]).map((p) => (
                        <span
                          key={p.id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            border: "1px solid var(--admin-line)",
                          }}
                        >
                          <Package size={12} /> {p.quantidade}x {p.nome}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="admin-field wide">
                  <label>Histórico e peças utilizadas</label>
                  {viewHistoryLoading ? (
                    <div style={{ color: "var(--admin-muted)", fontSize: 13 }}>Carregando histórico…</div>
                  ) : viewHistoryError ? (
                    <div className="admin-form-error" role="alert">{viewHistoryError}</div>
                  ) : (
                    <div style={{ display: "grid", gap: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", borderBottom: "1px solid var(--admin-line)", paddingBottom: 8 }}>
                        <strong style={{ fontSize: 13 }}>Custo das peças baixadas</strong>
                        {viewMovementError ? (
                          <span style={{ color: "var(--admin-muted)", fontSize: 12 }}>Livro de estoque indisponível para este perfil</span>
                        ) : (
                          <strong>{money(viewMovements.filter((movement) => movement.quantity_delta < 0).reduce((sum, movement) => sum + Math.abs(Number(movement.quantity_delta)) * Number(movement.unit_cost), 0))}</strong>
                        )}
                      </div>
                      {viewMovements.length > 0 && (
                        <div style={{ display: "grid", gap: 5 }}>
                          {viewMovements.map((movement, index) => (
                            <div key={`${movement.created_at}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "var(--admin-muted)", fontSize: 12 }}>
                              <span>{movement.memo || "Movimentação de estoque"}</span>
                              <span>{movement.quantity_delta > 0 ? "+" : ""}{movement.quantity_delta} · {money(movement.unit_cost)}/un.</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <strong style={{ fontSize: 13 }}>Vistorias vinculadas ({viewInspections.length})</strong>
                      {viewInspectionError ? (
                        <span style={{ color: "var(--admin-muted)", fontSize: 12 }}>Vistorias não disponíveis para este perfil.</span>
                      ) : viewInspections.length === 0 ? (
                        <span style={{ color: "var(--admin-muted)", fontSize: 12 }}>Nenhuma vistoria vinculada a esta OS.</span>
                      ) : viewInspections.map((inspection) => {
                        const checklist = Array.isArray(detail(inspection, "checklist")) ? detail(inspection, "checklist") as Array<{ id?: string; name?: string; result?: string }> : [];
                        const photos = Array.isArray(detail(inspection, "fotos")) ? detail(inspection, "fotos") as string[] : [];
                        return (
                          <div key={inspection.id} style={{ display: "grid", gap: 7, padding: 10, border: "1px solid var(--admin-line)", borderRadius: 6 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{inspection.title}</strong><span style={{ color: "var(--admin-muted)", fontSize: 12 }}>{inspection.status}</span></div>
                            {checklist.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, color: "var(--admin-muted)", fontSize: 12 }}>{checklist.map((item, index) => <li key={item.id || index}>{item.name}: {item.result}</li>)}</ul>}
                            {photos.length > 0 && <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>{photos.slice(0, 8).map((photo, index) => <a key={`${inspection.id}-${index}`} href={photo} target="_blank" rel="noreferrer"><img src={photo} alt={`Foto ${index + 1} de ${inspection.title}`} loading="lazy" style={{ width: 64, height: 48, objectFit: "cover", borderRadius: 4, border: "1px solid var(--admin-line)" }} /></a>)}</div>}
                          </div>
                        );
                      })}
                      <strong style={{ fontSize: 13 }}>Eventos da ordem ({viewEvents.length})</strong>
                      {viewEvents.length === 0 ? <span style={{ color: "var(--admin-muted)", fontSize: 12 }}>Nenhuma alteração registrada ainda.</span> : (
                        <div style={{ display: "grid", gap: 5, maxHeight: 160, overflow: "auto" }}>
                          {viewEvents.map((event) => (
                            <div key={event.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, borderBottom: "1px solid var(--admin-line)", padding: "5px 0", fontSize: 12 }}>
                              <span>{event.summary}{event.from_status || event.to_status ? ` · ${event.from_status ?? "—"} → ${event.to_status ?? "—"}` : ""}</span>
                              <time style={{ color: "var(--admin-muted)", whiteSpace: "nowrap" }}>{new Date(event.created_at).toLocaleString("pt-BR")}</time>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="admin-modal-actions" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={() => {
                    if (!(Number(viewing.amount) > 0)) {
                      setError("Defina o valor final antes de pedir aprovação pelo WhatsApp.");
                      return;
                    }
                    window.open(whatsappApprovalUrl(viewing, "os"), "_blank", "noopener,noreferrer");
                  }}
                >
                  <MessageCircle size={14} /> WhatsApp
                </button>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="admin-secondary"
                    onClick={() => {
                      const target = viewing;
                      setViewing(null);
                      openEdit(target);
                    }}
                  >
                    <Pencil size={14} /> Editar OS
                  </button>
                  <button
                    type="button"
                    className="admin-primary"
                    onClick={() => setViewing(null)}
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
