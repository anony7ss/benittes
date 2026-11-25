import OpenAI from 'openai';
import config from './config.js';
import { ferramentasSchema, executarFerramenta } from './tools.js';
import { getHistory, addMessage } from './memory.js';
import { sendHumanizedMessage, sendHumanizedVoice, reactToMessage } from './queue.js';
import { verificarSegurancaEntrada, verificarSegurancaSaida } from './guardrails.js';
import {
  logIncoming,
  logOutgoing,
  logAction,
  logWarn,
  logError,
  startSpinner,
  updateSpinner,
  stopSpinner,
  updateStatus,
} from './terminal.js';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { transcreverAudio } from './transcribe.js';
import { clientePediuAudio, gerarAudioVoz } from './tts.js';
import { sanitizarMensagemWhatsApp } from './format-cleaner.js';
import { isSafeWhatsAppJid, readAsyncIterableWithLimit, sanitizeUntrustedText } from './security-utils.js';
import { setAiStatus } from './ai-status.js';
import { createCircuitBreaker } from './circuit-breaker.js';
import { supabase } from './supabase.js';
import { registrarMensagemChat } from './web-sync.js';

const MAX_VISION_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOOL_ARGUMENT_CHARS = 12_000;
const MAX_TOOL_CALLS_PER_TURN = 4;
const INBOUND_RATE_WINDOW_MS = 60 * 1000;
const MAX_INBOUND_MESSAGES_PER_WINDOW = 20;
const inboundRate = new Map();
const messageQueues = new Map();

const aiCircuit = createCircuitBreaker({
  name: 'ai-provider',
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  shouldCountFailure: (error) => {
    const status = Number(error?.status || error?.response?.status);
    const code = String(error?.code || '').toUpperCase();
    return (
      status === 408 ||
      status === 425 ||
      status === 429 ||
      status >= 500 ||
      ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
    );
  },
  onStateChange: ({ state, failures }) => {
    if (state === 'open') {
      logWarn('Circuit IA', `Provedor pausado após ${failures} falhas; nova tentativa automática em 30s.`);
      setAiStatus({ connected: false, model: null });
      updateStatus('ai', 'Circuit breaker aberto');
    }
    if (state === 'closed') {
      logAction('Circuit IA', 'Provedor voltou a responder.');
      setAiStatus({ connected: true, model: config.opencodeModel || null });
      updateStatus('ai', 'Conectada');
    }
  },
});

function serializarMensagemPorChat(chatKey, work) {
  const key = String(chatKey || 'default');
  const previous = messageQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  messageQueues.set(key, current);
  return current.finally(() => {
    if (messageQueues.get(key) === current) messageQueues.delete(key);
  });
}

function getOpenAIClient() {
  if (!config.opencodeApiKey) return null;
  return new OpenAI({
    apiKey: config.opencodeApiKey,
    baseURL: config.opencodeBaseUrl,
    timeout: 25_000,
    maxRetries: 1,
    defaultHeaders: {
      'User-Agent': 'benittes-whatsapp-bot/1.0',
      'x-opencode-session': 'benittes-oficina-bot-session',
    },
  });
}

export async function testarConexaoIA() {
  const client = getOpenAIClient();
  if (!client) {
    setAiStatus({ connected: false, model: null });
    updateStatus('ai', 'Sem chave OPENCODE_API_KEY');
    return false;
  }
  try {
    await client.chat.completions.create({
      model: config.opencodeModel,
      messages: [{ role: 'user', content: 'ok' }],
      max_tokens: 4,
    });
    setAiStatus({ connected: true, model: config.opencodeModel });
    updateStatus('ai', `Conectada (${config.opencodeModel})`);
    return true;
  } catch (err) {
    setAiStatus({ connected: false, model: null });
    updateStatus('ai', `Erro: ${err?.message || 'falha'}`);
    return false;
  }
}

function isRateLimited(chatKey) {
  const now = Date.now();
  const list = (inboundRate.get(chatKey) || []).filter((t) => now - t < INBOUND_RATE_WINDOW_MS);
  list.push(now);
  inboundRate.set(chatKey, list);
  return list.length > MAX_INBOUND_MESSAGES_PER_WINDOW;
}

