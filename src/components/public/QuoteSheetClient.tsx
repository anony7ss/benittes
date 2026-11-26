"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  MessageCircle,
  Moon,
  RefreshCw,
  Sun,
  Wrench,
  XCircle,
} from "lucide-react";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-ext-400.css";
import "@fontsource/poppins/latin-400-italic.css";
import "@fontsource/poppins/latin-ext-400-italic.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-ext-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-ext-600.css";
import "@fontsource/poppins/latin-700.css";
import "@fontsource/poppins/latin-ext-700.css";
import "@/components/admin/admin.css";
import { Checkbox } from "@/components/ui/checkbox";
import { AdminStatusBadge } from "@/components/admin/StatusBadge";
import { dateText, money } from "@/components/admin/utils";
import { SkeletonBox } from "@/components/admin/Skeletons";

type PublicQuoteData = {
  quote: {
    id: string;
    title: string;
    customer_name: string | null;
    vehicle_plate: string | null;
    vehicle_info: {
      plate: string | null;
      make: string | null;
      model: string | null;
      model_year: number | null;
    } | null;
    amount: number;
    description: string | null;
    status: string;
    valid_until: string | null;
    aprovacao: string;
    aprovado_em: string | null;
    recusado_em: string | null;
    observacao_cliente: string | null;
    motivo_recusa: string | null;
    aprovacao_parcial?: boolean;
    desconto_tipo?: "percentual" | "fixo";
    desconto_valor?: number;
    permitir_aprovacao_parcial?: boolean;
    items?: Array<{
      id: string;
      name: string;
      type: "servico" | "peca";
      qty: number;
      unit_price: number;
      approved?: boolean;
    }>;
    created_at: string;
    updated_at: string;
  };
  workOrder: {
    id: string;
    reference: string;
    status: string;
    diagnosis: string | null;
    notes: string | null;
    total: number;
    created_at: string;
    updated_at: string;
  } | null;
  workshop: {
    name: string;
    whatsapp: string;
  };
};

const OS_STEPS = [
  {
    key: "orcamento",
    label: "Orçamento",
    desc: "Proposta enviada",
    icon: FileText,
  },
  {
    key: "aprovado",
    label: "Aprovado",
    desc: "Aguardando entrada",
    icon: ClipboardCheck,
  },
  {
    key: "aguardando",
    label: "Na oficina",
    desc: "Recebido / Na fila",
    icon: Clock,
  },
  {
    key: "em_andamento",
    label: "No box",
    desc: "Em execução",
    icon: Wrench,
  },
  {
    key: "concluido",
    label: "Concluído",
    desc: "Pronto para retirada",
    icon: CheckCircle2,
  },
] as const;

function getOsStepIndex(aprovacao: string, osStatus: string | null): number {
  if (aprovacao !== "aprovado") return 0;
  if (!osStatus) return 1;
  if (osStatus === "novo" || osStatus === "aguardando") return 2;
  if (osStatus === "em_andamento") return 3;
  if (osStatus === "concluido") return 4;
  return 1;
}

function osStatusLabel(status: string): string {
  switch (status) {
    case "novo":
      return "Na oficina · Na fila";
    case "aguardando":
      return "Aguardando peças";
    case "em_andamento":
      return "No box · Em execução";
    case "concluido":
      return "Pronto para retirada";
    case "cancelado":
      return "Cancelado";
    default:
      return status;
  }
}

