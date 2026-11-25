"use client";

import { SkeletonKanban } from "../Skeletons";
import { useMemo, useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, ArrowRight, CheckCircle2, ClipboardList, Eye, GripVertical, MessageCircle, Package, Pencil, Plus, Search, Trash2, Tv, Wrench, X } from "lucide-react";
import type { PanelRecord } from "../../../lib/supabase";
import { AdminStatusBadge } from "../StatusBadge";
import {
  asText,
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
  PlateLookupButton,
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
});

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
  const { clients, vehicles, services, reload: reloadCatalog } = useClientVehicleCatalog();
  const [subPage, setSubPage] = useState<"board" | "archived">("board");
  const [selectedPartId, setSelectedPartId] = useState("");
  const [selectedPartQty, setSelectedPartQty] = useState("1");

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
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

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
    setSelectedPartId("");
    setSelectedPartQty("1");
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    const rawParts = detail(row, "pecas");
    setEditing(row);
    setForm({
      title: row.title ?? "",
      customer_name: row.customer_name ?? "",
      phone: row.phone ?? "",
      vehicle: row.vehicle ?? "",
      status: row.status ?? "novo",
      amount: row.amount !== null && row.amount !== undefined ? String(row.amount) : "",
      description: row.description ?? "",
      tecnico: String(detail(row, "tecnico") ?? ""),
      box: String(detail(row, "box") ?? ""),
      pecas: Array.isArray(rawParts) ? (rawParts as PartUsage[]) : [],
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
      return { ...prev, pecas: nextPecas };
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
        },
      });
      await ensureClientAndVehicle({
        userId: session.user.id,
        clients,
        vehicles,
        customerName: form.customer_name,
        phone: form.phone,
        vehicle: form.vehicle,
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
          <p className="admin-kicker">OPERAÇÃO DE OFICINA</p>
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
            onChange={(e) => setQuery(e.target.value)}
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
                    <th style={{ width: 140 }}>Ações</th>
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
                      <td><strong>{money(row.amount)}</strong></td>
                      <td><AdminStatusBadge status={row.status} /></td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className="admin-icon-btn"
                            title="Ver detalhes"
                            onClick={() => setViewing(row)}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="admin-icon-btn"
                            title="Restaurar para o quadro"
                            onClick={() =>
                              void patchRecord(row.id, {
                                details: {
                                  ...(row.details && typeof row.details === "object" ? row.details : {}),
                                  archived: false,
                                },
                              })
                            }
                          >
                            <ArchiveRestore size={14} />
                          </button>
                          <button
                            type="button"
                            className="admin-icon-btn danger"
                            title="Remover OS"
                            onClick={() => void removeRecord(row)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
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
        <div className="admin-kanban">
          {LANES.map((lane) => {
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
                    Nenhuma OS nesta etapa
                  </div>
                ) : (
                  laneRows.map((row) => {
                    const tecnico = detail(row, "tecnico");
                    const box = detail(row, "box");
                    const aprovacao = String(detail(row, "aprovacao") ?? "pendente");
                    const isApproved = aprovacao === "aprovado";
                    const existingDetails =
                      row.details && typeof row.details === "object" ? row.details : {};
                    const vehicleLabel = getVehicleLabel(row);
                    return (
                      <div
                        key={row.id}
                        className={`admin-kanban-card ${draggingId === row.id ? "dragging" : ""}`}
                        {...cardDragProps(row)}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto 1fr",
                            alignItems: "start",
                            gap: 8,
                          }}
                        >
                          <span />
                          {row.vehicle ? (
                            <div className="mercosul-plate">
                              <div className="mercosul-plate-top">BRASIL</div>
                              <div className="mercosul-plate-code">{row.vehicle}</div>
                            </div>
                          ) : (
                            <span />
                          )}
                          <div style={{ display: "flex", gap: 4, alignItems: "center", justifySelf: "end" }}>
                            <span
                              className="admin-drag-handle"
                              title="Arrastar OS"
                              {...handleTouchProps(row)}
                            >
                              <GripVertical size={14} />
                            </span>
                            <AdminStatusBadge status={row.status} />
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 4 }}>
                          <strong style={{ fontSize: 15, lineHeight: 1.25, minWidth: 0, wordBreak: "break-word" }}>
                            {vehicleLabel}
                          </strong>
                          {vehicleLabel !== row.title && (
                            <span
                              style={{
                                fontSize: 13,
                                color: "var(--admin-text)",
                                fontWeight: 500,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              <Wrench size={12} style={{ color: "var(--admin-muted)", flexShrink: 0 }} />
                              {row.title}
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: 12.5, color: "var(--admin-muted)", display: "grid", gap: 3 }}>
                          <span>Cliente: {asText(row.customer_name)}</span>
                          <span
                            style={{
                              color: isApproved ? "var(--admin-green)" : "var(--admin-amber)",
                              fontWeight: 500,
                            }}
                          >
                            {isApproved ? "✓ Aprovado pelo cliente" : "• Aguardando aprovação"}
                          </span>
                          {Boolean(tecnico || box) && (
                            <span>
                              {tecnico ? `Téc: ${String(tecnico)}` : ""}
                              {tecnico && box ? " · " : ""}
                              {box ? `Box: ${String(box)}` : ""}
                            </span>
                          )}
                        </div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          <button
                            type="button"
                            className="admin-secondary"
                            style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5 }}
                            onClick={() => setViewing(row)}
                          >
                            <Eye size={12} /> Ver detalhes
                          </button>
                          <button
                            type="button"
                            className="admin-secondary"
                            style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5 }}
                            onClick={() =>
                              window.open(
                                whatsappApprovalUrl(row, "os"),
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                            title="Enviar OS pelo WhatsApp para o cliente aprovar"
                          >
                            <MessageCircle size={12} /> WhatsApp
                          </button>
                          {!isApproved && (
                            <button
                              type="button"
                              className="admin-secondary"
                              style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5, color: "#22c55e" }}
                              onClick={() =>
                                void patchRecord(row.id, {
                                  status: row.status === "novo" ? "em_andamento" : row.status,
                                  details: {
                                    ...existingDetails,
                                    aprovacao: "aprovado",
                                    aprovado_em: todayIso(),
                                  },
                                })
                              }
                            >
                              <CheckCircle2 size={12} /> Aprovar
                            </button>
                          )}
                          {(row.status === "novo" || row.status === "aguardando") && (
                            <button
                              type="button"
                              className="admin-secondary"
                              style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5 }}
                              onClick={() => void patchRecord(row.id, { status: "em_andamento" })}
                              title="Mover para No Box"
                            >
                              <ArrowRight size={12} /> Avançar
                            </button>
                          )}
                          {row.status !== "concluido" && row.status !== "cancelado" && (
                            <button
                              type="button"
                              className="admin-secondary"
                              style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5, color: "var(--admin-green)" }}
                              onClick={() => void handleFinalizeOrPatch(row.id, { status: "concluido" })}
                              title="Finalizar OS, contabilizar em finanças e dar baixa no estoque"
                            >
                              <CheckCircle2 size={12} /> Finalizar
                            </button>
                          )}
                          {(row.status === "concluido" || row.status === "cancelado") && (
                            <button
                              type="button"
                              className="admin-secondary"
                              style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 11.5 }}
                              onClick={() =>
                                void patchRecord(row.id, {
                                  details: {
                                    ...existingDetails,
                                    archived: true,
                                    archived_at: todayIso(),
                                  },
                                })
                              }
                              title="Mover para Arquivadas"
                            >
                              <Archive size={12} /> Arquivar
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
                          <strong style={{ fontSize: 13.5 }}>{money(row.amount)}</strong>
                          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                            <button
                              type="button"
                              className="admin-icon-btn"
                              title="Editar OS"
                              onClick={() => openEdit(row)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="admin-ghost-danger"
                              title="Remover OS"
                              onClick={() => void removeRecord(row)}
                            >
                              <Trash2 size={14} />
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
                <h2>{editing ? "Editar Ordem de Serviço" : "Nova Ordem de Serviço"}</h2>
                <p>Registre os dados do veículo, diagnóstico e responsável técnico.</p>
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
                  <label>Título / Serviço *</label>
                  <ServicePicker
                    services={services}
                    value={form.title}
                    onSelectService={(picked) => {
                      if (!picked) {
                        setForm({ ...form, title: "" });
                        return;
                      }
                      const promo = detail(picked, "preco_promo");
                      const price =
                        promo !== undefined && promo !== null && promo !== ""
                          ? String(promo)
                          : picked.amount !== null && picked.amount !== undefined
                            ? String(picked.amount)
                            : form.amount;
                      setForm({
                        ...form,
                        title: picked.title,
                        amount: price,
                        description: form.description || picked.description || "",
                      });
                    }}
                  />
                  <input
                    className="admin-input"
                    required
                    placeholder="Ex: Revisão completa + troca de pastilhas"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
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
                      setForm({
                        ...form,
                        customer_name: name,
                        phone: picked.phone ?? form.phone,
                        vehicle: matchVeh && !form.vehicle ? vehiclePlate(matchVeh) : form.vehicle,
                      });
                    }}
                  />
                  <input
                    className="admin-input"
                    placeholder="Nome do cliente"
                    value={form.customer_name}
                    onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                  />
                </div>

                <div className="admin-field">
                  <label>Telefone</label>
                  <input
                    className="admin-input"
                    placeholder="(11) 99999-9999"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>

                <div className="admin-field">
                  <label>Veículo / Placa</label>
                  <VehiclePicker
                    vehicles={vehicles}
                    value={form.vehicle}
                    clientName={form.customer_name}
                    onSelectVehicle={(picked) => {
                      if (!picked) {
                        setForm({ ...form, vehicle: "" });
                        return;
                      }
                      const ownerName = (picked.customer_name ?? "").trim();
                      const ownerClient = ownerName
                        ? clients.find(
                            (c) => clientDisplayName(c).toLowerCase() === ownerName.toLowerCase(),
                          )
                        : undefined;
                      setForm({
                        ...form,
                        vehicle: vehiclePlate(picked),
                        customer_name: form.customer_name || ownerName,
                        phone: form.phone || ownerClient?.phone || "",
                      });
                    }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      className="admin-input"
                      placeholder="ABC1D23"
                      value={form.vehicle}
                      onChange={(e) => setForm({ ...form, vehicle: e.target.value })}
                    />
                    <PlateLookupButton
                      plate={form.vehicle}
                      onFound={(res) => {
                        const info = [res.marca, res.modelo, res.ano, res.cor].filter(Boolean).join(" · ");
                        setForm((prev) => ({
                          ...prev,
                          vehicle: res.plate,
                          description:
                            info && !prev.description.includes(info)
                              ? prev.description
                                ? `${info}\n${prev.description}`
                                : info
                              : prev.description,
                        }));
                      }}
                    />
                  </div>
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
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </div>

                <div className="admin-field">
                  <label>Técnico responsável</label>
                  <input
                    className="admin-input"
                    placeholder="Nome do mecânico"
                    value={form.tecnico}
                    onChange={(e) => setForm({ ...form, tecnico: e.target.value })}
                  />
                </div>

                <div className="admin-field">
                  <label>Box</label>
                  <input
                    className="admin-input"
                    placeholder="Ex: Box 02"
                    value={form.box}
                    onChange={(e) => setForm({ ...form, box: e.target.value })}
                  />
                </div>

                <div className="admin-field wide">
                  <label>Peças do estoque (opcional)</label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      className="admin-select"
                      style={{ flex: "1 1 220px" }}
                      value={selectedPartId}
                      onChange={(e) => setSelectedPartId(e.target.value)}
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
                      onChange={(e) => setSelectedPartQty(e.target.value)}
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
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    placeholder="Sintomas relatados, diagnóstico técnico e peças previstas..."
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
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
                  <div style={{ fontWeight: 600 }}>{money(viewing.amount)}</div>
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
                      onChange={(e) => setSelectedPartId(e.target.value)}
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
                      onChange={(e) => setSelectedPartQty(e.target.value)}
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
              </div>

              <div className="admin-modal-actions" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={() =>
                    window.open(whatsappApprovalUrl(viewing, "os"), "_blank", "noopener,noreferrer")
                  }
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