function buildSystemPrompt({ nomeCliente, telefone }) {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return [
    `Você é a assistente virtual da *${config.workshopName}* no WhatsApp.`,
    `Hoje é ${hoje}. Cliente: ${nomeCliente || 'Cliente'} (WhatsApp: ${telefone || 'não identificado'}).`,
    '',
    'REGRAS INEGOCIAVEIS (SIGA SEMPRE):',
    '1. NUNCA invente ou chute preços, serviços, horários, endereços, status de OS ou orçamentos. SEMPRE chame as ferramentas disponíveis antes de responder.',
    '2. Se o cliente perguntar preço/serviço -> chame `listarServicos`.',
    '3. Se perguntar endereço, telefone, horário de funcionamento ou folgas -> chame `consultarEstabelecimento`.',
    '4. Se perguntar como está o carro/serviço/OS/orçamento -> chame `consultarStatusOS`.',
    '5. Se o cliente ACEITAR, APROVAR, CONFIRMAR ou RECUSAR/CANCELAR um orçamento ou OS (mesmo com gírias ou erros de português, ex: "blz pode faze", "aceito sim", "manda ver", "aprovo", "nao quero", "ficou caro") -> chame IMEDIATAMENTE `responderOrcamento` com `decisao: "aprovado"` ou `"recusado"`.',
    '6. Se o cliente quiser agendar uma visita/revisão -> chame `consultarHorarios` para confirmar se a oficina abre na data, e agende com `agendarVisita` para QUALQUER horário dentro do funcionamento (NÃO pergunte horário fixo nem liste horários; se o cliente não disser hora, use o horário padrão de entrada).',
    '7. Se o cliente pedir para falar com humano, mecânico ou atendente -> chame `chamarAtendente`.',
    '8. Entenda linguagem informal, abreviações e erros de digitação normalmente ("qto ta", "vc", "blz", "meu caro", "troca oleo").',
    '9. Seja educada, direta, humana e use frases curtas adequadas ao WhatsApp. Nunca use Markdown complexo (tabelas ou ###).',
  ].join('\n');
}

async function extrairConteudoMensagem(message, socket) {
  const msg = message?.message || {};
  const text =
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    '';

  if (msg.audioMessage) {
    try {
      const stream = await downloadMediaMessage(message, 'stream', {}, { reuploadRequest: socket.updateMediaMessage });
      const buffer = await readAsyncIterableWithLimit(stream, MAX_VISION_IMAGE_BYTES);
      const mime = msg.audioMessage.mimetype || 'audio/ogg';
      const transcricao = await transcreverAudio(buffer, mime);
      if (transcricao) {
        return { text: transcricao, isAudio: true, imageDataUrl: null };
      }
      return { text: '[Áudio recebido, mas não foi possível transcrever]', isAudio: true, imageDataUrl: null };
    } catch {
      return { text: '[Áudio recebido, mas houve erro ao baixar]', isAudio: true, imageDataUrl: null };
    }
  }

  if (msg.imageMessage) {
    try {
      const stream = await downloadMediaMessage(message, 'stream', {}, { reuploadRequest: socket.updateMediaMessage });
      const buffer = await readAsyncIterableWithLimit(stream, MAX_VISION_IMAGE_BYTES);
      const mime = msg.imageMessage.mimetype || 'image/jpeg';
      const base64 = buffer.toString('base64');
      return {
        text: text || 'O cliente enviou uma imagem (peça, painel, documento ou veículo). Descreva o que vê e ajude dentro do escopo da oficina.',
        isAudio: false,
        imageDataUrl: `data:${mime};base64,${base64}`,
      };
    } catch {
      return { text: text || '[Imagem recebida]', isAudio: false, imageDataUrl: null };
    }
  }

  return { text: text.trim(), isAudio: false, imageDataUrl: null };
}

