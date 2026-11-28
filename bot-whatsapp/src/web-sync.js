import { randomUUID } from 'node:crypto';
import { supabase } from './supabase.js';
import { getAiStatus } from './ai-status.js';
import { logInfo, logWarn, logAction, setRemoteLogHandler } from './terminal.js';
import { isLid, resolverLidParaTelefone } from './phone-utils.js';
import { isSafeWhatsAppJid, isSupportedMediaBuffer, sanitizeUntrustedText } from './security-utils.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authPath = path.resolve(__dirname, '../auth_info_baileys');

let heartbeatInterval = null;
let realtimeChannel = null;
let chatControlChannel = null;
let adminActionPollInterval = null;
let lastKnownStatus = 'disconnected';
let lastKnownPhone = null;
let lastKnownProfile = null;
let lastKnownQr = null;
let cachedAiEnabled = true;

const remoteLogQueue = [];
const MAX_REMOTE_LOG_QUEUE = 500;
let remoteLogFlushTimer = null;
let remoteLogFlushing = false;

async function flushRemoteLogs() {
  if (remoteLogFlushing || remoteLogQueue.length === 0) return;
  remoteLogFlushing = true;
  const batch = remoteLogQueue.splice(0, 20);
  try {
    await supabase.from('whatsapp_logs').insert(batch);
  } catch {}
  remoteLogFlushing = false;
  if (remoteLogQueue.length > 0) {
    remoteLogFlushTimer = setTimeout(() => {
      remoteLogFlushTimer = null;
      flushRemoteLogs().catch(() => {});
    }, 250);
    if (remoteLogFlushTimer.unref) remoteLogFlushTimer.unref();
  }
}

setRemoteLogHandler(({ level, tag, message }) => {
  if (remoteLogQueue.length >= MAX_REMOTE_LOG_QUEUE) {
    remoteLogQueue.splice(0, remoteLogQueue.length - MAX_REMOTE_LOG_QUEUE + 1);
  }
  remoteLogQueue.push({
    level: ['info', 'warn', 'error', 'action', 'success', 'incoming', 'outgoing', 'booking', 'reminder'].includes(level) ? level : 'info',
    tag: sanitizeUntrustedText(String(tag || ''), 80),
    message: sanitizeUntrustedText(String(message || ''), 500),
  });

  if (remoteLogQueue.length >= 10) {
    flushRemoteLogs().catch(() => {});
    return;
  }

  if (!remoteLogFlushTimer) {
    remoteLogFlushTimer = setTimeout(() => {
      remoteLogFlushTimer = null;
      flushRemoteLogs().catch(() => {});
    }, 250);
    if (remoteLogFlushTimer.unref) remoteLogFlushTimer.unref();
  }
});

const pausedChatsCache = new Map();
const MAX_PAUSED_CHAT_ENTRIES = 5000;

function guardarPausa(phone, control) {
  if (!phone || !control) return;
  pausedChatsCache.set(phone, control);
  while (pausedChatsCache.size > MAX_PAUSED_CHAT_ENTRIES) {
    pausedChatsCache.delete(pausedChatsCache.keys().next().value);
  }
}

export async function carregarControleChats() {
  try {
    const { data } = await supabase
      .from('whatsapp_chat_control')
      .select('phone, ai_paused, ai_paused_until')
      .limit(MAX_PAUSED_CHAT_ENTRIES);
    if (data) {
      pausedChatsCache.clear();
      for (const row of data) {
        const cleanPhone = String(row.phone || '').replace(/\D/g, '');
        if (row.ai_paused && cleanPhone.length >= 8 && cleanPhone.length <= 15) {
          guardarPausa(cleanPhone, {
            paused: true,
            until: row.ai_paused_until && Number.isFinite(new Date(row.ai_paused_until).getTime())
              ? new Date(row.ai_paused_until)
              : null,
          });
        }
      }
    }
  } catch {}
}

export function isChatAiPaused(phone) {
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  if (!cleanPhone) return false;
  const control = pausedChatsCache.get(cleanPhone);
  if (!control || !control.paused) return false;

  if (control.until && new Date() >= control.until) {
    pausedChatsCache.delete(cleanPhone);
    supabase
      .from('whatsapp_chat_control')
      .update({ ai_paused: false, ai_paused_until: null })
      .eq('phone', cleanPhone)
      .then(() => {});
    return false;
  }
  return true;
}

export async function pausarIaParaContato(phone, minutes = 120) {
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  if (!cleanPhone) return;
  const until = minutes ? new Date(Date.now() + minutes * 60 * 1000) : null;
  guardarPausa(cleanPhone, { paused: true, until });
  try {
    const { error } = await supabase
      .from('whatsapp_chat_control')
      .upsert(
        {
          phone: cleanPhone,
          ai_paused: true,
          ai_paused_until: until ? until.toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'phone' },
      );
    return !error;
  } catch {
    return false;
  }
}

