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
  PlateLookupButton,
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
});

export function QuotesView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, patchRecord, removeRecord } = useModuleRecords(
    "quotes",
    session.user.id,
  );
  const { clients, vehicles, services, reload: reloadCatalog } = useClientVehicleCatalog();
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [waMode, setWaMode] = useState<"confirm" | "link">("confirm");

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
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  async function ensurePublicToken(row: PanelRecord): Promise<string> {
    const existing = String(detail(row, "public_token") ?? "").trim();
    if (existing) return existing;
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
          approved: true,
        },
      ],
    }));
  }

  function updateLineItem(id: string, patch: Partial<QuoteLineItem>) {
    setForm((prev) => {
      const nextItems = prev.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
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
            onChange={(e) => setQuery(e.target.value)}
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
        <div className="admin-kanban">
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
                        <strong style={{ fontSize: 13.5 }}>{money(row.amount)}</strong>
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
                    placeholder="Ex: Troca de embreagem + retífica do volante"
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
                          <input
                            className="admin-input"
                            style={{ minHeight: 36, padding: "6px 10px", fontSize: 12.5 }}
                            placeholder="Descrição do item"
                            value={item.name}
                            onChange={(e) => updateLineItem(item.id, { name: e.target.value })}
                          />
                          <input
                            type="number"
                            min={1}
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
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
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
                      onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    />
                  </div>
                  <div className="admin-field">
                    <label>Validade</label>
                    <input
                      type="date"
                      className="admin-input"
                      value={form.validade}
                      onChange={(e) => setForm({ ...form, validade: e.target.value })}
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
    </>
  );
}
