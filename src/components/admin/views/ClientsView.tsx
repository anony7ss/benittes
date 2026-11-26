"use client";

import { SkeletonTable } from "../Skeletons";
import { usePagination } from "../Pagination";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArchiveRestore,
  CarFront,
  CreditCard,
  History,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { insertRow, selectRows, updateRow, type PanelRecord } from "../../../lib/supabase";
import { AdminStatusBadge } from "../StatusBadge";
import { asText, dateText, detail, money, todayIso, consumeVehicleOwnerLookup, useModuleRecords, modalBackdropProps } from "../utils";
import { clientDisplayName } from "../QuickPickers";

type ClientForm = {
  tipo_pessoa: "fisica" | "juridica";
  title: string;
  phone: string;
  customer_email: string;
  documento: string;
  contato_preferido: string;
  status: string;
  description: string;
  vehicle_plate: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: string;
};

const emptyForm: ClientForm = {
  tipo_pessoa: "fisica",
  title: "",
  phone: "",
  customer_email: "",
  documento: "",
  contato_preferido: "WhatsApp",
  status: "novo",
  description: "",
  vehicle_plate: "",
  vehicle_make: "",
  vehicle_model: "",
  vehicle_year: "",
};

export function ClientsView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, patchRecord, removeRecord } = useModuleRecords(
    "clients",
    session.user.id,
  );
  const [search, setSearch] = useState("");
  const [subPage, setSubPage] = useState<"active" | "archived">("active");
  const [modalOpen, setModalOpen] = useState(false);
  const [vehicleLinkOpen, setVehicleLinkOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<ClientForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{ top: number; left: number; placement: "above" | "below" } | null>(null);
  const [clientPanel, setClientPanel] = useState<{ client: PanelRecord; section: "profile" | "vehicles" | "history" | "debts" } | null>(null);
  const [relatedRows, setRelatedRows] = useState<PanelRecord[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState("");
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const relatedRequestRef = useRef(0);

  const activeRows = useMemo(() => rows.filter((row) => !detail(row, "archived")), [rows]);
  const archivedRows = useMemo(() => rows.filter((row) => Boolean(detail(row, "archived"))), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = subPage === "archived" ? archivedRows : activeRows;
    return source.filter((row) => {
      if (!q) return true;
      const haystack = [
        row.title,
        row.customer_name,
        row.phone,
        row.customer_email,
        detail(row, "documento"),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [activeRows, archivedRows, search, subPage]);
  const { pageItems, controls: pagination } = usePagination(filtered);

  useEffect(() => {
    if (!openActionMenuId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && (target.closest(".admin-client-action-trigger") || actionMenuRef.current?.contains(target))) return;
      setOpenActionMenuId(null);
      setActionMenuPosition(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenActionMenuId(null);
        setActionMenuPosition(null);
      }
    };
    const onScroll = () => {
      setOpenActionMenuId(null);
      setActionMenuPosition(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [openActionMenuId]);

  function toggleActionMenu(row: PanelRecord, event: React.MouseEvent<HTMLButtonElement>) {
    if (openActionMenuId === row.id) {
      setOpenActionMenuId(null);
      setActionMenuPosition(null);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const estimatedHeight = Math.min(330, window.innerHeight - 16);
    const spaceBelow = window.innerHeight - bounds.bottom;
    const spaceAbove = bounds.top;
    const placement = spaceBelow >= estimatedHeight
      ? "below"
      : spaceAbove >= estimatedHeight
        ? "above"
        : spaceBelow >= spaceAbove ? "below" : "above";
    const top = placement === "below"
      ? Math.min(bounds.bottom + 6, window.innerHeight - estimatedHeight - 8)
      : Math.max(8, bounds.top - estimatedHeight - 6);
    const left = Math.min(Math.max(8, bounds.right - 252), window.innerWidth - 260);
    setActionMenuPosition({ top: Math.max(8, top), left: Math.max(8, left), placement });
    setOpenActionMenuId(row.id);
  }

  async function openClientPanel(client: PanelRecord, section: "profile" | "vehicles" | "history" | "debts") {
    setOpenActionMenuId(null);
    setActionMenuPosition(null);
    setClientPanel({ client, section });
    setRelatedRows([]);
    setRelatedError("");
    setRelatedLoading(false);
    const requestId = ++relatedRequestRef.current;
    if (section === "profile") return;
    setRelatedLoading(true);
    try {
      const resource = section === "vehicles" ? "vehicles" : section === "history" ? "work-orders" : "finance";
      const records = await selectRows<PanelRecord>(resource, { order: "created_at.desc", limit: "500" });
      if (requestId !== relatedRequestRef.current) return;
      const clientName = String(client.customer_name || client.title || "").trim().toLocaleLowerCase("pt-BR");
      const matched = clientName ? records.filter((record) =>
        String(record.customer_name || "").trim().toLocaleLowerCase("pt-BR") === clientName,
      ) : [];
      const visible = section === "debts"
        ? matched.filter((record) => detail(record, "tipo") !== "pagar" && record.status !== "concluido" && record.status !== "cancelado")
        : matched;
      setRelatedRows(visible);
    } catch (reason) {
      if (requestId === relatedRequestRef.current) {
        setRelatedError(reason instanceof Error ? reason.message : "Não foi possível carregar os dados do cliente.");
      }
    } finally {
      if (requestId === relatedRequestRef.current) setRelatedLoading(false);
    }
  }

  useEffect(() => {
    if (loading || typeof window === "undefined") return;
    const requested = consumeVehicleOwnerLookup()?.trim();
    if (!requested) return;
    const normalized = requested.toLocaleLowerCase("pt-BR");
    const client = rows.find((row) =>
      row.id === requested ||
      clientDisplayName(row).trim().toLocaleLowerCase("pt-BR") === normalized ||
      String(row.customer_name ?? "").trim().toLocaleLowerCase("pt-BR") === normalized,
    );
    if (client) {
      setClientPanel({ client, section: "profile" });
      setRelatedRows([]);
      setRelatedError("");
    } else {
      setSearch(requested);
    }
  }, [loading, rows]);

  async function setClientArchived(client: PanelRecord, archived: boolean) {
    setArchivingId(client.id);
    setError("");
    try {
      await patchRecord(client.id, {
        details: {
          ...(client.details && typeof client.details === "object" ? client.details : {}),
          archived,
          archived_at: archived ? todayIso() : null,
        },
      });
      setOpenActionMenuId(null);
      setActionMenuPosition(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o cliente.");
    } finally {
      setArchivingId(null);
    }
  }

  function openClientWhatsApp(client: PanelRecord) {
    const digits = String(client.phone ?? "").replace(/\D/g, "");
    if (!digits) {
      setError("Este cliente ainda não tem telefone cadastrado.");
      return;
    }
    const phone = digits.startsWith("55") || digits.length > 11 ? digits : `55${digits}`;
    window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer");
    setOpenActionMenuId(null);
    setActionMenuPosition(null);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setVehicleLinkOpen(false);
    setError("");
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    setEditing(row);
    const documentDigits = String(detail(row, "documento") ?? "").replace(/\D/g, "");
    setForm({
      tipo_pessoa: detail(row, "tipo_pessoa") === "juridica" || documentDigits.length > 11 ? "juridica" : "fisica",
      title: row.title || row.customer_name || "",
      phone: row.phone ?? "",
      customer_email: row.customer_email ?? "",
      documento: String(detail(row, "documento") ?? ""),
      contato_preferido: String(detail(row, "contato_preferido") ?? "WhatsApp"),
      status: row.status || "novo",
      description: row.description ?? "",
      vehicle_plate: "",
      vehicle_make: "",
      vehicle_model: "",
      vehicle_year: "",
    });
    setVehicleLinkOpen(false);
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const existingDetails =
        editing?.details && typeof editing.details === "object" ? editing.details : {};
      const savedClient = await saveRecord(editing, {
        title: form.title.trim(),
        customer_name: form.title.trim(),
        phone: form.phone.trim() || null,
        customer_email: form.customer_email.trim() || null,
        status: form.status,
        description: form.description.trim() || null,
        details: {
          ...existingDetails,
          tipo_pessoa: form.tipo_pessoa,
          documento: form.documento.trim(),
          contato_preferido: form.contato_preferido,
        },
      });
      if (savedClient) setEditing(savedClient);

      const vehiclePlate = form.vehicle_plate.trim().toUpperCase();
      if (vehicleLinkOpen && vehiclePlate) {
        const vehicles = await selectRows<PanelRecord>("vehicles", { order: "created_at.desc", limit: "500" });
        const existingVehicle = vehicles.find((vehicle) =>
          String(vehicle.vehicle || vehicle.title || "").trim().toUpperCase() === vehiclePlate,
        );
        if (existingVehicle) {
          const owner = String(existingVehicle.customer_name ?? "").trim().toLowerCase();
          if (owner && owner !== form.title.trim().toLowerCase()) {
            throw new Error("Esta placa já está vinculada a outro cliente.");
          }
          if (!owner) {
            await updateRow<PanelRecord>("vehicles", existingVehicle.id, {
              customer_name: form.title.trim(),
            });
          }
        } else {
          await insertRow<PanelRecord>("panel_records", {
            module: "vehicles",
            title: vehiclePlate,
            vehicle: vehiclePlate,
            customer_name: form.title.trim(),
            status: "novo",
            details: {
              ...(form.vehicle_make.trim() ? { marca: form.vehicle_make.trim() } : {}),
              ...(form.vehicle_model.trim() ? { modelo: form.vehicle_model.trim() } : {}),
              ...(form.vehicle_year.trim() ? { ano: form.vehicle_year.trim() } : {}),
            },
            created_by: session.user.id,
          });
        }
      }
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar cliente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <h1>Clientes</h1>
        </div>
        <div className="admin-title-actions">
          <button type="button" className="admin-primary" onClick={openCreate}>
            <Plus size={16} /> Novo cliente
          </button>
        </div>
      </div>

      {error && <p className="admin-form-error" style={{ marginBottom: 16 }}>{error}</p>}

      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            className="admin-search"
            placeholder="Buscar por nome, telefone, e-mail ou CPF/CNPJ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)} id="admin-views-clientsview-131"
          />
        </div>
        <div className="admin-filter-pills admin-toolbar-right" aria-label="Filtrar clientes">
          <button
            type="button"
            className={`admin-pill ${subPage === "active" ? "active" : ""}`}
            onClick={() => setSubPage("active")}
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
      </div>

      {loading ? (
        <SkeletonTable rows={6} />
      ) : filtered.length === 0 ? (
        <div className="admin-empty">
          <Users size={24} />
          <strong>{subPage === "archived" ? "Nenhum cliente arquivado" : "Nenhum cliente encontrado"}</strong>
          <p>{subPage === "archived" ? "Clientes arquivados aparecerão aqui." : "Cadastre um novo cliente ou altere o termo de busca."}</p>
        </div>
      ) : (
        <>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Telefone</th>
                <th>E-mail</th>
                <th>CPF/CNPJ</th>
                <th>Cadastro</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{row.title || row.customer_name || "—"}</div>
                    {Boolean(detail(row, "contato_preferido")) && (
                      <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                        Pref.: {String(detail(row, "contato_preferido"))}
                      </div>
                    )}
                  </td>
                  <td>{asText(row.phone)}</td>
                  <td>{asText(row.customer_email)}</td>
                  <td>{asText(detail(row, "documento"))}</td>
                  <td>{dateText(row.created_at)}</td>
                  <td>
                    <AdminStatusBadge status={row.status} label={detail(row, "archived") ? "Arquivado" : undefined} />
                  </td>
                  <td>
                    <div className="admin-client-actions">
                      <button
                        type="button"
                        className="admin-icon-btn admin-client-action-trigger"
                        title="Ações do cliente"
                        aria-label={`Ações de ${row.title || row.customer_name || "cliente"}`}
                        aria-haspopup="menu"
                        aria-expanded={openActionMenuId === row.id}
                        onClick={(event) => toggleActionMenu(row, event)}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pagination}
        </>
      )}

      {openActionMenuId && actionMenuPosition && typeof document !== "undefined" && (() => {
        const client = rows.find((row) => row.id === openActionMenuId);
        if (!client) return null;
        const isArchived = Boolean(detail(client, "archived"));
        return createPortal(
          <div
            ref={actionMenuRef}
            className="admin-client-actions-menu"
            role="menu"
            aria-label="Menu de ações do cliente"
            data-placement={actionMenuPosition.placement}
            style={{ top: actionMenuPosition.top, left: actionMenuPosition.left }}
          >
            <button type="button" role="menuitem" onClick={() => void openClientPanel(client, "profile")}>
              <UserRound size={15} /> Ver perfil
            </button>
            <button type="button" role="menuitem" onClick={() => { setOpenActionMenuId(null); setActionMenuPosition(null); openEdit(client); }}>
              <Pencil size={15} /> Editar cadastro
            </button>
            <div className="admin-client-actions-divider" role="separator" />
            <button type="button" role="menuitem" disabled={!client.phone} onClick={() => openClientWhatsApp(client)}>
              <MessageCircle size={15} /> Abrir WhatsApp
            </button>
            <button type="button" role="menuitem" onClick={() => void openClientPanel(client, "vehicles")}>
              <CarFront size={15} /> Ver veículos
            </button>
            <button type="button" role="menuitem" onClick={() => void openClientPanel(client, "history")}>
              <History size={15} /> Histórico de serviços
            </button>
            <button type="button" role="menuitem" onClick={() => void openClientPanel(client, "debts")}>
              <CreditCard size={15} /> Consultar débitos
            </button>
            <div className="admin-client-actions-divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              disabled={archivingId === client.id}
              onClick={() => void setClientArchived(client, !isArchived)}
            >
              {isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
              {isArchived ? "Restaurar cliente" : "Arquivar cliente"}
            </button>
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => {
                setOpenActionMenuId(null);
                setActionMenuPosition(null);
                void removeRecord(client);
              }}
            >
              <Trash2 size={15} /> Excluir cliente
            </button>
          </div>,
          document.querySelector(".admin-root") ?? document.body,
        );
      })()}

      {clientPanel && (
        <div
          className="admin-modal-backdrop"
          {...modalBackdropProps(() => {
            relatedRequestRef.current += 1;
            setClientPanel(null);
            setRelatedLoading(false);
          })}
        >
          <div className="admin-modal admin-client-profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{clientPanel.client.title || clientPanel.client.customer_name || "Cliente"}</h2>
                <p>Perfil e informações relacionadas</p>
              </div>
              <button
                type="button"
                className="admin-icon-btn"
                aria-label="Fechar perfil do cliente"
                onClick={() => {
                  relatedRequestRef.current += 1;
                  setClientPanel(null);
                  setRelatedLoading(false);
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="admin-client-profile-tabs" role="tablist" aria-label="Seções do perfil do cliente">
              {([
                ["profile", "Perfil"],
                ["vehicles", "Veículos"],
                ["history", "Serviços"],
                ["debts", "Débitos"],
              ] as const).map(([section, label]) => (
                <button
                  key={section}
                  type="button"
                  role="tab"
                  aria-selected={clientPanel.section === section}
                  className={`admin-pill ${clientPanel.section === section ? "active" : ""}`}
                  onClick={() => void openClientPanel(clientPanel.client, section)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="admin-client-profile-content" role="tabpanel" aria-busy={relatedLoading}>
              {clientPanel.section === "profile" ? (
                <dl className="admin-client-profile-details">
                  <div><dt>Telefone</dt><dd>{asText(clientPanel.client.phone)}</dd></div>
                  <div><dt>E-mail</dt><dd>{asText(clientPanel.client.customer_email)}</dd></div>
                  <div><dt>CPF/CNPJ</dt><dd>{asText(detail(clientPanel.client, "documento"))}</dd></div>
                  <div><dt>Contato preferido</dt><dd>{asText(detail(clientPanel.client, "contato_preferido"))}</dd></div>
                  <div><dt>Cadastro</dt><dd>{dateText(clientPanel.client.created_at)}</dd></div>
                  {clientPanel.client.description && <div className="wide"><dt>Observações</dt><dd>{clientPanel.client.description}</dd></div>}
                </dl>
              ) : relatedLoading ? (
                <div className="admin-client-related-loading" role="status">Carregando informações…</div>
              ) : relatedError ? (
                <div className="admin-form-error" role="alert">{relatedError}</div>
              ) : relatedRows.length === 0 ? (
                <div className="admin-empty admin-client-related-empty">
                  {clientPanel.section === "vehicles" && "Nenhum veículo vinculado a este cliente."}
                  {clientPanel.section === "history" && "Nenhum serviço encontrado para este cliente."}
                  {clientPanel.section === "debts" && "Nenhum débito em aberto para este cliente."}
                </div>
              ) : (
                <div className="admin-client-related-list">
                  {relatedRows.map((record) => (
                    <article className="admin-client-related-row" key={record.id}>
                      <div className="admin-client-related-copy">
                        <strong>
                          {clientPanel.section === "vehicles"
                            ? record.vehicle || record.title || "Veículo"
                            : record.title || (clientPanel.section === "history" ? "Serviço" : "Lançamento")}
                        </strong>
                        <span>
                          {clientPanel.section === "vehicles"
                            ? [detail(record, "marca"), detail(record, "modelo"), detail(record, "ano")].filter(Boolean).join(" · ") || "Dados do veículo"
                            : clientPanel.section === "history"
                              ? `${dateText(record.created_at)} · ${record.vehicle || "Sem placa"}`
                              : `Vencimento: ${dateText(detail(record, "vencimento"))}`}
                        </span>
                      </div>
                      <div className="admin-client-related-meta">
                        {clientPanel.section === "history" && <AdminStatusBadge status={record.status} />}
                        {clientPanel.section === "debts" && <strong>{money(record.amount)}</strong>}
                        {clientPanel.section === "vehicles" && <AdminStatusBadge status={record.status} />}
                        {clientPanel.section === "history" && Number(record.amount) > 0 && <strong>{money(record.amount)}</strong>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className="admin-modal admin-client-create-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar cliente" : "Novo cliente"}</h2>
                <p>Cadastre os dados de identificação e contato do cliente.</p>
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
            <form className="admin-client-create-form" onSubmit={(e) => void handleSubmit(e)}>
              <section className="admin-client-form-section is-first">
                <h3>Identificação</h3>
                <div className="admin-client-type-switch" role="group" aria-label="Tipo de pessoa">
                  <button
                    type="button"
                    className={form.tipo_pessoa === "fisica" ? "is-active" : ""}
                    aria-pressed={form.tipo_pessoa === "fisica"}
                    onClick={() => setForm((prev) => ({ ...prev, tipo_pessoa: "fisica" }))}
                  >
                    Pessoa física
                  </button>
                  <button
                    type="button"
                    className={form.tipo_pessoa === "juridica" ? "is-active" : ""}
                    aria-pressed={form.tipo_pessoa === "juridica"}
                    onClick={() => setForm((prev) => ({ ...prev, tipo_pessoa: "juridica" }))}
                  >
                    Pessoa jurídica
                  </button>
                </div>

                <div className="admin-field">
                  <label htmlFor="client-name">{form.tipo_pessoa === "juridica" ? "Razão social *" : "Nome completo *"}</label>
                  <input
                    id="client-name"
                    className="admin-input"
                    required
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder={form.tipo_pessoa === "juridica" ? "Ex.: Oficina Exemplo Ltda." : "Ex.: João da Silva"}
                  />
                </div>

                <div className="admin-field">
                  <label htmlFor="client-document">{form.tipo_pessoa === "juridica" ? "CNPJ" : "CPF"}</label>
                  <input
                    id="client-document"
                    className="admin-input"
                    inputMode="numeric"
                    value={form.documento}
                    onChange={(e) => setForm((prev) => ({ ...prev, documento: e.target.value }))}
                    placeholder={form.tipo_pessoa === "juridica" ? "00.000.000/0000-00" : "000.000.000-00"}
                  />
                </div>
              </section>

              <section className="admin-client-form-section">
                <h3>Informações de contato</h3>
                <div className="admin-client-contact-grid">
                  <div className="admin-field">
                    <label htmlFor="client-phone">Telefone</label>
                    <input
                      id="client-phone"
                      className="admin-input"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                      placeholder="(51) 99999-9999"
                    />
                  </div>
                  <div className="admin-field">
                    <label htmlFor="client-email">E-mail</label>
                    <input
                      id="client-email"
                      type="email"
                      className="admin-input"
                      value={form.customer_email}
                      onChange={(e) => setForm((prev) => ({ ...prev, customer_email: e.target.value }))}
                      placeholder="cliente@exemplo.com"
                    />
                  </div>
                  <div className="admin-field wide">
                    <label>Contato preferido</label>
                    <div className="admin-client-contact-options" role="group" aria-label="Contato preferido">
                      <button
                        type="button"
                        className={form.contato_preferido === "WhatsApp" ? "is-active" : ""}
                        aria-pressed={form.contato_preferido === "WhatsApp"}
                        onClick={() => setForm((prev) => ({ ...prev, contato_preferido: "WhatsApp" }))}
                      >
                        <MessageCircle size={13} /> WhatsApp
                      </button>
                      <button
                        type="button"
                        className={form.contato_preferido === "Telefone" ? "is-active" : ""}
                        aria-pressed={form.contato_preferido === "Telefone"}
                        onClick={() => setForm((prev) => ({ ...prev, contato_preferido: "Telefone" }))}
                      >
                        <Phone size={13} /> Ligação
                      </button>
                      <button
                        type="button"
                        className={form.contato_preferido === "E-mail" ? "is-active" : ""}
                        aria-pressed={form.contato_preferido === "E-mail"}
                        onClick={() => setForm((prev) => ({ ...prev, contato_preferido: "E-mail" }))}
                      >
                        <Mail size={13} /> E-mail
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="admin-client-form-section admin-client-extra-section">
                <div className="admin-client-section-title-row">
                  <h3>Informações adicionais</h3>
                  <small>Opcional</small>
                </div>
                <div className="admin-field">
                  <label htmlFor="client-notes">Observações internas</label>
                  <textarea
                    id="client-notes"
                    className="admin-textarea"
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Preferências, informações relevantes e anotações..."
                  />
                </div>
                <div className="admin-client-vehicle-link">
                  <button
                    type="button"
                    className="admin-client-vehicle-toggle"
                    aria-expanded={vehicleLinkOpen}
                    onClick={() => setVehicleLinkOpen((open) => !open)}
                  >
                    <CarFront size={16} />
                    <span>
                      <strong>Vincular veículo</strong>
                      <small>{vehicleLinkOpen ? "Informe os dados do veículo" : "Adicione um veículo ao cadastro"}</small>
                    </span>
                    <Plus size={15} className={vehicleLinkOpen ? "is-open" : ""} />
                  </button>
                  {vehicleLinkOpen && (
                    <div className="admin-client-vehicle-fields">
                      <div className="admin-field">
                        <label htmlFor="client-vehicle-plate">Placa *</label>
                        <input
                          id="client-vehicle-plate"
                          className="admin-input"
                          required
                          value={form.vehicle_plate}
                          onChange={(e) => setForm((prev) => ({ ...prev, vehicle_plate: e.target.value.toUpperCase() }))}
                          placeholder="ABC1D23"
                        />
                      </div>
                      <div className="admin-field">
                        <label htmlFor="client-vehicle-make">Marca</label>
                        <input
                          id="client-vehicle-make"
                          className="admin-input"
                          value={form.vehicle_make}
                          onChange={(e) => setForm((prev) => ({ ...prev, vehicle_make: e.target.value }))}
                          placeholder="Ex.: Renault"
                        />
                      </div>
                      <div className="admin-field">
                        <label htmlFor="client-vehicle-model">Modelo</label>
                        <input
                          id="client-vehicle-model"
                          className="admin-input"
                          value={form.vehicle_model}
                          onChange={(e) => setForm((prev) => ({ ...prev, vehicle_model: e.target.value }))}
                          placeholder="Ex.: Clio"
                        />
                      </div>
                      <div className="admin-field">
                        <label htmlFor="client-vehicle-year">Ano</label>
                        <input
                          id="client-vehicle-year"
                          className="admin-input"
                          inputMode="numeric"
                          value={form.vehicle_year}
                          onChange={(e) => setForm((prev) => ({ ...prev, vehicle_year: e.target.value }))}
                          placeholder="Ex.: 2018"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {error && <p className="admin-form-error admin-client-create-error">{error}</p>}

              <div className="admin-client-create-footer">
                <small>* Campo obrigatório</small>
                <button
                  type="button"
                  className="admin-secondary"
                  disabled={saving}
                  onClick={() => setModalOpen(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="admin-primary" disabled={saving}>
                  {saving ? "Salvando..." : editing ? "Salvar alterações" : "Cadastrar cliente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
