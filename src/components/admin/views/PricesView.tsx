"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Pencil, Plus, Power, Search, Tags, Trash2, X } from "lucide-react";
import type { PanelRecord } from "../../../lib/supabase";
import { AdminActionMenu } from "../ActionMenu";
import { pricingModeForService } from "../../../lib/servicePricing";
import { SkeletonTable } from "../Skeletons";
import { AdminStatusBadge } from "../StatusBadge";
import { asText, detail, money, useModuleRecords, modalBackdropProps } from "../utils";

type RuleForm = {
  service_id: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_engine: string;
  vehicle_transmission: string;
  year_from: string;
  year_to: string;
  all_model_years: boolean;
  vehicle_application: string;
  amount: string;
  valid_from: string;
  valid_until: string;
  description: string;
  status: string;
};

const emptyForm: RuleForm = {
  service_id: "",
  vehicle_make: "",
  vehicle_model: "",
  vehicle_engine: "",
  vehicle_transmission: "",
  year_from: "",
  year_to: "",
  all_model_years: false,
  vehicle_application: "",
  amount: "",
  valid_from: "",
  valid_until: "",
  description: "",
  status: "concluido",
};

const VEHICLE_SPECS_PREFIX = "__BENITTES_VEHICLE_SPECS_V1__";

type VehicleSpecs = Pick<RuleForm, "vehicle_engine" | "vehicle_transmission" | "vehicle_application">;

function vehicleSpecsFromApplication(value: unknown): VehicleSpecs {
  const raw = typeof value === "string" ? value : "";
  if (!raw.startsWith(VEHICLE_SPECS_PREFIX)) {
    return { vehicle_engine: "", vehicle_transmission: "", vehicle_application: raw };
  }

  try {
    const parsed = JSON.parse(raw.slice(VEHICLE_SPECS_PREFIX.length)) as Partial<VehicleSpecs>;
    return {
      vehicle_engine: typeof parsed.vehicle_engine === "string" ? parsed.vehicle_engine : "",
      vehicle_transmission: typeof parsed.vehicle_transmission === "string" ? parsed.vehicle_transmission : "",
      vehicle_application: typeof parsed.vehicle_application === "string" ? parsed.vehicle_application : "",
    };
  } catch {
    return { vehicle_engine: "", vehicle_transmission: "", vehicle_application: raw };
  }
}

function vehicleApplicationForStorage(form: RuleForm): string | null {
  const specs: VehicleSpecs = {
    vehicle_engine: form.vehicle_engine.trim(),
    vehicle_transmission: form.vehicle_transmission.trim(),
    vehicle_application: form.vehicle_application.trim(),
  };
  if (!Object.values(specs).some(Boolean)) return null;
  return `${VEHICLE_SPECS_PREFIX}${JSON.stringify(specs)}`;
}

function vehicleApplicationLabel(value: unknown): string {
  const specs = vehicleSpecsFromApplication(value);
  return [
    specs.vehicle_engine && `Motor: ${specs.vehicle_engine}`,
    specs.vehicle_transmission && `Câmbio: ${specs.vehicle_transmission}`,
    specs.vehicle_application && `Aplicação: ${specs.vehicle_application}`,
  ].filter(Boolean).join(" · ");
}

function ruleName(service: PanelRecord, form: RuleForm): string {
  const vehicle = [form.vehicle_make.trim(), form.vehicle_model.trim()].filter(Boolean).join(" ");
  const years = form.year_from || form.year_to
    ? ` · ${form.year_from || "…"}–${form.year_to || "…"}`
    : "";
  return `${service.title}${vehicle ? ` · ${vehicle}` : ""}${years}`.slice(0, 160);
}

