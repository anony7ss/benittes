"use client";

import { SkeletonList } from "../Skeletons";
import { useEffect, useMemo, useState, type DragEvent as ReactDragEvent, type FormEvent } from "react";
import {
  Check,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import type { PanelRecord } from "../../../lib/supabase";
import { mergeVehiclePriceProfile } from "../../../lib/servicePricing";
import { confirmModal } from "../ConfirmDialog";
import { AdminStatusBadge } from "../StatusBadge";
import { asText, dateText, detail, todayIso, consumeVehicleActionPrefill, useModuleRecords, usePersistedViewMode, modalBackdropProps } from "../utils";
import {
  ClientPicker,
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
const FULL_WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatWeekRange(startIso: string, endIso: string): string {
  const start = new Date(`${startIso}T12:00:00`);
  const end = new Date(`${endIso}T12:00:00`);
  const startMonthYear = start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const endMonthYear = end.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}–${end.getDate()} de ${endMonthYear}`;
  }

  return `${start.getDate()} de ${startMonthYear} – ${end.getDate()} de ${endMonthYear}`;
}

function appointmentState(status: string) {
  const normalized = status.toLowerCase().replaceAll(" ", "_");
  if (["cancelado", "cancelada"].includes(normalized)) return { label: "Cancelado", tone: "cancelled" };
  if (["concluido", "concluida", "finalizado", "finalizada"].includes(normalized)) return { label: "Concluído", tone: "completed" };
  if (["em_andamento"].includes(normalized)) return { label: "Em andamento", tone: "active" };
  if (["confirmado", "confirmada", "aprovado", "aprovada", "confirmed"].includes(normalized)) return { label: "Confirmado", tone: "confirmed" };
  return { label: "Pendente", tone: "pending" };
}

function appointmentWhatsAppUrl(row: PanelRecord): string | null {
  const digits = (row.phone ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;

  const phone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  const customer = row.customer_name?.trim() || "cliente";
  const date = dateText(detail(row, "starts_at"));
  const time = String(detail(row, "horario") ?? "").trim();
  const text = `Olá, ${customer}! Aqui é da Benittes Oficina Mecânica. Estou entrando em contato sobre seu agendamento de ${row.title || "serviço"}${date !== "—" ? ` em ${date}` : ""}${time ? ` às ${time}` : ""}.`;

  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

function AppointmentCalendarCard({
  row,
  onClick,
  onDragStart,
}: {
  row: PanelRecord;
  onClick: () => void;
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
}) {
  const time = asText(detail(row, "horario"));
  const service = row.title?.trim() || "Serviço não informado";
  const customer = row.customer_name?.trim() || "Cliente não informado";
  const plate = row.vehicle?.trim().toUpperCase();
  const state = appointmentState(row.status);
  const label = `${time} · ${service} · Cliente: ${customer}${plate ? ` · Placa: ${plate}` : ""}`;

  return (
    <button
      type="button"
      className={`admin-calendar-event ${row.status} admin-data-enter`}
      draggable={row.status !== "cancelado"}
      onDragStart={onDragStart}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
    >
      <span className="admin-calendar-event-time">{time}</span>
      <strong className="admin-calendar-event-title">{service}</strong>
      <span className="admin-calendar-event-context">
        <span>{customer}</span>
        {plate && <span>Placa {plate}</span>}
        <span className={`admin-calendar-event-state ${state.tone}`}>{state.label}</span>
      </span>
    </button>
  );
}

function AppointmentDayColumn({
  day,
  appointments,
  today,
  selected,
  addActive,
  dragOver,
  onSelect,
  onCreate,
  onDragOver,
  onDragLeave,
  onDrop,
  onEdit,
  onAppointmentDragStart,
}: {
  day: { iso: string; label: string; day: number };
  appointments: PanelRecord[];
  today: string;
  selected: boolean;
  addActive: boolean;
  dragOver: boolean;
  onSelect: (iso: string) => void;
  onCreate: (iso: string) => void;
  onDragOver: (iso: string) => void;
  onDragLeave: (event: ReactDragEvent<HTMLDivElement>, iso: string) => void;
  onDrop: (event: ReactDragEvent<HTMLDivElement>, iso: string) => void;
  onEdit: (row: PanelRecord) => void;
  onAppointmentDragStart: (event: ReactDragEvent<HTMLButtonElement>, row: PanelRecord) => void;
}) {
  return (
    <div
      className={`admin-week-col ${day.iso === today ? "today" : ""} ${selected ? "selected" : ""} ${addActive ? "add-active" : ""} ${dragOver ? "drag-over" : ""}`}
      onClick={() => onSelect(day.iso)}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver(day.iso);
      }}
      onDragLeave={(event) => onDragLeave(event, day.iso)}
      onDrop={(event) => onDrop(event, day.iso)}
    >
      <div className="admin-week-day-header">
        <div className="admin-week-day-top">
          <div className="admin-week-day-label">
            <span>{day.label}</span>
            <strong className="admin-week-day-number">{day.day}</strong>
          </div>
          <button
            type="button"
            className="admin-icon-btn admin-calendar-add-button"
            style={{ width: 24, height: 24 }}
            onClick={(event) => {
              event.stopPropagation();
              onCreate(day.iso);
            }}
            title={`Agendar em ${dateText(day.iso)}`}
            aria-label={`Agendar em ${dateText(day.iso)}`}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
      <span className="admin-week-day-count">
        {appointments.length === 0
          ? "Sem horários"
          : `${appointments.length} ${appointments.length === 1 ? "agendamento" : "agendamentos"}`}
      </span>
      {appointments.map((appointment) => (
        <AppointmentCalendarCard
          key={appointment.id}
          row={appointment}
          onClick={() => onEdit(appointment)}
          onDragStart={(event) => onAppointmentDragStart(event, appointment)}
        />
      ))}
    </div>
  );
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
  const [viewing, setViewing] = useState<PanelRecord | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [actionMenuPlacement, setActionMenuPlacement] = useState<"above" | "below">("below");
  const [form, setForm] = useState<FormState>(() => emptyForm(todayIso()));
  const [customService, setCustomService] = useState(false);
  const [customClient, setCustomClient] = useState(false);
  const [customVehicle, setCustomVehicle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [addButtonDate, setAddButtonDate] = useState<string | null>(null);

  useEffect(() => {
    if (!openActionMenuId) return;

    function closeMenuOnOutsideClick(event: PointerEvent) {
      if (!(event.target instanceof Element) || !event.target.closest("[data-appointment-actions]")) {
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
        label: FULL_WEEKDAYS[d.getDay()],
        day: d.getDate(),
      };
    });
  }, [selectedDate, today]);

  async function moveAppointment(row: PanelRecord, targetDate: string) {
    const currentDate = String(detail(row, "starts_at") ?? "").slice(0, 10);
    if (!currentDate || currentDate === targetDate) return;

    const time = String(detail(row, "horario") ?? "09:00").slice(0, 5);
    const conflicts = rows.filter((candidate) => {
      if (candidate.id === row.id || candidate.status === "cancelado") return false;
      return (
        String(detail(candidate, "starts_at") ?? "").slice(0, 10) === targetDate &&
        String(detail(candidate, "horario") ?? "").slice(0, 5) === time
      );
    }).length;

    if (conflicts > 0) {
      const accepted = await confirmModal({
        title: "Possível conflito de horário",
        message: `Já existe${conflicts === 1 ? " um agendamento" : `m ${conflicts} agendamentos`} começando às ${time} nesse dia. Confira se há box e equipe disponíveis antes de mover.`,
        confirmLabel: "Mover mesmo assim",
        cancelLabel: "Cancelar",
        danger: false,
      });
      if (!accepted) return;
    }

    const existingDetails =
      row.details && typeof row.details === "object"
        ? (row.details as Record<string, unknown>)
        : {};

    try {
      const updated = await patchRecord(row.id, {
        details: { ...existingDetails, starts_at: targetDate, horario: time },
      });
      if (!updated) {
        setError("Não foi possível mover o agendamento. Tente novamente.");
        return;
      }
      setSelectedDate(targetDate);
      if (viewMode === "calendar") {
        const movedDate = new Date(`${targetDate}T12:00:00`);
        setMonthDate(new Date(movedDate.getFullYear(), movedDate.getMonth(), 1));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível mover o agendamento.");
    }
  }

  function appointmentDragStart(event: ReactDragEvent<HTMLButtonElement>, row: PanelRecord) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.id);
  }

  function handleAppointmentDrop(event: ReactDragEvent<HTMLDivElement>, targetDate: string) {
    event.preventDefault();
    setDragOverDate(null);
    const rowId = event.dataTransfer.getData("text/plain");
    const row = rows.find((appointment) => appointment.id === rowId);
    if (row) void moveAppointment(row, targetDate);
  }

  function handleAppointmentDragLeave(event: ReactDragEvent<HTMLDivElement>, date: string) {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setDragOverDate((current) => current === date ? null : current);
    }
  }

  function selectCalendarDay(date: string) {
    setSelectedDate(date);
    setAddButtonDate(date);
  }

  function createAppointmentForDate(date: string) {
    selectCalendarDay(date);
    openCreate(date);
  }

  function moveSelectedWeek(offsetDays: number) {
    const nextDate = new Date(`${selectedDate || today}T12:00:00`);
    nextDate.setDate(nextDate.getDate() + offsetDays);
    const iso = toIsoDate(nextDate);
    selectCalendarDay(iso);
    setMonthDate(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
  }

  function openCreate(dateOverride?: string) {
    setOpenActionMenuId(null);
    setViewing(null);
    setRescheduling(false);
    setEditing(null);
    setCustomService(false);
    setCustomClient(false);
    setCustomVehicle(false);
    setForm(emptyForm(dateOverride || selectedDate || todayIso()));
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
      marca: prefill.make,
      modelo: prefill.model,
      ano: prefill.year,
    }));
  }, []);

  function openEdit(row: PanelRecord) {
    setOpenActionMenuId(null);
    setViewing(null);
    setRescheduling(false);
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

  function openReschedule(row: PanelRecord) {
    openEdit(row);
    setRescheduling(true);
  }

  function openDetails(row: PanelRecord) {
    setOpenActionMenuId(null);
    setViewing(row);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Informe o serviço para criar o agendamento.");
      return;
    }
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
      if (!rescheduling) {
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
      }
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar agendamento.");
    } finally {
      setSaving(false);
    }
  }

  const creatingNew = !editing && !rescheduling;

  return (
    <>
      <div className="admin-page-title">
        <div>
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
            onChange={(e) => setQuery(e.target.value)} id="admin-views-appointmentsview-259"
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
                style={{ width: "auto", minHeight: 38, height: 38, padding: "4px 10px", borderRadius: 8 }} id="admin-views-appointmentsview-295"
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
                <div className="admin-calendar-title admin-calendar-month-title">
                  {monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                </div>
                <div className="admin-calendar-month-controls">
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
                      selectCalendarDay(today);
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
                      } ${cell.iso === selectedDate ? "selected" : ""} ${addButtonDate === cell.iso ? "add-active" : ""} ${dragOverDate === cell.iso ? "drag-over" : ""}`}
                      onClick={() => selectCalendarDay(cell.iso)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOverDate(cell.iso);
                      }}
                      onDragLeave={(event) => handleAppointmentDragLeave(event, cell.iso)}
                      onDrop={(event) => handleAppointmentDrop(event, cell.iso)}
                    >
                      <div className="admin-calendar-day-row">
                        <span className="admin-calendar-day">{cell.day}</span>
                        <button
                          type="button"
                          className="admin-icon-btn admin-calendar-add-button"
                          style={{ width: 22, height: 22 }}
                          title={`Agendar em ${dateText(cell.iso)}`}
                          aria-label={`Agendar em ${dateText(cell.iso)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            createAppointmentForDate(cell.iso);
                          }}
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      {dayRows.length > 0 && (
                        <span className="admin-calendar-day-count" aria-label={`${dayRows.length} agendamentos`}>
                          {dayRows.length}
                        </span>
                      )}
                      {dayRows.slice(0, 3).map((ev) => (
                        <AppointmentCalendarCard
                          key={ev.id}
                          row={ev}
                          onClick={() => openEdit(ev)}
                          onDragStart={(event) => appointmentDragStart(event, ev)}
                        />
                      ))}
                      {dayRows.length > 3 && (
                        <span className="admin-calendar-more-count" style={{ fontSize: 10.5, color: "var(--admin-muted)", paddingLeft: 4 }}>
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
                  <span className="admin-week-range-label">
                    {formatWeekRange(weekDays[0].iso, weekDays[6].iso)}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    className="admin-secondary"
                    style={{ height: 34, minHeight: 34, padding: "0 10px" }}
                    onClick={() => moveSelectedWeek(-7)}
                    aria-label="Semana anterior"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    className="admin-secondary"
                    style={{ height: 34, minHeight: 34, padding: "0 12px" }}
                    onClick={() => selectCalendarDay(today)}
                  >
                    Hoje
                  </button>
                  <button
                    type="button"
                    className="admin-secondary"
                    style={{ height: 34, minHeight: 34, padding: "0 10px" }}
                    onClick={() => moveSelectedWeek(7)}
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
                    <AppointmentDayColumn
                      key={wd.iso}
                      day={wd}
                      appointments={dayRows}
                      today={today}
                      selected={wd.iso === selectedDate}
                      addActive={addButtonDate === wd.iso}
                      dragOver={dragOverDate === wd.iso}
                      onSelect={selectCalendarDay}
                      onCreate={createAppointmentForDate}
                      onDragOver={setDragOverDate}
                      onDragLeave={handleAppointmentDragLeave}
                      onDrop={handleAppointmentDrop}
                      onEdit={openEdit}
                      onAppointmentDragStart={appointmentDragStart}
                    />
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
        <div className="admin-panel admin-appointment-list">
          {filtered.map((row) => {
            const horario = detail(row, "horario");
            const status = appointmentState(row.status);
            const customerName = row.customer_name?.trim();
            const whatsappUrl = appointmentWhatsAppUrl(row);
            return (
              <div key={row.id} className="admin-appointment-row admin-data-enter">
                <div className="admin-appointment-time">
                  <strong>{asText(horario)}</strong>
                  <span className={`admin-appointment-status ${status.tone}`}>{status.label}</span>
                </div>
                <div className="admin-appointment-main">
                  <strong className="admin-appointment-title">{row.title || "Serviço não informado"}</strong>
                  <div className="admin-appointment-meta">
                    <span><User size={12} /> {customerName || "Cliente não informado"}</span>
                    {row.vehicle && <span><Car size={13} /> {row.vehicle}</span>}
                  </div>
                  {row.description && <p className="admin-appointment-description">{row.description}</p>}
                  <div className="admin-appointment-row-footer">
                    <button type="button" className="admin-appointment-details-link" onClick={() => openDetails(row)}>
                      Ver detalhes <ChevronRight size={12} />
                    </button>
                    <div className="admin-appointment-actions" data-appointment-actions>
                      {whatsappUrl && (
                        <a
                          className="admin-icon-btn admin-appointment-whatsapp"
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Abrir WhatsApp para ${row.customer_name || "cliente"}`}
                          title="Abrir conversa no WhatsApp"
                        >
                          <MessageCircle size={12} />
                        </a>
                      )}
                      {status.tone !== "completed" && status.tone !== "cancelled" && (
                        <button
                          type="button"
                          className="admin-primary admin-appointment-start"
                          onClick={() => void patchRecord(row.id, { status: "em_andamento" })}
                        >
                          Iniciar atendimento
                        </button>
                      )}
                      <button
                        type="button"
                        className="admin-icon-btn admin-appointment-more"
                        aria-label="Ações do agendamento"
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
                        <MoreHorizontal size={16} />
                      </button>
                      {openActionMenuId === row.id && (
                        <div className="admin-appointment-actions-menu" data-placement={actionMenuPlacement} role="menu" aria-label="Ações do agendamento">
                          <button type="button" role="menuitem" onClick={() => openEdit(row)}><Pencil size={15} /> Editar agendamento</button>
                          <button type="button" role="menuitem" onClick={() => openReschedule(row)}><CalendarDays size={15} /> Reagendar</button>
                          <button type="button" role="menuitem" disabled={status.tone === "completed" || status.tone === "cancelled"} onClick={() => { setOpenActionMenuId(null); void patchRecord(row.id, { status: "concluido" }); }}><Check size={15} /> Marcar como concluído</button>
                          <div className="admin-appointment-actions-divider" role="separator" />
                          <button type="button" role="menuitem" className="is-danger" disabled={status.tone === "completed" || status.tone === "cancelled"} onClick={() => { setOpenActionMenuId(null); void patchRecord(row.id, { status: "cancelado" }); }}><X size={15} /> Cancelar agendamento</button>
                          <button type="button" role="menuitem" className="is-danger" onClick={() => { setOpenActionMenuId(null); void removeRecord(row); }}><Trash2 size={15} /> Excluir</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
            ))}
        </>
      )}

      {viewing && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setViewing(null))}>
          <div className="admin-modal admin-appointment-details-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{viewing.title || "Agendamento"}</h2>
                <p>{dateText(detail(viewing, "starts_at"))} às {asText(detail(viewing, "horario"))}</p>
              </div>
              <button type="button" className="admin-icon-btn" onClick={() => setViewing(null)} aria-label="Fechar detalhes">
                <X size={16} />
              </button>
            </div>

            <div className="admin-appointment-detail-content">
              <AdminStatusBadge status={viewing.status} />
              <dl>
                <div><dt>Cliente</dt><dd>{asText(viewing.customer_name)}</dd></div>
                <div><dt>Telefone</dt><dd>{asText(viewing.phone)}</dd></div>
                <div><dt>Veículo</dt><dd>{asText(viewing.vehicle)}</dd></div>
              </dl>
              {viewing.description && <p>{viewing.description}</p>}
            </div>

          </div>
        </div>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className={`admin-modal${creatingNew ? " admin-appointment-create-modal" : ""}`} onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{rescheduling ? "Reagendar agendamento" : editing ? "Editar agendamento" : "Novo agendamento"}</h2>
                <p>{creatingNew ? "Preencha as informações para agendar um atendimento." : rescheduling ? "Escolha uma nova data e horário para este atendimento." : "Defina data, horário, cliente e serviço agendado."}</p>
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
              <div className={`admin-form-grid${rescheduling ? " is-rescheduling" : ""}${creatingNew ? " admin-appointment-create-grid" : ""}`}>
                {!rescheduling && <>
                <div className="admin-appointment-section-heading is-first">Informações do serviço</div>
                <div className="admin-field wide">
                  <label>Serviço *</label>
                  {!customService && services.length > 0 ? (
                    <ServicePicker
                      services={services}
                      priceRules={priceRules}
                      value={form.title}
                      vehicleProfile={serviceVehicleProfile}
                      placeholder="Buscar ou selecionar serviço..."
                      required
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
                  ) : (
                    <input
                      className="admin-input"
                      required
                      placeholder="Buscar ou inserir serviço..."
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value, service_id: "" })}
                      id="admin-views-appointmentsview-700"
                    />
                  )}
                  {services.length > 0 && (
                    <button
                      type="button"
                      className="admin-appointment-add-link"
                      onClick={() => {
                        setCustomService((current) => !current);
                        setForm((current) => ({ ...current, service_id: "" }));
                      }}
                    >
                      {customService ? "+ Selecionar serviço cadastrado" : "+ Inserir serviço personalizado"}
                    </button>
                  )}
                </div>

                <div className="admin-appointment-section-heading">Cliente e veículo</div>
                <div className="admin-field">
                  <label>Cliente</label>
                  {clients.length > 0 && !customClient ? (
                    <ClientPicker
                      clients={clients}
                      value={form.customer_name}
                      placeholder="Buscar cliente..."
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
                  ) : (
                    <input
                      className="admin-input"
                      placeholder="Nome do cliente"
                      value={form.customer_name}
                      onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                      id="admin-views-appointmentsview-734"
                    />
                  )}
                  {clients.length > 0 && (
                    <button type="button" className="admin-appointment-add-link" onClick={() => setCustomClient((current) => !current)}>
                      {customClient ? "+ Selecionar cliente cadastrado" : "+ Novo cliente"}
                    </button>
                  )}
                </div>

                <div className="admin-field">
                  <label>Telefone</label>
                  <input
                    className="admin-input"
                    placeholder="(51) 99999-9999"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })} id="admin-views-appointmentsview-744"
                  />
                </div>

                <div className="admin-field wide">
                  <label>Veículo / Placa</label>
                  {vehicles.length > 0 && !customVehicle ? (
                    <VehiclePicker
                      vehicles={vehicles}
                      value={form.vehicle}
                      clientName={form.customer_name}
                      placeholder="Buscar veículo ou informar placa..."
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
                  ) : (
                    <input
                      className="admin-input"
                      placeholder="Buscar veículo ou informar placa..."
                      value={form.vehicle}
                      onChange={(e) => setForm({ ...form, vehicle: e.target.value, marca: "", modelo: "", ano: "" })}
                      id="admin-views-appointmentsview-780"
                    />
                  )}
                  {vehicles.length > 0 && (
                    <button type="button" className="admin-appointment-add-link" onClick={() => setCustomVehicle((current) => !current)}>
                      {customVehicle ? "+ Selecionar veículo cadastrado" : "+ Novo veículo"}
                    </button>
                  )}
                </div>
                </>}

                <div className="admin-appointment-section-heading">Data e horário</div>
                <div className="admin-field">
                  <label>Data *</label>
                  <input
                    type="date"
                    className="admin-input"
                    required
                    value={form.starts_at}
                    onChange={(e) => setForm({ ...form, starts_at: e.target.value })} id="admin-views-appointmentsview-790"
                  />
                </div>

                <div className="admin-field">
                  <label>Horário *</label>
                  <input
                    type="time"
                    className="admin-input"
                    required
                    value={form.horario}
                    onChange={(e) => setForm({ ...form, horario: e.target.value })} id="admin-views-appointmentsview-800"
                  />
                </div>

                {!rescheduling && <div className="admin-field wide admin-appointment-observations">
                  <label className={creatingNew ? "admin-appointment-observations-label" : undefined}>
                    <span>Observações</span>
                    {creatingNew && <small>Opcional</small>}
                  </label>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    placeholder="Detalhes adicionais sobre o atendimento..."
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })} id="admin-views-appointmentsview-810"
                  />
                </div>}
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
                  {saving ? "Salvando..." : rescheduling ? "Confirmar novo horário" : creatingNew ? "Criar agendamento" : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
