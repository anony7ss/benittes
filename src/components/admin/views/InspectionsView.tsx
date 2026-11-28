"use client";

import { SkeletonTable } from "../Skeletons";
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import type { PanelRecord } from "../../../lib/supabase";
import { AdminActionMenu } from "../ActionMenu";
import { AdminStatusBadge, statusLabels } from "../StatusBadge";
import { asText, dateText, detail, consumeVehicleActionPrefill, useModuleRecords, modalBackdropProps } from "../utils";
import {
  ClientPicker,
  VehiclePicker,
  clientDisplayName,
  ensureClientAndVehicle,
  useClientVehicleCatalog,
  vehiclePlate,
} from "../QuickPickers";

const RESULT_FILTERS = [
  { key: "todos", label: "Todos" },
  { key: "aprovado", label: "Aprovado" },
  { key: "atencao", label: "Atenção" },
  { key: "reprovado", label: "Reprovado" },
] as const;

const RESULT_LABELS: Record<string, string> = {
  aprovado: "Aprovado",
  atencao: "Atenção",
  reprovado: "Reprovado",
};

const RESULT_BADGE_CLASS: Record<string, string> = {
  aprovado: "concluido",
  atencao: "aguardando",
  reprovado: "cancelado",
};

type FormState = {
  title: string;
  vehicle: string;
  customer_name: string;
  resultado: string;
  quilometragem: string;
  tecnico: string;
  status: string;
  work_order_id: string;
  description: string;
  fotos: string[];
  checklist: InspectionChecklistItem[];
};

type InspectionChecklistItem = {
  id: string;
  name: string;
  result: string;
};

const emptyForm = (): FormState => ({
  title: "",
  vehicle: "",
  customer_name: "",
  resultado: "",
  quilometragem: "",
  tecnico: "",
  status: "em_andamento",
  work_order_id: "",
  description: "",
  fotos: [],
  checklist: [],
});

async function compressPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao ler imagem."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Imagem inválida."));
      img.onload = () => {
        const maxSide = 960;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(String(reader.result));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function normalizeChecklist(value: unknown): InspectionChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) return [];
    const result = ["aprovado", "atencao", "reprovado"].includes(String(item.result))
      ? String(item.result)
      : "aprovado";
    return [{
      id: typeof item.id === "string" && item.id ? item.id : `${index}-${name}`,
      name,
      result,
    }];
  });
}

