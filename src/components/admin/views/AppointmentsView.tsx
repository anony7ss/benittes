"use client";

import { SkeletonList } from "../Skeletons";
import { useMemo, useState, type FormEvent } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { PanelRecord } from "../../../lib/supabase";
import { mergeVehiclePriceProfile } from "../../../lib/servicePricing";
import { AdminStatusBadge } from "../StatusBadge";
import { asText, dateText, detail, todayIso, useModuleRecords, usePersistedViewMode, modalBackdropProps } from "../utils";
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

type FormState = {
  title: string;
  customer_name: string;
  phone: string;
  vehicle: string;
  starts_at: string;
  horario: string;
  status: string;
  description: string;
  service_id: string;
  marca: string;
  modelo: string;
  ano: string;
};

const emptyForm = (defaultDate: string): FormState => ({
  title: "",
  customer_name: "",
  phone: "",
  vehicle: "",
  starts_at: defaultDate,
  horario: "09:00",
  status: "novo",
  description: "",
  service_id: "",
  marca: "",
  modelo: "",
  ano: "",
});

type ViewMode = "calendar" | "week" | "list";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function AppointmentsView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, patchRecord, removeRecord } = useModuleRecords(
    "appointments",
    session.user.id,
  );
  const { clients, vehicles, services, priceRules, reload: reloadCatalog } = useClientVehicleCatalog();
  const [viewMode, setViewMode] = usePersistedViewMode<ViewMode>("appointments", "calendar", [
    "calendar",
    "week",
    "list",
  ] as const);
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [monthDate, setMonthDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(todayIso()));
  const [saving, setSaving] = useState(false);

  const today = todayIso();
  const serviceVehicleProfile = mergeVehiclePriceProfile(
    vehicles.find((v) => vehiclePlate(v) === form.vehicle.trim().toUpperCase()),
    { make: form.marca, model: form.modelo, year: form.ano },
  );

  const searchedRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (!q) return true;
        return [row.title, row.customer_name, row.vehicle, row.phone]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const dateA = String(detail(a, "starts_at") ?? "");
        const dateB = String(detail(b, "starts_at") ?? "");
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        const timeA = String(detail(a, "horario") ?? "");
        const timeB = String(detail(b, "horario") ?? "");
        return timeA.localeCompare(timeB);
      });
  }, [rows, query]);

  const byDate = useMemo(() => {
    const map = new Map<string, PanelRecord[]>();
    searchedRows.forEach((row) => {
      const d = String(detail(row, "starts_at") ?? "").slice(0, 10);
      if (!d) return;
      const list = map.get(d) ?? [];
      list.push(row);
      map.set(d, list);
    });
    return map;
  }, [searchedRows]);

  const filtered = useMemo(() => {
    if (viewMode === "list" && showAll) return searchedRows;
    return byDate.get(selectedDate) ?? [];
  }, [viewMode, showAll, searchedRows, byDate, selectedDate]);

  const calendarDays = useMemo(() => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const start = new Date(year, month, 1 - startOffset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return {
        iso: toIsoDate(d),
        day: d.getDate(),
        inMonth: d.getMonth() === month,
      };
    });
  }, [monthDate]);

  const weekDays = useMemo(() => {
    const base = new Date(`${selectedDate || today}T12:00:00`);
    const offset = base.getDay();
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - offset);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return {
        iso: toIsoDate(d),
        label: WEEKDAYS[d.getDay()],
        day: d.getDate(),
      };
    });
  }, [selectedDate, today]);

  function openCreate(dateOverride?: string) {
    setEditing(null);
    setForm(emptyForm(dateOverride || selectedDate || todayIso()));
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    setEditing(row);
    setForm({
      title: row.title ?? "",
      customer_name: row.customer_name ?? "",
      phone: row.phone ?? "",
      vehicle: row.vehicle ?? "",
      starts_at: String(detail(row, "starts_at") ?? "").slice(0, 10) || todayIso(),
      horario: String(detail(row, "horario") ?? "09:00"),
      status: row.status ?? "novo",
      description: row.description ?? "",
      service_id: String(detail(row, "service_id") ?? ""),
      marca: String(detail(row, "marca") ?? ""),
      modelo: String(detail(row, "modelo") ?? ""),
      ano: String(detail(row, "ano") ?? ""),
    });
    setModalOpen(true);
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
        description: form.description.trim() || null,
        details: {
          ...existingDetails,
          starts_at: form.starts_at || todayIso(),
          horario: form.horario || "09:00",
          service_id: form.service_id || null,
          marca: form.marca || null,
          modelo: form.modelo || null,
          ano: form.ano || null,
        },
      });
      await ensureClientAndVehicle({
        userId: session.user.id,
        clients,
        vehicles,
        customerName: form.customer_name,
        phone: form.phone,
        vehicle: form.vehicle,
        vehicleDetails: { marca: form.marca, modelo: form.modelo, ano: form.ano },
        reload: reloadCatalog,
      });
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar agendamento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">AGENDA DA OFICINA</p>
          <h1>Agendamentos</h1>
        </div>
        <div className="admin-title-actions">
          <button type="button" className="admin-primary" onClick={() => openCreate()}>
            <Plus size={16} /> Novo agendamento
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-form-error" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}

      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            className="admin-search"
            placeholder="Buscar por serviço, cliente ou placa..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="admin-filter-pills">
            <button
              type="button"
              className={`admin-pill ${viewMode === "calendar" ? "active" : ""}`}
              onClick={() => setViewMode("calendar")}
            >
              <CalendarDays size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
              Calendário
            </button>
            <button
              type="button"
              className={`admin-pill ${viewMode === "week" ? "active" : ""}`}
              onClick={() => setViewMode("week")}
            >
              <LayoutGrid size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
              Semana
            </button>
            <button
              type="button"
              className={`admin-pill ${viewMode === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
            >
              <List size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
              Lista
            </button>
          </div>
          {viewMode === "list" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input
                type="date"
                className="admin-input"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setShowAll(false);
                }}
                style={{ width: "auto", minHeight: 38, height: 38, padding: "4px 10px", borderRadius: 8 }}
              />
              <div className="admin-filter-pills">
                <button
                  type="button"
                  className={`admin-pill ${showAll ? "active" : ""}`}
                  onClick={() => setShowAll((prev) => !prev)}
                >
                  Todos
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          {viewMode === "calendar" && (
            <div style={{ marginBottom: 24 }}>
              <div className="admin-calendar-head">
                <div className="admin-calendar-title">
                  {monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    className="admin-secondary"
                    style={{ height: 34, minHeight: 34, padding: "0 10px" }}
                    onClick={() =>
                      setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
                    }
                    aria-label="Mês anterior"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    className="admin-secondary"
                    style={{ height: 34, minHeight: 34, padding: "0 12px" }}
                    onClick={() => {
                      const now = new Date();
                      setMonthDate(new Date(now.getFullYear(), now.getMonth(), 1));
                      setSelectedDate(today);
                    }}
                  >
                    Hoje
                  </button>
                  <button
                    type="button"
                    className="admin-secondary"
                    style={{ height: 34, minHeight: 34, padding: "0 10px" }}
                    onClick={() =>
                      setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
                    }
                    aria-label="Próximo mês"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>

              <div className="admin-calendar-grid">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="admin-calendar-weekday">
                    {day}
                  </div>
                ))}
                {calendarDays.map((cell) => {
                  const dayRows = byDate.get(cell.iso) ?? [];
                  return (
                    <div
                      key={cell.iso}
                      className={`admin-calendar-cell ${cell.inMonth ? "" : "muted"} ${
                        cell.iso === today ? "today" : ""
                      } ${cell.iso === selectedDate ? "selected" : ""}`}
                      onClick={() => setSelectedDate(cell.iso)}
                    >
                      <div className="admin-calendar-day-row">
                        <span className="admin-calendar-day">{cell.day}</span>
                        <button
                          type="button"
                          className="admin-icon-btn"
                          style={{ width: 22, height: 22 }}
                          title={`Agendar em ${dateText(cell.iso)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDate(cell.iso);
                            openCreate(cell.iso);
                          }}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      {dayRows.slice(0, 3).map((ev) => (
                        <button
                          key={ev.id}
                          type="button"
                          className={`admin-calendar-event ${ev.status}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(ev);
                          }}
                          title={`${asText(detail(ev, "horario"))} · ${ev.title}`}
                        >
                          <strong>{asText(detail(ev, "horario"))}</strong> {ev.title}
                        </button>
                      ))}
                      {dayRows.length > 3 && (
                        <span style={{ fontSize: 10.5, color: "var(--admin-muted)", paddingLeft: 4 }}>
                          +{dayRows.length - 3} mais
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {viewMode === "week" && (
            <div style={{ marginBottom: 24 }}>
              <div className="admin-calendar-head">
                <div className="admin-calendar-title">
                  Semana de {dateText(weekDays[0].iso)}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    className="admin-secondary"
                    style={{ height: 34, minHeight: 34, padding: "0 10px" }}
                    onClick={() => {
                      const d = new Date(`${selectedDate || today}T12:00:00`);
                      d.setDate(d.getDate() - 7);
                      setSelectedDate(toIsoDate(d));
                    }}
                    aria-label="Semana anterior"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    className="admin-secondary"
                    style={{ height: 34, minHeight: 34, padding: "0 12px" }}
                    onClick={() => setSelectedDate(today)}
                  >
                    Hoje
                  </button>
                  <button
                    type="button"
                    className="admin-secondary"
                    style={{ height: 34, minHeight: 34, padding: "0 10px" }}
                    onClick={() => {
                      const d = new Date(`${selectedDate || today}T12:00:00`);
                      d.setDate(d.getDate() + 7);
                      setSelectedDate(toIsoDate(d));
                    }}
                    aria-label="Próxima semana"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>

              <div className="admin-week-grid">
                {weekDays.map((wd) => {
                  const dayRows = byDate.get(wd.iso) ?? [];
                  return (
                    <div
                      key={wd.iso}
                      className={`admin-week-col ${wd.iso === today ? "today" : ""}`}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          paddingBottom: 6,
                          borderBottom: "1px solid var(--admin-line)",
                        }}
                      >
                        <strong style={{ fontSize: 12.5 }}>
                          {wd.label} {wd.day}
                        </strong>
                        <button
                          type="button"
                          className="admin-icon-btn"
                          style={{ width: 24, height: 24 }}
                          onClick={() => openCreate(wd.iso)}
                          title={`Agendar em ${dateText(wd.iso)}`}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      {dayRows.length === 0 ? (
                        <span style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                          Sem horários
                        </span>
                      ) : (
                        dayRows.map((ev) => (
                          <button
                            key={ev.id}
                            type="button"
                            className={`admin-calendar-event ${ev.status}`}
                            onClick={() => openEdit(ev)}
                            style={{ whiteSpace: "normal", display: "grid", gap: 2, padding: 8 }}
                          >
                            <strong>
                              {asText(detail(ev, "horario"))} · {ev.title}
                            </strong>
                            <span style={{ fontSize: 10.5, color: "var(--admin-muted)" }}>
                              {ev.customer_name || ev.vehicle || "Cliente"}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {viewMode === "calendar" && (
            <div className="admin-panel-head" style={{ marginBottom: 12 }}>
              <h2>Agendamentos de {dateText(selectedDate)}</h2>
              <button
                type="button"
                className="admin-secondary"
                style={{ height: 32, minHeight: 32, padding: "0 12px", fontSize: 12 }}
                onClick={() => openCreate(selectedDate)}
              >
                <Plus size={13} /> Agendar neste dia
              </button>
            </div>
          )}

          {(viewMode === "list" || viewMode === "calendar") &&
            (filtered.length === 0 ? (
              <div className="admin-empty">
                Nenhum agendamento encontrado para{" "}
                {viewMode === "list" && showAll ? "esta busca" : dateText(selectedDate)}.
              </div>
            ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map((row) => {
            const startsAt = detail(row, "starts_at");
            const horario = detail(row, "horario");
            return (
              <div key={row.id} className="admin-panel">
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          fontWeight: 700,
                          fontSize: 13.5,
                        }}
                      >
                        <Clock size={14} /> {asText(horario)}
                      </span>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: 12.5,
                          color: "var(--admin-muted)",
                        }}
                      >
                        <CalendarDays size={13} /> {dateText(startsAt)}
                      </span>
                      <AdminStatusBadge status={row.status} />
                    </div>

                    <strong style={{ fontSize: 15 }}>{row.title}</strong>

                    <div style={{ fontSize: 13, color: "var(--admin-muted)", display: "flex", gap: 14, flexWrap: "wrap" }}>
                      <span>Cliente: {asText(row.customer_name)}</span>
                      <span>Veículo: {asText(row.vehicle)}</span>
                      {row.phone && <span>Tel: {row.phone}</span>}
                    </div>

                    {row.description && (
                      <p style={{ fontSize: 12.5, color: "var(--admin-muted)", marginTop: 2 }}>
                        {row.description}
                      </p>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {row.status !== "em_andamento" && row.status !== "concluido" && (
                      <button
                        type="button"
                        className="admin-secondary"
                        onClick={() => void patchRecord(row.id, { status: "em_andamento" })}
                      >
                        Iniciar
                      </button>
                    )}
                    {row.status !== "concluido" && (
                      <button
                        type="button"
                        className="admin-secondary"
                        onClick={() => void patchRecord(row.id, { status: "concluido" })}
                      >
                        Concluir
                      </button>
                    )}
                    {row.status !== "cancelado" && (
                      <button
                        type="button"
                        className="admin-ghost-danger"
                        onClick={() => void patchRecord(row.id, { status: "cancelado" })}
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      type="button"
                      className="admin-icon-btn"
                      title="Editar agendamento"
                      onClick={() => openEdit(row)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="admin-ghost-danger"
                      title="Remover agendamento"
                      onClick={() => void removeRecord(row)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
            ))}
        </>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar Agendamento" : "Novo Agendamento"}</h2>
                <p>Defina data, horário, cliente e serviço agendado.</p>
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
                  <label>Serviço *</label>
                  <ServicePicker
                    services={services}
                    priceRules={priceRules}
                    value={form.title}
                    vehicleProfile={serviceVehicleProfile}
                    onSelectService={(picked) => {
                      if (!picked) {
                        setForm((prev) => ({ ...prev, title: "", service_id: "" }));
                        return;
                      }
                      setForm((prev) => ({
                        ...prev,
                        service_id: picked.id,
                        title: picked.title,
                        description: prev.description || picked.description || "",
                      }));
                    }}
                  />
                  <input
                    className="admin-input"
                    required
                    placeholder="Ex: Alinhamento e balanceamento"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value, service_id: "" })}
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
                        marca: matchVeh ? String(detail(matchVeh, "marca") ?? "") : form.marca,
                        modelo: matchVeh ? String(detail(matchVeh, "modelo") ?? "") : form.modelo,
                        ano: matchVeh ? String(detail(matchVeh, "ano") ?? "") : form.ano,
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
                        marca: String(detail(picked, "marca") ?? ""),
                        modelo: String(detail(picked, "modelo") ?? ""),
                        ano: String(detail(picked, "ano") ?? ""),
                      });
                    }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      className="admin-input"
                      placeholder="ABC1D23"
                      value={form.vehicle}
                      onChange={(e) => setForm({ ...form, vehicle: e.target.value, marca: "", modelo: "", ano: "" })}
                    />
                    <PlateLookupButton
                      plate={form.vehicle}
                      onFound={(res) => {
                        const info = [res.marca, res.modelo, res.ano, res.cor].filter(Boolean).join(" · ");
                        setForm((prev) => ({
                          ...prev,
                          vehicle: res.plate,
                          marca: res.marca ?? "",
                          modelo: res.modelo ?? "",
                          ano: res.ano ?? "",
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
                  <label>Data</label>
                  <input
                    type="date"
                    className="admin-input"
                    value={form.starts_at}
                    onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                  />
                </div>

                <div className="admin-field">
                  <label>Horário</label>
                  <input
                    type="time"
                    className="admin-input"
                    value={form.horario}
                    onChange={(e) => setForm({ ...form, horario: e.target.value })}
                  />
                </div>

                <div className="admin-field wide">
                  <label>Observações</label>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    placeholder="Detalhes adicionais sobre o atendimento..."
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