export async function isAiEnabled() {
  try {
    const { data } = await supabase
      .from('whatsapp_bot_session')
      .select('ai_enabled')
      .eq('id', 'default')
      .single();
    if (data && typeof data.ai_enabled === 'boolean') {
      cachedAiEnabled = data.ai_enabled;
    }
  } catch {}
  return cachedAiEnabled;
}

export async function salvarMidiaChat(phone, buffer, mediaType, mimetype = '') {
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  if (!/^55\d{10,11}$/.test(cleanPhone) || !Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > 16 * 1024 * 1024) return null;
  if (!['image', 'audio', 'video'].includes(mediaType) || !isSupportedMediaBuffer(buffer, mediaType)) return null;
  const safeMime = String(mimetype || '').toLowerCase().split(';', 1)[0].trim();
  const mimeMap = {
    'image/jpeg': ['image/jpeg', 'jpg'], 'image/png': ['image/png', 'png'], 'image/webp': ['image/webp', 'webp'], 'image/gif': ['image/gif', 'gif'],
    'audio/ogg': ['audio/ogg', 'ogg'], 'audio/opus': ['audio/opus', 'opus'], 'audio/mpeg': ['audio/mpeg', 'mp3'], 'audio/mp4': ['audio/mp4', 'm4a'], 'audio/x-m4a': ['audio/mp4', 'm4a'], 'audio/webm': ['audio/webm', 'webm'],
    'video/mp4': ['video/mp4', 'mp4'], 'video/webm': ['video/webm', 'webm'],
  };
  const fallback = mediaType === 'image' ? ['image/jpeg', 'jpg'] : mediaType === 'video' ? ['video/mp4', 'mp4'] : ['audio/ogg', 'ogg'];
  const [contentType, extension] = mimeMap[safeMime] || fallback;
  const path = `${cleanPhone}/${randomUUID()}.${extension}`;
  try {
    const { error } = await supabase.storage.from('whatsapp-chat-media').upload(path, buffer, {
      contentType,
      cacheControl: '0',
      upsert: false,
    });
    if (error) {
      logWarn('Chat', `Não foi possível guardar um anexo recebido: ${error.message}`);
      return null;
    }
    return path;
  } catch (error) {
    logWarn('Chat', `Não foi possível guardar um anexo recebido: ${error?.message || error}`);
    return null;
  }
}

export async function registrarMensagemChat({
  phone,
  direction,
  senderName = null,
  body,
  mediaType = null,
  mediaUrl = null,
  messageKey = null,
  outboxId = null,
  status = null,
}) {
  try {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (!cleanPhone || !['incoming', 'outgoing'].includes(direction)) return;
    const payload = {
      phone: cleanPhone,
      direction,
      sender_name: senderName ? sanitizeUntrustedText(senderName, 80) : null,
      body: sanitizeUntrustedText(String(body || ''), 4000) || (mediaType === 'audio' ? '[Áudio recebido]' : mediaType === 'image' ? '[Imagem recebida]' : mediaType === 'video' ? '[Vídeo recebido]' : ''),
      media_type: mediaType,
      ...(mediaUrl ? { media_url: mediaUrl } : {}),
      ...(messageKey ? { message_key: sanitizeUntrustedText(String(messageKey), 200) } : {}),
      ...(outboxId ? { outbox_id: outboxId } : {}),
      status: status || (direction === 'incoming' ? 'received' : 'sent'),
    };
    if (!payload.body) return;

    let existingQuery = null;
    if (outboxId) existingQuery = supabase.from('whatsapp_messages').select('id').eq('outbox_id', outboxId).maybeSingle();
    else if (messageKey) existingQuery = supabase.from('whatsapp_messages').select('id').eq('message_key', payload.message_key).maybeSingle();
    const { data: existing } = existingQuery ? await existingQuery : { data: null };
    if (existing?.id) {
      await supabase.from('whatsapp_messages').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('whatsapp_messages').insert(payload);
    }
  } catch {}
}

export async function publicarStatusBot({ status, phone_connected, profile_name, qr_code, bot_enabled, qr_requested }) {
  if (status !== undefined) lastKnownStatus = status;
  if (phone_connected !== undefined) lastKnownPhone = phone_connected;
  if (profile_name !== undefined) lastKnownProfile = profile_name;
  if (qr_code !== undefined) lastKnownQr = qr_code;

  try {
    const ai = getAiStatus();
    const payload = {
      id: 'default',
      status: lastKnownStatus,
      phone_connected: lastKnownPhone,
      profile_name: lastKnownProfile,
      qr_code: lastKnownQr,
      ai_model: ai.model || null,
      last_heartbeat: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(typeof bot_enabled === 'boolean' ? { bot_enabled } : {}),
      ...(typeof qr_requested === 'boolean' ? { qr_requested } : {}),
    };
    await supabase.from('whatsapp_bot_session').upsert(payload, { onConflict: 'id' });
  } catch {}
}

