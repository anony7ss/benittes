const _origInfo = console.info;
const _origWarn = console.warn;
const _origError = console.error;

console.info = function (...args) {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('Closing session') ||
      args[0].includes('Opening session') ||
      args[0].includes('Removing old closed session') ||
      args[0].includes('Migrating session to'))
  ) {
    return;
  }
  _origInfo.apply(console, args);
};

console.warn = function (...args) {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('Session already closed') ||
      args[0].includes('Session already open') ||
      args[0].includes('Closing open session in favor') ||
      args[0].includes('Decrypted message with closed session'))
  ) {
    return;
  }
  _origWarn.apply(console, args);
};

import { initWhatsApp, limparSessaoDesincronizada } from './src/whatsapp.js';

console.error = function (...args) {
  const msg = typeof args[0] === 'string' ? args[0] : '';
  if (
    msg.includes('Failed to decrypt message with any known session') ||
    msg.includes('Session error:Error: Bad MAC') ||
    msg.includes('Session error:MessageCounterError') ||
    msg.includes('Session error:')
  ) {
    const match = msg.match(/(\d{8,16})/);
    if (match && match[1]) {
      limparSessaoDesincronizada(match[1]);
    }
    return;
  }
  _origError.apply(console, args);
};

import { assertRuntimeConfig } from './src/config.js';
import { iniciarProcessadorOutbox } from './src/outbox.js';
import { iniciarProcessadorLembretes } from './src/reminders.js';
import { testarConexaoIA, processarMensagemComIA } from './src/ai.js';
import { verificarOficinaFechadaAgora } from './src/tools.js';
import { sendHumanizedMessage } from './src/queue.js';
import {
  iniciarHeartbeat,
  escutarAcoesAdmin,
  publicarStatusBot,
  isAiEnabled,
  isChatAiPaused,
  registrarMensagemChat,
} from './src/web-sync.js';
import {
  clearScreen,
  renderBanner,
  updateStatus,
  logSuccess,
  logInfo,
  logWarn,
  logError,
  stopSpinner,
} from './src/terminal.js';
import {
  isLid,
  resolverLidParaTelefone,
  registrarMapeamentoLid,
  normalizarTelefoneBR,
} from './src/phone-utils.js';
import { isSafeWhatsAppJid } from './src/security-utils.js';

clearScreen();

try {
  assertRuntimeConfig();
} catch (error) {
  console.error(`[Sistema] ${error?.message || error}`);
  process.exit(1);
}

process.on('uncaughtException', (error) => {
  logError('Sistema', `Exceção não tratada: ${error?.message || error}`);
});

process.on('unhandledRejection', (reason) => {
  logWarn('Sistema', `Promessa rejeitada: ${reason?.message || reason}`);
});

let isShuttingDown = false;
const closedReplyCooldown = new Map();
const CLOSED_REPLY_COOLDOWN_MS = 2 * 60 * 60 * 1000;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  stopSpinner();
  console.log(`\n🛑 [Sistema] Encerrando com segurança (${signal})...`);
  try {
    await publicarStatusBot({
      status: 'disconnected',
      phone_connected: null,
      profile_name: null,
      qr_code: null,
    });
  } catch {}
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

async function startBot() {
  renderBanner();
  updateStatus('whatsapp', 'Conectando...');
  updateStatus('supabase', 'Conectado');
  iniciarProcessadorLembretes();
  await testarConexaoIA();
  renderBanner();
  iniciarHeartbeat();

  const startSocket = async () => {
    await initWhatsApp(
      async (socket, message) => {
        const jid = message?.key?.remoteJid;
        if (!jid || message.key.fromMe || !isSafeWhatsAppJid(jid)) return;
        if (jid.endsWith('@g.us') || jid === 'status@broadcast') return;

        let telefone = '';
        if (isLid(jid)) {
          const pn = message?.key?.senderPn || message?.key?.remoteJidAlt;
          if (pn) {
            telefone = normalizarTelefoneBR(String(pn).split('@')[0]);
            if (telefone) await registrarMapeamentoLid(jid, telefone);
          } else {
            telefone = (await resolverLidParaTelefone(jid)) || '';
          }
        } else {
          telefone = normalizarTelefoneBR(String(jid).split('@')[0]);
        }

        const aiOn = await isAiEnabled();
        if (!aiOn) return;
        if (telefone && isChatAiPaused(telefone)) {
          logInfo('IA Pausada', `Ignorando resposta automática para ${telefone}`);
          return;
        }

        const closedState = await verificarOficinaFechadaAgora();
        if (closedState.fechada) {
          const chatKey = telefone || jid;
          const lastSent = closedReplyCooldown.get(chatKey) || 0;
          if (Date.now() - lastSent >= CLOSED_REPLY_COOLDOWN_MS) {
            closedReplyCooldown.set(chatKey, Date.now());
            await sendHumanizedMessage(socket, jid, closedState.mensagem);
            await registrarMensagemChat({
              phone: chatKey,
              direction: 'outgoing',
              senderName: 'Oficina Fechada (Automático)',
              body: closedState.mensagem,
            });
            logInfo('Horário', `Oficina fechada: mensagem automática enviada para ${chatKey}`);
          }
          return;
        }

        await processarMensagemComIA({
          socket,
          message,
          jid,
          telefone,
          nomeCliente: message.pushName || '',
        });
      },
      async (socket, update) => {
        if (update?.connection === 'open') {
          const me = socket.user;
          const phone = me?.id ? String(me.id).split(':')[0].split('@')[0] : null;
          updateStatus('whatsapp', `Conectado (${phone || 'OK'})`);
          renderBanner();
          logSuccess('WhatsApp', `Conectado (${phone || 'OK'})`);
          escutarAcoesAdmin(socket, () => startSocket());
          iniciarProcessadorOutbox(socket);
        } else if (update?.connection === 'close') {
          updateStatus('whatsapp', 'Desconectado');
        }
      },
    );
  };

  await startSocket();
}

startBot().catch((err) => {
  logError('Sistema', err?.message || String(err));
});