export function InspectionsView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, removeRecord } = useModuleRecords(
    "inspections",
    session.user.id,
  );
  const { rows: workOrders } = useModuleRecords("work-orders", session.user.id);
  const { clients, vehicles, reload: reloadCatalog } = useClientVehicleCatalog();
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<string>("todos");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [customClient, setCustomClient] = useState(false);
  const [customVehicle, setCustomVehicle] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistDraft, setChecklistDraft] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const resultado = String(detail(row, "resultado") ?? "").toLowerCase();
      if (resultFilter !== "todos" && resultado !== resultFilter) return false;
      if (!q) return true;
      return [row.title, row.vehicle, row.customer_name, detail(row, "quilometragem")]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, query, resultFilter]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setCustomClient(clients.length === 0);
    setCustomVehicle(vehicles.length === 0);
    setChecklistOpen(false);
    setChecklistDraft("");
    setError("");
    setModalOpen(true);
  }

  useEffect(() => {
    const prefill = consumeVehicleActionPrefill();
    if (!prefill) return;
    openCreate();
    setForm((current) => ({
      ...current,
      title: prefill.plate ? `Vistoria · ${prefill.plate}` : current.title,
      vehicle: prefill.plate,
      customer_name: prefill.customerName,
    }));
  }, []);

  function openEdit(row: PanelRecord) {
    setEditing(row);
    const rawFotos = detail(row, "fotos");
    setForm({
      title: row.title ?? "",
      vehicle: row.vehicle ?? "",
      customer_name: row.customer_name ?? "",
      resultado: String(detail(row, "resultado") ?? ""),
      quilometragem: String(detail(row, "quilometragem") ?? ""),
      tecnico: String(detail(row, "tecnico") ?? ""),
      status: row.status ?? "em_andamento",
      work_order_id: String(detail(row, "work_order_id") ?? ""),
      description: row.description ?? "",
      fotos: Array.isArray(rawFotos) ? rawFotos.map(String) : [],
      checklist: normalizeChecklist(detail(row, "checklist")),
    });
    setCustomClient(!clients.some((client) => clientDisplayName(client).toLowerCase() === (row.customer_name ?? "").trim().toLowerCase()));
    setCustomVehicle(!vehicles.some((vehicle) => vehiclePlate(vehicle) === (row.vehicle ?? "").trim().toUpperCase()));
    setChecklistOpen(false);
    setChecklistDraft("");
    setError("");
    setModalOpen(true);
  }

  async function addPhotos(files: File[]) {
    const available = Math.max(0, 8 - form.fotos.length);
    const images = files.filter((file) => file.type.startsWith("image/")).slice(0, available);
    if (!images.length) {
      if (available === 0) setError("O limite de 8 fotos já foi atingido.");
      return;
    }
    try {
      const compressed = await Promise.all(images.map(compressPhoto));
      setForm((prev) => ({
        ...prev,
        fotos: [...prev.fotos, ...compressed].slice(0, 8),
      }));
    } catch {
      setError("Não foi possível processar uma das fotos.");
    }
  }

  async function handlePhotoUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await addPhotos(files);
  }

  function addChecklistItem() {
    const name = checklistDraft.trim();
    if (!name) return;
    setForm((prev) => ({
      ...prev,
      checklist: [...prev.checklist, { id: `${Date.now()}-${Math.random()}`, name, result: "aprovado" }],
    }));
    setChecklistDraft("");
  }

  async function saveInspection(status: string) {
    if (!form.title.trim()) {
      setError("Informe o título da vistoria.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const existingDetails =
        editing?.details && typeof editing.details === "object" ? editing.details : {};
      await saveRecord(editing, {
        title: form.title.trim(),
        vehicle: form.vehicle.trim().toUpperCase() || null,
        customer_name: form.customer_name.trim() || null,
        status,
        description: form.description.trim() || null,
        details: {
          ...existingDetails,
          resultado: form.resultado,
          quilometragem: form.quilometragem.trim() || null,
          tecnico: form.tecnico.trim() || null,
          work_order_id: form.work_order_id || null,
          fotos: form.fotos,
          checklist: form.checklist,
        },
      });
      await ensureClientAndVehicle({
        userId: session.user.id,
        clients,
        vehicles,
        customerName: form.customer_name,
        vehicle: form.vehicle,
        km: form.quilometragem.trim(),
        reload: reloadCatalog,
      });
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar vistoria.");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void saveInspection("concluido");
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <h1>Vistorias</h1>
        </div>
        <div className="admin-title-actions">
          <button type="button" className="admin-primary" onClick={openCreate}>
            <Plus size={16} /> Nova vistoria
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
            placeholder="Buscar por laudo, placa ou cliente..."
            value={query}
            onChange={(e) => setQuery(e.target.value)} id="admin-views-inspectionsview-208"
          />
        </div>
        <div className="admin-filter-pills">
          {RESULT_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`admin-pill ${resultFilter === f.key ? "active" : ""}`}
              onClick={() => setResultFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={5} />
      ) : filtered.length === 0 ? (
        <div className="admin-empty">Nenhuma vistoria encontrada.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Veículo</th>
                <th>Cliente</th>
                <th>Laudo</th>
                <th>Resultado</th>
                <th>Data</th>
                <th>Status</th>
                <th style={{ width: 72, textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const resultado = String(detail(row, "resultado") ?? "");
                const km = detail(row, "quilometragem");
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{asText(row.vehicle)}</strong>
                      {km ? (
                        <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                          {String(km)} km
                        </div>
                      ) : null}
                    </td>
                    <td>{asText(row.customer_name)}</td>
                    <td>{row.title}</td>
                    <td>
                      <AdminStatusBadge
                        status={RESULT_BADGE_CLASS[resultado] ?? (resultado || "novo")}
                        label={RESULT_LABELS[resultado] ?? (resultado ? asText(resultado) : "Não definido")}
                      />
                    </td>
                    <td>{dateText(row.created_at)}</td>
                    <td>
                      <AdminStatusBadge status={row.status} />
                    </td>
                    <td>
                      <AdminActionMenu
                        label={`Ações da vistoria ${row.title}`}
                        actions={[
                          { label: "Editar vistoria", icon: <Pencil size={14} />, onSelect: () => openEdit(row) },
                          { label: "Excluir vistoria", icon: <Trash2 size={14} />, onSelect: () => void removeRecord(row), destructive: true, separatorBefore: true },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className="admin-modal admin-inspection-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar vistoria" : "Nova vistoria"}</h2>
                <p>Registre as condições e os resultados da inspeção do veículo.</p>
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

            <form className="admin-inspection-form" onSubmit={handleSubmit}>
              <section className="admin-inspection-section is-first">
                <h3>Identificação</h3>
                <div className="admin-inspection-grid">
                  <div className="admin-field wide">
                    <label htmlFor="inspection-title">Título da vistoria *</label>
                    <input
                      id="inspection-title"
                      className="admin-input"
                      required
                      placeholder="Ex.: Vistoria preventiva de 40.000 km"
                      value={form.title}
                      onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                    />
                  </div>

                  <div className="admin-field">
                    <label htmlFor="inspection-vehicle">Veículo / placa</label>
                    {!customVehicle && vehicles.length > 0 ? (
                      <VehiclePicker
                        id="inspection-vehicle"
                        vehicles={vehicles}
                        value={form.vehicle}
                        clientName={form.customer_name}
                        placeholder="Buscar veículo..."
                        onSelectVehicle={(picked) => {
                          if (!picked) {
                            setForm((prev) => ({ ...prev, vehicle: "" }));
                            return;
                          }
                          setCustomVehicle(false);
                          const ownerName = (picked.customer_name ?? "").trim();
                          const km = String(detail(picked, "km") ?? "").trim();
                          setForm((prev) => ({
                            ...prev,
                            vehicle: vehiclePlate(picked),
                            customer_name: prev.customer_name || ownerName,
                            quilometragem: prev.quilometragem || km,
                          }));
                        }}
                      />
                    ) : (
                      <input
                        id="inspection-vehicle"
                        className="admin-input"
                        placeholder="Buscar ou informar placa..."
                        value={form.vehicle}
                        onChange={(e) => setForm((prev) => ({ ...prev, vehicle: e.target.value }))}
                      />
                    )}
                    {vehicles.length > 0 && (
                      <button
                        type="button"
                        className="admin-work-order-link"
                        onClick={() => setCustomVehicle((value) => !value)}
                      >
                        {customVehicle ? "+ Buscar veículo salvo" : "+ Novo veículo"}
                      </button>
                    )}
                  </div>

                  <div className="admin-field">
                    <label htmlFor="inspection-client">Cliente</label>
                    {!customClient && clients.length > 0 ? (
                      <ClientPicker
                        id="inspection-client"
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
                          const matchVehicle = vehicles.find(
                            (vehicle) => (vehicle.customer_name ?? "").trim().toLowerCase() === name.toLowerCase(),
                          );
                          setForm((prev) => ({
                            ...prev,
                            customer_name: name,
                            vehicle: matchVehicle && !prev.vehicle ? vehiclePlate(matchVehicle) : prev.vehicle,
                            quilometragem: !prev.quilometragem && matchVehicle
                              ? String(detail(matchVehicle, "km") ?? "").trim()
                              : prev.quilometragem,
                          }));
                        }}
                      />
                    ) : (
                      <input
                        id="inspection-client"
                        className="admin-input"
                        placeholder="Buscar ou informar cliente..."
                        value={form.customer_name}
                        onChange={(e) => setForm((prev) => ({ ...prev, customer_name: e.target.value }))}
                      />
                    )}
                    {clients.length > 0 && (
                      <button
                        type="button"
                        className="admin-work-order-link"
                        onClick={() => setCustomClient((value) => !value)}
                      >
                        {customClient ? "+ Buscar cliente salvo" : "+ Novo cliente"}
                      </button>
                    )}
                  </div>

                  <div className="admin-field">
                    <label htmlFor="inspection-odometer">Quilometragem</label>
                    <div className="admin-inspection-input-with-suffix">
                      <input
                        id="inspection-odometer"
                        className="admin-input"
                        inputMode="numeric"
                        placeholder="42.500"
                        value={form.quilometragem}
                        onChange={(e) => setForm((prev) => ({ ...prev, quilometragem: e.target.value }))}
                      />
                      <span>km</span>
                    </div>
                  </div>

                  <div className="admin-field">
                    <label htmlFor="inspection-technician">Técnico responsável</label>
                    <input
                      id="inspection-technician"
                      className="admin-input"
                      list="inspection-technician-options"
                      placeholder="Selecionar técnico"
                      value={form.tecnico}
                      onChange={(e) => setForm((prev) => ({ ...prev, tecnico: e.target.value }))}
                    />
                    <datalist id="inspection-technician-options">
                      {Array.from(new Set(rows.map((row) => String(detail(row, "tecnico") ?? "").trim()).filter(Boolean))).map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                  <div className="admin-field wide">
                    <label htmlFor="inspection-work-order">Vincular à ordem de serviço</label>
                    <select
                      id="inspection-work-order"
                      className="admin-select"
                      value={form.work_order_id}
                      onChange={(event) => setForm((prev) => ({ ...prev, work_order_id: event.target.value }))}
                    >
                      <option value="">Sem vínculo</option>
                      {workOrders.filter((order) => order.status !== "cancelado").map((order) => (
                        <option key={order.id} value={order.id}>
                          {order.title} · {order.customer_name || "Sem cliente"} · {order.vehicle || "Sem placa"}
                        </option>
                      ))}
                    </select>
                    <small style={{ color: "var(--admin-muted)" }}>A vistoria, o checklist e as fotos aparecerão no histórico da OS.</small>
                  </div>
                </div>
              </section>

              <section className="admin-inspection-section">
                <h3>Avaliação técnica</h3>
                <div className="admin-field">
                  <label>Resultado da vistoria</label>
                  <div className="admin-inspection-results" role="group" aria-label="Resultado da vistoria">
                    <button
                      type="button"
                      className={`admin-inspection-result is-approved${form.resultado === "aprovado" ? " is-selected" : ""}`}
                      aria-pressed={form.resultado === "aprovado"}
                      onClick={() => setForm((prev) => ({ ...prev, resultado: "aprovado" }))}
                    >
                      <CheckCircle2 size={14} /> Aprovado
                    </button>
                    <button
                      type="button"
                      className={`admin-inspection-result is-caution${form.resultado === "atencao" ? " is-selected" : ""}`}
                      aria-pressed={form.resultado === "atencao"}
                      onClick={() => setForm((prev) => ({ ...prev, resultado: "atencao" }))}
                    >
                      <AlertCircle size={14} /> Com ressalvas
                    </button>
                    <button
                      type="button"
                      className={`admin-inspection-result is-rejected${form.resultado === "reprovado" ? " is-selected" : ""}`}
                      aria-pressed={form.resultado === "reprovado"}
                      onClick={() => setForm((prev) => ({ ...prev, resultado: "reprovado" }))}
                    >
                      <XCircle size={14} /> Reprovado
                    </button>
                  </div>
                  <small className="admin-inspection-result-hint">
                    {form.resultado ? RESULT_LABELS[form.resultado] : "Nenhum resultado definido."}
                  </small>
                </div>

                <div className="admin-inspection-checklist">
                  <button
                    type="button"
                    className="admin-inspection-checklist-summary"
                    aria-expanded={checklistOpen}
                    onClick={() => setChecklistOpen((open) => !open)}
                  >
                    <span className="admin-inspection-checklist-icon"><ClipboardCheck size={15} /></span>
                    <span className="admin-inspection-checklist-copy">
                      <strong>Checklist de inspeção</strong>
                      <small>{form.checklist.length ? `${form.checklist.length} componentes avaliados` : "Adicione os componentes avaliados"}</small>
                    </span>
                    <span className="admin-inspection-checklist-config">{checklistOpen ? "Fechar" : "Configurar"}</span>
                    <ChevronRight className={checklistOpen ? "is-open" : ""} size={15} />
                  </button>
                  {checklistOpen && (
                    <div className="admin-inspection-checklist-editor">
                      <div className="admin-inspection-checklist-add">
                        <input
                          className="admin-input"
                          placeholder="Ex.: Freios, pneus, iluminação..."
                          value={checklistDraft}
                          onChange={(e) => setChecklistDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addChecklistItem();
                            }
                          }}
                        />
                        <button type="button" className="admin-secondary" onClick={addChecklistItem}>
                          <Plus size={14} /> Adicionar
                        </button>
                      </div>
                      {form.checklist.map((item) => (
                        <div className="admin-inspection-checklist-row" key={item.id}>
                          <span>{item.name}</span>
                          <select
                            className="admin-select"
                            aria-label={`Resultado de ${item.name}`}
                            value={item.result}
                            onChange={(e) => setForm((prev) => ({
                              ...prev,
                              checklist: prev.checklist.map((current) => current.id === item.id
                                ? { ...current, result: e.target.value }
                                : current),
                            }))}
                          >
                            <option value="aprovado">Aprovado</option>
                            <option value="atencao">Com ressalvas</option>
                            <option value="reprovado">Reprovado</option>
                          </select>
                          <button
                            type="button"
                            className="admin-icon-btn"
                            aria-label={`Remover ${item.name} do checklist`}
                            onClick={() => setForm((prev) => ({
                              ...prev,
                              checklist: prev.checklist.filter((current) => current.id !== item.id),
                            }))}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="admin-field admin-inspection-observations">
                  <label htmlFor="inspection-observations">Observações e recomendações</label>
                  <textarea
                    id="inspection-observations"
                    className="admin-textarea"
                    rows={3}
                    placeholder="Descreva os problemas encontrados e as recomendações técnicas..."
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  />
                </div>
              </section>

              <section className="admin-inspection-section admin-inspection-photos-section">
                <div className="admin-inspection-section-title-row">
                  <h3>Registro fotográfico</h3>
                  <span>{form.fotos.length}/8 fotos</span>
                </div>
                <label
                  className={`admin-inspection-upload${form.fotos.length >= 8 ? " is-full" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void addPhotos(Array.from(e.dataTransfer.files));
                  }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    disabled={form.fotos.length >= 8}
                    onChange={(e) => void handlePhotoUpload(e)}
                  />
                  <span className="admin-inspection-upload-camera"><Camera size={17} /></span>
                  <span className="admin-inspection-upload-copy">
                    <strong>{form.fotos.length >= 8 ? "Limite de fotos atingido" : "Anexar fotos da vistoria"}</strong>
                    <small>Selecione ou arraste até {8 - form.fotos.length} imagens</small>
                  </span>
                  <Upload size={15} className="admin-inspection-upload-icon" />
                </label>
                {form.fotos.length > 0 && (
                  <div className="admin-inspection-photo-list">
                    {form.fotos.map((src, idx) => (
                      <div className="admin-inspection-photo" key={`${idx}-${src.slice(0, 18)}`}>
                        <img src={src} alt={`Foto da vistoria ${idx + 1}`} />
                        <button
                          type="button"
                          aria-label={`Remover foto ${idx + 1}`}
                          onClick={() => setForm((prev) => ({
                            ...prev,
                            fotos: prev.fotos.filter((_, i) => i !== idx),
                          }))}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {error && <p className="admin-form-error admin-inspection-modal-error">{error}</p>}

              <div className="admin-inspection-footer">
                <div className="admin-inspection-footer-status">
                  <span>Status da vistoria</span>
                  <strong>{statusLabels[form.status] ?? form.status.replaceAll("_", " ")}</strong>
                </div>
                <div className="admin-inspection-footer-actions">
                  <button type="button" className="admin-secondary" onClick={() => setModalOpen(false)} disabled={saving}>
                    Cancelar
                  </button>
                  <button type="button" className="admin-secondary" onClick={() => void saveInspection("novo")} disabled={saving}>
                    {saving ? "Salvando..." : "Salvar rascunho"}
                  </button>
                  <button type="submit" className="admin-primary" disabled={saving}>
                    {saving ? "Salvando..." : "Concluir vistoria"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