export async function getBotControlState() {
  const { data, error } = await supabase
    .from('whatsapp_bot_session')
    .select('bot_enabled, qr_requested, phone_connected, profile_name')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throw error;
  if (data?.phone_connected) lastKnownPhone = data.phone_connected;
  if (data?.profile_name) lastKnownProfile = data.profile_name;
  return {
    botEnabled: data?.bot_enabled !== false,
    qrRequested: data?.qr_requested === true,
    phoneConnected: data?.phone_connected || null,
    profileName: data?.profile_name || null,
  };
}

export function iniciarHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    publicarStatusBot({}).catch(() => {});
  }, 15_000);
  if (heartbeatInterval.unref) heartbeatInterval.unref();
}

export function escutarAcoesAdmin({ getSocket, onStart, onStop, onGenerateQr, onRestart } = {}) {
  if (realtimeChannel) {
    try { supabase.removeChannel(realtimeChannel); } catch {}
  }
  if (chatControlChannel) {
    try { supabase.removeChannel(chatControlChannel); } catch {}
  }
  if (adminActionPollInterval) clearInterval(adminActionPollInterval);

  carregarControleChats().catch(() => {});

  chatControlChannel = supabase
    .channel('whatsapp-chat-control')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'whatsapp_chat_control' },
      (payload) => {
        const row = payload.new;
        if (!row) return;
        const cleanPhone = String(row.phone || '').replace(/\D/g, '');
        if (!cleanPhone) return;
        if (row.ai_paused) {
          guardarPausa(cleanPhone, {
            paused: true,
            until: row.ai_paused_until ? new Date(row.ai_paused_until) : null,
          });
        } else {
          pausedChatsCache.delete(cleanPhone);
        }
      },
    )
    .subscribe();

  const handleAction = async (action) => {
    if (typeof action !== 'string' || !action) return;
    const { data: claimed, error: claimError } = await supabase
      .from('whatsapp_bot_session')
      .update({ action_requested: null })
      .eq('id', 'default')
      .eq('action_requested', action)
      .select('id')
      .limit(1);
    if (claimError || !claimed?.length) return;

    logAction('Painel Admin', `Comando recebido: ${action}`);
    try {
      if (action === 'stop_bot') {
        await onStop?.();
      } else if (action === 'start_bot') {
        await onStart?.();
      } else if (action === 'generate_qr') {
        await onGenerateQr?.();
      } else if (action === 'disconnect') {
        try { await getSocket?.()?.logout?.(); } catch {}
        try { fs.rmSync(authPath, { recursive: true, force: true }); } catch {}
        await publicarStatusBot({ status: 'disconnected', phone_connected: null, profile_name: null, qr_code: null });
        await onRestart?.();
      } else if (action === 'clear_session') {
        try { await getSocket?.()?.end?.(); } catch {}
        try { fs.rmSync(authPath, { recursive: true, force: true }); } catch {}
        await publicarStatusBot({ status: 'disconnected', phone_connected: null, profile_name: null, qr_code: null });
        await onRestart?.();
      } else if (action === 'restart') {
        await onRestart?.();
      } else {
        logWarn('Painel Admin', `Comando do bot ignorado por não ser reconhecido: ${action.slice(0, 40)}`);
      }
    } catch (error) {
      logWarn('Painel Admin', `Falha ao executar ${action}: ${error?.message || error}`);
    }
  };

  realtimeChannel = supabase
    .channel('whatsapp-bot-session-actions')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'whatsapp_bot_session', filter: 'id=eq.default' },
      async (payload) => {
        const row = payload.new;
        if (!row) return;
        if (typeof row.ai_enabled === 'boolean') {
          cachedAiEnabled = row.ai_enabled;
        }
        const action = row.action_requested;
        if (action) await handleAction(action);
      },
    )
    .subscribe();

  adminActionPollInterval = setInterval(() => {
    supabase
      .from('whatsapp_bot_session')
      .select('action_requested')
      .eq('id', 'default')
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data?.action_requested) return handleAction(data.action_requested);
      })
      .catch(() => {});
  }, 5000);
  if (adminActionPollInterval.unref) adminActionPollInterval.unref();

  logInfo('Web Sync', 'Sincronização em tempo real com o painel admin ativa.');
}

export async function resolverDestinoMensagem(rawPhone) {
  const clean = String(rawPhone || '').replace(/\D/g, '');
  if (!clean) return null;
  if (isLid(rawPhone)) {
    const mapped = await resolverLidParaTelefone(rawPhone);
    if (mapped) return `${mapped}@s.whatsapp.net`;
  }
  const jid = `${clean}@s.whatsapp.net`;
  return isSafeWhatsAppJid(jid) ? jid : null;
}
