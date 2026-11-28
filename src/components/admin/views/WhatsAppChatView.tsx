"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  AudioLines,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  Clock3,
  ImagePlus,
  Info,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Pause,
  Phone,
  Play,
  Search,
  Send,
  Trash2,
  UserRound,
  Video,
  X,
} from "lucide-react";
import type { PanelMember } from "../../../lib/supabase";
import { hasModulePermission } from "../../../admin/permissions";
import { routeFor } from "../../../admin/navigation";
import { getChatUploadClient } from "../../../lib/chatUploadClient";
import { confirmModal } from "../ConfirmDialog";
import { saveVehicleOwnerLookup } from "../utils";

type ChatMessage = {
  id: string;
  phone: string;
  direction: "incoming" | "outgoing";
  senderName: string | null;
  body: string;
  mediaType: "image" | "audio" | "video" | "text" | null;
  mediaUrl: string | null;
  status: string;
  createdAt: string;
  outboxId?: string | null;
  kind?: string | null;
};

type ChatVehicle = { id: string; plate: string; make: string | null; model: string; year: number | null };
type ChatConversation = {
  phone: string;
  unread: number;
  lastMessage: ChatMessage;
  client: { id: string; name: string; vehicles: ChatVehicle[] } | null;
  control: {
    aiPaused: boolean;
    aiPausedUntil: string | null;
    archived: boolean;
    assignedTo: string | null;
    note: string;
    lastReadAt: string | null;
  };
};
type ChatMember = { user_id: string; full_name: string | null; email: string };
type SavedChatSelection = { phone: string; archived: boolean };

const CHAT_SELECTION_STORAGE_KEY = "benittes_whatsapp_chat_last_selection";
type BotStatus = { status: string; profileName: string | null; phoneConnected: string | null; lastHeartbeat: string | null } | null;

const PAUSE_OPTIONS = [
  { value: 15, label: "15 minutos" },
  { value: 30, label: "30 minutos" },
  { value: 60, label: "1 hora" },
  { value: 240, label: "4 horas" },
  { value: 1440, label: "24 horas" },
  { value: 10080, label: "7 dias" },
  { value: 0, label: "Até eu reativar" },
];

function normalizeMessage(value: Record<string, unknown>): ChatMessage | null {
  if (typeof value.id !== "string" || typeof value.phone !== "string") return null;
  const mediaType = value.mediaType ?? value.media_type;
  const storedPath = value.mediaUrl ?? value.media_url;
  let mediaUrl: string | null = null;
  if (typeof storedPath === "string") {
    if (storedPath.startsWith("/api/admin/chat/media?")) mediaUrl = storedPath;
    else if (/^[0-9]{12,13}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|ogg|opus|mp3|m4a|webm|mp4)$/i.test(storedPath)) {
      mediaUrl = `/api/admin/chat/media?path=${encodeURIComponent(storedPath)}&type=${encodeURIComponent(String(mediaType || "image"))}`;
    }
  }
  const direction = value.direction === "outgoing" ? "outgoing" : "incoming";
  return {
    id: value.id,
    phone: value.phone,
    direction,
    senderName: typeof value.senderName === "string" ? value.senderName : typeof value.sender_name === "string" ? value.sender_name : null,
    body: typeof value.body === "string" ? value.body : "",
    mediaType: mediaType === "image" || mediaType === "audio" || mediaType === "video" || mediaType === "text" ? mediaType : null,
    mediaUrl,
    status: typeof value.status === "string" ? value.status : "received",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : typeof value.created_at === "string" ? value.created_at : new Date().toISOString(),
    outboxId: typeof value.outboxId === "string" ? value.outboxId : typeof value.outbox_id === "string" ? value.outbox_id : null,
    kind: typeof value.kind === "string" ? value.kind : null,
  };
}

