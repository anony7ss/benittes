"use client";

import { SkeletonTable } from "../Skeletons";
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Camera, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { PanelRecord } from "../../../lib/supabase";
import { AdminStatusBadge, statusLabels } from "../StatusBadge";
import { asText, dateText, detail, useModuleRecords, modalBackdropProps } from "../utils";
import {
  ClientPicker,
  PlateLookupButton,
  VehiclePicker,
  clientDisplayName,
  ensureClientAndVehicle,
  useClientVehicleCatalog,
  vehiclePlate,
} from "../QuickPickers";

const STATUS_OPTIONS = ["novo", "em_andamento", "aguardando", "concluido", "cancelado"] as const;

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
  status: string;
  description: string;
  fotos: string[];
};

const emptyForm = (): FormState => ({
  title: "",
  vehicle: "",
  customer_name: "",
  resultado: "aprovado",
  quilometragem: "",
  status: "concluido",
  description: "",
  fotos: [],
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

export function InspectionsView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, removeRecord } = useModuleRecords(
    "inspections",
    session.user.id,
  );
  const { clients, vehicles, reload: reloadCatalog } = useClientVehicleCatalog();
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<string>("todos");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

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
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    setEditing(row);
    const rawFotos = detail(row, "fotos");
    setForm({
      title: row.title ?? "",
      vehicle: row.vehicle ?? "",
      customer_name: row.customer_name ?? "",
      resultado: String(detail(row, "resultado") ?? "aprovado"),
      quilometragem: String(detail(row, "quilometragem") ?? ""),
      status: row.status ?? "concluido",
      description: row.description ?? "",
      fotos: Array.isArray(rawFotos) ? rawFotos.map(String) : [],
    });
    setModalOpen(true);
  }

  async function handlePhotoUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 6);
    e.target.value = "";
    if (files.length === 0) return;
    try {
      const compressed = await Promise.all(files.map(compressPhoto));
      setForm((prev) => ({
        ...prev,
        fotos: [...prev.fotos, ...compressed].slice(0, 8),
      }));
    } catch {
      setError("Não foi possível processar uma das fotos.");
    }
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
        vehicle: form.vehicle.trim().toUpperCase() || null,
        customer_name: form.customer_name.trim() || null,
        status: form.status,
        description: form.description.trim() || null,
        details: {
          ...existingDetails,
          resultado: form.resultado,
          quilometragem: form.quilometragem.trim() || null,
          fotos: form.fotos,
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

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">CHECKLIST E LAUDOS</p>
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
            onChange={(e) => setQuery(e.target.value)}
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
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const resultado = String(detail(row, "resultado") ?? "aprovado");
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
                        status={RESULT_BADGE_CLASS[resultado] ?? resultado}
                        label={RESULT_LABELS[resultado] ?? asText(resultado)}
                      />
                    </td>
                    <td>{dateText(row.created_at)}</td>
                    <td>
                      <AdminStatusBadge status={row.status} />
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          type="button"
                          className="admin-icon-btn"
                          title="Editar vistoria"
                          onClick={() => openEdit(row)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="admin-ghost-danger"
                          title="Remover vistoria"
                          onClick={() => void removeRecord(row)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
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
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar Vistoria" : "Nova Vistoria"}</h2>
                <p>Registre o resultado da inspeção técnica e observações do checklist.</p>
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
                  <label>Laudo / Título *</label>
                  <input
                    className="admin-input"
                    required
                    placeholder="Ex: Vistoria preventiva 40.000 km"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
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
                      const km = String(detail(picked, "km") ?? "").trim();
                      setForm({
                        ...form,
                        vehicle: vehiclePlate(picked),
                        customer_name: form.customer_name || (picked.customer_name ?? "").trim(),
                        quilometragem: form.quilometragem || km,
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
                      const km = matchVeh ? String(detail(matchVeh, "km") ?? "").trim() : "";
                      setForm({
                        ...form,
                        customer_name: name,
                        vehicle: matchVeh && !form.vehicle ? vehiclePlate(matchVeh) : form.vehicle,
                        quilometragem: !form.quilometragem && km ? km : form.quilometragem,
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
                  <label>Resultado</label>
                  <select
                    className="admin-select"
                    value={form.resultado}
                    onChange={(e) => setForm({ ...form, resultado: e.target.value })}
                  >
                    <option value="aprovado">Aprovado</option>
                    <option value="atencao">Atenção</option>
                    <option value="reprovado">Reprovado</option>
                  </select>
                </div>

                <div className="admin-field">
                  <label>Quilometragem</label>
                  <input
                    className="admin-input"
                    placeholder="Ex: 42500"
                    value={form.quilometragem}
                    onChange={(e) => setForm({ ...form, quilometragem: e.target.value })}
                  />
                </div>

                <div className="admin-field wide">
                  <label>Status</label>
                  <select
                    className="admin-select"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {STATUS_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {statusLabels[st] ?? st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="admin-field wide">
                  <label>Observações / Checklist</label>
                  <textarea
                    className="admin-textarea"
                    rows={3}
                    placeholder="Itens inspecionados, apontamentos e recomendações..."
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>

                <div className="admin-field wide">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <label style={{ margin: 0 }}>Fotos da vistoria ({form.fotos.length}/8)</label>
                    <label className="admin-secondary" style={{ height: 30, minHeight: 30, padding: "0 10px", fontSize: 12, cursor: "pointer" }}>
                      <Camera size={13} /> Anexar fotos
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        multiple
                        onChange={(e) => void handlePhotoUpload(e)}
                        style={{ display: "none" }}
                      />
                    </label>
                  </div>
                  {form.fotos.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                      {form.fotos.map((src, idx) => (
                        <div
                          key={idx}
                          style={{
                            position: "relative",
                            width: 76,
                            height: 76,
                            borderRadius: 6,
                            overflow: "hidden",
                            border: "1px solid var(--admin-line)",
                          }}
                        >
                          <img
                            src={src}
                            alt={`Vistoria ${idx + 1}`}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                fotos: prev.fotos.filter((_, i) => i !== idx),
                              }))
                            }
                            style={{
                              position: "absolute",
                              top: 3,
                              right: 3,
                              width: 20,
                              height: 20,
                              borderRadius: 999,
                              background: "rgba(0,0,0,0.7)",
                              color: "#fff",
                              border: 0,
                              display: "grid",
                              placeItems: "center",
                              cursor: "pointer",
                            }}
                            aria-label="Remover foto"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
