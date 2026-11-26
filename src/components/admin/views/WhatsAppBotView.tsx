"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import QRCode from "qrcode";
import {
  Bot,
  CheckCircle2,
  Cpu,
  LogOut,
  Power,
  QrCode,
  RefreshCw,
  Save,
  Send,
  Settings2,
  Smartphone,
  Terminal as TerminalIcon,
  Trash2,
} from "lucide-react";
import { AdminStatusBadge } from "../StatusBadge";
import { dateText } from "../utils";

type BotSession = {
  id: string;
  status: "connected" | "qr_ready" | "connecting" | "disconnected";
  qr_code?: string | null;
  phone_connected?: string | null;
  profile_name?: string | null;
  ai_mode?: string | null;
  ai_model?: string | null;
  ai_enabled?: boolean;
  response_mode?: "conversational" | "quote_only";
  auto_send_quotes?: boolean;
  automations_enabled?: boolean;
  owner_phone?: string | null;
  notify_on_human_transfer?: boolean;
  notify_on_quote_response?: boolean;
  notify_on_appointment?: boolean;
  appointment_reminders_enabled?: boolean;
  appointment_reminder_minutes?: number;
  appointment_reminder_message?: string | null;
  quote_followups_enabled?: boolean;
  quote_followup_hours?: number;
  quote_followup_message?: string | null;
  service_followups_enabled?: boolean;
  service_followup_days?: number;
  service_followup_message?: string | null;
  auto_quote_message_template?: string | null;
  owner_human_alert_message?: string | null;
  owner_quote_alert_message?: string | null;
  owner_appointment_alert_message?: string | null;
  audio_mode?: "direct_request" | "mirror" | "always" | "disabled";
  audio_voice?: string | null;
  ai_paused_phones?: string[] | null;
  human_reply_pause_minutes?: number | null;
  closed_auto_reply_enabled?: boolean;
  closed_auto_reply_message?: string | null;
  last_heartbeat?: string | null;
  updated_at?: string | null;
  is_online?: boolean;
};

type BotLog = {
  id: string;
  level: string;
  tag: string;
  message: string;
  created_at: string;
};

type OutboxRow = {
  id: string;
  phone: string;
  message: string;
  kind: string;
  status: string;
  error?: string | null;
  created_at: string;
};

type BotTab = "conexao" | "terminal" | "config" | "outbox";

const LOG_COLORS: Record<string, string> = {
  error: "#f87171",
  warn: "#fbbf24",
  success: "#4ade80",
  action: "#60a5fa",
  incoming: "#34d399",
  outgoing: "#a78bfa",
  info: "#94a3b8",
};