function collapseDuplicateAutomationMessages(messages: ChatMessage[]) {
  const visible: ChatMessage[] = [];
  const recentByFingerprint = new Map<string, number>();
  for (const message of messages) {
    const isQuoteAutomation = message.direction === "outgoing"
      && message.status !== "failed"
      && (message.kind === "quote" || message.kind === "os_quote");
    if (!isQuoteAutomation || !message.body.trim()) {
      visible.push(message);
      continue;
    }
    const fingerprint = `${message.phone}|${message.kind}|${message.body.trim().replace(/\s+/g, " ")}`;
    const timestamp = new Date(message.createdAt).getTime();
    const previous = recentByFingerprint.get(fingerprint);
    if (previous !== undefined && timestamp >= previous && timestamp - previous <= 120_000) {
      recentByFingerprint.set(fingerprint, timestamp);
      continue;
    }
    recentByFingerprint.set(fingerprint, timestamp);
    visible.push(message);
  }
  return visible;
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) {
    const local = digits.slice(2);
    return `+55 (${local.slice(0, 2)}) ${local.slice(2, local.length - 4)}-${local.slice(-4)}`;
  }
  return phone;
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? "").filter(Boolean);
  return (words.length > 1 ? `${words[0]}${words.at(-1)}` : name.trim().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2) || "CL").toUpperCase();
}

function conversationDisplayName(conversation: ChatConversation) {
  const savedName = conversation.client?.name.trim();
  if (savedName) return savedName;
  const senderName = conversation.lastMessage.direction === "incoming"
    ? conversation.lastMessage.senderName?.trim()
    : "";
  if (senderName && !/^(?:oficina fechada(?:\s*\(autom[aá]tico\))?|mensagem autom[aá]tica|sistema)$/i.test(senderName)) return senderName;
  return "Cliente";
}

function shortTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return isToday
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function fullDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function mediaKind(file: File): { type: "image" | "audio" | "video"; mime: string } | null {
  const mime = (file.type || "").toLowerCase().split(";", 1)[0];
  if (mime.startsWith("image/")) return { type: "image", mime };
  if (mime.startsWith("audio/")) return { type: "audio", mime };
  if (mime.startsWith("video/")) return { type: "video", mime };
  const ext = file.name.split(".").at(-1)?.toLowerCase();
  const byExtension: Record<string, { type: "image" | "audio" | "video"; mime: string }> = {
    jpg: { type: "image", mime: "image/jpeg" }, jpeg: { type: "image", mime: "image/jpeg" }, png: { type: "image", mime: "image/png" }, webp: { type: "image", mime: "image/webp" }, gif: { type: "image", mime: "image/gif" },
    ogg: { type: "audio", mime: "audio/ogg" }, opus: { type: "audio", mime: "audio/opus" }, mp3: { type: "audio", mime: "audio/mpeg" }, m4a: { type: "audio", mime: "audio/mp4" }, mp4: { type: "video", mime: "video/mp4" }, webm: { type: "video", mime: "video/webm" },
  };
  return ext ? byExtension[ext] ?? null : null;
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Não foi possível concluir a ação.");
  return result;
}

function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return <span className={`wa-avatar${small ? " small" : ""}`} aria-hidden="true">{initials(name)}</span>;
}

