import NodeCache from '@cacheable/node-cache';
import baileysPkg, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  isJidStatusBroadcast,
  isJidNewsletter,
  normalizeMessageContent,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authPath = path.resolve(__dirname, '../auth_info_baileys');

import { logInfo, logSuccess, logWarn, logError, startSpinner, stopSpinner } from './terminal.js';
import { publicarStatusBot, registrarMensagemChat, salvarMidiaChat } from './web-sync.js';
import { isLid, registrarMapeamentoLid, resolverLidParaTelefone, resolverLidParaTelefoneAsync } from './phone-utils.js';
import { isSafeWhatsAppJid, isSupportedMediaBuffer, readAsyncIterableWithLimit, sanitizeUntrustedText } from './security-utils.js';
import { supabase } from './supabase.js';

const makeWASocket = typeof baileysPkg === 'function' ? baileysPkg : (baileysPkg?.default || baileysPkg);

let activeSocket = null;
let preKeyInterval = null;
let reconnectTimer = null;

// Armazena as mensagens recentes (enviadas e recebidas) para responder a pedidos de retransmissão/retry do WhatsApp
// Isso impede o erro "Aguardando mensagem. Essa ação pode levar alguns instantes. Saiba mais"
const messageStore = new Map();
const MAX_MESSAGE_STORE = 5000;
const MAX_MESSAGE_STORE_ITEM_CHARS = 128 * 1024;
const MAX_CHAT_MEDIA_BYTES = 16 * 1024 * 1024;

async function registrarMensagemRecebidaNoChat(sock, msg, jid) {
  try {
    const content = normalizeMessageContent(msg.message) || msg.message || {};
    const text = String(
      content.conversation ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      content.videoMessage?.caption ||
      content.documentMessage?.caption ||
      content.buttonsResponseMessage?.selectedDisplayText ||
      content.listResponseMessage?.title ||
      '',
    ).trim();
    const image = content.imageMessage || content.stickerMessage ||
      (String(content.documentMessage?.mimetype || '').startsWith('image/') ? content.documentMessage : null);
    const audio = content.audioMessage || content.pttMessage;
    const video = content.videoMessage;
    const mediaType = image ? 'image' : audio ? 'audio' : video ? 'video' : null;
    let phone = jid.split('@', 1)[0].replace(/\D/g, '');
    if (isLid(jid)) phone = String(await resolverLidParaTelefoneAsync(jid, msg.pushName) || phone).replace(/\D/g, '');
    if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
    if (!/^55\d{10,11}$/.test(phone)) return;

    let mediaUrl = null;
    if (mediaType) {
      try {
        const declaredLength = Number(image?.fileLength || audio?.fileLength || video?.fileLength || 0);
        if (declaredLength <= MAX_CHAT_MEDIA_BYTES) {
          const stream = await downloadMediaMessage(msg, 'stream', {}, { reuploadRequest: sock.updateMediaMessage });
          const buffer = await readAsyncIterableWithLimit(stream, MAX_CHAT_MEDIA_BYTES);
          if (isSupportedMediaBuffer(buffer, mediaType)) {
            const mime = String(image?.mimetype || audio?.mimetype || video?.mimetype || '');
            mediaUrl = await salvarMidiaChat(phone, buffer, mediaType, mime);
          }
        }
      } catch (error) {
        console.warn(`[whatsapp] Não foi possível guardar mídia recebida (${mediaType}):`, error?.message || error);
      }
    }

    const body = sanitizeUntrustedText(text, 4000) || (mediaType === 'image' ? '[Imagem recebida]' : mediaType === 'audio' ? '[Áudio recebido]' : mediaType === 'video' ? '[Vídeo recebido]' : '[Mensagem recebida]');
    await registrarMensagemChat({
      phone,
      direction: 'incoming',
      senderName: sanitizeUntrustedText(String(msg.pushName || ''), 80) || null,
      body,
      mediaType,
      mediaUrl,
      messageKey: msg.key?.id || null,
      status: 'received',
    });
  } catch (error) {
    console.warn('[whatsapp] Não foi possível registrar mensagem recebida no chat:', error?.message || error);
  }
}