export function PricesView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, patchRecord, removeRecord } = useModuleRecords(
    "prices",
    session.user.id,
  );
  const { rows: serviceRows, loading: servicesLoading } = useModuleRecords("services", session.user.id);
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const services = useMemo(
    () => serviceRows.filter((service) => service.status !== "cancelado" && pricingModeForService(service) === "vehicle"),
    [serviceRows],
  );
  const selectedService = services.find((service) => service.id === form.service_id) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    if (!q) return rows;
    return rows.filter((row) =>
      [row.title, row.description, detail(row, "vehicle_make"), detail(row, "vehicle_model"), detail(row, "vehicle_application")]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(q)),
    );
  }, [rows, query]);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, service_id: services[0]?.id ?? "" });
    setError("");
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    setEditing(row);
    const vehicleSpecs = vehicleSpecsFromApplication(detail(row, "vehicle_application"));
    const yearFrom = detail(row, "year_from");
    const yearTo = detail(row, "year_to");
    setForm({
      service_id: String(detail(row, "service_id") ?? ""),
      vehicle_make: String(detail(row, "vehicle_make") ?? ""),
      vehicle_model: String(detail(row, "vehicle_model") ?? ""),
      vehicle_engine: vehicleSpecs.vehicle_engine,
      vehicle_transmission: vehicleSpecs.vehicle_transmission,
      year_from: yearFrom == null ? "" : String(yearFrom),
      year_to: yearTo == null ? "" : String(yearTo),
      all_model_years: yearFrom == null && yearTo == null,
      vehicle_application: vehicleSpecs.vehicle_application,
      amount: row.amount == null ? "" : String(row.amount),
      valid_from: String(detail(row, "valid_from") ?? "").slice(0, 10),
      valid_until: String(detail(row, "valid_until") ?? "").slice(0, 10),
      description: row.description ?? "",
      status: row.status || "concluido",
    });
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const service = services.find((item) => item.id === form.service_id);
    const price = Number(form.amount.replace(",", "."));
    const yearFrom = form.all_model_years || !form.year_from ? null : Number(form.year_from);
    const yearTo = form.all_model_years || !form.year_to ? null : Number(form.year_to);
    if (!service) {
      setError("Selecione um serviço cadastrado como preço por veículo.");
      return;
    }
    if (!form.vehicle_make.trim() && !form.vehicle_model.trim()) {
      setError("Informe ao menos a marca ou o modelo do veículo.");
      return;
    }
    if (!form.all_model_years && yearFrom === null && yearTo === null) {
      setError("Informe uma faixa de ano ou marque a opção para todos os anos do modelo.");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setError("Informe um valor maior que zero.");
      return;
    }
    if ([yearFrom, yearTo].some((year) => year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200))) {
      setError("Use anos entre 1900 e 2200.");
      return;
    }
    if (yearFrom !== null && yearTo !== null && yearTo < yearFrom) {
      setError("O ano final precisa ser igual ou posterior ao ano inicial.");
      return;
    }
    if (form.valid_from && form.valid_until && form.valid_until < form.valid_from) {
      setError("A validade final precisa ser igual ou posterior à inicial.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await saveRecord(editing, {
        title: ruleName(service, form),
        amount: price,
        status: form.status,
        description: form.description.trim() || null,
        details: {
          ...(editing?.details ?? {}),
          service_id: service.id,
          vehicle_make: form.vehicle_make.trim() || null,
          vehicle_model: form.vehicle_model.trim() || null,
          year_from: yearFrom,
          year_to: yearTo,
          vehicle_application: vehicleApplicationForStorage(form),
          valid_from: form.valid_from || null,
          valid_until: form.valid_until || null,
        },
      });
      setModalOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar a tarifa.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: PanelRecord) {
    try {
      await patchRecord(row.id, { status: row.status === "cancelado" ? "concluido" : "cancelado" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar a tarifa.");
    }
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <h1>Preços por veículo</h1>
          <p className="admin-page-desc">Cadastre valores diferentes por marca, modelo e faixa de ano.</p>
        </div>
        <div className="admin-title-actions">
          <a href="/painel/servicos/" className="admin-secondary" style={{ textDecoration: "none" }}>
            Gerenciar serviços
          </a>
          <button type="button" className="admin-primary" onClick={openCreate} disabled={servicesLoading || services.length === 0}>
            <Plus size={16} /> Nova tarifa
          </button>
        </div>
      </div>

      {error && !modalOpen && <p className="admin-form-error" style={{ marginBottom: 16 }}>{error}</p>}
      <div className="admin-toolbar">
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            className="admin-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar serviço, marca, modelo ou aplicação..." id="admin-views-pricesview-189"
          />
        </div>
        <span className="admin-muted">{rows.length} {rows.length === 1 ? "regra" : "regras"}</span>
      </div>

      {loading || servicesLoading ? (
        <SkeletonTable rows={4} />
      ) : services.length === 0 && rows.length === 0 ? (
        <div className="admin-empty">
          <Tags size={24} />
          <strong>Configure primeiro um serviço por veículo</strong>
          <p>Abra o catálogo, escolha “Preço por veículo” e depois cadastre as tarifas de cada aplicação.</p>
          <a href="/painel/servicos/" className="admin-primary admin-prices-empty-action">Abrir catálogo de serviços</a>
        </div>
      ) : rows.length === 0 ? (
        <div className="admin-empty">
          <Tags size={24} />
          <strong>Nenhuma tarifa cadastrada</strong>
          <p>Adicione uma regra para o sistema consultar o valor correto de cada carro.</p>
          <button type="button" className="admin-primary admin-prices-empty-action" onClick={openCreate}>
            <Plus size={15} /> Nova tarifa
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="admin-empty">
          <Search size={24} />
          <strong>Nenhuma tarifa encontrada</strong>
          <p>Tente buscar por outro serviço, marca, modelo ou aplicação.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Serviço</th>
                <th>Aplicação</th>
                <th>Validade</th>
                <th>Valor</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const service = serviceRows.find((item) => item.id === detail(row, "service_id"));
                const make = String(detail(row, "vehicle_make") ?? "").trim();
                const model = String(detail(row, "vehicle_model") ?? "").trim();
                const yearFrom = detail(row, "year_from");
                const yearTo = detail(row, "year_to");
                const yearLabel = yearFrom || yearTo ? `${yearFrom || "…"}–${yearTo || "…"}` : "todos os anos";
                const applicationLabel = vehicleApplicationLabel(detail(row, "vehicle_application"));
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{service?.title ?? row.title}</strong>
                      <div className="admin-muted">{service ? asText(detail(service, "categoria")) : "Serviço removido ou não vinculado"}</div>
                    </td>
                    <td>
                      {[make, model].filter(Boolean).join(" ") || String(detail(row, "vehicle_application") ?? "Aplicação antiga para revisar")}
                      <div className="admin-muted">
                        {yearLabel}{applicationLabel ? ` · ${applicationLabel}` : ""}
                      </div>
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                        <CalendarDays size={13} />
                        {detail(row, "valid_from") || detail(row, "valid_until")
                          ? `${asText(detail(row, "valid_from"))} — ${asText(detail(row, "valid_until"))}`
                          : "Sem prazo"}
                      </span>
                    </td>
                    <td><strong>{row.amount && row.amount > 0 ? money(row.amount) : "Valor pendente"}</strong></td>
                    <td><AdminStatusBadge status={row.status} label={row.status === "cancelado" ? "Inativa" : "Ativa"} /></td>
                    <td>
                      <AdminActionMenu
                        label={`Ações da regra de ${row.title}`}
                        actions={[
                          { label: row.status === "cancelado" ? "Ativar tarifa" : "Desativar tarifa", icon: <Power size={14} />, onSelect: () => void toggleActive(row) },
                          { label: "Editar tarifa", icon: <Pencil size={14} />, onSelect: () => openEdit(row), separatorBefore: true },
                          { label: "Excluir tarifa", icon: <Trash2 size={14} />, onSelect: () => void removeRecord(row), destructive: true },
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
          <div className="admin-modal admin-price-rule-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-head admin-price-rule-head">
              <div>
                <h2>{editing ? "Editar tarifa" : "Nova tarifa por veículo"}</h2>
                <p>Configure um preço específico de mão de obra para determinado veículo.</p>
              </div>
              <button type="button" className="admin-icon-btn" onClick={() => setModalOpen(false)} aria-label="Fechar"><X size={16} /></button>
            </div>
            <form className="admin-price-rule-form" onSubmit={(event) => void handleSubmit(event)}>
              <section className="admin-price-rule-section">
                <h3>Serviço e aplicação</h3>
                <label className="admin-field admin-price-rule-wide">
                  <span>Serviço *</span>
                  <select className="admin-select" required value={form.service_id} onChange={(event) => setForm({ ...form, service_id: event.target.value })} id="admin-views-pricesview-291" name="service_id">
                    <option value="">Selecionar serviço</option>
                    {services.map((service) => <option key={service.id} value={service.id}>{service.title}</option>)}
                  </select>
                </label>
                <div className="admin-price-rule-grid">
                  <label className="admin-field">
                    <span>Marca</span>
                    <input className="admin-input" maxLength={100} value={form.vehicle_make} onChange={(event) => setForm({ ...form, vehicle_make: event.target.value })} placeholder="Ex.: Hyundai" id="admin-views-pricesview-297" name="vehicle_make" />
                  </label>
                  <label className="admin-field">
                    <span>Modelo</span>
                    <input className="admin-input" maxLength={120} value={form.vehicle_model} onChange={(event) => setForm({ ...form, vehicle_model: event.target.value })} placeholder="Ex.: HB20" id="admin-views-pricesview-300" name="vehicle_model" />
                  </label>
                  <label className={`admin-field${form.all_model_years ? " is-disabled" : ""}`}>
                    <span>Ano inicial</span>
                    <input className="admin-input" type="number" min={1900} max={2200} step={1} disabled={form.all_model_years} value={form.year_from} onChange={(event) => setForm({ ...form, year_from: event.target.value })} placeholder="Ex.: 2020" id="admin-views-pricesview-303" name="year_from" />
                  </label>
                  <label className={`admin-field${form.all_model_years ? " is-disabled" : ""}`}>
                    <span>Ano final</span>
                    <input className="admin-input" type="number" min={1900} max={2200} step={1} disabled={form.all_model_years} value={form.year_to} onChange={(event) => setForm({ ...form, year_to: event.target.value })} placeholder="Ex.: 2026" id="admin-views-pricesview-306" name="year_to" />
                  </label>
                  <label className="admin-field">
                    <span>Motorização</span>
                    <input className="admin-input" maxLength={70} value={form.vehicle_engine} onChange={(event) => setForm({ ...form, vehicle_engine: event.target.value })} placeholder="Ex.: 1.0 Flex" id="admin-views-pricesview-engine" name="vehicle_engine" />
                  </label>
                  <label className="admin-field">
                    <span>Câmbio</span>
                    <input className="admin-input" maxLength={50} value={form.vehicle_transmission} onChange={(event) => setForm({ ...form, vehicle_transmission: event.target.value })} placeholder="Ex.: Manual" id="admin-views-pricesview-transmission" name="vehicle_transmission" />
                  </label>
                </div>
                <label className="admin-price-rule-check">
                  <input
                    type="checkbox"
                    name="all_model_years"
                    id="admin-views-pricesview-all-years"
                    checked={form.all_model_years}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      all_model_years: event.target.checked,
                      year_from: event.target.checked ? "" : current.year_from,
                      year_to: event.target.checked ? "" : current.year_to,
                    }))}
                  />
                  Aplicar a todos os anos do modelo
                </label>
              </section>

              <section className="admin-price-rule-section">
                <h3>Preço e vigência</h3>
                <div className="admin-price-rule-value-panel">
                  <label className="admin-field">
                    <span>Valor da mão de obra *</span>
                    <span className="admin-price-rule-money-input">
                      <span aria-hidden="true">R$</span>
                      <input className="admin-input" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0,00" id="admin-views-pricesview-309" name="amount" />
                    </span>
                  </label>
                  <small>Valor sugerido automaticamente nos orçamentos e ordens de serviço.</small>
                </div>
                <div className="admin-price-rule-grid admin-price-rule-dates">
                  <label className="admin-field">
                    <span>Válida a partir de</span>
                    <input className="admin-input" type="date" value={form.valid_from} onChange={(event) => setForm({ ...form, valid_from: event.target.value })} id="admin-views-pricesview-315" name="valid_from" />
                  </label>
                  <label className="admin-field">
                    <span>Válida até</span>
                    <input className="admin-input" type="date" value={form.valid_until} onChange={(event) => setForm({ ...form, valid_until: event.target.value })} id="admin-views-pricesview-318" name="valid_until" />
                  </label>
                </div>
              </section>

              <section className="admin-price-rule-section">
                <h3>Informações adicionais</h3>
                <div className="admin-price-rule-grid">
                  <label className="admin-field admin-price-rule-wide">
                    <span>Aplicação / versão <small>(opcional)</small></span>
                    <input className="admin-input" maxLength={160} value={form.vehicle_application} onChange={(event) => setForm({ ...form, vehicle_application: event.target.value })} placeholder="Ex.: Comfort, motor 1.0 12V" id="admin-views-pricesview-312" name="vehicle_application" />
                  </label>
                  <label className="admin-field admin-price-rule-wide">
                    <span>Observações internas <small>(opcional)</small></span>
                    <textarea className="admin-textarea" rows={2} maxLength={4000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Condições, exceções ou notas para a equipe..." id="admin-views-pricesview-321" name="description" />
                  </label>
                </div>
                <label className="admin-price-rule-status">
                  <span>
                    <strong>Tarifa ativa</strong>
                    <small>Disponível para utilização em novos orçamentos.</small>
                  </span>
                  <span className="admin-price-rule-switch">
                    <input
                      type="checkbox"
                      name="status"
                      id="admin-views-pricesview-324"
                      checked={form.status !== "cancelado"}
                      onChange={(event) => setForm({ ...form, status: event.target.checked ? "concluido" : "cancelado" })}
                    />
                    <span aria-hidden="true" />
                  </span>
                </label>
              </section>

              {error && <p className="admin-form-error" role="alert">{error}</p>}
              <div className="admin-price-rule-footer">
                <small>* Campos obrigatórios</small>
                <div>
                  <button type="button" className="admin-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
                  <button type="submit" className="admin-primary" disabled={saving}>{saving ? "Salvando…" : editing ? "Salvar alterações" : "Cadastrar tarifa"}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