export function QuoteSheetClient({ token }: { token: string }) {
  const [data, setData] = useState<PublicQuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [dark, setDark] = useState(false);

  // Sempre inicia no tema claro (branco) igual ao site principal
  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  const toggleTheme = (e: MouseEvent<HTMLButtonElement>) => {
    const nextDark = !dark;
    const x = e.clientX || window.innerWidth / 2;
    const y = e.clientY || 32;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const applyTheme = () => {
      document.documentElement.classList.toggle("dark", nextDark);
      setDark(nextDark);
    };

    const docWithTransition = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> };
    };

    if (!docWithTransition.startViewTransition) {
      applyTheme();
      return;
    }

    const transition = docWithTransition.startViewTransition(() => {
      flushSync(applyTheme);
    });

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 520,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        // ignore
      });
  };

  const fetchQuote = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetch(`/api/public/quote/${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(String(json.error || "Não foi possível carregar este orçamento."));
          return;
        }
        const loaded = json as PublicQuoteData;
        setData(loaded);
        if (Array.isArray(loaded.quote.items) && loaded.quote.items.length > 0 && !silent) {
          setSelectedItemIds(
            loaded.quote.items
              .filter((it) => it.approved !== false)
              .map((it) => it.id),
          );
        }
        setError(null);
      } catch {
        setError("Falha de conexão ao buscar atualização do orçamento.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void fetchQuote(false);
  }, [fetchQuote]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchQuote(true);
      }
    }, 10000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void fetchQuote(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchQuote]);

  async function handleDecision(action: "approve" | "reject") {
    if (action === "approve" && quote) {
      const items = quote.items ?? [];
      if (items.length > 0) {
        const selected = quote.permitir_aprovacao_parcial === false
          ? items.filter((item) => item.approved !== false)
          : items.filter((item) => selectedItemIds.includes(item.id));
        if (selected.length === 0) {
          setError("Selecione ao menos um item com valor definido para aprovar.");
          return;
        }
        if (selected.some((item) => !Number.isFinite(item.unit_price) || item.unit_price <= 0)) {
          setError("Há itens selecionados sem preço final. Desmarque-os ou fale com a oficina para atualizar o orçamento.");
          return;
        }
        if (selected.reduce((sum, item) => sum + item.qty * item.unit_price, 0) <= 0) {
          setError("O orçamento precisa ter um valor final maior que zero para ser aprovado.");
          return;
        }
      } else if (!Number.isFinite(quote.amount) || quote.amount <= 0) {
        setError("Este orçamento ainda não tem um valor final. Fale com a oficina para atualizar a proposta.");
        return;
      }
    }

    setSubmitting(action);
    setActionMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/public/quote/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          note,
          ...(action === "approve" && quote && (quote.items?.length ?? 0) > 0 && quote.permitir_aprovacao_parcial !== false
            ? { approved_item_ids: selectedItemIds }
            : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(json.error || "Não foi possível registrar sua resposta."));
        return;
      }
      setData(json as PublicQuoteData);
      setNote("");
      setActionMsg(
        action === "approve"
          ? "Orçamento aprovado! Assim que o veículo entrar na oficina, o andamento será atualizado aqui."
          : "Orçamento recusado. Se quiser ajustar algum detalhe, fale conosco pelo WhatsApp.",
      );
    } catch {
      setError("Erro de conexão ao enviar sua decisão.");
    } finally {
      setSubmitting(null);
    }
  }

  const quote = data?.quote;
  const workOrder = data?.workOrder;
  const isApproved =
    quote?.aprovacao === "aprovado" || quote?.status === "concluido";
  const isRejected =
    quote?.aprovacao === "recusado" || quote?.status === "cancelado";
  const isPending = Boolean(quote && !isApproved && !isRejected);
  const quoteItems = quote?.items ?? [];
  const displayedItems = isPending && quote?.permitir_aprovacao_parcial !== false
    ? quoteItems.filter((item) => selectedItemIds.includes(item.id))
    : quoteItems.filter((item) => item.approved !== false);
  const displayedTotal = quoteItems.length > 0
    ? displayedItems.length > 0 && displayedItems.every((item) => Number.isFinite(item.unit_price) && item.unit_price > 0)
      ? (() => {
          const subtotal = displayedItems.reduce((sum, item) => sum + item.qty * item.unit_price, 0);
          const fullSubtotal = quoteItems.reduce((sum, item) => sum + item.qty * Math.max(0, item.unit_price), 0);
          const requestedDiscount = Math.max(0, Number(quote?.desconto_valor ?? 0) || 0);
          const discount = quote?.desconto_tipo === "fixo"
            ? fullSubtotal > 0 ? requestedDiscount * subtotal / fullSubtotal : 0
            : subtotal * Math.min(100, requestedDiscount) / 100;
          return Math.max(0, Math.round((subtotal - discount) * 100) / 100);
        })()
      : null
    : quote && quote.amount > 0 ? quote.amount : null;
  const selectedItemsHavePendingPrice = displayedItems.some((item) => !Number.isFinite(item.unit_price) || item.unit_price <= 0);
  const canApprove = quoteItems.length > 0
    ? displayedItems.length > 0 && !selectedItemsHavePendingPrice && displayedTotal !== null && displayedTotal > 0
    : Boolean(quote && quote.amount > 0);
  const currentStepIdx = quote
    ? getOsStepIndex(quote.aprovacao, workOrder?.status ?? null)
    : 0;
  const stepRatio = currentStepIdx / Math.max(1, OS_STEPS.length - 1);

  const vehicleParts = quote?.vehicle_info
    ? [
        quote.vehicle_info.make,
        quote.vehicle_info.model,
        quote.vehicle_info.model_year ? String(quote.vehicle_info.model_year) : null,
      ].filter(Boolean)
    : [];

  const vehicleSummary =
    vehicleParts.length > 0
      ? `${vehicleParts.join(" ")}${quote?.vehicle_plate ? ` · ${quote.vehicle_plate}` : ""}`
      : quote?.vehicle_plate || "Não informado";

  const whatsappHref =
    data?.workshop.whatsapp && quote
      ? `https://wa.me/${data.workshop.whatsapp}?text=${encodeURIComponent(
          `Olá! Estou acompanhando o orçamento "${quote.title}" pela ficha online.`,
        )}`
      : null;

  return (
    <div
      className={`admin-root ph-no-capture ${dark ? "dark" : "admin-login-light"}`}
      style={{
        display: "block",
        minHeight: "100dvh",
        background: "var(--admin-bg)",
        color: "var(--admin-ink)",
      }}
    >
      <div
        className="admin-page"
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "28px clamp(18px, 3vw, 48px) 64px",
        }}
      >
        {/* Cabeçalho largo com logo oficial e botão de tema */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
            marginBottom: 22,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="admin-workspace-logo" style={{ width: 40, height: 40 }}>
              <img src="/benittes-logo.png" alt="Benittes Oficina Mecânica" />
            </div>
            <div>
              <strong style={{ display: "block", fontSize: 16, lineHeight: 1.2 }}>
                Benittes Oficina Mecânica
              </strong>
              <span style={{ fontSize: 12.5, color: "var(--admin-muted)" }}>
                Ficha de Orçamento &amp; Acompanhamento
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="admin-secondary"
                style={{
                  height: 36,
                  minHeight: 36,
                  padding: "0 14px",
                  fontSize: 12.5,
                }}
              >
                <MessageCircle size={14} /> WhatsApp
              </a>
            )}
            <button
              type="button"
              className="admin-secondary"
              style={{
                height: 36,
                minHeight: 36,
                padding: "0 14px",
                fontSize: 12.5,
              }}
              onClick={() => void fetchQuote(true)}
              disabled={refreshing}
              title="Atualizar status"
            >
              <RefreshCw
                size={13}
                style={{
                  animation: refreshing ? "spin 0.9s linear infinite" : undefined,
                }}
              />
              Atualizar
            </button>
            <button
              type="button"
              className="admin-icon-btn"
              onClick={toggleTheme}
              aria-label={dark ? "Ativar modo claro" : "Ativar modo escuro"}
              title={dark ? "Modo claro" : "Modo escuro"}
            >
              <motion.span
                key={dark ? "sun" : "moon"}
                initial={{ rotate: -65, scale: 0.65, opacity: 0 }}
                animate={{ rotate: 0, scale: 1, opacity: 1 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                style={{ display: "inline-flex" }}
              >
                {dark ? <Sun size={16} /> : <Moon size={16} />}
              </motion.span>
            </button>
          </div>
        </header>

        {loading ? (
          <div className="admin-panel" style={{ padding: 26 }}>
            <SkeletonBox height={26} width="35%" />
            <div style={{ height: 18 }} />
            <SkeletonBox height={56} width="100%" />
            <div style={{ height: 18 }} />
            <SkeletonBox height={160} width="100%" />
          </div>
        ) : error && !quote ? (
          <div className="admin-panel" style={{ padding: 40, textAlign: "center" }}>
            <XCircle size={32} style={{ color: "#ef4444", margin: "0 auto 10px" }} />
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
              Ficha indisponível
            </h2>
            <p style={{ color: "var(--admin-muted)", fontSize: 13.5 }}>{error}</p>
          </div>
        ) : quote ? (
          <>
            {error && (
              <p className="admin-form-error" style={{ marginBottom: 14 }}>
                {error}
              </p>
            )}
            <AnimatePresence>
              {actionMsg && (
                <motion.p
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="admin-form-success"
                  style={{ marginBottom: 14 }}
                >
                  {actionMsg}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Progresso Horizontal em largura total */}
            <section
              className="admin-panel"
              style={{ padding: "20px 24px", marginBottom: 18 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 18,
                  flexWrap: "wrap",
                }}
              >
                <h2 style={{ fontSize: 15, fontWeight: 600 }}>
                  Andamento do serviço
                </h2>
                {!isRejected && (
                  <motion.span
                    key={OS_STEPS[currentStepIdx].key}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    style={{ fontSize: 13, fontWeight: 600, color: "var(--admin-orange)" }}
                  >
                    Etapa atual: {OS_STEPS[currentStepIdx].label}
                  </motion.span>
                )}
              </div>

              {isRejected ? (
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 6,
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    background: "rgba(239, 68, 68, 0.06)",
                    fontSize: 13.5,
                  }}
                >
                  <strong>Orçamento recusado</strong>
                  {quote.recusado_em ? ` em ${dateText(quote.recusado_em)}` : ""}.
                  {quote.motivo_recusa && (
                    <p style={{ marginTop: 6, color: "var(--admin-muted)" }}>
                      Motivo informado: {quote.motivo_recusa}
                    </p>
                  )}
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <div
                    className="quote-stepper-track"
                    style={{
                      position: "absolute",
                      top: 19,
                      left: "10%",
                      right: "10%",
                      height: 3,
                      borderRadius: 999,
                      background: "var(--admin-line)",
                      zIndex: 0,
                      overflow: "hidden",
                    }}
                  >
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${stepRatio * 100}%` }}
                      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
                      style={{
                        height: "100%",
                        borderRadius: 999,
                        background:
                          currentStepIdx === OS_STEPS.length - 1
                            ? "#16a34a"
                            : "var(--admin-orange)",
                      }}
                    />
                  </div>

                  <div className="quote-stepper">
                    {OS_STEPS.map((step, idx) => {
                      const Icon = step.icon;
                      const done = idx <= currentStepIdx;
                      const isCurrent = idx === currentStepIdx;
                      return (
                        <motion.div
                          key={step.key}
                          animate={{ opacity: done ? 1 : 0.45 }}
                          transition={{ duration: 0.3 }}
                          style={{
                            position: "relative",
                            zIndex: 1,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            textAlign: "center",
                            gap: 8,
                            padding: "0 4px",
                          }}
                        >
                          <motion.div
                            animate={{ scale: isCurrent ? 1.12 : 1 }}
                            transition={{
                              type: "spring",
                              stiffness: 360,
                              damping: 24,
                            }}
                            style={{
                              width: 38,
                              height: 38,
                              borderRadius: 999,
                              display: "grid",
                              placeItems: "center",
                              background: "var(--admin-card)",
                              color: isCurrent
                                ? "var(--admin-orange)"
                                : done
                                  ? "#16a34a"
                                  : "var(--admin-muted)",
                              border: isCurrent
                                ? "1.5px solid var(--admin-orange)"
                                : done
                                  ? "1.5px solid #16a34a"
                                  : "1px solid var(--admin-line)",
                            }}
                          >
                            <Icon size={16} />
                          </motion.div>

                          <div>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: isCurrent ? 700 : 600,
                                color: isCurrent
                                  ? "var(--admin-orange)"
                                  : "var(--admin-ink)",
                              }}
                            >
                              {step.label}
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                              {step.desc}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* Grade larga 2 colunas no desktop */}
            <div className="quote-sheet-grid">
              {/* Coluna esquerda: Detalhes do orçamento */}
              <section className="admin-panel" style={{ padding: 24 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: 14,
                    paddingBottom: 18,
                    borderBottom: "1px solid var(--admin-line)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <h1
                      style={{
                        fontSize: "clamp(22px, 2.5vw, 28px)",
                        fontWeight: 600,
                        letterSpacing: "-0.02em",
                        lineHeight: 1.2,
                        marginBottom: 10,
                      }}
                    >
                      {quote.title}
                    </h1>
                    <AdminStatusBadge
                      status={
                        isApproved
                          ? workOrder?.status ?? "concluido"
                          : isRejected
                            ? "cancelado"
                            : "aguardando"
                      }
                      label={
                        isApproved
                          ? workOrder
                            ? osStatusLabel(workOrder.status)
                            : "Aprovado"
                          : isRejected
                            ? "Recusado"
                            : "Aguardando aprovação"
                      }
                    />
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--admin-muted)",
                      }}
                    >
                      Total
                    </span>
                    <strong
                      style={{
                        fontSize: 28,
                        fontWeight: 700,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {displayedTotal === null ? "A definir" : money(displayedTotal)}
                    </strong>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                    gap: 16,
                    padding: "18px 0",
                  }}
                >
                  <div>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12,
                        color: "var(--admin-muted)",
                      }}
                    >
                      Cliente
                    </span>
                    <strong style={{ fontSize: 14.5, fontWeight: 600 }}>
                      {quote.customer_name || "Não informado"}
                    </strong>
                  </div>

                  <div>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12,
                        color: "var(--admin-muted)",
                      }}
                    >
                      Veículo
                    </span>
                    <strong style={{ fontSize: 14.5, fontWeight: 600 }}>
                      {vehicleSummary}
                    </strong>
                  </div>

                  <div>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12,
                        color: "var(--admin-muted)",
                      }}
                    >
                      Validade
                    </span>
                    <strong style={{ fontSize: 14.5, fontWeight: 600 }}>
                      {dateText(quote.valid_until)}
                    </strong>
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid var(--admin-line)",
                    borderRadius: 6,
                    padding: "14px 16px",
                    background: "var(--admin-soft)",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--admin-muted)",
                      marginBottom: 6,
                    }}
                  >
                    Serviços e peças
                  </span>
                  {quote.items && quote.items.length > 0 ? (
                    <div style={{ display: "grid", gap: 8, marginBottom: quote.description ? 12 : 0 }}>
                      {quote.items.map((item) => {
                        const checked = isPending
                          ? selectedItemIds.includes(item.id)
                          : item.approved !== false;
                        const itemTotal = Math.max(1, item.qty) * Math.max(0, item.unit_price);
                        return (
                          <label
                            key={item.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              padding: "8px 10px",
                              borderRadius: 6,
                              border: "1px solid var(--admin-line)",
                              background: "var(--admin-card)",
                              cursor: isPending ? "pointer" : "default",
                              opacity: checked ? 1 : 0.55,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                              {isPending && quote.permitir_aprovacao_parcial !== false && (
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(val) => {
                                    setSelectedItemIds((prev) =>
                                      val === true
                                        ? [...prev, item.id]
                                        : prev.filter((id) => id !== item.id),
                                    );
                                  }}
                                />
                              )}
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                                  {item.name}
                                </div>
                                <div style={{ fontSize: 11.5, color: "var(--admin-muted)" }}>
                                  {item.type === "peca" ? "Peça" : "Serviço"} · Qtd: {item.qty}
                                  {!isPending && (item.approved === false ? " · Não aprovado" : " · Aprovado")}
                                </div>
                              </div>
                            </div>
                            <strong style={{ fontSize: 13.5, flexShrink: 0 }}>
                              {item.unit_price > 0 ? money(itemTotal) : "Valor em definição"}
                            </strong>
                          </label>
                        );
                      })}
                      {isPending && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, paddingTop: 4 }}>
                          <span style={{ color: "var(--admin-muted)" }}>
                            {quote.permitir_aprovacao_parcial === false ? "Total do orçamento:" : `Total selecionado (${displayedItems.length}/${quote.items.length} itens):`}
                          </span>
                          <strong>
                            {displayedItems.length === 0
                              ? "Selecione um item"
                              : selectedItemsHavePendingPrice
                                ? "A definir"
                                : money(displayedTotal ?? 0)}
                          </strong>
                        </div>
                      )}
                      {isPending && selectedItemsHavePendingPrice && (
                        <p style={{ margin: "2px 0 0", color: "var(--admin-muted)", fontSize: 12 }}>
                          A oficina ainda está confirmando o valor deste item. Você pode aprovar os itens com valor confirmado e pedir a atualização dos demais.
                        </p>
                      )}
                    </div>
                  ) : null}
                  {quote.description && (
                    <p
                      style={{
                        fontSize: 14,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        color: "var(--admin-ink)",
                        margin: 0,
                      }}
                    >
                      {quote.description}
                    </p>
                  )}
                  {!quote.description && (!quote.items || quote.items.length === 0) && (
                    <p
                      style={{
                        fontSize: 14,
                        lineHeight: 1.6,
                        color: "var(--admin-ink)",
                        margin: 0,
                      }}
                    >
                      Detalhes conforme alinhado com a oficina.
                    </p>
                  )}
                </div>
              </section>

              {/* Coluna direita: Decisão ou Diagnóstico/Observações */}
              <div style={{ display: "grid", gap: 16 }}>
                {isPending ? (
                  <section className="admin-panel" style={{ padding: 24 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>
                      Aprovar orçamento
                    </h2>

                    <div className="admin-field" style={{ marginBottom: 16 }}>
                      <label htmlFor="quote-client-note">
                        Observação (opcional)
                      </label>
                      <textarea
                        id="quote-client-note"
                        className="admin-textarea"
                        rows={1}
                        placeholder="Ex.: Pode prosseguir, busco no final da tarde..."
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        disabled={submitting !== null}
                        style={{
                          minHeight: 48,
                          padding: "13px 14px",
                          lineHeight: 1.45,
                          resize: "vertical",
                        }}
                      />
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <button
                        type="button"
                        className="admin-primary"
                        style={{ width: "100%", justifyContent: "center" }}
                        disabled={submitting !== null || !canApprove}
                        onClick={() => void handleDecision("approve")}
                      >
                        <CheckCircle2 size={16} />
                        {submitting === "approve" ? "Aprovando..." : "Aprovar Orçamento"}
                      </button>

                      <button
                        type="button"
                        className="admin-secondary"
                        style={{
                          width: "100%",
                          justifyContent: "center",
                          color: "#dc2626",
                        }}
                        disabled={submitting !== null}
                        onClick={() => void handleDecision("reject")}
                      >
                        <XCircle size={15} />
                        {submitting === "reject" ? "Registrando..." : "Recusar"}
                      </button>
                    </div>
                  </section>
                ) : (
                  <section className="admin-panel" style={{ padding: 24 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
                      Informações da OS
                    </h2>
                    <div style={{ display: "grid", gap: 10, fontSize: 13.5 }}>
                      {quote.aprovado_em && (
                        <div>
                          <span style={{ color: "var(--admin-muted)" }}>
                            Aprovado em:{" "}
                          </span>
                          <strong>{dateText(quote.aprovado_em)}</strong>
                        </div>
                      )}
                      {workOrder?.diagnosis && (
                        <div
                          style={{
                            padding: "10px 12px",
                            borderRadius: 6,
                            border: "1px solid var(--admin-line)",
                            background: "var(--admin-soft)",
                          }}
                        >
                          <strong style={{ display: "block", marginBottom: 4 }}>
                            Diagnóstico técnico
                          </strong>
                          <span style={{ color: "var(--admin-muted)" }}>
                            {workOrder.diagnosis}
                          </span>
                        </div>
                      )}
                      {quote.observacao_cliente && (
                        <div
                          style={{
                            padding: "10px 12px",
                            borderRadius: 6,
                            border: "1px solid var(--admin-line)",
                            background: "var(--admin-soft)",
                          }}
                        >
                          <strong style={{ display: "block", marginBottom: 4 }}>
                            Sua observação
                          </strong>
                          <span style={{ color: "var(--admin-muted)" }}>
                            {quote.observacao_cliente}
                          </span>
                        </div>
                      )}
                      {!workOrder?.diagnosis && !quote.observacao_cliente && (
                        <p style={{ color: "var(--admin-muted)", margin: 0 }}>
                          Qualquer atualização da oficina aparece automaticamente aqui nesta página.
                        </p>
                      )}
                    </div>
                  </section>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
