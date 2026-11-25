"use client";

import { SkeletonList } from "../Skeletons";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Building2,
  CalendarOff,
  Check,
  Clock,
  Copy,
  Globe,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Power,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { selectRows, updateRow, type PanelRecord, type SiteContent } from "../../../lib/supabase";
import { AdminStatusBadge } from "../StatusBadge";
import { asText, dateText, detail, modalBackdropProps, todayIso, useModuleRecords } from "../utils";
import {
  defaultEstablishmentConfig,
  defaultScheduleConfig,
  UF_LIST,
  type EstablishmentConfig,
  type HolidayEntry,
  type ScheduleConfig,
} from "./settingsDefaults";

type SettingsTab = "estabelecimento" | "horarios" | "parametros";

const SYSTEM_TITLES = new Set(["__estabelecimento__", "__horarios__"]);

const CATEGORIES = ["Oficina", "Atendimento", "Operação", "OS / Orçamento", "Financeiro"] as const;

const PRESET_PARAMS = [
  { title: "Nome da oficina", category: "Oficina", placeholder: "Benittes Oficina Mecânica" },
  { title: "Telefone / WhatsApp", category: "Atendimento", placeholder: "(11) 99999-9999" },
  { title: "Endereço", category: "Oficina", placeholder: "Rua Exemplo, 123 - Centro" },
  {
    title: "Horário de funcionamento",
    category: "Atendimento",
    placeholder: "Seg a Sex: 08h às 18h · Sáb: 08h às 12h",
  },
  { title: "Box disponíveis", category: "Operação", placeholder: "4 boxes" },
  {
    title: "Observações padrão de OS",
    category: "OS / Orçamento",
    placeholder: "Garantia de 90 dias sobre serviços executados.",
  },
] as const;

const SITE_KEY_LABELS: Record<string, string> = {
  hero: "Seção principal (Hero)",
  about: "Sobre a oficina",
  sobre: "Sobre a oficina",
  services: "Serviços em destaque",
  servicos: "Serviços em destaque",
  especialidades: "Especialidades",
  fotos: "Galeria de fotos",
  faq: "Perguntas frequentes (FAQ)",
  identidade: "Identidade visual",
  contact: "Contato e localização",
  contato: "Contato e localização",
  footer: "Rodapé",
  hours: "Horário de atendimento",
  whatsapp: "Atendimento WhatsApp",
};

const FIELD_LABELS: Record<string, string> = {
  nome: "Nome",
  title: "Título",
  titulo: "Título",
  subtitulo: "Subtítulo",
  subtitle: "Subtítulo",
  detalhe: "Detalhe",
  descricao: "Descrição",
  description: "Descrição",
  alt: "Texto alternativo (alt)",
  slug: "Slug",
  id: "Identificador",
  logo: "Logo (URL)",
  corPrincipal: "Cor principal",
  telefone: "Telefone",
  whatsapp: "WhatsApp",
  endereco: "Endereço",
  horario: "Horário",
  email: "E-mail",
  itens: "Itens",
};

function labelForField(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function summarizeSiteValue(value: Record<string, unknown> | null | undefined): string {
  if (!value || typeof value !== "object") return "—";
  const entries = Object.entries(value).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== "",
  );
  if (entries.length === 0) return "Sem conteúdo";
  return entries
    .slice(0, 3)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        const count = v.length;
        const first = v[0];
        let preview = "";
        if (Array.isArray(first) && first[0]) {
          preview = String(first[0]);
        } else if (first && typeof first === "object") {
          const rec = first as Record<string, unknown>;
          preview = String(rec.nome ?? rec.title ?? rec.titulo ?? rec.alt ?? rec.id ?? "");
        } else if (first !== undefined) {
          preview = String(first);
        }
        const clipped = preview.length > 36 ? `${preview.slice(0, 36)}…` : preview;
        return `${count} ${count === 1 ? "item" : "itens"}${clipped ? ` (${clipped})` : ""}`;
      }
      if (typeof v === "object") {
        return `${labelForField(k)}: ${Object.keys(v as object).length} campos`;
      }
      const text = String(v);
      const clipped = text.length > 48 ? `${text.slice(0, 48)}…` : text;
      return `${labelForField(k)}: ${clipped}`;
    })
    .join(" · ");
}

