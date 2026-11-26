"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import {
  Activity, AlertCircle, AudioLines, BadgeCheck, BrainCircuit, CalendarDays, Check, CheckCheck,
  ChevronDown, CircleDashed, Clock3, FileText, ImagePlus, LoaderCircle, MessageSquarePlus,
  Mic, Paperclip, Send, ShieldCheck, Square, UserRound, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { AgentAttachment, AgentCatalogItem, AgentConversation, AgentKey, AgentMessage, AgentProfile, AgentProposal, AgentRoutineRun } from "../../../admin/agents";
import { AGENT_CATALOG } from "../../../admin/agents";
import type { PanelMember, Session } from "../../../lib/supabase";
import styles from "./AgentsView.module.css";

type LoadPayload = {
  agents: AgentCatalogItem[];
  profiles: AgentProfile[];
  conversations: AgentConversation[];
  runs: AgentRoutineRun[];
  canConfigure: boolean;
};
type StepState = { id: string; title: string; status: "pending" | "active" | "complete" | "skipped" | "error" };
type ToolState = { id: string; label: string; status: "active" | "complete" | "error" };
type DraftFile = { key: string; file: File; name: string; mime: string; kind: "image" | "video" | "audio"; localUrl: string; progress: number; state: "queued" | "preparing" | "uploading" | "uploaded" | "error" };
type DisplayAttachment = AgentAttachment & { local_url?: string; progress?: number; upload_state?: DraftFile["state"] };
type DisplayMessage = Omit<AgentMessage, "attachments"> & { attachments: DisplayAttachment[]; local?: boolean };

const MAX_FILE_BYTES: Record<DraftFile["kind"], number> = { image: 8 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 15 * 1024 * 1024 };
const ACCEPTED_IMAGE = new Set(["image/jpeg", "image/png", "image/webp"]);
const ACCEPTED_VIDEO = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const ACCEPTED_AUDIO = new Set(["audio/webm", "audio/ogg", "audio/opus", "audio/mp4", "audio/x-m4a", "audio/mpeg", "audio/wav", "audio/x-wav"]);
const STEP_TITLES: Record<string, string> = {
  context: "Preparando contexto",
  media: "Analisando anexos",
  operations: "Consultando dados autorizados",
  response: "Preparando resposta",
};
const CHANGE_LABELS: Record<string, string> = {
  objective_add: "Adicionar objetivo", objective_remove: "Remover objetivo",
  agreement_add: "Adicionar combinado", agreement_remove: "Remover combinado",
  memory_add: "Guardar memória", alert_add: "Adicionar alerta", alert_remove: "Remover alerta",
  routine_create: "Criar rotina", routine_remove: "Remover rotina", routine_set_enabled: "Alterar estado da rotina",
};

async function jsonResponse<T>(response: Response): Promise<T & { error?: string }> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Não foi possível concluir a ação.");
  return body;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date);
}

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function AgentAvatar({ agent, className }: { agent: AgentCatalogItem; className: string }) {
  return (
    <span className={`${className} ${styles.avatarFrame}`} aria-hidden="true">
      <Image src={agent.avatar} alt="" width={54} height={54} loading="lazy" decoding="async" />
    </span>
  );
}

function getFileKind(file: File): DraftFile["kind"] {
  if (ACCEPTED_IMAGE.has(file.type)) return "image";
  if (ACCEPTED_VIDEO.has(file.type)) return "video";
  if (ACCEPTED_AUDIO.has(file.type)) return "audio";
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "webp"].includes(extension || "")) return "image";
  if (["mp4", "webm", "mov"].includes(extension || "")) return "video";
  if (["ogg", "opus", "mp3", "m4a", "wav"].includes(extension || "")) return "audio";
  throw new Error("Formato não suportado. Use JPG, PNG, WebP, MP4, WebM, MOV ou áudio comum.");
}

function normalizeMime(file: File, kind: DraftFile["kind"]) {
  if (file.type) return file.type.toLowerCase().split(";", 1)[0];
  const extension = file.name.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    mp4: "video/mp4", webm: kind === "video" ? "video/webm" : "audio/webm", mov: "video/quicktime",
    ogg: "audio/ogg", opus: "audio/opus", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
  };
  return byExtension[extension || ""] || "application/octet-stream";
}

function makeDraft(file: File): DraftFile {
  const kind = getFileKind(file);
  const mime = normalizeMime(file, kind);
  if (file.size < 1 || file.size > MAX_FILE_BYTES[kind]) throw new Error(`O limite para ${kind === "video" ? "vídeos" : kind === "audio" ? "áudios" : "fotos"} é ${formatBytes(MAX_FILE_BYTES[kind])}.`);
  return { key: crypto.randomUUID(), file, name: file.name.slice(0, 180), mime, kind, localUrl: URL.createObjectURL(file), progress: 0, state: "queued" };
}