function saveToMessageStore(id, message, remoteJid = null) {
  if (!id || !message) return;
  if (remoteJid && !isSafeWhatsAppJid(String(remoteJid))) return;
  const idText = String(id);
  if (idText.length > 200) return;
  try {
    if (JSON.stringify(message).length > MAX_MESSAGE_STORE_ITEM_CHARS) return;
  } catch {
    return;
  }
  messageStore.set(idText, message);
  if (messageStore.size > MAX_MESSAGE_STORE) {
    const oldestKey = messageStore.keys().next().value;
    messageStore.delete(oldestKey);
  }
}

// Cache de contadores de retry conforme especificação do Baileys (usa NodeCache para del e flushAll)
const msgRetryCounterCache = new NodeCache({
  stdTTL: 3600, // 1 hora
  useClones: false,
});

// Cache anti-duplicação de mensagens recebidas (evita repetição em retries ou retransmissões do WhatsApp)
const mensagensProcessadas = new Map();
const TTL_DEDUP_MS = 10 * 60 * 1000; // 10 minutos

function ehMensagemDuplicada(msgId) {
  if (!msgId) return false;
  const now = Date.now();
  if (mensagensProcessadas.has(msgId)) {
    return true;
  }
  mensagensProcessadas.set(msgId, now);

  // Limpeza periódica leve
  if (mensagensProcessadas.size > 2000) {
    for (const [id, timestamp] of mensagensProcessadas.entries()) {
      if (now - timestamp > TTL_DEDUP_MS) {
        mensagensProcessadas.delete(id);
      }
    }
  }
  while (mensagensProcessadas.size > 10000) {
    mensagensProcessadas.delete(mensagensProcessadas.keys().next().value);
  }
  return false;
}

export function limparSessaoDesincronizada(idOuJid) {
  if (!idOuJid) return;
  try {
    const raw = String(idOuJid).split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!raw || raw.length < 5) return;
    if (!fs.existsSync(authPath)) return;

    const files = fs.readdirSync(authPath);
    let remCount = 0;
    for (const f of files) {
      if (
        f.startsWith(`session-${raw}`) &&
        f.endsWith('.json')
      ) {
        try {
          fs.unlinkSync(path.join(authPath, f));
          remCount++;
        } catch {}
      }
    }
    if (remCount > 0) {
      logWarn('WhatsApp', `Auto-recuperação: ${remCount} chave(s) de sessão desincronizada(s) limpa(s) para ${raw}. Chaves renovadas!`);
    }
  } catch {}
}

let consecutiveDisconnectCount = 0;

export function limparSessaoGeral(motivo = 'Sessão corrompida') {
  logWarn('WhatsApp', `Auto-recuperação: ${motivo}. Deletando chaves inválidas e renovando sessão do zero...`);
  try {
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }
  } catch {}
  publicarStatusBot({
    status: 'disconnected',
    qr_code: null,
    phone_connected: null,
    profile_name: null,
  });
}

function agendarReconexao(sock, onMessageReceived, onConnectionUpdate, delay, options) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (activeSocket !== sock) return;
    initWhatsApp(onMessageReceived, onConnectionUpdate, options).catch((err) => {
      logError('WhatsApp', `Falha ao iniciar reconexão: ${err?.message || err}`);
      agendarReconexao(sock, onMessageReceived, onConnectionUpdate, 5000, options);
    });
  }, delay);
  if (reconnectTimer.unref) reconnectTimer.unref();
}

/**
 * Inicializa a conexão com o WhatsApp usando Baileys
 * @param {Function} onMessageReceived Callback executado quando uma mensagem válida é recebida: (sock, msg) => Promise<void>
 * @param {Function} [onConnectionUpdate] Callback executado em mudanças de conexão: (sock, update) => void
 * @returns {Promise<{ sock: any }>}
 */