export async function processarMensagemComIA({ socket, message, jid, telefone, nomeCliente }) {
  if (!isSafeWhatsAppJid(jid)) return;

  return serializarMensagemPorChat(telefone || jid, async () => {
    const { text, isAudio, imageDataUrl } = await extrairConteudoMensagem(message, socket);
    if (!text && !imageDataUrl) return;

    const cleanText = sanitizeUntrustedText(text, 6000);
    logIncoming(nomeCliente || telefone || jid, isAudio ? `[Áudio] ${cleanText}` : cleanText);
    await registrarMensagemChat({
      phone: telefone || jid,
      direction: 'incoming',
      senderName: nomeCliente || null,
      body: cleanText,
      mediaType: isAudio ? 'audio' : imageDataUrl ? 'image' : null,
    });

    if (isRateLimited(telefone || jid)) {
      logWarn('Rate Limit', `Excesso de mensagens de ${telefone || jid}`);
      return;
    }

    const secIn = verificarSegurancaEntrada(cleanText);
    if (secIn.bloqueado) {
      logWarn('Guardrail', `Bloqueado (${secIn.motivo}) de ${telefone || jid}`);
      await sendHumanizedMessage(socket, jid, secIn.resposta);
      return;
    }

    const client = getOpenAIClient();
    if (!client) {
      await sendHumanizedMessage(
        socket,
        jid,
        'Olá! Nosso atendimento automático está temporariamente indisponível. Um atendente da oficina responderá em breve.',
      );
      return;
    }

    await reactToMessage(socket, jid, message.key, '👀');
    startSpinner('Processando com IA...');

    try {
      const chatKey = telefone || jid;
      const history = getHistory(chatKey);
      const { data: botCfg } = await supabase
        .from('whatsapp_bot_session')
        .select('ai_model, audio_mode, audio_voice')
        .eq('id', 'default')
        .maybeSingle();

      const modelToUse = imageDataUrl
        ? config.opencodeVisionModel
        : (botCfg?.ai_model || config.opencodeModel);

      const userContent = imageDataUrl
        ? [
            { type: 'text', text: cleanText },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ]
        : cleanText;

      const messages = [
        { role: 'system', content: buildSystemPrompt({ nomeCliente, telefone }) },
        ...history,
        { role: 'user', content: userContent },
      ];

      let finalReply = '';
      let calls = 0;

      while (calls < MAX_TOOL_CALLS_PER_TURN) {
        calls += 1;
        updateSpinner(`Consultando IA (${calls})...`);

        const response = await aiCircuit.execute(() =>
          client.chat.completions.create({
            model: modelToUse,
            messages,
            tools: imageDataUrl ? undefined : ferramentasSchema,
            tool_choice: imageDataUrl ? undefined : 'auto',
            temperature: 0.25,
          }),
        );

        const choice = response.choices?.[0]?.message;
        if (!choice) break;

        messages.push(choice);

        if (choice.tool_calls && choice.tool_calls.length > 0) {
          for (const tc of choice.tool_calls.slice(0, 4)) {
            const fnName = tc.function?.name;
            const rawArgs = String(tc.function?.arguments || '{}').slice(0, MAX_TOOL_ARGUMENT_CHARS);
            let parsedArgs = {};
            try {
              parsedArgs = JSON.parse(rawArgs);
            } catch {}

            logAction('Tool', `${fnName}(${JSON.stringify(parsedArgs)})`);
            const result = await executarFerramenta(fnName, parsedArgs, {
              telefone,
              nome: nomeCliente,
              jid,
            });

            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify(result).slice(0, 20_000),
            });
          }
          continue;
        }

        finalReply = choice.content || '';
        break;
      }

      stopSpinner();

      const secOut = verificarSegurancaSaida(finalReply);
      const safeReply = sanitizarMensagemWhatsApp(secOut.resposta);
      if (!safeReply) return;

      addMessage(chatKey, 'user', cleanText);
      addMessage(chatKey, 'assistant', safeReply);

      const audioMode = botCfg?.audio_mode || 'direct_request';
      const wantsVoice =
        audioMode === 'always' ||
        (audioMode === 'mirror' && isAudio) ||
        (audioMode === 'direct_request' && clientePediuAudio(cleanText));

      if (wantsVoice) {
        const audioBuf = await gerarAudioVoz(safeReply, botCfg?.audio_voice || 'pt-BR-FranciscaNeural');
        if (audioBuf) {
          await sendHumanizedVoice(socket, jid, audioBuf);
        } else {
          await sendHumanizedMessage(socket, jid, safeReply);
        }
      } else {
        await sendHumanizedMessage(socket, jid, safeReply);
      }

      await registrarMensagemChat({
        phone: chatKey,
        direction: 'outgoing',
        senderName: 'Bot IA',
        body: safeReply,
      });
      logOutgoing(nomeCliente || telefone || jid, safeReply);
    } catch (err) {
      stopSpinner();
      logError('IA', err instanceof Error ? err.message : String(err));
      await sendHumanizedMessage(
        socket,
        jid,
        'Desculpe, tive uma instabilidade momentânea aqui. Pode repetir ou aguardar um instante que já te atendo!',
      );
    }
  });
}