async function blobToJpeg(blob: Blob, name: string) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Não foi possível preparar um quadro do vídeo.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let output: Blob | null = null;
    for (const quality of [0.68, 0.55, 0.42]) {
      output = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Não foi possível preparar um quadro do vídeo.")), "image/jpeg", quality));
      if (output.size <= 512 * 1024) break;
    }
    canvas.width = 0;
    canvas.height = 0;
    if (!output || output.size > 512 * 1024) throw new Error("Um quadro do vídeo ficou muito grande.");
    return new File([output], name, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

async function extractVideoFrames(file: File): Promise<File[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Tempo esgotado ao preparar o vídeo.")), 9000);
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => { window.clearTimeout(timer); reject(new Error("O navegador não conseguiu ler este vídeo.")); };
      video.load();
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0) return [];
    const times = [...new Set([0.08, 0.34, 0.66, 0.92].map((part) => Math.max(0, Math.min(video.duration - 0.05, video.duration * part))))];
    const frames: File[] = [];
    for (const [index, time] of times.entries()) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Tempo esgotado ao preparar os quadros.")), 6000);
        video.onseeked = () => { window.clearTimeout(timer); resolve(); };
        video.onerror = () => { window.clearTimeout(timer); reject(new Error("Não foi possível analisar os quadros deste vídeo.")); };
        video.currentTime = time;
      });
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Não foi possível preparar um quadro do vídeo.");
      context.drawImage(video, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Não foi possível preparar um quadro do vídeo.")), "image/jpeg", 0.68));
      canvas.width = 0;
      canvas.height = 0;
      frames.push(await blobToJpeg(blob, `quadro-${index + 1}.jpg`));
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function uploadSignedFile(url: string, headers: Record<string, string>, file: File, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Cache-Control", "no-store");
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round(event.loaded / event.total * 100)));
    };
    xhr.onerror = () => reject(new Error("Falha de conexão durante o envio do anexo."));
    xhr.onabort = () => reject(new Error("Envio cancelado."));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("O armazenamento recusou o arquivo."));
    xhr.send(file);
  });
}

type UploadedFile = { path: string; name: string; mime_type: string; size: number; kind: DraftFile["kind"] };

async function uploadAgentFile(file: File, name: string, kind: DraftFile["kind"] | "video-frame", conversationId: string, onProgress: (progress: number) => void): Promise<UploadedFile> {
  const mime = normalizeMime(file, kind === "video-frame" ? "image" : kind);
  const prep = await jsonResponse<{ path: string; upload_url: string; upload_headers: Record<string, string> }>(await fetch("/api/admin/agents/uploads", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, kind, mime_type: mime, size: file.size }),
  }));
  await uploadSignedFile(prep.upload_url, prep.upload_headers || {}, file, onProgress);
  return { path: prep.path, name: name.slice(0, 180), mime_type: mime, size: file.size, kind: kind === "video-frame" ? "image" : kind };
}

function statusText(status: StepState["status"]) {
  return status === "active" ? "Em andamento" : status === "complete" ? "Concluído" : status === "skipped" ? "Não necessário" : status === "error" ? "Falhou" : "Aguardando";
}