export async function initWhatsApp(onMessageReceived, onConnectionUpdate, { allowQr = false } = {}) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Limpa socket anterior se houver para evitar listeners duplicados
  if (activeSocket) {
    try {
      activeSocket.ev?.removeAllListeners();
      activeSocket.end?.();
      activeSocket.ws?.close?.();
    } catch {
      // silencioso
    }
  }

  // Garante que o diretório de autenticação existe
  if (!fs.existsSync(authPath)) {
    fs.mkdirSync(authPath, { recursive: true });
  }

  let state, saveCreds;
  try {
    const auth = await useMultiFileAuthState(authPath);
    state = auth.state;
    saveCreds = auth.saveCreds;
  } catch (errAuth) {
    // Filesystem or transient read failures do not prove that credentials are
    // invalid. Preserve the auth directory and let the caller retry safely.
    logError('WhatsApp', `Não foi possível ler as credenciais; arquivos preservados: ${errAuth?.message || errAuth}`);
    throw errAuth;
  }

  const savedAccount = state?.creds?.registered ? state.creds.me : null;
  const savedPhone = savedAccount?.id
    ? String(savedAccount.id).split(':')[0].split('@')[0].replace(/\D/g, '') || null
    : null;
  const savedProfile = savedAccount?.name || null;

  // Baileys creates a QR immediately when credentials are not linked. Keep an
  // unpaired worker idle until an authorized panel action explicitly requests it.
  if (!state?.creds?.registered && !allowQr) {
    await publicarStatusBot({
      status: 'qr_pending',
      qr_code: null,
      phone_connected: null,
      profile_name: null,
    });
    logInfo('WhatsApp', 'Conta ainda não vinculada. Gere o QR Code pelo painel quando estiver pronto.');
    return { sock: null, waitingForQr: true };
  }

  let version;
  try {
    const fetched = await fetchLatestBaileysVersion();
    version = fetched?.version;
  } catch {
    // Silencioso - usa fallback padrão do Baileys
  }

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    browser: Browsers.ubuntu('Chrome'),
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid) || String(jid || '').endsWith('@g.us'),
    msgRetryCounterCache,
    markOnlineOnConnect: true,
    keepAliveIntervalMs: 30000,
    connectTimeoutMs: 180000,
    defaultQueryTimeoutMs: 60000,
    retryRequestDelayMs: 2000,
    getMessage: async (key) => {
      if (!key?.id) return undefined;

      // 1. Tenta recuperar do cache recente em memória
      if (messageStore.has(key.id)) {
        return messageStore.get(key.id);
      }

      // Não devolva a última mensagem do banco sem filtrar pelo ID: isso
      // poderia entregar uma conversa de outra cliente a um retry incorreto.
      return undefined;
    },
  });

  // Intercepta sock.sendMessage para registrar mensagens enviadas no messageStore
  const originalSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    const sent = await originalSendMessage(...args);
    if (sent?.key?.id && sent?.message) {
      saveToMessageStore(sent.key.id, sent.message, args[0]);
    }
    return sent;
  };

  activeSocket = sock;

  // Notifica início da conexão (limpando qualquer número pendente)
  publicarStatusBot({
    status: 'connecting',
    phone_connected: savedPhone,
    profile_name: savedProfile,
  });

  // Salva credenciais sempre que atualizadas
  sock.ev.on('creds.update', saveCreds);

  // Monitora atualização de conexão e exibição de QR Code
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      stopSpinner();
      console.log('\n+-----------------------------------------------+');
      console.log('|   >> ESCANEIE O QR CODE NO SEU WHATSAPP:      |');
      console.log('+-----------------------------------------------+\n');
      qrcode.generate(qr, { small: true });
      logInfo('WhatsApp', 'Aguardando leitura do QR Code no aplicativo...');

      // Publica QR Code no Supabase para visualização no painel admin
      publicarStatusBot({
        status: 'qr_ready',
        qr_code: qr,
        phone_connected: null,
        profile_name: null,
      });
    }

    if (connection === 'connecting') {
      startSpinner('WhatsApp', 'Sincronizando chaves e conectando...');
    }

    if (connection === 'open') {
      stopSpinner();
      consecutiveDisconnectCount = 0;
      const me = sock.user || sock.authState?.creds?.me;
      const rawJid = me?.id || '';
      // Baileys IDs: "555199999999:2@s.whatsapp.net" ou "555199999999@s.whatsapp.net"
      const phoneRaw = rawJid ? rawJid.split(':')[0].split('@')[0].replace(/\D/g, '') : null;
      const profileName = me?.name || sock.user?.name || 'Benittes Oficina';

      if (phoneRaw) {
        logSuccess('WhatsApp', `Conectado com sucesso ao número: +${phoneRaw}`);
      } else {
        logSuccess('WhatsApp', 'Conectado com sucesso!');
      }

      // Garante pré-chaves atualizadas no servidor do WhatsApp para evitar "Aguardando mensagem"
      if (typeof sock.uploadPreKeysToServerIfRequired === 'function') {
        await sock.uploadPreKeysToServerIfRequired().catch(() => {});
      }

      if (preKeyInterval) clearInterval(preKeyInterval);
      preKeyInterval = setInterval(() => {
        if (activeSocket && typeof activeSocket.uploadPreKeysToServerIfRequired === 'function') {
          activeSocket.uploadPreKeysToServerIfRequired().catch(() => {});
        }
      }, 2 * 3600 * 1000);
      if (preKeyInterval.unref) preKeyInterval.unref();

      publicarStatusBot({
        status: 'connected',
        qr_code: null,
        phone_connected: phoneRaw,
        profile_name: profileName,
        bot_enabled: true,
        qr_requested: false,
      });
    }

    if (typeof onConnectionUpdate === 'function') {
      try {
        onConnectionUpdate(sock, update);
      } catch (err) {
        logError('WhatsApp', `Erro no listener de conexão: ${err?.message || err}`);
      }
    }

    if (connection === 'close') {
      if (activeSocket !== sock) return;
      if (preKeyInterval) {
        clearInterval(preKeyInterval);
        preKeyInterval = null;
      }
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorMsg = String(lastDisconnect?.error?.message || lastDisconnect?.error || '');

      // 1. Reinicialização de stream padrão do WhatsApp Multi-Device (515 / restart required / Stream Errored)
      // NUNCA DELETAR SESSÃO! Baileys precisa apenas reconectar mantendo os arquivos intactos.
      const isRestartRequired =
        statusCode === DisconnectReason?.restartRequired ||
        statusCode === 515 ||
        errorMsg.includes('Stream Errored') ||
        errorMsg.includes('restart required');

      if (isRestartRequired) {
        logInfo('WhatsApp', 'WhatsApp solicitou reinicialização de stream (restart required). Reconectando mantendo credenciais...');
        agendarReconexao(sock, onMessageReceived, onConnectionUpdate, 1000, { allowQr });
        return;
      }

      consecutiveDisconnectCount++;

      // Only an explicit logged-out response proves that the saved credentials
      // have been revoked. Network failures, conflicts, 403/405 and repeated
      // reconnects can be transient and must not erase a usable session.
      const isLoggedOut = statusCode === DisconnectReason?.loggedOut || statusCode === 401;
      const isReplaced = statusCode === DisconnectReason?.connectionReplaced || statusCode === 440;

      if (isReplaced) {
        logWarn('WhatsApp', 'Sessão substituída por outra instância ativa (440). Verifique se não há outro bot rodando.');
        publicarStatusBot({ status: 'disconnected', qr_code: null });
        return;
      }

      if (isLoggedOut) {
        limparSessaoGeral('Desconectado pelo WhatsApp (401)');
        consecutiveDisconnectCount = 0;
        agendarReconexao(sock, onMessageReceived, onConnectionUpdate, 1500, { allowQr });
      } else {
        publicarStatusBot({
          status: 'connecting',
          qr_code: null,
        });
        logWarn('WhatsApp', `Reconectando automaticamente (código: ${statusCode || 'rede'}, tentativa ${consecutiveDisconnectCount})...`);
        const retryDelay = Math.min(2500 * 2 ** Math.min(consecutiveDisconnectCount - 1, 5), 60000);
        agendarReconexao(sock, onMessageReceived, onConnectionUpdate, retryDelay, { allowQr });
      }
    }
  });


  // Filtra e processa mensagens recebidas
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (!Array.isArray(messages)) return;
    // Armazena todas as mensagens recebidas para responder a retries caso o WhatsApp requisite
    for (const msg of messages) {
      if (msg?.key?.id && msg?.message) {
        saveToMessageStore(msg.key.id, msg.message, msg.key.remoteJid);
      }
    }

    // Processa mensagens em tempo real ('notify') e também mensagens recentes que chegaram
    // durante o handshake/reconexão ('append'), descartando apenas mensagens históricas antigas (>3 min).
    for (const msg of messages) {
      const jid = msg.key?.remoteJid;

      // Se a mensagem chegou sem corpo decriptado (stanzas de protocolo, recibos ou negociação em andamento)
      if (!msg.message) {
        continue;
      }

      // 1. Ignora mensagens enviadas pelo próprio bot
      if (msg.key?.fromMe) continue;

      // Se for append (sincronização de backlog), ignora mensagens antigas
      if (type === 'append') {
        const msgTime = Number(msg.messageTimestamp || 0);
        const nowSec = Math.floor(Date.now() / 1000);
        if (!msgTime || (nowSec - msgTime > 180)) {
          continue;
        }
      }

      // 2. Anti-duplicação: descarta se esse mesmo ID de mensagem já foi processado
      const msgId = msg.key?.id;
      if (msgId && ehMensagemDuplicada(msgId)) {
        continue;
      }

      if (!jid) continue;
      if (!isSafeWhatsAppJid(jid)) continue;

      // 2. Ignora mensagens de grupos (@g.us)
      if (jid.endsWith('@g.us')) continue;

      // 3. Ignora status e broadcasts (@broadcast)
      if (jid.includes('@broadcast')) continue;

      // Se o cliente respondeu, marca mensagens enviadas anteriormente por nós como 'read' (lido)
      const cleanJidPhone = jid.replace(/\D/g, '');
      if (cleanJidPhone && supabase) {
        void supabase
          .from('whatsapp_messages')
          .update({ status: 'read' })
          .eq('phone', cleanJidPhone)
          .eq('from_me', true)
          .neq('status', 'read')
          .then(() => {}, () => {});
      }

      await registrarMensagemRecebidaNoChat(sock, msg, jid);

      // Repassa mensagem filtrada para o callback de negócio
      if (typeof onMessageReceived === 'function') {
        try {
          await onMessageReceived(sock, msg);
        } catch (err) {
          console.error(`[whatsapp] Erro no processamento de mensagem de ${jid}:`, err);
        }
      }
    }
  });

  // Atualiza recibos de entrega e leitura (tiques do WhatsApp)
  sock.ev.on('messages.update', async (updates) => {
    if (!Array.isArray(updates)) return;
    for (const update of updates) {
      const jid = update.key?.remoteJid;
      if (!jid || jid.endsWith('@g.us') || jid.includes('@broadcast')) continue;
      const statusNum = update.update?.status;
      // Baileys WAMessageStatus:
      // 2 = SERVER_ACK (enviado - 1 tique cinza)
      // 3 = DELIVERY_ACK (entregue no aparelho - 2 tiques cinza)
      // 4 = READ, 5 = PLAYED (lido pelo cliente - 2 tiques azuis)
      let mappedStatus = null;
      if (statusNum === 4 || statusNum === 5) mappedStatus = 'read';
      else if (statusNum === 3) mappedStatus = 'delivered';
      else if (statusNum === 2) mappedStatus = 'sent';

      if (mappedStatus && supabase) {
        const cleanP = jid.replace(/\D/g, '');
        try {
          await supabase
            .from('whatsapp_messages')
            .update({ status: mappedStatus })
            .eq('phone', cleanP)
            .eq('from_me', true)
            .neq('status', 'read')
            .order('created_at', { ascending: false })
            .limit(5);
        } catch {}
      }
    }
  });

  return { sock };
}

export async function stopWhatsAppSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (preKeyInterval) {
    clearInterval(preKeyInterval);
    preKeyInterval = null;
  }

  const socket = activeSocket;
  activeSocket = null;
  if (!socket) return;

  // Ending the transport preserves auth_info_baileys; deliberately do not call logout().
  try { socket.ev?.removeAllListeners(); } catch {}
  try { socket.end?.(new Error('Bot pausado pelo painel')); } catch {}
  try { socket.ws?.close?.(); } catch {}
}

export default initWhatsApp;
