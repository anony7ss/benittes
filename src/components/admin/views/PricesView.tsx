"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Pencil, Plus, Power, Search, Tags, Trash2, X } from "lucide-react";
import type { PanelRecord } from "../../../lib/supabase";
import { pricingModeForService } from "../../../lib/servicePricing";
import { SkeletonTable } from "../Skeletons";
import { AdminStatusBadge } from "../StatusBadge";
import { asText, detail, money, useModuleRecords, modalBackdropProps } from "../utils";

type RuleForm = {
  service_id: string;
  vehicle_make: string;
  vehicle_model: string;
  year_from: string;
  year_to: string;
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
  year_from: "",
  year_to: "",
  vehicle_application: "",
  amount: "",
  valid_from: "",
  valid_until: "",
  description: "",
  status: "concluido",
};

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
    setForm({
      service_id: String(detail(row, "service_id") ?? ""),
      vehicle_make: String(detail(row, "vehicle_make") ?? ""),
      vehicle_model: String(detail(row, "vehicle_model") ?? ""),
      year_from: detail(row, "year_from") == null ? "" : String(detail(row, "year_from")),
      year_to: detail(row, "year_to") == null ? "" : String(detail(row, "year_to")),
      vehicle_application: String(detail(row, "vehicle_application") ?? ""),
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
    const yearFrom = form.year_from ? Number(form.year_from) : null;
    const yearTo = form.year_to ? Number(form.year_to) : null;
    if (!service) {
      setError("Selecione um serviço cadastrado como preço por veículo.");
      return;
    }
    if (!form.vehicle_make.trim() && !form.vehicle_model.trim()) {
      setError("Informe ao menos a marca ou o modelo do veículo.");
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
          vehicle_application: form.vehicle_application.trim() || null,
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
          <p className="admin-kicker">TABELA DE APLICAÇÕES</p>
          <h1>Preços por veículo</h1>
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

      {error && <p className="admin-form-error" style={{ marginBottom: 16 }}>{error}</p>}
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
                <th aria-label="Ações" />
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
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{service?.title ?? row.title}</strong>
                      <div className="admin-muted">{service ? asText(detail(service, "categoria")) : "Serviço removido ou não vinculado"}</div>
                    </td>
                    <td>
                      {[make, model].filter(Boolean).join(" ") || String(detail(row, "vehicle_application") ?? "Aplicação antiga para revisar")}
                      <div className="admin-muted">
                        {yearLabel}{detail(row, "vehicle_application") ? ` · ${String(detail(row, "vehicle_application"))}` : ""}
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
                      <div style={{ display: "flex", gap: 5 }}>
                        <button type="button" className="admin-icon-btn" title={row.status === "cancelado" ? "Ativar" : "Desativar"} onClick={() => void toggleActive(row)}><Power size={14} /></button>
                        <button type="button" className="admin-icon-btn" title="Editar" onClick={() => openEdit(row)}><Pencil size={14} /></button>
                        <button type="button" className="admin-icon-btn danger" title="Excluir" onClick={() => void removeRecord(row)}><Trash2 size={14} /></button>
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
          <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-head">
              <div><h2>{editing ? "Editar tarifa" : "Nova tarifa por veículo"}</h2><p>Informe a aplicação exata para evitar apresentar um valor de outro carro.</p></div>
              <button type="button" className="admin-icon-btn" onClick={() => setModalOpen(false)} aria-label="Fechar"><X size={16} /></button>
            </div>
            <form onSubmit={(event) => void handleSubmit(event)}>
              <div className="admin-form-grid">
                <label className="admin-field wide">Serviço
                  <select className="admin-select" required value={form.service_id} onChange={(event) => setForm({ ...form, service_id: event.target.value })} id="admin-views-pricesview-291">
                    <option value="">Selecione um serviço variável</option>
                    {services.map((service) => <option key={service.id} value={service.id}>{service.title}</option>)}
                  </select>
                </label>
                <label className="admin-field">Marca
                  <input className="admin-input" maxLength={100} value={form.vehicle_make} onChange={(event) => setForm({ ...form, vehicle_make: event.target.value })} placeholder="Ex.: Hyundai" id="admin-views-pricesview-297" />
                </label>
                <label className="admin-field">Modelo
                  <input className="admin-input" maxLength={120} value={form.vehicle_model} onChange={(event) => setForm({ ...form, vehicle_model: event.target.value })} placeholder="Ex.: HB20 1.0" id="admin-views-pricesview-300" />
                </label>
                <label className="admin-field">Ano a partir de
                  <input className="admin-input" type="number" min={1900} max={2200} step={1} value={form.year_from} onChange={(event) => setForm({ ...form, year_from: event.target.value })} placeholder="Qualquer ano" id="admin-views-pricesview-303" />
                </label>
                <label className="admin-field">Ano até
                  <input className="admin-input" type="number" min={1900} max={2200} step={1} value={form.year_to} onChange={(event) => setForm({ ...form, year_to: event.target.value })} placeholder="Qualquer ano" id="admin-views-pricesview-306" />
                </label>
                <label className="admin-field">Valor da mão de obra (R$)
                  <input className="admin-input" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="Ex.: 850,00" id="admin-views-pricesview-309" />
                </label>
                <label className="admin-field">Aplicação / versão (opcional)
                  <input className="admin-input" maxLength={160} value={form.vehicle_application} onChange={(event) => setForm({ ...form, vehicle_application: event.target.value })} placeholder="Ex.: motor 1.0 flex, câmbio manual" id="admin-views-pricesview-312" />
                </label>
                <label className="admin-field">Válida a partir de
                  <input className="admin-input" type="date" value={form.valid_from} onChange={(event) => setForm({ ...form, valid_from: event.target.value })} id="admin-views-pricesview-315" />
                </label>
                <label className="admin-field">Válida até
                  <input className="admin-input" type="date" value={form.valid_until} onChange={(event) => setForm({ ...form, valid_until: event.target.value })} id="admin-views-pricesview-318" />
                </label>
                <label className="admin-field wide">Observações internas
                  <textarea className="admin-textarea" rows={3} maxLength={4000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Condições, exceções ou notas para a equipe" id="admin-views-pricesview-321" />
                </label>
                <label className="admin-field">Status
                  <select className="admin-select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} id="admin-views-pricesview-324"><option value="concluido">Ativa</option><option value="cancelado">Inativa</option></select>
                </label>
              </div>
              {error && <p className="admin-form-error">{error}</p>}
              <div className="admin-modal-actions">
                <button type="button" className="admin-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
                <button type="submit" className="admin-primary" disabled={saving}>{saving ? "Salvando…" : "Salvar tarifa"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