export function SettingsView({ session }: { session: { user: { id: string } } }) {
  const { rows, loading, error, setError, saveRecord, patchRecord, removeRecord } =
    useModuleRecords("settings", session.user.id);

  const [tab, setTab] = useState<SettingsTab>("estabelecimento");
  const [feedback, setFeedback] = useState("");

  // --- Estabelecimento ---
  const [estConfig, setEstConfig] = useState<EstablishmentConfig>(defaultEstablishmentConfig);
  const [estHydrated, setEstHydrated] = useState(false);
  const [estSaving, setEstSaving] = useState(false);

  // --- Horários & Folgas ---
  const [schedConfig, setSchedConfig] = useState<ScheduleConfig>(defaultScheduleConfig);
  const [schedHydrated, setSchedHydrated] = useState(false);
  const [schedSaving, setSchedSaving] = useState(false);
  const [newHolidayDate, setNewHolidayDate] = useState(todayIso());
  const [newHolidayReason, setNewHolidayReason] = useState("");
  const [newHolidayAllDay, setNewHolidayAllDay] = useState(true);
  const [newHolidayStart, setNewHolidayStart] = useState("08:00");
  const [newHolidayEnd, setNewHolidayEnd] = useState("12:00");

  // --- Parâmetros livres ---
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PanelRecord | null>(null);
  const [title, setTitle] = useState("");
  const [valueText, setValueText] = useState("");
  const [category, setCategory] = useState<string>("Oficina");
  const [saving, setSaving] = useState(false);

  // --- Conteúdo do site ---
  const [siteContents, setSiteContents] = useState<SiteContent[]>([]);
  const [editingSite, setEditingSite] = useState<SiteContent | null>(null);
  const [siteDraft, setSiteDraft] = useState<Record<string, unknown>>({});
  const [siteEnabled, setSiteEnabled] = useState(true);
  const [siteSaving, setSiteSaving] = useState(false);

  const estRecord = useMemo(
    () => rows.find((r) => r.title === "__estabelecimento__") ?? null,
    [rows],
  );
  const schedRecord = useMemo(
    () => rows.find((r) => r.title === "__horarios__") ?? null,
    [rows],
  );

  useEffect(() => {
    if (!loading && !estHydrated) {
      if (estRecord?.details && typeof estRecord.details === "object") {
        setEstConfig({
          ...defaultEstablishmentConfig(),
          ...(estRecord.details as Partial<EstablishmentConfig>),
        });
      }
      setEstHydrated(true);
    }
  }, [loading, estHydrated, estRecord]);

  useEffect(() => {
    if (!loading && !schedHydrated) {
      if (schedRecord?.details && typeof schedRecord.details === "object") {
        const d = schedRecord.details as Partial<ScheduleConfig>;
        const base = defaultScheduleConfig();
        setSchedConfig({
          days: Array.isArray(d.days) && d.days.length === 7 ? d.days : base.days,
          holidays: Array.isArray(d.holidays) ? d.holidays : [],
          slotDuration: d.slotDuration ?? base.slotDuration,
          bufferMinutes: d.bufferMinutes ?? base.bufferMinutes,
          minAdvanceHours: d.minAdvanceHours ?? base.minAdvanceHours,
        });
      }
      setSchedHydrated(true);
    }
  }, [loading, schedHydrated, schedRecord]);

  useEffect(() => {
    void selectRows<SiteContent>("site_content", { order: "key.asc" })
      .then((data) => setSiteContents(data))
      .catch(() => setSiteContents([]));
  }, []);

  const paramRows = useMemo(
    () => rows.filter((r) => !SYSTEM_TITLES.has(r.title)),
    [rows],
  );

  const existingByTitle = useMemo(() => {
    const map = new Map<string, PanelRecord>();
    for (const r of paramRows) {
      map.set(r.title.trim().toLowerCase(), r);
    }
    return map;
  }, [paramRows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return paramRows.filter((row) => {
      const cat = String(detail(row, "category") ?? "Oficina");
      if (categoryFilter !== "all" && cat !== categoryFilter) return false;
      if (!q) return true;
      return [row.title, row.description, cat]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [paramRows, query, categoryFilter]);

  async function saveEstablishment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEstSaving(true);
    setError("");
    setFeedback("");
    try {
      await saveRecord(estRecord, {
        title: "__estabelecimento__",
        description: estConfig.nome || "Configurações do estabelecimento",
        status: "ativo",
        details: estConfig as unknown as Record<string, unknown>,
      });
      setFeedback("Dados do estabelecimento salvos com sucesso.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar dados do estabelecimento.");
    } finally {
      setEstSaving(false);
    }
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSchedSaving(true);
    setError("");
    setFeedback("");
    try {
      await saveRecord(schedRecord, {
        title: "__horarios__",
        description: "Horários de funcionamento e folgas",
        status: "ativo",
        details: schedConfig as unknown as Record<string, unknown>,
      });
      setFeedback("Horários e folgas salvos com sucesso.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao salvar horários e folgas.");
    } finally {
      setSchedSaving(false);
    }
  }

  function applyWeekdaysFromMonday() {
    const monday = schedConfig.days[0];
    if (!monday) return;
    setSchedConfig((prev) => ({
      ...prev,
      days: prev.days.map((d, idx) =>
        idx >= 1 && idx <= 4
          ? {
              ...d,
              open: monday.open,
              start: monday.start,
              end: monday.end,
              hasBreak: monday.hasBreak,
              breakStart: monday.breakStart,
              breakEnd: monday.breakEnd,
            }
          : d,
      ),
    }));
  }

  function addHoliday() {
    if (!newHolidayDate) return;
    const entry: HolidayEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: newHolidayDate,
      reason: newHolidayReason.trim() || "Folga / Feriado",
      allDay: newHolidayAllDay,
      startTime: newHolidayStart,
      endTime: newHolidayEnd,
    };
    setSchedConfig((prev) => ({
      ...prev,
      holidays: [...prev.holidays, entry].sort((a, b) => a.date.localeCompare(b.date)),
    }));
    setNewHolidayReason("");
  }

  function openCreate() {
    setEditing(null);
    setTitle("");
    setValueText("");
    setCategory("Oficina");
    setError("");
    setModalOpen(true);
  }

  function openEdit(row: PanelRecord) {
    setEditing(row);
    setTitle(row.title);
    setValueText(row.description ?? "");
    setCategory(String(detail(row, "category") ?? "Oficina"));
    setError("");
    setModalOpen(true);
  }

  function handlePresetClick(preset: (typeof PRESET_PARAMS)[number]) {
    const existing = existingByTitle.get(preset.title.toLowerCase());
    if (existing) {
      openEdit(existing);
      return;
    }
    setEditing(null);
    setTitle(preset.title);
    setCategory(preset.category);
    setValueText(preset.placeholder);
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    setFeedback("");

    try {
      await saveRecord(editing, {
        title: title.trim(),
        description: valueText.trim() || null,
        status: editing?.status || "ativo",
        details: {
          ...(editing?.details ?? {}),
          category: category.trim() || "Oficina",
        },
      });
      setFeedback(editing ? "Parâmetro atualizado." : "Parâmetro salvo.");
      setModalOpen(false);
      setEditing(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar o parâmetro.");
    } finally {
      setSaving(false);
    }
  }

  function openSiteModal(entry: SiteContent) {
    const val = (entry.value ?? {}) as Record<string, unknown>;
    setEditingSite(entry);
    setSiteEnabled(entry.enabled);
    setSiteDraft(structuredClone(val));
    setError("");
  }

  async function saveSiteContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingSite) return;
    setSiteSaving(true);
    setError("");
    setFeedback("");
    try {
      const updated = await updateRow<SiteContent>(
        "site_content",
        editingSite.key,
        { value: siteDraft, enabled: siteEnabled },
        "key",
      );
      if (updated[0]) {
        setSiteContents((current) =>
          current.map((item) => (item.key === editingSite.key ? updated[0] : item)),
        );
      }
      setFeedback(`Conteúdo "${SITE_KEY_LABELS[editingSite.key] ?? editingSite.key}" atualizado.`);
      setEditingSite(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Não foi possível atualizar o conteúdo do site.",
      );
    } finally {
      setSiteSaving(false);
    }
  }

  function renderPrimitiveInput(
    label: string,
    val: unknown,
    onChange: (next: unknown) => void,
  ) {
    if (typeof val === "boolean") {
      return (
        <label className="admin-check">
          <Checkbox
            checked={val}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <span>{label}</span>
        </label>
      );
    }
    const str = val === null || val === undefined ? "" : String(val);
    const isHexColor = /^#[0-9a-fA-F]{6}$/.test(str.trim());
    if (isHexColor) {
      return (
        <>
          <label>{label}</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="color"
              value={str.trim()}
              onChange={(e) => onChange(e.target.value)}
              style={{
                width: 40,
                height: 36,
                padding: 2,
                borderRadius: 8,
                border: "1px solid var(--admin-line)",
                background: "transparent",
                cursor: "pointer",
              }}
            />
            <input
              className="admin-input"
              value={str}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        </>
      );
    }
    if (str.length > 70) {
      return (
        <>
          <label>{label}</label>
          <textarea
            className="admin-textarea"
            rows={3}
            value={str}
            onChange={(e) => onChange(e.target.value)}
          />
        </>
      );
    }
    return (
      <>
        <label>{label}</label>
        <input
          className="admin-input"
          type={typeof val === "number" ? "number" : "text"}
          value={str}
          onChange={(e) =>
            onChange(typeof val === "number" ? Number(e.target.value || 0) : e.target.value)
          }
        />
      </>
    );
  }

  return (
    <>
      <div className="admin-page-title">
        <div>
          <p className="admin-kicker">SISTEMA · CONFIGURAÇÕES</p>
          <h1>Estabelecimento e configurações</h1>
        </div>
        {tab === "parametros" && (
          <div className="admin-title-actions">
            <button type="button" className="admin-primary" onClick={openCreate}>
              <Plus size={15} /> Novo parâmetro
            </button>
          </div>
        )}
      </div>

      <div className="admin-toolbar" style={{ marginBottom: 18 }}>
        <div className="admin-filter-pills">
          <button
            type="button"
            className={`admin-pill ${tab === "estabelecimento" ? "active" : ""}`}
            onClick={() => setTab("estabelecimento")}
          >
            <Building2 size={14} style={{ marginRight: 6 }} />
            Estabelecimento
          </button>
          <button
            type="button"
            className={`admin-pill ${tab === "horarios" ? "active" : ""}`}
            onClick={() => setTab("horarios")}
          >
            <Clock size={14} style={{ marginRight: 6 }} />
            Horários e folgas
          </button>
          <button
            type="button"
            className={`admin-pill ${tab === "parametros" ? "active" : ""}`}
            onClick={() => setTab("parametros")}
          >
            <SlidersHorizontal size={14} style={{ marginRight: 6 }} />
            Parâmetros e site
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-form-error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}
      {feedback && (
        <p className="admin-form-success" role="status" style={{ marginBottom: 16 }}>
          {feedback}
        </p>
      )}

      {tab === "estabelecimento" && (
        <form onSubmit={(e) => void saveEstablishment(e)} style={{ display: "grid", gap: 18 }}>
          <div className="admin-two-col">
            <div className="admin-panel">
              <div className="admin-panel-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Building2 size={16} />
                  <h2>Dados da oficina</h2>
                </div>
              </div>
              <div className="admin-form-grid">
                <div className="admin-field wide">
                  <label>Nome fantasia *</label>
                  <input
                    className="admin-input"
                    required
                    value={estConfig.nome}
                    onChange={(e) => setEstConfig({ ...estConfig, nome: e.target.value })}
                    placeholder="Benittes Oficina Mecânica"
                  />
                </div>
                <div className="admin-field">
                  <label>Razão social</label>
                  <input
                    className="admin-input"
                    value={estConfig.razao_social}
                    onChange={(e) => setEstConfig({ ...estConfig, razao_social: e.target.value })}
                    placeholder="Benittes Serviços Automotivos LTDA"
                  />
                </div>
                <div className="admin-field">
                  <label>CNPJ</label>
                  <input
                    className="admin-input"
                    value={estConfig.cnpj}
                    onChange={(e) => setEstConfig({ ...estConfig, cnpj: e.target.value })}
                    placeholder="00.000.000/0001-00"
                  />
                </div>
                <div className="admin-field">
                  <label>Slogan / Especialidade</label>
                  <input
                    className="admin-input"
                    value={estConfig.slogan}
                    onChange={(e) => setEstConfig({ ...estConfig, slogan: e.target.value })}
                    placeholder="Mecânica geral, revisão e diagnóstico"
                  />
                </div>
                <div className="admin-field">
                  <label>Quantidade de boxes / elevadores</label>
                  <input
                    className="admin-input"
                    type="number"
                    min="1"
                    value={estConfig.boxes}
                    onChange={(e) => setEstConfig({ ...estConfig, boxes: e.target.value })}
                    placeholder="4"
                  />
                </div>
              </div>
            </div>

            <div className="admin-panel">
              <div className="admin-panel-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Phone size={16} />
                  <h2>Contato público e redes</h2>
                </div>
              </div>
              <div className="admin-form-grid">
                <div className="admin-field">
                  <label>Número público (WhatsApp)</label>
                  <input
                    className="admin-input"
                    value={estConfig.whatsapp}
                    onChange={(e) => setEstConfig({ ...estConfig, whatsapp: e.target.value })}
                    placeholder="(11) 99999-9999"
                  />
                </div>
                <div className="admin-field">
                  <label>Telefone fixo</label>
                  <input
                    className="admin-input"
                    value={estConfig.telefone}
                    onChange={(e) => setEstConfig({ ...estConfig, telefone: e.target.value })}
                    placeholder="(11) 3333-3333"
                  />
                </div>
                <div className="admin-field wide">
                  <label>E-mail público</label>
                  <input
                    className="admin-input"
                    type="email"
                    value={estConfig.email}
                    onChange={(e) => setEstConfig({ ...estConfig, email: e.target.value })}
                    placeholder="contato@oficina.com.br"
                  />
                </div>
                <div className="admin-field">
                  <label>Instagram</label>
                  <input
                    className="admin-input"
                    value={estConfig.instagram}
                    onChange={(e) => setEstConfig({ ...estConfig, instagram: e.target.value })}
                    placeholder="@benittesoficina"
                  />
                </div>
                <div className="admin-field">
                  <label>Site / Link externo</label>
                  <input
                    className="admin-input"
                    value={estConfig.website}
                    onChange={(e) => setEstConfig({ ...estConfig, website: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="admin-two-col">
            <div className="admin-panel">
              <div className="admin-panel-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <MapPin size={16} />
                  <h2>Local e endereço</h2>
                </div>
              </div>
              <div className="admin-form-grid">
                <div className="admin-field">
                  <label>CEP</label>
                  <input
                    className="admin-input"
                    value={estConfig.cep}
                    onChange={(e) => setEstConfig({ ...estConfig, cep: e.target.value })}
                    placeholder="00000-000"
                  />
                </div>
                <div className="admin-field">
                  <label>Bairro</label>
                  <input
                    className="admin-input"
                    value={estConfig.bairro}
                    onChange={(e) => setEstConfig({ ...estConfig, bairro: e.target.value })}
                    placeholder="Centro"
                  />
                </div>
                <div className="admin-field wide">
                  <label>Rua / Avenida</label>
                  <input
                    className="admin-input"
                    value={estConfig.logradouro}
                    onChange={(e) => setEstConfig({ ...estConfig, logradouro: e.target.value })}
                    placeholder="Av. Brasil"
                  />
                </div>
                <div className="admin-field">
                  <label>Número</label>
                  <input
                    className="admin-input"
                    value={estConfig.numero}
                    onChange={(e) => setEstConfig({ ...estConfig, numero: e.target.value })}
                    placeholder="1200"
                  />
                </div>
                <div className="admin-field">
                  <label>Complemento</label>
                  <input
                    className="admin-input"
                    value={estConfig.complemento}
                    onChange={(e) => setEstConfig({ ...estConfig, complemento: e.target.value })}
                    placeholder="Galpão B"
                  />
                </div>
                <div className="admin-field">
                  <label>Cidade</label>
                  <input
                    className="admin-input"
                    value={estConfig.cidade}
                    onChange={(e) => setEstConfig({ ...estConfig, cidade: e.target.value })}
                    placeholder="São Paulo"
                  />
                </div>
                <div className="admin-field">
                  <label>Estado (UF)</label>
                  <select
                    className="admin-select"
                    value={estConfig.uf}
                    onChange={(e) => setEstConfig({ ...estConfig, uf: e.target.value })}
                  >
                    {UF_LIST.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="admin-field wide">
                  <label>Link do Google Maps</label>
                  <input
                    className="admin-input"
                    value={estConfig.maps_url}
                    onChange={(e) => setEstConfig({ ...estConfig, maps_url: e.target.value })}
                    placeholder="https://maps.google.com/?q=..."
                  />
                </div>
              </div>
            </div>

            <div className="admin-panel">
              <div className="admin-panel-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Wrench size={16} />
                  <h2>Padrões de OS e orçamento</h2>
                </div>
              </div>
              <div className="admin-form-grid">
                <div className="admin-field">
                  <label>Garantia padrão (dias)</label>
                  <input
                    className="admin-input"
                    type="number"
                    min="0"
                    value={estConfig.garantia_dias}
                    onChange={(e) => setEstConfig({ ...estConfig, garantia_dias: e.target.value })}
                  />
                </div>
                <div className="admin-field">
                  <label>Validade do orçamento (dias)</label>
                  <input
                    className="admin-input"
                    type="number"
                    min="1"
                    value={estConfig.validade_orcamento_dias}
                    onChange={(e) =>
                      setEstConfig({ ...estConfig, validade_orcamento_dias: e.target.value })
                    }
                  />
                </div>
                <div className="admin-field wide">
                  <label>Observações / Termos padrão</label>
                  <textarea
                    className="admin-textarea"
                    rows={5}
                    value={estConfig.observacoes_os}
                    onChange={(e) => setEstConfig({ ...estConfig, observacoes_os: e.target.value })}
                    placeholder="Texto padrão exibido em ordens de serviço e orçamentos..."
                  />
                </div>
              </div>

              <div style={{ marginTop: "auto", paddingTop: 16, display: "flex", justifyContent: "flex-end" }}>
                <button type="submit" className="admin-primary" disabled={estSaving}>
                  <Save size={15} />
                  {estSaving ? "Salvando…" : "Salvar estabelecimento"}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {tab === "horarios" && (
        <form onSubmit={(e) => void saveSchedule(e)} style={{ display: "grid", gap: 18 }}>
          <div className="admin-panel">
            <div className="admin-panel-head" style={{ flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Clock size={16} />
                <h2>Horário de funcionamento e pausas</h2>
              </div>
              <button
                type="button"
                className="admin-secondary"
                onClick={applyWeekdaysFromMonday}
                title="Copia o horário de Segunda-feira para Terça a Sexta"
              >
                <Copy size={14} /> Aplicar Seg–Sex igual
              </button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {schedConfig.days.map((day, idx) => {
                const updateDay = (patch: Partial<typeof day>) => {
                  setSchedConfig((prev) => ({
                    ...prev,
                    days: prev.days.map((d, i) => (i === idx ? { ...d, ...patch } : d)),
                  }));
                };

                return (
                  <div
                    key={day.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: "1px solid var(--admin-line)",
                      opacity: day.open ? 1 : 0.65,
                      minWidth: 0,
                    }}
                  >
                    <label className="admin-check" style={{ fontWeight: 600 }}>
                      <Checkbox
                        checked={day.open}
                        onCheckedChange={(checked) => updateDay({ open: checked === true })}
                      />
                      <span>{day.label}</span>
                    </label>

                    {day.open ? (
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, color: "var(--admin-muted)" }}>Abre</span>
                          <input
                            type="time"
                            className="admin-input"
                            style={{ width: 102, minWidth: 96 }}
                            value={day.start}
                            onChange={(e) => updateDay({ start: e.target.value })}
                          />
                          <span style={{ fontSize: 12, color: "var(--admin-muted)" }}>Fecha</span>
                          <input
                            type="time"
                            className="admin-input"
                            style={{ width: 102, minWidth: 96 }}
                            value={day.end}
                            onChange={(e) => updateDay({ end: e.target.value })}
                          />
                        </div>

                        <label className="admin-check" style={{ fontSize: 12.5 }}>
                          <Checkbox
                            checked={day.hasBreak}
                            onCheckedChange={(checked) => updateDay({ hasBreak: checked === true })}
                          />
                          <span>Pausa / Almoço</span>
                        </label>

                        {day.hasBreak && (
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                            <input
                              type="time"
                              className="admin-input"
                              style={{ width: 102, minWidth: 96 }}
                              value={day.breakStart}
                              onChange={(e) => updateDay({ breakStart: e.target.value })}
                            />
                            <span style={{ fontSize: 12, color: "var(--admin-muted)" }}>até</span>
                            <input
                              type="time"
                              className="admin-input"
                              style={{ width: 102, minWidth: 96 }}
                              value={day.breakEnd}
                              onChange={(e) => updateDay({ breakEnd: e.target.value })}
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 13, color: "var(--admin-muted)" }}>Fechado</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="admin-two-col">
            <div className="admin-panel">
              <div className="admin-panel-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CalendarOff size={16} />
                  <h2>Folgas, feriados e bloqueios ({schedConfig.holidays.length})</h2>
                </div>
              </div>

              <div className="admin-form-grid" style={{ marginBottom: 14 }}>
                <div className="admin-field">
                  <label>Data</label>
                  <input
                    type="date"
                    className="admin-input"
                    value={newHolidayDate}
                    onChange={(e) => setNewHolidayDate(e.target.value)}
                  />
                </div>
                <div className="admin-field">
                  <label>Motivo</label>
                  <input
                    className="admin-input"
                    value={newHolidayReason}
                    onChange={(e) => setNewHolidayReason(e.target.value)}
                    placeholder="Ex.: Feriado, recesso, manutenção"
                  />
                </div>
                <div className="admin-field wide">
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                    <label className="admin-check">
                      <Checkbox
                        checked={newHolidayAllDay}
                        onCheckedChange={(checked) => setNewHolidayAllDay(checked === true)}
                      />
                      <span>Dia inteiro</span>
                    </label>
                    {!newHolidayAllDay && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="time"
                          className="admin-input"
                          style={{ width: 112 }}
                          value={newHolidayStart}
                          onChange={(e) => setNewHolidayStart(e.target.value)}
                        />
                        <span style={{ fontSize: 12, color: "var(--admin-muted)" }}>até</span>
                        <input
                          type="time"
                          className="admin-input"
                          style={{ width: 112 }}
                          value={newHolidayEnd}
                          onChange={(e) => setNewHolidayEnd(e.target.value)}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      className="admin-secondary"
                      style={{ marginLeft: "auto" }}
                      onClick={addHoliday}
                    >
                      <Plus size={14} /> Adicionar folga
                    </button>
                  </div>
                </div>
              </div>

              {schedConfig.holidays.length === 0 ? (
                <div className="admin-empty" style={{ padding: "20px 12px" }}>
                  <span>Nenhuma folga ou feriado programado</span>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {schedConfig.holidays.map((h) => (
                    <div
                      key={h.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "9px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--admin-line)",
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: 13 }}>{dateText(h.date)}</strong>
                        <span style={{ fontSize: 12.5, color: "var(--admin-muted)", marginLeft: 8 }}>
                          {h.reason} · {h.allDay ? "Dia inteiro" : `${h.startTime} – ${h.endTime}`}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="admin-icon-btn danger"
                        title="Remover folga"
                        onClick={() =>
                          setSchedConfig((prev) => ({
                            ...prev,
                            holidays: prev.holidays.filter((item) => item.id !== h.id),
                          }))
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="admin-panel">
              <div className="admin-panel-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <SlidersHorizontal size={16} />
                  <h2>Regras de agendamento</h2>
                </div>
              </div>
              <div className="admin-form-grid">
                <div className="admin-field wide">
                  <label>Duração padrão do atendimento</label>
                  <select
                    className="admin-select"
                    value={schedConfig.slotDuration}
                    onChange={(e) => setSchedConfig({ ...schedConfig, slotDuration: e.target.value })}
                  >
                    <option value="30">30 minutos</option>
                    <option value="45">45 minutos</option>
                    <option value="60">1 hora</option>
                    <option value="90">1 hora e 30 min</option>
                    <option value="120">2 horas</option>
                  </select>
                </div>
                <div className="admin-field">
                  <label>Intervalo entre horários</label>
                  <select
                    className="admin-select"
                    value={schedConfig.bufferMinutes}
                    onChange={(e) => setSchedConfig({ ...schedConfig, bufferMinutes: e.target.value })}
                  >
                    <option value="0">Sem intervalo</option>
                    <option value="10">10 minutos</option>
                    <option value="15">15 minutos</option>
                    <option value="30">30 minutos</option>
                  </select>
                </div>
                <div className="admin-field">
                  <label>Antecedência mínima</label>
                  <select
                    className="admin-select"
                    value={schedConfig.minAdvanceHours}
                    onChange={(e) =>
                      setSchedConfig({ ...schedConfig, minAdvanceHours: e.target.value })
                    }
                  >
                    <option value="0">Imediato</option>
                    <option value="1">1 hora</option>
                    <option value="2">2 horas</option>
                    <option value="4">4 horas</option>
                    <option value="24">24 horas</option>
                  </select>
                </div>
              </div>

              <div style={{ marginTop: "auto", paddingTop: 16, display: "flex", justifyContent: "flex-end" }}>
                <button type="submit" className="admin-primary" disabled={schedSaving}>
                  <Save size={15} />
                  {schedSaving ? "Salvando…" : "Salvar horários e folgas"}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {tab === "parametros" && (
        <>
          <div className="admin-panel" style={{ marginBottom: 20 }}>
            <div className="admin-panel-head" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <SlidersHorizontal size={16} />
                <h2>Atalhos essenciais</h2>
              </div>
              <span style={{ fontSize: 12, color: "var(--admin-muted)" }}>
                Clique para configurar ou editar
              </span>
            </div>

            <div className="admin-filter-pills">
              {PRESET_PARAMS.map((preset) => {
                const configured = existingByTitle.has(preset.title.toLowerCase());
                return (
                  <button
                    key={preset.title}
                    type="button"
                    className={`admin-pill ${configured ? "active" : ""}`}
                    onClick={() => handlePresetClick(preset)}
                  >
                    {configured && <Check size={12} style={{ marginRight: 5 }} />}
                    {preset.title}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="admin-panel">
            <div className="admin-panel-head" style={{ flexWrap: "wrap", gap: 12 }}>
              <h2>Parâmetros salvos ({filteredRows.length})</h2>
              <div className="admin-search-wrap" style={{ maxWidth: 280 }}>
                <Search size={14} />
                <input
                  className="admin-search"
                  placeholder="Buscar parâmetro ou valor..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="admin-filter-pills" style={{ marginBottom: 14 }}>
              <button
                type="button"
                className={`admin-pill ${categoryFilter === "all" ? "active" : ""}`}
                onClick={() => setCategoryFilter("all")}
              >
                Todas
              </button>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`admin-pill ${categoryFilter === cat ? "active" : ""}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            {loading ? (
              <SkeletonList rows={4} />
            ) : filteredRows.length === 0 ? (
              <div className="admin-empty">
                <strong>Nenhum parâmetro encontrado</strong>
                <p>Use os atalhos acima ou clique em &ldquo;Novo parâmetro&rdquo; para cadastrar.</p>
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Parâmetro</th>
                      <th>Valor / Conteúdo</th>
                      <th style={{ width: 110 }}>Situação</th>
                      <th style={{ width: 120 }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const isActive = row.status !== "cancelado";
                      return (
                        <tr key={row.id}>
                          <td>
                            <strong>{row.title}</strong>
                            <div style={{ fontSize: 12, color: "var(--admin-muted)" }}>
                              {asText(detail(row, "category") ?? "Oficina")}
                            </div>
                          </td>
                          <td style={{ whiteSpace: "pre-wrap", maxWidth: 420 }}>
                            {asText(row.description)}
                          </td>
                          <td>
                            <AdminStatusBadge
                              status={isActive ? "ativo" : "cancelado"}
                              label={isActive ? "Ativo" : "Inativo"}
                            />
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                type="button"
                                className="admin-icon-btn"
                                title={isActive ? "Desativar parâmetro" : "Ativar parâmetro"}
                                onClick={() =>
                                  void patchRecord(row.id, {
                                    status: isActive ? "cancelado" : "ativo",
                                  })
                                }
                              >
                                <Power size={14} />
                              </button>
                              <button
                                type="button"
                                className="admin-icon-btn"
                                title="Editar"
                                onClick={() => openEdit(row)}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                className="admin-icon-btn danger"
                                title="Remover"
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
          </div>

          {siteContents.length > 0 && (
            <div className="admin-panel" style={{ marginTop: 20 }}>
              <div className="admin-panel-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Globe size={16} />
                  <h2>Conteúdo do site ({siteContents.length})</h2>
                </div>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Seção</th>
                      <th>Resumo</th>
                      <th style={{ width: 100 }}>Visibilidade</th>
                      <th style={{ width: 120 }}>Atualizado</th>
                      <th style={{ width: 72 }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siteContents.map((entry) => (
                      <tr key={entry.key}>
                        <td>
                          <strong>{SITE_KEY_LABELS[entry.key] ?? entry.key}</strong>
                          <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>{entry.key}</div>
                        </td>
                        <td style={{ maxWidth: 420, color: "var(--admin-muted)", fontSize: 13 }}>
                          {summarizeSiteValue(entry.value as Record<string, unknown>)}
                        </td>
                        <td>
                          <AdminStatusBadge
                            status={entry.enabled ? "ativo" : "cancelado"}
                            label={entry.enabled ? "Ativo" : "Oculto"}
                          />
                        </td>
                        <td>{dateText(entry.updated_at)}</td>
                        <td>
                          <button
                            type="button"
                            className="admin-icon-btn"
                            title="Editar conteúdo"
                            onClick={() => openSiteModal(entry)}
                          >
                            <Pencil size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {modalOpen && (
        <div className="admin-modal-backdrop" {...modalBackdropProps(() => setModalOpen(false))}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{editing ? "Editar parâmetro" : "Novo parâmetro"}</h2>
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
                <div className="admin-field">
                  <label>Parâmetro *</label>
                  <input
                    className="admin-input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex.: Nome da oficina"
                    required
                  />
                </div>

                <div className="admin-field">
                  <label>Categoria</label>
                  <select
                    className="admin-select"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="admin-field wide">
                  <label>Valor / Conteúdo *</label>
                  <textarea
                    className="admin-textarea"
                    rows={4}
                    value={valueText}
                    onChange={(e) => setValueText(e.target.value)}
                    placeholder="Informe o valor do parâmetro ou texto padrão..."
                    required
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
                  <Save size={15} />
                  {saving ? "Salvando…" : editing ? "Atualizar" : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingSite && (
        <div
          className="admin-modal-backdrop"
          {...modalBackdropProps(() => setEditingSite(null))}
        >
          <div className="admin-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h2>{SITE_KEY_LABELS[editingSite.key] ?? editingSite.key}</h2>
                <p style={{ fontSize: 12, color: "var(--admin-muted)", marginTop: 2 }}>
                  Chave: {editingSite.key}
                </p>
              </div>
              <button
                type="button"
                className="admin-icon-btn"
                onClick={() => setEditingSite(null)}
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={(e) => void saveSiteContent(e)}>
              <div className="admin-form-grid">
                <div className="admin-field wide">
                  <label className="admin-check">
                    <Checkbox
                      checked={siteEnabled}
                      onCheckedChange={(checked) => setSiteEnabled(checked === true)}
                    />
                    <span>Exibir seção no site</span>
                  </label>
                </div>

                {Object.entries(siteDraft).map(([fieldKey, fieldVal]) => {
                  if (Array.isArray(fieldVal)) {
                    const isTupleList =
                      fieldVal.length > 0 && Array.isArray(fieldVal[0]);
                    const isObjectList =
                      fieldVal.length > 0 &&
                      typeof fieldVal[0] === "object" &&
                      fieldVal[0] !== null &&
                      !Array.isArray(fieldVal[0]);

                    const addEmptyItem = () => {
                      let nextItem: unknown = "";
                      if (isTupleList) {
                        nextItem = ["", ""];
                      } else if (isObjectList) {
                        const sample = fieldVal[0] as Record<string, unknown>;
                        const blank: Record<string, unknown> = {};
                        for (const k of Object.keys(sample)) {
                          blank[k] = typeof sample[k] === "number" ? 0 : typeof sample[k] === "boolean" ? false : "";
                        }
                        nextItem = blank;
                      }
                      setSiteDraft((prev) => ({
                        ...prev,
                        [fieldKey]: [...fieldVal, nextItem],
                      }));
                    };

                    return (
                      <div key={fieldKey} className="admin-field wide">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <label>{labelForField(fieldKey)} ({fieldVal.length})</label>
                          <button
                            type="button"
                            className="admin-secondary"
                            style={{ height: 28, minHeight: 28, padding: "0 10px", fontSize: 12 }}
                            onClick={addEmptyItem}
                          >
                            <Plus size={13} /> Adicionar
                          </button>
                        </div>

                        <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
                          {fieldVal.map((item, idx) => {
                            const removeItem = () =>
                              setSiteDraft((prev) => ({
                                ...prev,
                                [fieldKey]: fieldVal.filter((_, i) => i !== idx),
                              }));

                            if (Array.isArray(item)) {
                              const pair = item as unknown[];
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    border: "1px solid var(--admin-line)",
                                    borderRadius: 10,
                                    padding: 12,
                                    display: "grid",
                                    gap: 8,
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <strong style={{ fontSize: 12.5 }}>Item {idx + 1}</strong>
                                    <button
                                      type="button"
                                      className="admin-icon-btn danger"
                                      title="Remover item"
                                      onClick={removeItem}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                  {pair.map((subVal, subIdx) => (
                                    <div key={subIdx} className="admin-field">
                                      {renderPrimitiveInput(
                                        subIdx === 0 ? "Pergunta / Título" : subIdx === 1 ? "Resposta / Conteúdo" : `Campo ${subIdx + 1}`,
                                        subVal,
                                        (next) => {
                                          const nextArr = [...fieldVal];
                                          const nextPair = [...pair];
                                          nextPair[subIdx] = next;
                                          nextArr[idx] = nextPair;
                                          setSiteDraft((prev) => ({ ...prev, [fieldKey]: nextArr }));
                                        },
                                      )}
                                    </div>
                                  ))}
                                </div>
                              );
                            }

                            if (item && typeof item === "object") {
                              const rec = item as Record<string, unknown>;
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    border: "1px solid var(--admin-line)",
                                    borderRadius: 10,
                                    padding: 12,
                                    display: "grid",
                                    gap: 8,
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <strong style={{ fontSize: 12.5 }}>
                                      {String(rec.nome ?? rec.title ?? rec.titulo ?? `Item ${idx + 1}`)}
                                    </strong>
                                    <button
                                      type="button"
                                      className="admin-icon-btn danger"
                                      title="Remover item"
                                      onClick={removeItem}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                  <div className="admin-form-grid" style={{ gap: 10 }}>
                                    {Object.entries(rec).map(([subKey, subVal]) => (
                                      <div
                                        key={subKey}
                                        className={`admin-field ${String(subVal ?? "").length > 50 ? "wide" : ""}`}
                                      >
                                        {renderPrimitiveInput(labelForField(subKey), subVal, (next) => {
                                          const nextArr = [...fieldVal];
                                          nextArr[idx] = { ...rec, [subKey]: next };
                                          setSiteDraft((prev) => ({ ...prev, [fieldKey]: nextArr }));
                                        })}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input
                                  className="admin-input"
                                  value={String(item ?? "")}
                                  onChange={(e) => {
                                    const nextArr = [...fieldVal];
                                    nextArr[idx] = e.target.value;
                                    setSiteDraft((prev) => ({ ...prev, [fieldKey]: nextArr }));
                                  }}
                                />
                                <button
                                  type="button"
                                  className="admin-icon-btn danger"
                                  title="Remover item"
                                  onClick={removeItem}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  if (fieldVal && typeof fieldVal === "object") {
                    const nested = fieldVal as Record<string, unknown>;
                    return (
                      <div key={fieldKey} className="admin-field wide">
                        <label>{labelForField(fieldKey)}</label>
                        <div
                          className="admin-form-grid"
                          style={{
                            border: "1px solid var(--admin-line)",
                            borderRadius: 10,
                            padding: 12,
                            gap: 10,
                          }}
                        >
                          {Object.entries(nested).map(([subKey, subVal]) => (
                            <div key={subKey} className="admin-field">
                              {renderPrimitiveInput(labelForField(subKey), subVal, (next) =>
                                setSiteDraft((prev) => ({
                                  ...prev,
                                  [fieldKey]: { ...nested, [subKey]: next },
                                })),
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={fieldKey} className="admin-field wide">
                      {renderPrimitiveInput(labelForField(fieldKey), fieldVal, (next) =>
                        setSiteDraft((prev) => ({ ...prev, [fieldKey]: next })),
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="admin-modal-actions">
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={() => setEditingSite(null)}
                >
                  Cancelar
                </button>
                <button type="submit" className="admin-primary" disabled={siteSaving}>
                  <Save size={15} />
                  {siteSaving ? "Salvando…" : "Salvar alterações"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