export function WhatsAppBotView() {
  const [tab, setTab] = useState<BotTab>("conexao");
  const [bot, setBot] = useState<BotSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<BotLog[]>([]);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [outboxStats, setOutboxStats] = useState({ pending: 0, sent: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  // Settings form
  const [autoSendQuotes, setAutoSendQuotes] = useState(true);
  const [responseMode, setResponseMode] = useState<"conversational" | "quote_only">("conversational");
  const [automationsEnabled, setAutomationsEnabled] = useState(false);
  const [ownerPhone, setOwnerPhone] = useState("");
  const [notifyQuote, setNotifyQuote] = useState(true);
  const [notifyHuman, setNotifyHuman] = useState(true);
  const [notifyAppointment, setNotifyAppointment] = useState(false);
  const [appointmentRemindersEnabled, setAppointmentRemindersEnabled] = useState(false);
  const [appointmentReminderMinutes, setAppointmentReminderMinutes] = useState(1440);
  const [appointmentReminderMessage, setAppointmentReminderMessage] = useState("Olá, {{nome}}! Passando para lembrar do seu horário na {{oficina}} em {{data}} às {{hora}}. Serviço: {{servico}}. Se precisar alterar, fale com a equipe.");
  const [quoteFollowupsEnabled, setQuoteFollowupsEnabled] = useState(false);
  const [quoteFollowupHours, setQuoteFollowupHours] = useState(24);
  const [quoteFollowupMessage, setQuoteFollowupMessage] = useState("Olá, {{nome}}! O orçamento {{servico}} da {{oficina}} ainda está aguardando sua resposta. Você pode consultar os detalhes por aqui: {{link}}");
  const [serviceFollowupsEnabled, setServiceFollowupsEnabled] = useState(false);
  const [serviceFollowupDays, setServiceFollowupDays] = useState(90);
  const [serviceFollowupMessage, setServiceFollowupMessage] = useState("Olá, {{nome}}! Já faz um tempo desde o serviço {{servico}} do veículo {{placa}}. Se estiver na hora da próxima revisão, a equipe da {{oficina}} pode ajudar.");
  const [autoQuoteMessageTemplate, setAutoQuoteMessageTemplate] = useState("Olá, {{nome}}! Aqui é da {{oficina}}. Preparamos o orçamento {{servico}} para {{veiculo}} no valor de {{valor}}. Você aprova a execução? Responda Aprovar ou Recusar.");
  const [ownerHumanAlertMessage, setOwnerHumanAlertMessage] = useState("🙋 *Atendimento humano solicitado*\nCliente: {{nome}}\nTelefone: {{telefone}}\nMotivo: {{motivo}}");
  const [ownerQuoteAlertMessage, setOwnerQuoteAlertMessage] = useState("🔔 *Resposta de orçamento*\nCliente: {{nome}}\nVeículo: {{placa}}\nServiço: {{servico}}\nValor: {{valor}}\nDecisão: {{decisao}}");
  const [ownerAppointmentAlertMessage, setOwnerAppointmentAlertMessage] = useState("📅 *Novo agendamento via WhatsApp*\nCliente: {{nome}} ({{telefone}})\nServiço: {{servico}}\nData: {{data}} às {{hora}}\nPlaca: {{placa}}");
  const [aiModel, setAiModel] = useState("qwen3.8-flash");
  const [audioMode, setAudioMode] = useState<"direct_request" | "mirror" | "always" | "disabled">("direct_request");
  const [audioVoice, setAudioVoice] = useState("pt-BR-FranciscaNeural");
  const [pausedPhonesText, setPausedPhonesText] = useState("");
  const [humanPauseMinutes, setHumanPauseMinutes] = useState(30);
  const [closedAutoReplyEnabled, setClosedAutoReplyEnabled] = useState(true);
  const [closedAutoReplyMessage, setClosedAutoReplyMessage] = useState(
    "Olá! 👋 No momento a *Benittes Oficina Mecânica* está fechada. Assim que retomarmos o atendimento, responderemos sua mensagem!",
  );
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  // Test message
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/whatsapp/action", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { session: BotSession | null };
      if (json.session) {
        setBot(json.session);
        if (!settingsHydrated) {
          setAutoSendQuotes(json.session.auto_send_quotes !== false);
          setResponseMode(json.session.response_mode === "quote_only" ? "quote_only" : "conversational");
          setAutomationsEnabled(json.session.automations_enabled === true);
          setOwnerPhone(json.session.owner_phone ?? "");
          setNotifyQuote(json.session.notify_on_quote_response !== false);
          setNotifyHuman(json.session.notify_on_human_transfer !== false);
          setNotifyAppointment(json.session.notify_on_appointment === true);
          setAppointmentRemindersEnabled(json.session.appointment_reminders_enabled === true);
          setAppointmentReminderMinutes(json.session.appointment_reminder_minutes ?? 1440);
          setAppointmentReminderMessage(json.session.appointment_reminder_message || "Olá, {{nome}}! Passando para lembrar do seu horário na {{oficina}} em {{data}} às {{hora}}. Serviço: {{servico}}. Se precisar alterar, fale com a equipe.");
          setQuoteFollowupsEnabled(json.session.quote_followups_enabled === true);
          setQuoteFollowupHours(json.session.quote_followup_hours ?? 24);
          setQuoteFollowupMessage(json.session.quote_followup_message || "Olá, {{nome}}! O orçamento {{servico}} da {{oficina}} ainda está aguardando sua resposta. Você pode consultar os detalhes por aqui: {{link}}");
          setServiceFollowupsEnabled(json.session.service_followups_enabled === true);
          setServiceFollowupDays(json.session.service_followup_days ?? 90);
          setServiceFollowupMessage(json.session.service_followup_message || "Olá, {{nome}}! Já faz um tempo desde o serviço {{servico}} do veículo {{placa}}. Se estiver na hora da próxima revisão, a equipe da {{oficina}} pode ajudar.");
          setAutoQuoteMessageTemplate(json.session.auto_quote_message_template || "Olá, {{nome}}! Aqui é da {{oficina}}. Preparamos o orçamento {{servico}} para {{veiculo}} no valor de {{valor}}. Você aprova a execução? Responda Aprovar ou Recusar.");
          setOwnerHumanAlertMessage(json.session.owner_human_alert_message || "🙋 *Atendimento humano solicitado*\nCliente: {{nome}}\nTelefone: {{telefone}}\nMotivo: {{motivo}}");
          setOwnerQuoteAlertMessage(json.session.owner_quote_alert_message || "🔔 *Resposta de orçamento*\nCliente: {{nome}}\nVeículo: {{placa}}\nServiço: {{servico}}\nValor: {{valor}}\nDecisão: {{decisao}}");
          setOwnerAppointmentAlertMessage(json.session.owner_appointment_alert_message || "📅 *Novo agendamento via WhatsApp*\nCliente: {{nome}} ({{telefone}})\nServiço: {{servico}}\nData: {{data}} às {{hora}}\nPlaca: {{placa}}");
          setAiModel(json.session.ai_model || "qwen3.8-flash");
          setAudioMode(json.session.audio_mode || "direct_request");
          setAudioVoice(json.session.audio_voice || "pt-BR-FranciscaNeural");
          setPausedPhonesText((json.session.ai_paused_phones ?? []).join("\n"));
          setHumanPauseMinutes(json.session.human_reply_pause_minutes ?? 30);
          setClosedAutoReplyEnabled(json.session.closed_auto_reply_enabled !== false);
          if (json.session.closed_auto_reply_message) {
            setClosedAutoReplyMessage(json.session.closed_auto_reply_message);
          }
          setSettingsHydrated(true);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [settingsHydrated]);

  const loadLogs = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp/logs", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return;
    const json = (await res.json()) as { logs?: BotLog[] };
    setLogs(json.logs ?? []);
  }, []);

  const loadOutbox = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp/outbox", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return;
    const json = (await res.json()) as {
      items?: OutboxRow[];
      stats?: { pending: number; sent: number; failed: number };
    };
    setOutbox(json.items ?? []);
    if (json.stats) setOutboxStats(json.stats);
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadLogs();
    void loadOutbox();
    const timer = setInterval(() => {
      void loadStatus();
      if (tab === "terminal") void loadLogs();
      if (tab === "outbox") void loadOutbox();
    }, 3000);
    return () => clearInterval(timer);
  }, [loadStatus, loadLogs, loadOutbox, tab]);

  useEffect(() => {
    if (bot?.status === "qr_ready" && bot.qr_code) {
      void QRCode.toDataURL(bot.qr_code, { width: 260, margin: 2 })
        .then((url) => setQrDataUrl(url))
        .catch(() => setQrDataUrl(null));
    } else {
      setQrDataUrl(null);
    }
  }, [bot?.status, bot?.qr_code]);

  async function sendAction(action: string, extra: Record<string, unknown> = {}): Promise<boolean> {
    setBusyAction(true);
    setError("");
    setFeedback("");
    try {
      const res = await fetch("/api/admin/whatsapp/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action, ...extra }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; session?: BotSession };
      if (!res.ok) throw new Error(json.error || "Erro ao executar ação.");
      if (json.session) setBot(json.session);
      setFeedback("Comando enviado para o bot.");
      void loadStatus();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha na operação.");
      return false;
    } finally {
      setBusyAction(false);
    }
  }

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    const saved = await sendAction("update_settings", {
      auto_send_quotes: autoSendQuotes,
      response_mode: responseMode,
      automations_enabled: automationsEnabled,
      owner_phone: ownerPhone,
      notify_on_quote_response: notifyQuote,
      notify_on_human_transfer: notifyHuman,
      notify_on_appointment: notifyAppointment,
      appointment_reminders_enabled: appointmentRemindersEnabled,
      appointment_reminder_minutes: appointmentReminderMinutes,
      appointment_reminder_message: appointmentReminderMessage,
      quote_followups_enabled: quoteFollowupsEnabled,
      quote_followup_hours: quoteFollowupHours,
      quote_followup_message: quoteFollowupMessage,
      service_followups_enabled: serviceFollowupsEnabled,
      service_followup_days: serviceFollowupDays,
      service_followup_message: serviceFollowupMessage,
      auto_quote_message_template: autoQuoteMessageTemplate,
      owner_human_alert_message: ownerHumanAlertMessage,
      owner_quote_alert_message: ownerQuoteAlertMessage,
      owner_appointment_alert_message: ownerAppointmentAlertMessage,
      ai_model: aiModel,
      audio_mode: audioMode,
      audio_voice: audioVoice,
      ai_paused_phones: pausedPhonesText.split(/[\n,;]+/).map((phone) => phone.trim()).filter(Boolean),
      human_reply_pause_minutes: humanPauseMinutes,
      closed_auto_reply_enabled: closedAutoReplyEnabled,
      closed_auto_reply_message: closedAutoReplyMessage,
    });
    if (saved) setFeedback("Configurações do bot salvas.");
  }

  async function handleClearLogs() {
    await fetch("/api/admin/whatsapp/logs", { method: "DELETE", credentials: "same-origin" });
    setLogs([]);
  }

  async function handleSendTest(e: FormEvent) {
    e.preventDefault();
    setSendingTest(true);
    setError("");
    setFeedback("");
    try {
      const res = await fetch("/api/admin/whatsapp/outbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ phone: testPhone, message: testMessage }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Erro ao enfileirar mensagem.");
      setTestMessage("");
      setFeedback("Mensagem adicionada à fila de envio.");
      void loadOutbox();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao enviar.");
    } finally {
      setSendingTest(false);
    }
  }

  const isOnline =
    typeof bot?.is_online === "boolean"
      ? bot.is_online
      : Boolean(
          bot?.last_heartbeat &&
            Date.now() - new Date(bot.last_heartbeat).getTime() <= 90_000,
        );

  const statusBadge = !isOnline
    ? { status: "cancelado", label: "Offline" }
    : bot?.status === "connected"
      ? { status: "concluido", label: "Conectado" }
      : bot?.status === "qr_ready"
        ? { status: "aguardando", label: "Aguardando QR Code" }
        : bot?.status === "connecting"
          ? { status: "em_andamento", label: "Conectando" }
          : { status: "cancelado", label: "Desconectado" };

  return (
    <>
      <div className="admin-page-title">
        <div>
          <h1>Bot WhatsApp</h1>
        </div>
        <div className="admin-title-actions">
          <button
            type="button"
            className="admin-secondary"
            onClick={() => {
              void loadStatus();
              void loadLogs();
              void loadOutbox();
            }}
          >
            <RefreshCw size={15} /> Atualizar
          </button>
        </div>
      </div>

      <div className="admin-toolbar" style={{ marginBottom: 18 }}>
        <div className="admin-filter-pills">
          <button
            type="button"
            className={`admin-pill ${tab === "conexao" ? "active" : ""}`}
            onClick={() => setTab("conexao")}
          >
            <QrCode size={13} style={{ marginRight: 5 }} /> Conexão e QR Code
          </button>
          <button
            type="button"
            className={`admin-pill ${tab === "terminal" ? "active" : ""}`}
            onClick={() => setTab("terminal")}
          >
            <TerminalIcon size={13} style={{ marginRight: 5 }} /> Terminal ({logs.length})
          </button>
          <button
            type="button"
            className={`admin-pill ${tab === "config" ? "active" : ""}`}
            onClick={() => setTab("config")}
          >
            <Settings2 size={13} style={{ marginRight: 5 }} /> Configurações
          </button>
          <button
            type="button"
            className={`admin-pill ${tab === "outbox" ? "active" : ""}`}
            onClick={() => setTab("outbox")}
          >
            <Send size={13} style={{ marginRight: 5 }} /> Fila de envios ({outboxStats.pending})
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

      {tab === "conexao" && (
        <div className="admin-two-col">
          <div className="admin-panel">
            <div className="admin-panel-head">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Smartphone size={16} />
                <h2>Status da instância</h2>
              </div>
              <AdminStatusBadge status={statusBadge.status} label={statusBadge.label} />
            </div>

            {loading ? (
              <p style={{ color: "var(--admin-muted)", fontSize: 13 }}>Carregando status…</p>
            ) : (
              <div style={{ display: "grid", gap: 12, fontSize: 13.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--admin-muted)" }}>Número conectado</span>
                  <strong>{bot?.phone_connected || "—"}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--admin-muted)" }}>Perfil</span>
                  <strong>{bot?.profile_name || "—"}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--admin-muted)" }}>Modelo de IA</span>
                  <strong>{bot?.ai_model || aiModel}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--admin-muted)" }}>Último sinal (Heartbeat)</span>
                  <strong>
                    {bot?.last_heartbeat
                      ? new Date(bot.last_heartbeat).toLocaleString("pt-BR")
                      : "—"}
                  </strong>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingTop: 12,
                    borderTop: "1px solid var(--admin-line)",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Cpu size={15} /> Respostas com IA
                  </span>
                  <button
                    type="button"
                    className="admin-secondary"
                    disabled={busyAction}
                    onClick={() => void sendAction("toggle_ai", { ai_enabled: !(bot?.ai_enabled !== false) })}
                  >
                    <Power size={14} />
                    {bot?.ai_enabled !== false ? "Ativa (Pausar)" : "Pausada (Ativar)"}
                  </button>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 6 }}>
                  <button
                    type="button"
                    className="admin-secondary"
                    disabled={busyAction}
                    onClick={() => void sendAction("restart")}
                  >
                    <RefreshCw size={14} /> Reiniciar
                  </button>
                  <button
                    type="button"
                    className="admin-secondary"
                    disabled={busyAction}
                    onClick={() => void sendAction("clear_session")}
                  >
                    <Trash2 size={14} /> Limpar sessão
                  </button>
                  <button
                    type="button"
                    className="admin-ghost-danger"
                    disabled={busyAction}
                    onClick={() => void sendAction("disconnect")}
                  >
                    <LogOut size={14} /> Desconectar
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="admin-panel" style={{ display: "grid", placeItems: "center", textAlign: "center" }}>
            {bot?.status === "connected" ? (
              <div style={{ display: "grid", gap: 10, placeItems: "center", padding: 16 }}>
                <CheckCircle2 size={44} style={{ color: "var(--admin-green)" }} />
                <strong>WhatsApp conectado</strong>
                <p style={{ fontSize: 13, color: "var(--admin-muted)", margin: 0 }}>
                  O bot está pronto para enviar orçamentos de OS, códigos 2FA e responder clientes.
                </p>
              </div>
            ) : qrDataUrl ? (
              <div style={{ display: "grid", gap: 10, placeItems: "center", padding: 12 }}>
                <img
                  src={qrDataUrl}
                  alt="QR Code WhatsApp"
                  style={{ width: 220, height: 220, borderRadius: 12, background: "#fff", padding: 8 }}
                />
                <span style={{ fontSize: 12.5, color: "var(--admin-muted)" }}>
                  Abra o WhatsApp &rarr; Aparelhos conectados &rarr; Conectar aparelho
                </span>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10, placeItems: "center", padding: 16 }}>
                <Bot size={40} style={{ color: "var(--admin-muted)" }} />
                <strong>Aguardando processo do bot</strong>
                <p style={{ fontSize: 12.5, color: "var(--admin-muted)", margin: 0 }}>
                  Inicie o serviço com <code>cd bot-whatsapp &amp;&amp; npm start</code> para gerar o QR Code.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "terminal" && (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TerminalIcon size={16} />
              <h2>Terminal ao vivo</h2>
            </div>
            <button type="button" className="admin-secondary" onClick={() => void handleClearLogs()}>
              <Trash2 size={14} /> Limpar
            </button>
          </div>
          <div
            style={{
              background: "#0b0e14",
              color: "#e2e8f0",
              borderRadius: 10,
              padding: 14,
              fontFamily: "monospace",
              fontSize: 12.5,
              lineHeight: 1.55,
              maxHeight: 420,
              overflowY: "auto",
              border: "1px solid var(--admin-line)",
            }}
          >
            {logs.length === 0 ? (
              <span style={{ color: "#64748b" }}>Nenhum log registrado ainda…</span>
            ) : (
              logs.map((l) => (
                <div key={l.id} style={{ wordBreak: "break-word" }}>
                  <span style={{ color: "#64748b" }}>
                    [{new Date(l.created_at).toLocaleTimeString("pt-BR")}]
                  </span>{" "}
                  <span style={{ color: LOG_COLORS[l.level] || "#94a3b8", fontWeight: 600 }}>
                    [{l.tag}]
                  </span>{" "}
                  <span>{l.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === "config" && (
        <form onSubmit={(e) => void handleSaveSettings(e)} className="admin-panel">
          <div className="admin-panel-head">
            <h2>Configurações do Bot e Automação</h2>
          </div>

          <div className="admin-form-grid">
            <div className="admin-field wide">
              <label className="admin-check">
                <Checkbox checked={automationsEnabled} onCheckedChange={(checked) => setAutomationsEnabled(checked === true)} />
                <span>Automatizações de mensagens ativas</span>
              </label>
              <small style={{ color: "var(--admin-muted)" }}>Desative para pausar lembretes, avisos e mensagens automáticas. A IA e as mensagens enviadas manualmente continuam funcionando.</small>
            </div>

            <div className="admin-field wide">
              <label htmlFor="whatsapp-response-mode">Modo de resposta às mensagens</label>
              <select
                className="admin-select"
                id="whatsapp-response-mode"
                name="response_mode"
                value={responseMode}
                onChange={(event) => setResponseMode(event.target.value as typeof responseMode)}
              >
                <option value="conversational">Atendimento conversacional</option>
                <option value="quote_only">Somente registrar resposta de orçamento</option>
              </select>
              <small style={{ color: "var(--admin-muted)" }}>
                Nesse modo, o bot não conversa nem envia respostas da IA. Ele só registra uma aprovação ou recusa clara de um orçamento pendente. As automatizações configuradas continuam seguindo suas próprias regras.
              </small>
            </div>

            <div className="admin-field wide">
              <label className="admin-check">
                <Checkbox
                  checked={autoSendQuotes}
                  onCheckedChange={(checked) => setAutoSendQuotes(checked === true)}
                />
                <span>
                  Enviar orçamento automaticamente (mensagem direta, sem IA) ao criar OS ou Orçamento com telefone
                </span>
              </label>
            </div>

            {autoSendQuotes && (
              <div className="admin-field wide">
                <label>Mensagem ao enviar orçamento ou OS</label>
                <textarea className="admin-textarea" rows={3} maxLength={1500} value={autoQuoteMessageTemplate} onChange={(event) => setAutoQuoteMessageTemplate(event.target.value)} id="admin-views-whatsappbotview-601" />
                <small style={{ color: "var(--admin-muted)" }}>Variáveis: {"{{nome}}"}, {"{{oficina}}"}, {"{{servico}}"}, {"{{veiculo}}"} e {"{{valor}}"}.</small>
              </div>
            )}

            <div className="admin-field">
              <label>WhatsApp do responsável (alertas)</label>
              <input
                className="admin-input"
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value)}
                placeholder="(11) 99999-9999" id="admin-views-whatsappbotview-608"
              />
            </div>

            <div className="admin-field">
              <label>Modelo OpenCode</label>
              <input
                className="admin-input"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="qwen3.8-flash" id="admin-views-whatsappbotview-618"
              />
            </div>

            <div className="admin-field">
              <label>Modo de resposta em áudio (TTS)</label>
              <select
                className="admin-select"
                value={audioMode}
                onChange={(e) => setAudioMode(e.target.value as typeof audioMode)} id="admin-views-whatsappbotview-628"
              >
                <option value="direct_request">Quando o cliente pedir</option>
                <option value="mirror">Espelhar (se cliente mandar áudio)</option>
                <option value="always">Sempre responder em áudio</option>
                <option value="disabled">Desativado</option>
              </select>
            </div>

            <div className="admin-field wide">
              <label>Pausa após mensagem do atendente</label>
              <select className="admin-select" value={humanPauseMinutes} onChange={(event) => setHumanPauseMinutes(Number(event.target.value))} id="admin-views-whatsappbotview-642">
                <option value={0}>Não pausar automaticamente</option>
                <option value={15}>15 minutos</option>
                <option value={30}>30 minutos</option>
                <option value={60}>1 hora</option>
                <option value={120}>2 horas</option>
                <option value={240}>4 horas</option>
                <option value={480}>8 horas</option>
                <option value={1440}>24 horas</option>
              </select>
              <small style={{ color: "var(--admin-muted)" }}>Depois de uma resposta manual enviada pelo site, a IA ignora novas mensagens desse contato durante esse período. Elas não ficam em fila para resposta posterior.</small>
            </div>

            <div className="admin-field wide">
              <label>Números com IA pausada</label>
              <textarea
                className="admin-input"
                rows={4}
                value={pausedPhonesText}
                onChange={(event) => setPausedPhonesText(event.target.value)}
                placeholder={"+5511999999999\n+5511888888888"} id="admin-views-whatsappbotview-657"
              />
              <small style={{ color: "var(--admin-muted)" }}>
                Um número por linha. Também aceita vírgulas. O bot não responderá automaticamente a esses contatos até remover o número e salvar.
              </small>
            </div>

            <div className="admin-field">
              <label>Voz do TTS</label>
              <select
                className="admin-select"
                value={audioVoice}
                onChange={(e) => setAudioVoice(e.target.value)} id="admin-views-whatsappbotview-671"
              >
                <option value="pt-BR-FranciscaNeural">Francisca (Feminina)</option>
                <option value="pt-BR-AntonioNeural">Antonio (Masculina)</option>
              </select>
            </div>

            <div className="admin-field">
              <label className="admin-check">
                <Checkbox
                  checked={notifyQuote}
                  onCheckedChange={(checked) => setNotifyQuote(checked === true)}
                />
                <span>Avisar responsável quando cliente aprovar/recusar</span>
              </label>
            </div>
            {notifyQuote && (
              <div className="admin-field wide">
                <label>Modelo do aviso de orçamento</label>
                <textarea className="admin-textarea" rows={3} maxLength={1500} value={ownerQuoteAlertMessage} onChange={(event) => setOwnerQuoteAlertMessage(event.target.value)} id="admin-views-whatsappbotview-693" />
                <small style={{ color: "var(--admin-muted)" }}>Variáveis: {"{{nome}}"}, {"{{placa}}"}, {"{{servico}}"}, {"{{valor}}"} e {"{{decisao}}"}.</small>
              </div>
            )}

            <div className="admin-field">
              <label className="admin-check">
                <Checkbox
                  checked={notifyHuman}
                  onCheckedChange={(checked) => setNotifyHuman(checked === true)}
                />
                <span>Avisar responsável quando cliente pedir atendente</span>
              </label>
            </div>
            {notifyHuman && (
              <div className="admin-field wide">
                <label>Modelo do aviso de atendimento humano</label>
                <textarea className="admin-textarea" rows={3} maxLength={1500} value={ownerHumanAlertMessage} onChange={(event) => setOwnerHumanAlertMessage(event.target.value)} id="admin-views-whatsappbotview-710" />
                <small style={{ color: "var(--admin-muted)" }}>Variáveis: {"{{nome}}"}, {"{{telefone}}"} e {"{{motivo}}"}.</small>
              </div>
            )}

            <div className="admin-field">
              <label className="admin-check">
                <Checkbox checked={notifyAppointment} onCheckedChange={(checked) => setNotifyAppointment(checked === true)} />
                <span>Avisar responsável quando houver novo agendamento pelo WhatsApp</span>
              </label>
            </div>
            {notifyAppointment && (
              <div className="admin-field wide">
                <label>Modelo do aviso de agendamento</label>
                <textarea className="admin-textarea" rows={3} maxLength={1500} value={ownerAppointmentAlertMessage} onChange={(event) => setOwnerAppointmentAlertMessage(event.target.value)} id="admin-views-whatsappbotview-724" />
                <small style={{ color: "var(--admin-muted)" }}>Variáveis: {"{{nome}}"}, {"{{telefone}}"}, {"{{servico}}"}, {"{{data}}"}, {"{{hora}}"} e {"{{placa}}"}.</small>
              </div>
            )}

            <div className="admin-field wide" style={{ paddingTop: 14, borderTop: "1px solid var(--admin-line)" }}>
              <label className="admin-check">
                <Checkbox checked={appointmentRemindersEnabled} onCheckedChange={(checked) => setAppointmentRemindersEnabled(checked === true)} />
                <span>Lembrete automático de agendamento</span>
              </label>
            </div>
            {appointmentRemindersEnabled && (
              <>
                <div className="admin-field">
                  <label>Enviar com quantos minutos de antecedência</label>
                  <input className="admin-input" type="number" min={15} max={10080} step={15} required value={appointmentReminderMinutes} onChange={(event) => setAppointmentReminderMinutes(Number(event.target.value))} id="admin-views-whatsappbotview-739" />
                  <small style={{ color: "var(--admin-muted)" }}>De 15 minutos a 7 dias.</small>
                </div>
                <div className="admin-field wide">
                  <label>Mensagem do lembrete</label>
                  <textarea className="admin-textarea" rows={3} maxLength={1500} value={appointmentReminderMessage} onChange={(event) => setAppointmentReminderMessage(event.target.value)} id="admin-views-whatsappbotview-744" />
                  <small style={{ color: "var(--admin-muted)" }}>Variáveis: {"{{nome}}"}, {"{{oficina}}"}, {"{{data}}"}, {"{{hora}}"}, {"{{servico}}"} e {"{{placa}}"}.</small>
                </div>
              </>
            )}

            <div className="admin-field wide" style={{ paddingTop: 14, borderTop: "1px solid var(--admin-line)" }}>
              <label className="admin-check">
                <Checkbox checked={quoteFollowupsEnabled} onCheckedChange={(checked) => setQuoteFollowupsEnabled(checked === true)} />
                <span>Lembrete de orçamento que ainda aguarda resposta</span>
              </label>
            </div>
            {quoteFollowupsEnabled && (
              <>
                <div className="admin-field">
                  <label>Enviar após quantas horas</label>
                  <input className="admin-input" type="number" min={1} max={720} step={1} required value={quoteFollowupHours} onChange={(event) => setQuoteFollowupHours(Number(event.target.value))} id="admin-views-whatsappbotview-760" />
                  <small style={{ color: "var(--admin-muted)" }}>De 1 hora a 30 dias.</small>
                </div>
                <div className="admin-field wide">
                  <label>Mensagem de acompanhamento</label>
                  <textarea className="admin-textarea" rows={3} maxLength={1500} value={quoteFollowupMessage} onChange={(event) => setQuoteFollowupMessage(event.target.value)} id="admin-views-whatsappbotview-765" />
                  <small style={{ color: "var(--admin-muted)" }}>Variáveis: {"{{nome}}"}, {"{{oficina}}"}, {"{{servico}}"}, {"{{placa}}"}, {"{{valor}}"} e {"{{link}}"}.</small>
                </div>
              </>
            )}

            <div className="admin-field wide" style={{ paddingTop: 14, borderTop: "1px solid var(--admin-line)" }}>
              <label className="admin-check">
                <Checkbox checked={serviceFollowupsEnabled} onCheckedChange={(checked) => setServiceFollowupsEnabled(checked === true)} />
                <span>Lembrete de revisão após um serviço concluído</span>
              </label>
            </div>
            {serviceFollowupsEnabled && (
              <>
                <div className="admin-field">
                  <label>Enviar após quantos dias</label>
                  <input className="admin-input" type="number" min={1} max={3650} step={1} required value={serviceFollowupDays} onChange={(event) => setServiceFollowupDays(Number(event.target.value))} id="admin-views-whatsappbotview-781" />
                  <small style={{ color: "var(--admin-muted)" }}>De 1 dia a 10 anos.</small>
                </div>
                <div className="admin-field wide">
                  <label>Mensagem do lembrete de revisão</label>
                  <textarea className="admin-textarea" rows={3} maxLength={1500} value={serviceFollowupMessage} onChange={(event) => setServiceFollowupMessage(event.target.value)} id="admin-views-whatsappbotview-786" />
                  <small style={{ color: "var(--admin-muted)" }}>Variáveis: {"{{nome}}"}, {"{{oficina}}"}, {"{{servico}}"}, {"{{placa}}"} e {"{{data}}"}.</small>
                </div>
              </>
            )}

            <div className="admin-field wide" style={{ paddingTop: 10, borderTop: "1px solid var(--admin-line)" }}>
              <label className="admin-check">
                <Checkbox
                  checked={closedAutoReplyEnabled}
                  onCheckedChange={(checked) => setClosedAutoReplyEnabled(checked === true)}
                />
                <span>Enviar mensagem automática quando a oficina estiver fechada (fora do horário / folga)</span>
              </label>
            </div>

            {closedAutoReplyEnabled && (
              <div className="admin-field wide">
                <label>Mensagem automática (oficina fechada)</label>
                <textarea
                  className="admin-textarea"
                  rows={3}
                  value={closedAutoReplyMessage}
                  onChange={(e) => setClosedAutoReplyMessage(e.target.value)}
                  placeholder="Mensagem enviada automaticamente fora do horário de funcionamento..." id="admin-views-whatsappbotview-805"
                />
              </div>
            )}
          </div>

          <div className="admin-modal-actions">
            <button type="submit" className="admin-primary" disabled={busyAction}>
              <Save size={15} /> Salvar configurações
            </button>
          </div>
        </form>
      )}

      {tab === "outbox" && (
        <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
          <div className="admin-panel" style={{ minWidth: 0 }}>
            <div className="admin-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
              <h2>Disparo direto (sem IA)</h2>
              <span style={{ fontSize: 12, color: "var(--admin-muted)" }}>
                Pendentes: {outboxStats.pending} · Enviadas: {outboxStats.sent} · Falhas: {outboxStats.failed}
              </span>
            </div>
            <form onSubmit={(e) => void handleSendTest(e)} className="admin-form-grid">
              <div className="admin-field wide">
                <label>Telefone (com DDD)</label>
                <input
                  className="admin-input"
                  required
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="(11) 99999-9999" id="admin-views-whatsappbotview-836"
                />
              </div>
              <div className="admin-field wide">
                <label>Mensagem</label>
                <textarea
                  className="admin-textarea"
                  rows={2}
                  required
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  placeholder="Mensagem direta para o cliente..." id="admin-views-whatsappbotview-846"
                />
              </div>
              <div className="admin-field wide" style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="submit" className="admin-primary" disabled={sendingTest}>
                  <Send size={14} /> {sendingTest ? "Enviando…" : "Enviar mensagem"}
                </button>
              </div>
            </form>
          </div>

          <div className="admin-panel" style={{ minWidth: 0 }}>
            <div className="admin-panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
              <h2>Últimos envios ({outbox.length})</h2>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Telefone</th>
                    <th>Tipo</th>
                    <th>Mensagem</th>
                    <th>Status</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {outbox.map((item) => (
                    <tr key={item.id}>
                      <td>{item.phone}</td>
                      <td>{item.kind}</td>
                      <td style={{ maxWidth: 340, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.message}
                      </td>
                      <td>
                        <AdminStatusBadge
                          status={item.status === "sent" ? "concluido" : item.status === "failed" ? "cancelado" : "aguardando"}
                          label={item.status}
                        />
                      </td>
                      <td>{dateText(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