export function WhatsAppChatView({ member }: { member: PanelMember }) {
  const reducedMotion = useReducedMotion();
  const canWriteChat = member.role === "owner" || hasModulePermission(member.permissions, "chat", "write");
  const selectionStorageKey = `${CHAT_SELECTION_STORAGE_KEY}:${member.user_id}`;
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [team, setTeam] = useState<ChatMember[]>([]);
  const [bot, setBot] = useState<BotStatus>(null);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [archivedView, setArchivedView] = useState(false);
  const [savedSelection, setSavedSelection] = useState<SavedChatSelection | null>(null);
  const [selectionRestoreReady, setSelectionRestoreReady] = useState(false);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [pauseMinutes, setPauseMinutes] = useState(30);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const listBusy = useRef(false);
  const selectionRestoreAttempted = useRef(false);
  const messagesBusy = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef(messages);
  const previousScrollHeight = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingChunks = useRef<BlobPart[]>([]);
  const recorderSendRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selected = useMemo(() => conversations.find((conversation) => conversation.phone === selectedPhone) ?? null, [conversations, selectedPhone]);
  messagesRef.current = messages;

  const loadConversations = useCallback(async (silent = false) => {
    if (listBusy.current) return;
    listBusy.current = true;
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`/api/admin/chat/conversations?archived=${archivedView ? "1" : "0"}`, { credentials: "same-origin", cache: "no-store" });
      const result = await parseApiResponse<{ conversations?: ChatConversation[]; members?: ChatMember[]; bot?: BotStatus }>(response);
      setConversations(result.conversations ?? []);
      setTeam(result.members ?? []);
      setBot(result.bot ?? null);
      setError("");
    } catch (reason) {
      if (!silent) setError(reason instanceof Error ? reason.message : "Não foi possível carregar as conversas.");
    } finally {
      setLoading(false);
      listBusy.current = false;
    }
  }, [archivedView]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(selectionStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<SavedChatSelection>;
        if (typeof parsed.phone === "string" && parsed.phone && typeof parsed.archived === "boolean") {
          setSavedSelection({ phone: parsed.phone, archived: parsed.archived });
          setArchivedView(parsed.archived);
        }
      }
    } catch {
      // The chat remains usable when browser storage is unavailable or invalid.
    } finally {
      setSelectionRestoreReady(true);
    }
  }, [selectionStorageKey]);

  const fetchThread = useCallback(async (phone: string, mode: "initial" | "new" = "initial") => {
    if (messagesBusy.current) return;
    messagesBusy.current = true;
    if (mode === "initial") setLoadingMessages(true);
    try {
      const last = mode === "new" ? messagesRef.current.at(-1)?.createdAt : undefined;
      const params = new URLSearchParams({ phone, limit: mode === "new" ? "80" : "80" });
      if (mode === "new" && last) params.set("after", last);
      const response = await fetch(`/api/admin/chat/messages?${params}`, { credentials: "same-origin", cache: "no-store" });
      const result = await parseApiResponse<{ messages?: Record<string, unknown>[]; hasMore?: boolean }>(response);
      const incoming = (result.messages ?? []).map(normalizeMessage).filter((message): message is ChatMessage => Boolean(message));
      if (mode === "initial") setMessages(incoming);
      else if (incoming.length) {
        setMessages((current) => {
          const byId = new Map(current.map((message) => [message.id, message]));
          for (const message of incoming) byId.set(message.id, message);
          return [...byId.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        });
      }
      if (mode === "initial") setHasOlderMessages(Boolean(result.hasMore));
    } catch (reason) {
      if (mode === "initial") setError(reason instanceof Error ? reason.message : "Não foi possível abrir a conversa.");
    } finally {
      if (mode === "initial") setLoadingMessages(false);
      messagesBusy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!selectionRestoreReady) return;
    void loadConversations();
    const interval = window.setInterval(() => void loadConversations(true), 4500);
    return () => window.clearInterval(interval);
  }, [loadConversations, selectionRestoreReady]);

  useEffect(() => {
    if (!selectionRestoreReady || loading || error || selectionRestoreAttempted.current) return;
    selectionRestoreAttempted.current = true;
    if (!savedSelection) return;
    if (conversations.some((conversation) => conversation.phone === savedSelection.phone)) {
      setSelectedPhone(savedSelection.phone);
      return;
    }
    try {
      window.localStorage.removeItem(selectionStorageKey);
    } catch {
      // Ignore unavailable browser storage.
    }
  }, [conversations, error, loading, savedSelection, selectionRestoreReady, selectionStorageKey]);

  useEffect(() => {
    if (!selectedPhone) return;
    try {
      window.localStorage.setItem(selectionStorageKey, JSON.stringify({ phone: selectedPhone, archived: archivedView }));
    } catch {
      // The chat remains usable when browser storage is unavailable.
    }
  }, [archivedView, selectedPhone, selectionStorageKey]);

  useEffect(() => {
    if (!selectedPhone) {
      setMessages([]);
      return;
    }
    setMessages([]);
    void fetchThread(selectedPhone, "initial");
    fetch("/api/admin/chat/control", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: selectedPhone, action: "read" }),
    }).then(() => {
      setConversations((items) => items.map((item) => item.phone === selectedPhone ? { ...item, unread: 0 } : item));
    }).catch(() => {});
  }, [selectedPhone, fetchThread]);

  useEffect(() => {
    if (!selectedPhone) return;
    const interval = window.setInterval(() => {
      void fetchThread(selectedPhone, "new");
      void loadConversations(true);
    }, 2600);
    return () => window.clearInterval(interval);
  }, [selectedPhone, fetchThread, loadConversations]);

  useEffect(() => {
    if (selected) setNoteDraft(selected.control.note);
  }, [selected?.phone, selected?.control.note]);

  useEffect(() => {
    if (!scrollRef.current || !messages.length) return;
    if (previousScrollHeight.current !== null) {
      scrollRef.current.scrollTop += scrollRef.current.scrollHeight - previousScrollHeight.current;
      previousScrollHeight.current = null;
      return;
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, selectedPhone]);

  useEffect(() => {
    if (!recording) return;
    const interval = window.setInterval(() => setRecordSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(interval);
  }, [recording]);

  useEffect(() => () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return [...conversations]
      .filter((conversation) => {
        if (!query) return true;
        const name = conversationDisplayName(conversation);
        return `${name} ${conversation.phone} ${conversation.lastMessage.body}`.toLocaleLowerCase("pt-BR").includes(query);
      })
      .sort((a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime());
  }, [conversations, search]);

  async function patchControl(action: string, extra: Record<string, unknown> = {}) {
    if (!selected) return;
    const response = await fetch("/api/admin/chat/control", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: selected.phone, action, ...extra }),
    });
    await parseApiResponse(response);
    await loadConversations(true);
  }

  function mergeMessage(value: Record<string, unknown> | undefined) {
    const message = value ? normalizeMessage(value) : null;
    if (!message) return;
    setMessages((current) => {
      const index = current.findIndex((item) => item.id === message.id);
      if (index < 0) return [...current, message].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return current.map((item) => item.id === message.id ? message : item);
    });
    void loadConversations(true);
  }

  async function sendText() {
    if (!selected || !draft.trim() || busy) return;
    const text = draft.trim();
    const clientId = crypto.randomUUID();
    setBusy(true);
    setError("");
    setDraft("");
    try {
      const response = await fetch("/api/admin/chat/messages", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selected.phone, text, pauseMinutes, clientId }),
      });
      const result = await parseApiResponse<{ message?: Record<string, unknown> }>(response);
      mergeMessage(result.message);
    } catch (reason) {
      setDraft(text);
      setError(reason instanceof Error ? reason.message : "A mensagem não pôde ser enviada.");
    } finally {
      setBusy(false);
    }
  }

  async function sendMedia(file: File) {
    if (!selected || busy) return;
    const kind = mediaKind(file);
    if (!kind) {
      setError("Escolha uma imagem, um vídeo MP4/WebM ou um áudio compatível.");
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      setError("O limite por arquivo é 16 MB.");
      return;
    }
    const caption = draft.trim();
    setBusy(true);
    setError("");
    try {
      const signResponse = await fetch("/api/admin/chat/uploads", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selected.phone, type: kind.type, mime: kind.mime, size: file.size }),
      });
      const signed = await parseApiResponse<{ path: string; token: string }>(signResponse);
      const storage = getChatUploadClient().storage.from("whatsapp-chat-media");
      const { error: uploadError } = await storage.uploadToSignedUrl(signed.path, signed.token, file, { contentType: kind.mime, upsert: false });
      if (uploadError) throw new Error("Não foi possível carregar o arquivo. Tente novamente.");

      const response = await fetch("/api/admin/chat/uploads", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selected.phone, path: signed.path, type: kind.type, caption, pauseMinutes }),
      });
      const result = await parseApiResponse<{ message?: Record<string, unknown> }>(response);
      mergeMessage(result.message);
      setDraft("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "O arquivo não pôde ser enviado.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function toggleRecorder() {
    if (!selected || busy) return;
    if (recording) {
      recorderSendRef.current = true;
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Este navegador não permite gravar áudio. Você ainda pode anexar um arquivo de áudio.");
      return;
    }
    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recordingChunks.current = [];
      recorderSendRef.current = false;
      const preferred = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunks.current.push(event.data); };
      recorder.onstop = () => {
        const shouldSend = recorderSendRef.current;
        const blob = new Blob(recordingChunks.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (shouldSend && blob.size > 0) {
          const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
          void sendMedia(new File([blob], `audio-${Date.now()}.${ext}`, { type: blob.type.split(";", 1)[0] }));
        }
        setRecordSeconds(0);
      };
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
    } catch {
      setError("Não foi possível acessar o microfone. Confira a permissão do navegador.");
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) await sendMedia(file);
  }

  async function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await sendText();
    }
  }

  async function loadOlderMessages() {
    if (!selected || !messages.length || busy) return;
    const oldest = messages[0].createdAt;
    previousScrollHeight.current = scrollRef.current?.scrollHeight ?? null;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/chat/messages?phone=${encodeURIComponent(selected.phone)}&limit=60&before=${encodeURIComponent(oldest)}`, { credentials: "same-origin", cache: "no-store" });
      const result = await parseApiResponse<{ messages?: Record<string, unknown>[]; hasMore?: boolean }>(response);
      const older = (result.messages ?? []).map(normalizeMessage).filter((message): message is ChatMessage => Boolean(message));
      setMessages((current) => {
        const map = new Map(older.map((message) => [message.id, message]));
        for (const message of current) map.set(message.id, message);
        return [...map.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      });
      setHasOlderMessages(Boolean(result.hasMore));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar o histórico.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!selected) return;
    const action = selected.control.archived ? "unarchive" : "archive";
    try {
      await patchControl(action);
      setSelectedPhone(null);
      setMenuOpen(false);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível arquivar a conversa.");
    }
  }

  async function deleteConversation() {
    if (!selected) return;
    const accepted = await confirmModal({
      title: "Excluir histórico da conversa",
      message: `Isso apaga do painel as mensagens e os anexos de ${conversationDisplayName(selected)}. Não apaga as mensagens no WhatsApp do cliente. Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir histórico",
      danger: true,
    });
    if (!accepted) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/chat/control", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selected.phone, confirm: true }),
      });
      await parseApiResponse(response);
      setSelectedPhone(null);
      setMessages([]);
      setMenuOpen(false);
      await loadConversations(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível excluir o histórico.");
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!selected || noteSaving) return;
    setNoteSaving(true);
    try {
      await patchControl("note", { note: noteDraft });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar a observação.");
    } finally {
      setNoteSaving(false);
    }
  }

  async function setPause(minutes: number) {
    try {
      await patchControl("pause", { minutes });
      setPauseMenuOpen(false);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível pausar o bot.");
    }
  }

  const botConnected = bot?.status === "connected";
  const connectionLabel = botConnected ? "WhatsApp conectado" : bot?.status === "connecting" || bot?.status === "qr_ready" ? "WhatsApp conectando" : "WhatsApp desconectado";
  const visibleMessages = useMemo(() => collapseDuplicateAutomationMessages(messages), [messages]);

  return (
    <div className={`whatsapp-chat${selected ? " has-selection" : ""}${detailsOpen ? " details-open" : ""}`}>
      <aside className={`wa-inbox${selected ? " mobile-hidden" : ""}`} aria-label="Lista de conversas">
        <div className="wa-inbox-head">
          <div className="wa-inbox-title-row">
            <div>
              <h1>Chat</h1>
              <p>Atendimento pelo WhatsApp</p>
            </div>
          </div>
          <div className="wa-search-row">
            <label className="wa-search">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conversa" aria-label="Buscar conversa" />
              {search && <button type="button" onClick={() => setSearch("")} aria-label="Limpar busca"><X size={14} /></button>}
            </label>
            <button type="button" className={`wa-archive-toggle${archivedView ? " active" : ""}`} onClick={() => { setArchivedView((value) => !value); setSelectedPhone(null); }} title={archivedView ? "Ver conversas ativas" : "Ver conversas arquivadas"}>
              <Archive size={16} />
            </button>
          </div>
          <div className="wa-inbox-status">
            <span className={`wa-status-chip ${botConnected ? "connected" : "disconnected"}`}>{connectionLabel}</span>
            <span>{filtered.length} {filtered.length === 1 ? "conversa" : "conversas"}</span>
          </div>
        </div>

        <div className="wa-conversation-list">
          {loading ? Array.from({ length: 7 }, (_, index) => <div className="wa-conversation-skeleton" key={index}><i /><span><b /><em /></span><small /></div>) : filtered.length ? filtered.map((conversation, index) => {
            const name = conversationDisplayName(conversation);
            const selectedItem = selectedPhone === conversation.phone;
            const preview = conversation.lastMessage.mediaType === "image" ? "Imagem" : conversation.lastMessage.mediaType === "audio" ? "Áudio" : conversation.lastMessage.mediaType === "video" ? "Vídeo" : conversation.lastMessage.body;
            return (
              <motion.button
                type="button"
                key={conversation.phone}
                className={`wa-conversation${selectedItem ? " active" : ""}${conversation.unread ? " unread" : ""}`}
                onClick={() => { setSelectedPhone(conversation.phone); setDetailsOpen(false); setMenuOpen(false); }}
                initial={reducedMotion ? false : { opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.17, delay: reducedMotion ? 0 : Math.min(index * 0.018, 0.2) }}
              >
                <Avatar name={name} />
                <span className="wa-conversation-copy">
                  <span className="wa-conversation-name">{name}<small>{shortTime(conversation.lastMessage.createdAt)}</small></span>
                  <span className="wa-conversation-preview">{preview || "Mensagem recebida"}</span>
                  <span className="wa-conversation-meta">{conversation.control.aiPaused && <em><Pause size={10} /> Bot pausado</em>}{conversation.control.assignedTo && <em><UserRound size={10} /> Atribuída</em>}</span>
                </span>
                {conversation.unread > 0 && <span className="wa-unread-count">{conversation.unread > 99 ? "99+" : conversation.unread}</span>}
              </motion.button>
            );
          }) : (
            <div className="wa-inbox-empty">
              <MessageCircle size={22} />
              <strong>{search ? "Nenhuma conversa encontrada" : archivedView ? "Sem conversas arquivadas" : "Ainda não há conversas"}</strong>
              <span>{search ? "Tente buscar pelo nome ou telefone." : "Quando alguém enviar uma mensagem pelo WhatsApp, ela aparecerá aqui."}</span>
            </div>
          )}
        </div>
      </aside>

      <section className={`wa-thread${!selected ? " no-selection" : ""}${detailsOpen ? " mobile-thread-hidden" : ""}`} aria-label="Conversa">
        {selected ? (
          <>
            <header className="wa-thread-head">
              <button type="button" className="wa-mobile-back" onClick={() => setSelectedPhone(null)} aria-label="Voltar às conversas"><ArrowLeft size={18} /></button>
              <Avatar small name={conversationDisplayName(selected)} />
              <div className="wa-thread-contact">
                <strong>{conversationDisplayName(selected)}</strong>
                <span>{formatPhone(selected.phone)}{selected.control.aiPaused ? " · Bot pausado" : " · Atualizando a cada poucos segundos"}</span>
              </div>
              <div className="wa-thread-actions">
                <div className="wa-action-anchor">
                  <button type="button" className={`wa-icon-action${selected.control.aiPaused ? " selected" : ""}`} onClick={() => selected.control.aiPaused ? void patchControl("resume").catch((reason) => setError(reason.message)) : setPauseMenuOpen((value) => !value)} title={selected.control.aiPaused ? "Reativar bot" : "Pausar bot"} aria-label={selected.control.aiPaused ? "Reativar bot" : "Pausar bot"} disabled={!canWriteChat}>
                    {selected.control.aiPaused ? <Play size={17} /> : <Bot size={17} />}
                  </button>
                  {pauseMenuOpen && !selected.control.aiPaused && (
                    <div className="wa-action-menu wa-pause-menu">
                      <strong>Pausar respostas automáticas</strong>
                      {PAUSE_OPTIONS.map((option) => <button type="button" key={option.value} onClick={() => void setPause(option.value)}><Clock3 size={14} />{option.label}</button>)}
                    </div>
                  )}
                </div>
                <button type="button" className={`wa-icon-action wa-details-toggle${detailsOpen ? " selected" : ""}`} onClick={() => setDetailsOpen((value) => !value)} aria-label="Ver contato" title="Informações do contato"><Info size={17} /></button>
                <div className="wa-action-anchor">
                  <button type="button" className="wa-icon-action" onClick={() => setMenuOpen((value) => !value)} aria-label="Mais ações" disabled={!canWriteChat}><MoreHorizontal size={19} /></button>
                  {menuOpen && <div className="wa-action-menu">
                    <button type="button" onClick={() => void toggleArchive()} disabled={!canWriteChat}><Archive size={14} />{selected.control.archived ? "Restaurar conversa" : "Arquivar conversa"}</button>
                    <button type="button" className="danger" onClick={() => void deleteConversation()} disabled={!canWriteChat}><Trash2 size={14} />Excluir histórico</button>
                  </div>}
                </div>
              </div>
            </header>

            <div className="wa-message-scroll" ref={scrollRef}>
              {loadingMessages ? (
                <div className="wa-message-skeleton"><i /><i /><i /><i /></div>
              ) : visibleMessages.length ? (
                <>
                  {hasOlderMessages && <button type="button" className="wa-load-older" onClick={() => void loadOlderMessages()} disabled={busy}><ArrowDown size={13} /> Carregar mensagens anteriores</button>}
                  {visibleMessages.map((message, index) => {
                    const previous = visibleMessages[index - 1];
                    const dateLabel = new Date(message.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
                    const previousDateLabel = previous ? new Date(previous.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : null;
                    const showDate = !previous || dateLabel !== previousDateLabel;
                    const attachmentBody = /^\[(imagem|áudio|video|vídeo).*(enviada|enviado|recebida|recebido)\]$/i.test(message.body.trim()) || /^🎤 Áudio enviado$/i.test(message.body.trim());
                    return (
                      <div key={message.id} className="wa-message-row-wrap">
                        {showDate && <span className="wa-date-separator">{dateLabel}</span>}
                        <motion.div
                          className={`wa-message-row ${message.direction === "outgoing" ? "outgoing" : "incoming"}`}
                          initial={reducedMotion ? false : { opacity: 0, y: 7, scale: 0.99 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ duration: reducedMotion ? 0 : 0.18 }}
                        >
                          <article className="wa-message-bubble">
                            {message.mediaType === "image" && message.mediaUrl && <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="wa-message-image-link"><img src={message.mediaUrl} alt="Imagem enviada na conversa" loading="lazy" /></a>}
                            {message.mediaType === "audio" && message.mediaUrl && <audio className="wa-message-audio" controls preload="metadata" src={message.mediaUrl} />}
                            {message.mediaType === "video" && message.mediaUrl && <video className="wa-message-video" controls preload="metadata" src={message.mediaUrl} />}
                            {message.mediaType && !message.mediaUrl && <span className="wa-attachment-unavailable">{message.mediaType === "image" ? <ImagePlus size={15} /> : message.mediaType === "video" ? <Video size={15} /> : <AudioLines size={15} />} Arquivo sem prévia salva</span>}
                            {message.body && !attachmentBody && <p>{message.body}</p>}
                            <footer><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>{message.direction === "outgoing" && <span className={message.status === "failed" ? "failed" : ""} title={message.status === "queued" ? "Na fila" : message.status === "failed" ? "Falha no envio" : message.status === "read" ? "Lida" : message.status === "delivered" ? "Entregue" : "Enviada"}>{message.status === "queued" ? <Clock3 size={12} /> : message.status === "failed" ? <CircleAlert size={13} /> : message.status === "read" ? <CheckCheck size={14} /> : <Check size={13} />}</span>}</footer>
                          </article>
                        </motion.div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="wa-thread-empty"><MessageCircle size={25} /><strong>Comece o atendimento</strong><span>Envie uma mensagem para iniciar a conversa. O bot ficará pausado pelo tempo escolhido.</span></div>
              )}
            </div>

            {error && <div className="wa-error" role="alert"><CircleAlert size={15} /><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Fechar aviso"><X size={14} /></button></div>}

            <div className="wa-composer-area">
              <div className="wa-composer-options">
                <span className="wa-pause-description">{canWriteChat ? <><Pause size={14} /> Pausar bot ao responder</> : "Acesso somente para visualizar"}</span>
                <label className="wa-pause-select-label">
                  <span className="wa-pause-visible-label">Pausar por</span>
                  <select aria-label="Duração da pausa do bot após enviar" value={pauseMinutes} onChange={(event) => setPauseMinutes(Number(event.target.value))} disabled={!canWriteChat}>
                    {PAUSE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <ChevronDown size={12} />
                </label>
              </div>
              {busy && <div className="wa-upload-track"><motion.i initial={{ x: "-70%" }} animate={{ x: "160%" }} transition={{ repeat: Infinity, duration: 1.15, ease: "easeInOut" }} /></div>}
              {recording && <div className="wa-recording-bar"><span className="wa-record-dot" /> Gravando áudio <b>{String(Math.floor(recordSeconds / 60)).padStart(2, "0")}:{String(recordSeconds % 60).padStart(2, "0")}</b><span>Toque no microfone para enviar</span></div>}
              <div className="wa-composer">
                <input ref={fileInputRef} type="file" accept="image/*,video/mp4,video/webm,audio/*" hidden onChange={(event) => void handleFileChange(event)} />
                <button type="button" className="wa-composer-icon" onClick={() => fileInputRef.current?.click()} disabled={!selected || busy || recording || !canWriteChat} aria-label="Anexar arquivo" title="Enviar foto, vídeo ou áudio"><ImagePlus size={18} /></button>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => void handleComposerKey(event)} placeholder={canWriteChat ? "Digite uma mensagem" : "Acesso somente para visualizar"} rows={1} aria-label="Mensagem para enviar" disabled={!selected || recording || !canWriteChat} />
                {draft.trim() ? (
                  <button type="button" className="wa-send-button" onClick={() => void sendText()} disabled={!selected || busy || !canWriteChat} aria-label="Enviar mensagem" title="Enviar mensagem">{busy ? <LoaderCircle className="wa-spin" size={17} /> : <Send size={17} />}</button>
                ) : (
                  <button type="button" className={`wa-mic-button${recording ? " recording" : ""}`} onClick={() => void toggleRecorder()} disabled={!selected || busy || !canWriteChat} aria-label={recording ? "Parar e enviar áudio" : "Gravar áudio"} title={recording ? "Parar e enviar" : "Gravar áudio"}>{recording ? <X size={17} /> : <AudioLines size={18} />}</button>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="wa-no-thread"><div><MessageCircle size={29} /><strong>{archivedView ? "Selecione uma conversa arquivada" : "Suas conversas do WhatsApp"}</strong><span>Escolha uma conversa na lista para ver as mensagens e responder por aqui.</span></div></div>
        )}
      </section>

      {selected && (
        <aside className="wa-contact-panel" aria-label="Detalhes do contato">
          <div className="wa-contact-head">
            <span>Contato</span>
            <button type="button" className="wa-icon-action wa-contact-close" onClick={() => setDetailsOpen(false)} aria-label="Fechar informações"><X size={17} /></button>
          </div>
          <div className="wa-contact-profile">
            <Avatar name={conversationDisplayName(selected)} />
            <strong>{conversationDisplayName(selected)}</strong>
            <span><Phone size={12} /> {formatPhone(selected.phone)}</span>
          </div>
          <div className="wa-contact-info">
            <label>Atendimento</label>
            <span className={`wa-control-state${selected.control.aiPaused ? " paused" : ""}`}><i />{selected.control.aiPaused ? "Bot pausado" : "Bot ativo"}</span>
            {selected.control.aiPaused && selected.control.aiPausedUntil && <small>Retoma {new Date(selected.control.aiPausedUntil).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small>}
          </div>
          <div className="wa-contact-info">
            <label>Responsável</label>
            <select value={selected.control.assignedTo || ""} onChange={(event) => void patchControl("assign", { memberId: event.target.value || null }).catch((reason) => setError(reason.message))} aria-label="Responsável pela conversa" disabled={!canWriteChat}>
              <option value="">Sem responsável</option>
              {team.map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name || person.email}</option>)}
            </select>
          </div>
          <div className="wa-contact-info">
            <label>Veículos cadastrados</label>
            {selected.client?.vehicles.length ? selected.client.vehicles.map((vehicle) => <div key={vehicle.id} className="wa-contact-vehicle"><b>{vehicle.plate}</b><span>{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" · ")}</span></div>) : <small>{selected.client ? "Nenhum veículo associado." : "Este telefone ainda não está associado a um cadastro."}</small>}
          </div>
          {selected.client && <a className="wa-client-link" href={`${routeFor("clientes")}?ver-proprietario=1`} onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (selected.client?.name) saveVehicleOwnerLookup(selected.client.name);
          }}>Abrir cadastro do cliente <ArrowDown size={13} /></a>}
          <div className="wa-contact-info wa-note-box">
            <label htmlFor="wa-internal-note">Observação interna</label>
            <textarea id="wa-internal-note" maxLength={2000} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Anotações visíveis apenas para a equipe" disabled={!canWriteChat} />
            <button type="button" className="wa-save-note" onClick={() => void saveNote()} disabled={!canWriteChat || noteSaving || noteDraft === selected.control.note}>{noteSaving ? <LoaderCircle className="wa-spin" size={14} /> : <Check size={14} />} Salvar observação</button>
          </div>
        </aside>
      )}
      {detailsOpen && <button type="button" className="wa-details-scrim" onClick={() => setDetailsOpen(false)} aria-label="Fechar detalhes do contato" />}
    </div>
  );
}