function RoutineToggle({
  enabled,
  disabled,
  onClick,
  label,
}: {
  enabled: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      className={`${styles.switch} ${enabled ? styles.switchOn : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span />
    </button>
  );
}

function FileCard({ attachment }: { attachment: DisplayAttachment }) {
  const src = attachment.local_url || attachment.signed_url || "";
  const uploading = attachment.upload_state && !["uploaded", "error"].includes(attachment.upload_state);
  return (
    <div className={styles.fileCard}>
      {attachment.kind === "image" && src ? <img src={src} alt={attachment.name} /> : attachment.kind === "video" && src ? <video src={src} controls preload="metadata" /> : <div className={styles.fileIcon}>{attachment.kind === "audio" ? <AudioLines size={17} /> : attachment.kind === "video" ? <FileText size={17} /> : <ImagePlus size={17} />}</div>}
      <div className={styles.fileInfo}>
        <span title={attachment.name}>{attachment.name}</span>
        <small>{uploading ? `Enviando ${Math.max(0, Math.min(100, attachment.progress || 0))}%` : attachment.upload_state === "error" ? "Falha no envio" : formatBytes(attachment.size)}</small>
        {uploading && <i><b style={{ width: `${Math.max(0, Math.min(100, attachment.progress || 0))}%` }} /></i>}
        {attachment.kind === "audio" && src && !uploading && <audio controls src={src} />}
      </div>
    </div>
  );
}

function renderList(title: string, items: string[], empty: string, icon: ReactNode) {
  return (
    <section className={styles.profileSection}>
      <h3>{icon}{title}</h3>
      {items.length ? <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className={styles.muted}>{empty}</p>}
    </section>
  );
}

export function AgentsView({ member }: { session: Session; member: PanelMember }) {
  const reducedMotion = useReducedMotion();
  const [data, setData] = useState<LoadPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentKey | null>(null);
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [draft, setDraft] = useState("");
  const [draftFiles, setDraftFiles] = useState<DraftFile[]>([]);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [tools, setTools] = useState<ToolState[]>([]);
  const [busy, setBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [savingProfile, setSavingProfile] = useState("");
  const [resolvingProposal, setResolvingProposal] = useState("");
  const [narrowAgentListOpen, setNarrowAgentListOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const inputFileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageLoadRef = useRef(0);
  const shouldFollowMessagesRef = useRef(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const draftsRef = useRef<DraftFile[]>([]);

  const activeAgent = useMemo(() => AGENT_CATALOG.find((agent) => agent.key === selectedAgent) ?? null, [selectedAgent]);
  const profile = useMemo(() => data?.profiles.find((item) => item.agent_key === selectedAgent) ?? null, [data, selectedAgent]);
  const agentRuns = useMemo(() => data?.runs.filter((run) => run.agent_key === selectedAgent) ?? [], [data, selectedAgent]);
  const agentConversations = useMemo(() => data?.conversations.filter((item) => item.agent_key === selectedAgent) ?? [], [data, selectedAgent]);
  const displayName = member.full_name?.trim() || member.email;

  const loadMessages = useCallback(async (conversationId: string, showLoading = true) => {
    const requestId = ++messageLoadRef.current;
    if (showLoading) setMessagesLoading(true);
    try {
      const response = await fetch(`/api/admin/agents/conversations/${conversationId}`, { credentials: "same-origin", cache: "no-store" });
      const payload = await jsonResponse<{ conversation: AgentConversation; messages: AgentMessage[]; proposals: AgentProposal[] }>(response);
      if (requestId !== messageLoadRef.current) return;
      shouldFollowMessagesRef.current = true;
      setConversation(payload.conversation);
      setMessages(payload.messages as DisplayMessage[]);
      setProposals(payload.proposals ?? []);
      setError("");
    } finally {
      if (showLoading && requestId === messageLoadRef.current) setMessagesLoading(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await jsonResponse<LoadPayload>(await fetch("/api/admin/agents", { credentials: "same-origin", cache: "no-store" }));
      setData(payload);
      const first = payload.agents.find((agent) => payload.profiles.some((item) => item.agent_key === agent.key && item.enabled)) || payload.agents[0];
      if (first) {
        setSelectedAgent(first.key);
        const last = payload.conversations.find((item) => item.agent_key === first.key);
        if (last) {
          setConversation(last);
          setMessages([]);
          setProposals([]);
          void loadMessages(last.id).catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível abrir a conversa."));
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar os agentes.");
    } finally {
      setLoading(false);
    }
  }, [loadMessages]);

  useEffect(() => { void loadAgents(); }, [loadAgents]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !shouldFollowMessagesRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, busy, steps, tools]);

  useEffect(() => {
    draftsRef.current = draftFiles;
  }, [draftFiles]);

  useEffect(() => () => {
    for (const item of draftsRef.current) URL.revokeObjectURL(item.localUrl);
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setRecordingTime(Math.floor((Date.now() - recordingStartRef.current) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  function updateDataProfile(nextProfile: AgentProfile) {
    setData((current) => current ? { ...current, profiles: current.profiles.map((item) => item.agent_key === nextProfile.agent_key ? nextProfile : item) } : current);
  }

  async function selectAgent(agent: AgentCatalogItem) {
    if (busy) return;
    setSelectedAgent(agent.key);
    setNarrowAgentListOpen(false);
    setProfileOpen(false);
    setError("");
    const latest = data?.conversations.find((item) => item.agent_key === agent.key);
    if (latest) {
      try { await loadMessages(latest.id); }
      catch (reason) { setConversation(latest); setMessages([]); setError(reason instanceof Error ? reason.message : "Não foi possível abrir a conversa."); }
    } else {
      messageLoadRef.current += 1;
      setMessagesLoading(false);
      setConversation(null);
      setMessages([]);
      setProposals([]);
    }
  }

  async function openConversation(item: AgentConversation) {
    if (busy) return;
    setError("");
    setHistoryOpen(false);
    setConversation(item);
    try { await loadMessages(item.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível abrir a conversa."); }
  }

  async function createConversation(agentKey = selectedAgent, preserveMessages = false) {
    if (!agentKey) throw new Error("Escolha um agente para iniciar.");
    const payload = await jsonResponse<{ conversation: AgentConversation }>(await fetch("/api/admin/agents", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_key: agentKey }),
    }));
    messageLoadRef.current += 1;
    setMessagesLoading(false);
    setConversation(payload.conversation);
    setHistoryOpen(false);
    if (!preserveMessages) {
      setMessages([]);
      setProposals([]);
    }
    setData((current) => current ? { ...current, conversations: [payload.conversation, ...current.conversations] } : current);
    return payload.conversation;
  }

  function addFiles(files: FileList | File[]) {
    setError("");
    try {
      const next = Array.from(files).map(makeDraft);
      if (draftFiles.length + next.length > 4) throw new Error("Envie até quatro anexos por mensagem.");
      setDraftFiles((current) => [...current, ...next]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível anexar este arquivo.");
    }
  }

  function removeDraft(key: string) {
    setDraftFiles((current) => {
      const found = current.find((item) => item.key === key);
      if (found) URL.revokeObjectURL(found.localUrl);
      return current.filter((item) => item.key !== key);
    });
  }

  function setLocalProgress(messageId: string, index: number, progress: number, state?: DraftFile["state"]) {
    setMessages((current) => current.map((message) => message.id !== messageId ? message : {
      ...message,
      attachments: message.attachments.map((attachment, attachmentIndex) => attachmentIndex !== index ? attachment : {
        ...attachment,
        progress,
        upload_state: state ?? attachment.upload_state,
      }),
    }));
  }

  async function uploadDraft(item: DraftFile, conversationId: string, onProgress: (value: number) => void) {
    if (item.kind !== "video") return uploadAgentFile(item.file, item.name, item.kind, conversationId, onProgress);
    let frames: File[] = [];
    try { frames = await extractVideoFrames(item.file); }
    catch (reason) { setToast(reason instanceof Error ? `${reason.message} O vídeo será anexado sem análise visual.` : "O vídeo será anexado sem análise visual."); }
    const parts = frames.length + 1;
    const uploaded = await uploadAgentFile(item.file, item.name, "video", conversationId, (value) => onProgress(Math.round(value / parts)));
    const framePaths: string[] = [];
    for (const [index, frame] of frames.entries()) {
      const frameUpload = await uploadAgentFile(frame, `${item.name} · quadro ${index + 1}`, "video-frame", conversationId, (value) => onProgress(Math.round((100 + index * 100 + value) / parts)));
      framePaths.push(frameUpload.path);
    }
    return { ...uploaded, frame_paths: framePaths };
  }

  async function consumeChatStream(response: Response, optimisticId: string) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("O navegador não recebeu o fluxo de resposta.");
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;
    const handleEvent = (raw: string) => {
      const lines = raw.split(/\r?\n/);
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7) || "message";
      const dataLine = lines.find((line) => line.startsWith("data: "))?.slice(6);
      if (!dataLine) return;
      const value = JSON.parse(dataLine) as Record<string, unknown>;
      if (event === "run_started") {
        setSteps(Array.isArray(value.steps) ? value.steps as StepState[] : []);
        setTools([]);
      } else if (event === "task_started") {
        setSteps(Array.isArray(value.steps) ? value.steps as StepState[] : []);
        setTools([]);
      } else if (event === "step") {
        const id = String(value.id || "");
        setSteps((current) => current.map((step) => step.id === id ? { ...step, status: value.status as StepState["status"], title: typeof value.title === "string" ? value.title : step.title } : step));
      } else if (event === "user_saved") {
        setMessages((current) => current.map((message) => message.id === optimisticId ? {
          ...message,
          id: String(value.id || optimisticId),
          content: typeof value.content === "string" ? value.content : message.content,
          created_at: typeof value.created_at === "string" ? value.created_at : message.created_at,
        } : message));
      } else if (event === "tool_start") {
        setTools((current) => [...current, { id: String(value.id || crypto.randomUUID()), label: String(value.label || "Consultando"), status: "active" }]);
      } else if (event === "tool_complete") {
        const id = String(value.id || "");
        setTools((current) => current.map((tool) => tool.id === id ? { ...tool, label: String(value.label || tool.label), status: value.ok === false ? "error" : "complete" } : tool));
      } else if (event === "proposal") {
        const proposal = value.proposal as AgentProposal | undefined;
        if (proposal?.id) setProposals((current) => current.some((item) => item.id === proposal.id) ? current : [...current, proposal]);
      } else if (event === "done") {
        const result = value.message as DisplayMessage | undefined;
        if (result?.id) setMessages((current) => [...current.filter((message) => message.id !== result.id), result]);
        completed = true;
      } else if (event === "error") {
        setError(String(value.error || "Não foi possível concluir a resposta."));
        setSteps((current) => current.map((step) => step.status === "active" ? { ...step, status: "error" } : step));
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        handleEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    if (buffer.trim()) handleEvent(buffer);
    if (!completed) throw new Error("A resposta foi interrompida. Atualize a conversa para conferir o resultado.");
  }

  async function sendMessage(text: string, files: DraftFile[]) {
    if (busy || (!text.trim() && !files.length) || !selectedAgent || !profile?.enabled) return;
    setBusy(true);
    setError("");
    setToast("");
    shouldFollowMessagesRef.current = true;
    const optimisticId = `local-${crypto.randomUUID()}`;
    const localFiles: DisplayAttachment[] = files.map((item) => ({
      path: "", name: item.name, mime_type: item.mime, size: item.file.size, kind: item.kind,
      local_url: item.localUrl, progress: 0, upload_state: "queued",
    }));
    const optimistic: DisplayMessage = {
      id: optimisticId,
      conversation_id: conversation?.id || "",
      role: "user",
      content: text,
      attachments: localFiles,
      metadata: {},
      created_at: new Date().toISOString(),
      local: true,
    };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setDraftFiles([]);
    setSteps([]);
    setTools([]);
    abortRef.current = new AbortController();

    try {
      const currentConversation = conversation || await createConversation(selectedAgent, true);
      const payloadAttachments: Array<Record<string, unknown>> = [];
      for (const [index, item] of files.entries()) {
        setLocalProgress(optimisticId, index, 0, item.kind === "video" ? "preparing" : "uploading");
        try {
          const uploaded = await uploadDraft(item, currentConversation.id, (progress) => setLocalProgress(optimisticId, index, progress, "uploading"));
          payloadAttachments.push(uploaded);
          setLocalProgress(optimisticId, index, 100, "uploaded");
        } catch (reason) {
          setLocalProgress(optimisticId, index, 0, "error");
          throw reason;
        }
      }

      setMessages((current) => current.map((message) => message.id !== optimisticId ? message : {
        ...message,
        conversation_id: currentConversation.id,
        attachments: message.attachments.map((attachment, index) => ({ ...attachment, path: String(payloadAttachments[index]?.path || ""), frame_paths: payloadAttachments[index]?.frame_paths as string[] | undefined })),
      }));
      const response = await fetch("/api/admin/agents/chat", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: abortRef.current.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: currentConversation.id, content: text, attachments: payloadAttachments }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || "O agente não conseguiu receber a mensagem.");
      await consumeChatStream(response, optimisticId);
      setData((current) => current ? {
        ...current,
        conversations: current.conversations.map((item) => item.id === currentConversation.id ? { ...item, last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() } : item),
      } : current);
      await loadMessages(currentConversation.id, false).catch(() => {});
    } catch (reason) {
      if ((reason as Error)?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Não foi possível enviar a mensagem.");
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const files = draftFiles;
    await sendMessage(draft, files);
    for (const file of files) URL.revokeObjectURL(file.localUrl);
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Este navegador não permite gravar áudio. Você ainda pode anexar um arquivo de áudio.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorderStreamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(recordingChunksRef.current, { type: type.split(";", 1)[0] });
        const file = new File([blob], `gravacao-${Date.now()}.${type.includes("ogg") ? "ogg" : "webm"}`, { type: blob.type, lastModified: Date.now() });
        stream.getTracks().forEach((track) => track.stop());
        recorderStreamRef.current = null;
        setRecording(false);
        setRecordingTime(0);
        try {
          const item = makeDraft(file);
          setDraftFiles((current) => current.length < 4 ? [...current, item] : current);
          if (draftFiles.length >= 4) { URL.revokeObjectURL(item.localUrl); setError("Envie até quatro anexos por mensagem."); }
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "A gravação excede o limite permitido.");
        }
      };
      recorder.start(250);
      recordingStartRef.current = Date.now();
      setRecording(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível iniciar a gravação.");
    }
  }

  async function updateProfile(action: "agent_enabled" | "routine_enabled", enabled: boolean, routineId?: string) {
    if (!activeAgent || !data?.canConfigure || savingProfile) return;
    const busyKey = routineId || activeAgent.key;
    setSavingProfile(busyKey);
    setError("");
    try {
      const result = await jsonResponse<{ profile: AgentProfile }>(await fetch("/api/admin/agents/profile", {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_key: activeAgent.key, action, enabled, routine_id: routineId }),
      }));
      updateDataProfile(result.profile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar a alteração.");
    } finally {
      setSavingProfile("");
    }
  }

  async function decideProposal(proposal: AgentProposal, decision: "approve" | "reject") {
    setResolvingProposal(proposal.id);
    setError("");
    try {
      const result = await jsonResponse<{ proposal: AgentProposal; profile?: AgentProfile }>(await fetch("/api/admin/agents/proposals", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal_id: proposal.id, decision }),
      }));
      setProposals((current) => current.map((item) => item.id === result.proposal.id ? result.proposal : item));
      if (result.profile) updateDataProfile(result.profile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível resolver a proposta.");
    } finally {
      setResolvingProposal("");
    }
  }

  async function cancelResponse() {
    abortRef.current?.abort();
    setBusy(false);
    setSteps((current) => current.map((step) => step.status === "active" ? { ...step, status: "error" } : step));
  }

  function showSuggestion(text: string) {
    setDraft(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  if (loading) {
    return (
      <div className={styles.root}>
        <div className={styles.pageHeading}><h1>Agents</h1></div>
        <section className={`${styles.workspace} ${styles.loadingWorkspace}`} aria-label="Carregando Agents" aria-busy="true">
          <aside className={styles.loadingRail} aria-hidden="true">
            <div className={styles.railHeader}><span className={styles.loadingLabel} /></div>
            <div className={styles.loadingAgentList}>{[0, 1, 2, 3].map((item) => <div className={styles.loadingAgent} key={item}><i /><span><b /><small /></span></div>)}</div>
          </aside>
          <div className={styles.loadingChat} aria-hidden="true">
            <div className={styles.loadingChatHeader}><i /><span><b /><small /></span><em /></div>
            <div className={styles.loadingMessages}><div className={styles.loadingAgentBubble} /><div className={styles.loadingUserBubble} /><div className={styles.loadingAgentBubbleShort} /></div>
            <div className={styles.loadingComposer}><i /><span /></div>
          </div>
        </section>
      </div>
    );
  }

  if (!data || data.agents.length === 0) {
    return <div className={styles.root}><div className={styles.pageHeading}><h1>Agents</h1></div><div className={styles.emptyState}><BrainCircuit size={22} /><strong>{error || "Nenhum agente está configurado."}</strong><p>Peça ao proprietário para verificar a configuração do módulo.</p></div></div>;
  }

  const activeProfile = profile;
  const enabled = activeProfile?.enabled !== false;
  const currentConversationId = conversation?.id || "";

  return (
    <div className={styles.root}>
      <div className={styles.pageHeading}>
        <div><h1>Agents</h1></div>
      </div>

      {error && <div className={styles.errorBanner} role="alert"><AlertCircle size={16} /><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Fechar aviso"><X size={15} /></button></div>}
      {toast && <div className={styles.toast}><Activity size={15} /><span>{toast}</span><button type="button" onClick={() => setToast("")} aria-label="Fechar aviso"><X size={15} /></button></div>}

      <section className={styles.workspace} aria-label="Área de conversa com agentes">
        <aside className={`${styles.agentRail} ${narrowAgentListOpen ? styles.agentRailOpen : ""}`}>
          <div className={styles.railHeader}><span>SEUS AGENTES</span></div>
          <div className={styles.agentList}>
            {data.agents.map((agent) => {
              const itemProfile = data.profiles.find((item) => item.agent_key === agent.key);
              const selected = selectedAgent === agent.key;
              const latest = data.conversations.find((item) => item.agent_key === agent.key);
              return (
                <button key={agent.key} type="button" className={`${styles.agentItem} ${selected ? styles.agentSelected : ""}`} onClick={() => void selectAgent(agent)} aria-current={selected ? "true" : undefined} aria-label={`${agent.name}, ${agent.role}, ${itemProfile?.enabled ? "ativo" : "desativado"}`}>
                  <AgentAvatar agent={agent} className={styles.agentAvatar} />
                  <span className={styles.agentText}><strong>{agent.name}</strong><small>{agent.role}</small><em>{latest?.title || agent.summary}</em></span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className={styles.chatColumn}>
          {activeAgent ? (
            <>
              <header className={styles.chatHeader}>
                <button type="button" className={styles.mobileAgentButton} onClick={() => setNarrowAgentListOpen((value) => !value)} aria-expanded={narrowAgentListOpen}>
                  <AgentAvatar agent={activeAgent} className={styles.agentAvatar} />
                  <span>{activeAgent.name}<small>{activeAgent.role}</small></span><ChevronDown size={15} />
                </button>
                <div className={styles.chatIdentity}>
                  <AgentAvatar agent={activeAgent} className={styles.agentAvatar} />
                  <div><strong>{activeAgent.name}</strong><span>{activeAgent.role} · atendimento interno para {displayName}</span></div>
                </div>
                <div className={styles.headerActions}>
                  <button type="button" className={styles.iconButton} onClick={() => setHistoryOpen((value) => !value)} disabled={busy || agentConversations.length === 0} aria-label="Abrir histórico de conversas" title="Histórico" aria-expanded={historyOpen}><Clock3 size={16} /></button>
                  <button type="button" className={styles.secondaryButton} onClick={() => void createConversation()} disabled={!enabled || busy}><MessageSquarePlus size={16} /><span>Nova conversa</span></button>
                  <button type="button" className={`${styles.iconButton} ${profileOpen ? styles.iconButtonActive : ""}`} onClick={() => setProfileOpen(true)} aria-label={`Abrir perfil de ${activeAgent.name}`} title="Perfil do agente"><UserRound size={17} /></button>
                </div>
              </header>

              {historyOpen && agentConversations.length > 0 && (
                <div className={styles.historyStrip}>
                  <span>HISTÓRICO</span>
                  {agentConversations.slice(0, 10).map((item) => <button type="button" key={item.id} aria-current={conversation?.id === item.id ? "true" : undefined} disabled={busy} onClick={() => void openConversation(item)}>{item.title}<small>{formatDate(item.last_message_at)}</small></button>)}
                </div>
              )}

              <div className={styles.messageScroll} ref={scrollRef} onScroll={(event) => {
                const element = event.currentTarget;
                shouldFollowMessagesRef.current = element.scrollHeight - element.clientHeight - element.scrollTop < 96;
              }} aria-live="polite" aria-busy={messagesLoading}>
                {messagesLoading ? (
                  <div className={`${styles.loadingMessages} ${styles.inlineLoadingMessages}`} aria-label="Carregando mensagens" aria-busy="true"><div className={styles.loadingAgentBubble} /><div className={styles.loadingUserBubble} /><div className={styles.loadingAgentBubbleShort} /></div>
                ) : (
                  <>
                    {messages.length === 0 && (
                      <motion.div className={styles.welcome} initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
                        <AgentAvatar agent={activeAgent} className={styles.welcomeAvatar} />
                        <span className={styles.kicker}>{activeAgent.role.toUpperCase()}</span>
                        <h2>Como posso ajudar?</h2>
                        <p>{activeAgent.summary} O agente só consulta dados permitidos para sua função.</p>
                      </motion.div>
                    )}

                    <motion.div key={conversation?.id ?? `${selectedAgent ?? ""}-nova`} className={styles.messages} initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: "easeOut" }}>
                    {messages.map((message, index) => (
                      <motion.article key={message.id} initial={reducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: reducedMotion ? 0 : Math.min(index * 0.055, 0.33), ease: "easeOut" }} className={`${styles.messageRow} ${message.role === "user" ? styles.userRow : styles.agentRow}`}>
                        {message.role === "assistant" && <AgentAvatar agent={activeAgent} className={styles.messageAvatar} />}
                        <div className={`${styles.bubble} ${message.role === "user" ? styles.userBubble : styles.agentBubble}`}>
                          {message.content && <p>{message.content}</p>}
                          {!!message.attachments.length && <div className={styles.messageFiles}>{message.attachments.map((attachment, index) => <FileCard key={`${message.id}-${index}`} attachment={attachment} />)}</div>}
                          <time>{formatTime(message.created_at)}{message.local && busy ? " · Enviando" : ""}</time>
                          {message.role === "assistant" && (message.metadata?.proposal_ids || []).map((proposalId) => {
                            const proposal = proposals.find((item) => item.id === proposalId);
                            return proposal ? <ProposalCard key={proposal.id} proposal={proposal} canConfigure={data.canConfigure} busy={resolvingProposal === proposal.id} onDecision={(decision) => void decideProposal(proposal, decision)} /> : null;
                          })}
                        </div>
                      </motion.article>
                  ))}
                    </motion.div>
                  </>
                )}

                {busy && (steps.length > 0 || tools.length > 0) && <WorkingPanel reducedMotion={Boolean(reducedMotion)} steps={steps} tools={tools} />}
                <div className={styles.scrollTail} />
              </div>

              {!enabled && <div className={styles.disabledBanner}><AlertCircle size={16} />Este agente está desativado. Um usuário autorizado pode ativá-lo pelo perfil.</div>}
              <form className={styles.composer} onSubmit={(event) => void handleSubmit(event)}>
                {draftFiles.length > 0 && <div className={styles.draftTray}>{draftFiles.map((item) => <div className={styles.draftItem} key={item.key}><span className={styles.draftIcon}>{item.kind === "audio" ? <AudioLines size={15} /> : item.kind === "video" ? <FileText size={15} /> : <ImagePlus size={15} />}</span><span><strong title={item.name}>{item.name}</strong><small>{formatBytes(item.file.size)} · {item.kind === "image" ? "Foto" : item.kind === "video" ? "Vídeo" : "Áudio"}</small></span><button type="button" aria-label={`Remover ${item.name}`} onClick={() => removeDraft(item.key)}><X size={14} /></button></div>)}</div>}
                {recording && <div className={styles.recordingBar}><span className={styles.recordingDot} /><AudioLines size={18} /><span>Gravando áudio</span><time>{String(Math.floor(recordingTime / 60)).padStart(2, "0")}:{String(recordingTime % 60).padStart(2, "0")}</time><button type="button" onClick={() => void toggleRecording()} aria-label="Parar gravação"><Square size={14} fill="currentColor" /></button></div>}
                {busy && <div className={styles.busyLine}><TypingIndicator reducedMotion={Boolean(reducedMotion)} /><span>{steps.find((step) => step.status === "active")?.title || "O agente está preparando a resposta"}</span><button type="button" onClick={() => void cancelResponse()}>Interromper</button></div>}
                <div className={styles.suggestions} aria-label={`Sugestões para ${activeAgent.name}`}>
                  {activeAgent.suggestions.slice(0, 4).map((suggestion) => <button type="button" key={suggestion} title={suggestion} disabled={busy || !enabled} onClick={() => showSuggestion(suggestion)}>{suggestion}</button>)}
                </div>
                <div className={styles.composerRow}>
                  <input ref={inputFileRef} className={styles.hiddenInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,audio/*" multiple onChange={(event) => { if (event.currentTarget.files) addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
                  <button type="button" className={styles.composerIcon} onClick={() => inputFileRef.current?.click()} disabled={busy || !enabled} aria-label="Anexar foto, vídeo ou áudio" title="Anexar foto, vídeo ou áudio"><Paperclip size={18} /></button>
                  <button type="button" className={`${styles.composerIcon} ${recording ? styles.recordingButton : ""}`} onClick={() => void toggleRecording()} disabled={busy || !enabled} aria-label={recording ? "Parar gravação" : "Gravar áudio"} title={recording ? "Parar gravação" : "Gravar áudio"}><Mic size={18} /></button>
                  <textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 4000))} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={`Mensagem para ${activeAgent.name}...`} rows={1} maxLength={4000} disabled={busy || !enabled} aria-label="Mensagem para o agente" />
                  <button type="submit" className={styles.sendButton} disabled={busy || (!draft.trim() && !draftFiles.length) || !enabled} aria-label="Enviar mensagem" title="Enviar mensagem"><Send size={17} /></button>
                </div>
                <div className={styles.composerFooter}><small>{draft.length}/4000</small></div>
              </form>
            </>
          ) : <div className={styles.emptyState}>Nenhum agente disponível.</div>}
        </div>

        <AnimatePresence>
          {profileOpen && activeAgent && activeProfile && (
            <>
              <motion.button type="button" className={styles.profileScrim} aria-label="Fechar perfil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setProfileOpen(false)} />
              <motion.aside className={styles.profilePanel} initial={reducedMotion ? false : { x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={reducedMotion ? { opacity: 0 } : { x: 24, opacity: 0 }} transition={{ duration: 0.22, ease: "easeOut" }} aria-label={`Perfil de ${activeAgent.name}`}>
                <div className={styles.profileHeader}>
                  <div><span className={styles.kicker}>PERFIL DO AGENTE</span><h2>{activeAgent.name}</h2><small>{activeAgent.role}</small></div>
                  <button type="button" className={styles.iconButton} onClick={() => setProfileOpen(false)} aria-label="Fechar perfil"><X size={17} /></button>
                </div>
                <div className={styles.profileScroll}>
                  <div className={styles.profileIntro}><AgentAvatar agent={activeAgent} className={styles.agentAvatar} /><p>{activeAgent.summary}</p></div>
                  <section className={styles.profileStateRow}><div><strong>Agente ativo</strong><span>{activeProfile.enabled ? "Disponível no painel" : "Desativado para novas conversas"}</span></div><RoutineToggle enabled={activeProfile.enabled} disabled={!data.canConfigure || Boolean(savingProfile)} label={`Ativar ou desativar ${activeAgent.name}`} onClick={() => void updateProfile("agent_enabled", !activeProfile.enabled)} /></section>
                  {!data.canConfigure && <p className={styles.permissionHint}>Apenas quem tem permissão de escrita em Agents pode alterar configurações.</p>}
                  {renderList("Objetivos", activeProfile.objectives, "Ainda não há objetivos definidos. Peça um ajuste pelo chat.", <BadgeCheck size={15} />)}
                  {renderList("O que sabe", [...activeAgent.capabilities, ...activeProfile.knowledge], "Conhecimento cadastrado aparecerá aqui.", <BrainCircuit size={15} />)}
                  {renderList("Combinados", activeProfile.agreements, "Nenhum combinado salvo. Você pode propor um pelo chat.", <ShieldCheck size={15} />)}
                  {renderList("O que lembra", activeProfile.memories, "Memórias aprovadas pela equipe aparecerão aqui.", <FileText size={15} />)}
                  <section className={styles.profileSection}>
                    <h3><AlertCircle size={15} />Alertas configurados</h3>
                    {activeProfile.alerts.length ? <ul>{activeProfile.alerts.map((item) => <li key={item.id}>{item.text}</li>)}</ul> : <p className={styles.muted}>Peça no chat para registrar um ponto de atenção.</p>}
                  </section>
                  <section className={styles.profileSection}>
                    <div className={styles.sectionHeading}><h3><Activity size={15} />Rotinas</h3><span>{activeProfile.routines.length}</span></div>
                    {activeProfile.routines.length ? <div className={styles.routines}>{activeProfile.routines.map((routine) => {
                      const lastRun = agentRuns.find((run) => run.routine_id === routine.id);
                      return <div className={styles.routineRow} key={routine.id}>
                        <div className={styles.routineText}><strong>{routine.name}</strong><span>{routine.frequency === "weekly" ? `Semanal · ${routine.weekday ? ["", "seg", "ter", "qua", "qui", "sex", "sáb", "dom"][routine.weekday] : "segunda"}` : "Diária"}{lastRun ? ` · última execução ${formatDate(lastRun.run_date)}` : " · ainda não executada"}</span>{lastRun && <small className={lastRun.status === "failed" ? styles.runFailed : lastRun.has_alert ? styles.runAlert : styles.runOk}>{typeof lastRun.result?.summary === "string" ? lastRun.result.summary : lastRun.status === "failed" ? "Falha ao executar" : "Rotina concluída"}</small>}</div>
                        <RoutineToggle enabled={routine.enabled} disabled={!data.canConfigure || Boolean(savingProfile)} label={`${routine.enabled ? "Desativar" : "Ativar"} a rotina ${routine.name}`} onClick={() => void updateProfile("routine_enabled", !routine.enabled, routine.id)} />
                      </div>;
                    })}</div> : <p className={styles.muted}>Peça no chat uma rotina diária ou semanal. Toda nova rotina fica desligada até alguém ativá-la.</p>}
                  </section>
                  <section className={styles.profileSection}>
                    <h3><Clock3 size={15} />Atividade recente</h3>
                    {agentRuns.length ? <div className={styles.runList}>{agentRuns.slice(0, 6).map((run) => <div key={run.id} className={styles.runItem}><span className={run.has_alert ? styles.runDotAlert : styles.runDot} /><div><strong>{run.routine_name}</strong><small>{formatDate(run.run_date)} · {run.status === "completed" ? "concluída" : run.status === "running" ? "em andamento" : "falhou"}</small>{typeof run.result?.summary === "string" && <p>{run.result.summary}</p>}</div></div>)}</div> : <p className={styles.muted}>As execuções das rotinas aparecerão aqui.</p>}
                  </section>
                  <div className={styles.profileHint}><MessageSquarePlus size={15} /><span>Para mudar objetivos, combinados, memórias ou alertas, peça no chat. A alteração aparece para revisão antes de ser aplicada.</span></div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

function ProposalCard({ proposal, canConfigure, busy, onDecision }: { proposal: AgentProposal; canConfigure: boolean; busy: boolean; onDecision: (decision: "approve" | "reject") => void }) {
  const routine = proposal.payload?.routine as Record<string, unknown> | undefined;
  const description = typeof proposal.payload?.text === "string" ? proposal.payload.text : typeof routine?.name === "string" ? routine.name : String(proposal.payload?.text || "");
  return (
    <div className={styles.proposalCard}>
      <div className={styles.proposalHeading}><ShieldCheck size={15} /><strong>Proposta de configuração</strong><span>{proposal.status === "approved" ? "Aplicada" : proposal.status === "rejected" ? "Recusada" : proposal.status === "expired" ? "Expirada" : "Aguardando"}</span></div>
      <div className={styles.proposalBody}><small>{CHANGE_LABELS[proposal.change_type] || "Alteração"}</small><p>{description}</p>{proposal.change_type === "routine_create" && <em>Rotina nova, inicialmente desativada · {routine?.frequency === "weekly" ? "semanal" : "diária"}</em>}</div>
      {proposal.status === "pending" && canConfigure && <div className={styles.proposalActions}><button type="button" className={styles.rejectButton} disabled={busy} onClick={() => onDecision("reject")}>Recusar</button><button type="button" className={styles.approveButton} disabled={busy} onClick={() => onDecision("approve")}>{busy ? <LoaderCircle size={14} className={styles.spinner} /> : <Check size={14} />} Confirmar</button></div>}
      {proposal.status === "pending" && !canConfigure && <small className={styles.permissionHint}>Aguardando confirmação de alguém com permissão de configuração.</small>}
      {proposal.status === "pending" && <small className={styles.proposalExpiry}>Expira em {formatDate(proposal.expires_at)} às {formatTime(proposal.expires_at)}.</small>}
    </div>
  );
}

function WorkingPanel({ reducedMotion, steps, tools }: { reducedMotion: boolean; steps: StepState[]; tools: ToolState[] }) {
  const visibleTools = tools.slice(-4);
  return (
    <motion.section className={styles.workingPanel} initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} aria-label="Progresso da resposta">
      <div className={styles.workingTitle}><TypingIndicator reducedMotion={reducedMotion} /><strong>{steps.find((step) => step.status === "active")?.title || "O agente está trabalhando"}</strong></div>
      {!!steps.length && <ol className={styles.checklist}>{steps.map((step) => <li key={step.id} className={`${styles[`step_${step.status}`]}`}><span>{step.status === "complete" ? <Check size={13} /> : step.status === "skipped" ? <CircleDashed size={13} /> : step.status === "active" ? <LoaderCircle size={13} className={reducedMotion ? "" : styles.spinner} /> : step.status === "error" ? <AlertCircle size={13} /> : <span className={styles.stepWaiting} />}</span><span>{step.title}</span><small>{statusText(step.status)}</small></li>)}</ol>}
      {!!visibleTools.length && <div className={styles.toolProgress}>{visibleTools.map((tool) => <div key={tool.id}><span className={tool.status === "complete" ? styles.toolDone : styles.toolActive}>{tool.status === "complete" ? <CheckCheck size={14} /> : tool.status === "error" ? <AlertCircle size={14} /> : <LoaderCircle size={14} className={reducedMotion ? "" : styles.spinner} />}</span><span>{tool.label}</span><small>{tool.status === "active" ? "Consultando" : tool.status === "complete" ? "Pronto" : "Falhou"}</small></div>)}</div>}
    </motion.section>
  );
}

function TypingIndicator({ reducedMotion }: { reducedMotion: boolean }) {
  return <span className={`${styles.typingIndicator} ${reducedMotion ? styles.typingStatic : ""}`} aria-hidden="true"><i /><i /><i /></span>;
}
