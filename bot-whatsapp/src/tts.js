import { EdgeTTS } from '@andresaya/edge-tts';
import { spawn } from 'child_process';
import { logAction, logError, logInfo, logWarn } from './terminal.js';
import { createCircuitBreaker, isTransientExternalError } from './circuit-breaker.js';

/**
 * Voz padrão da oficina para respostas em áudio (voz neural feminina em pt-BR)
 */
export const DEFAULT_VOICE = 'pt-BR-FranciscaNeural';

const TTS_CACHE_TTL_MS = 15 * 60 * 1000;
const TTS_CACHE_MAX_ITEMS = 24;
const MAX_TTS_TEXT_CHARS = 3000;
const MAX_TTS_AUDIO_BYTES = 16 * 1024 * 1024;
const ttsCache = new Map();
const ttsCircuit = createCircuitBreaker({
  name: 'edge-tts',
  failureThreshold: 3,
  resetTimeoutMs: 45_000,
  shouldCountFailure: isTransientExternalError,
  onStateChange: ({ state, failures }) => {
    if (state === 'open') logWarn('TTS', `Geração de voz pausada após ${failures} falhas temporárias; respostas em texto continuam disponíveis.`);
    if (state === 'closed') logInfo('TTS', 'Geração de voz voltou a responder.');
  },
});

/**
 * Remove acentos e caracteres diacríticos para facilitar buscas e detecções semânticas.
 * @param {string} str 
 * @returns {string}
 */
export function removerAcentos(str) {
  if (!str || typeof str !== 'string') return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Verifica se a mensagem do cliente pede explicitamente uma resposta em áudio / voz.
 * Ex: "manda em áudio", "me explica por áudio", "prefiro áudio", "grava um áudio", "pode mandar áudio?"
 * 
 * @param {string} texto 
 * @returns {boolean}
 */
export function clientePediuAudio(texto) {
  if (!texto || typeof texto !== 'string') return false;
  const norm = removerAcentos(texto);

  const padroes = [
    /\b(manda|mandar|mande|envia|enviar|envie|fala|falar|fale|grava|gravar|grave|responde|responder|responda|prefiro|quero|pode ser|consegue)\b.*\b(audio|voz|gravacao)\b/,
    /\b(em|por)\s+(audio|voz)\b/,
    /\b(audio|voz)\b.*\b(por\s*favor|pfv|pode\s*ser|obrigad[oa])\b/,
    /\b(manda|grava|responde|envia)\s+(um\s+)?(audio|voz)\b/
  ];

  return padroes.some((re) => re.test(norm));
}

/**
 * Limpa o texto gerado pela IA para fala sintética:
 * - Remove formatações markdown (*, _, ~, `, #)
 * - Remove emojis visuais para não soar robótico
 * - Substitui URLs longas por menção falada
 * - Organiza quebras de linha e tópicos em pausas naturais com pontuação
 * 
 * @param {string} texto 
 * @returns {string}
 */
export function limparTextoParaFala(texto) {
  if (!texto || typeof texto !== 'string') return '';

  let limpo = texto
    // Substitui links por menção falada suave
    .replace(/https?:\/\/[^\s]+/gi, 'no link que te enviei')
    // Remove emojis Unicode (emoticons, símbolos pictográficos e variações)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{200D}\u{20E3}]/gu, '')
    // Remove formatação Markdown
    .replace(/[*_~`#]+/g, '')
    // Converte listas e marcadores em frases pausadas
    .replace(/\r?\n\s*[-*•]\s*/g, '. ')
    // Converte quebras de linha múltiplas em pausa/ponto
    .replace(/\r?\n+/g, '. ')
    // Remove pontuações duplicadas e normaliza espaços
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return limpo.slice(0, MAX_TTS_TEXT_CHARS);
}

/**
 * Converte buffer de MP3 gerado pelo Edge TTS para OGG/Opus.
 * Quando FFmpeg falha, retorna buffer vazio: o chamador deve enviar texto em vez de
 * marcar um MP3 como nota de voz PTT, formato que não foi validado para WhatsApp.
 * 
 * @param {Buffer} mp3Buffer
 * @returns {Promise<{ buffer: Buffer, mimetype: string }>}
 */
export function converterParaOggOpus(mp3Buffer) {
  return new Promise((resolve) => {
    const falha = () => resolve({ buffer: Buffer.alloc(0), mimetype: 'audio/ogg; codecs=opus' });
    if (!Buffer.isBuffer(mp3Buffer) || mp3Buffer.length === 0 || mp3Buffer.length > MAX_TTS_AUDIO_BYTES) {
      falha();
      return;
    }
    try {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-c:a', 'libopus',
        '-b:a', '24k',
        '-vbr', 'on',
        '-compression_level', '0',
        '-frame_duration', '20',
        '-application', 'voip',
        '-f', 'ogg',
        'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'ignore'] });

      const chunks = [];
      let totalBytes = 0;
      let settled = false;
      let excedeuLimite = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };
      const timeout = setTimeout(() => {
        excedeuLimite = true;
        ffmpeg.kill('SIGKILL');
        finish({ buffer: Buffer.alloc(0), mimetype: 'audio/ogg; codecs=opus' });
      }, 20_000);
      timeout.unref?.();

      ffmpeg.stdout.on('data', (chunk) => {
        if (excedeuLimite) return;
        totalBytes += chunk.length;
        if (totalBytes > MAX_TTS_AUDIO_BYTES) {
          excedeuLimite = true;
          ffmpeg.kill('SIGKILL');
          finish({ buffer: Buffer.alloc(0), mimetype: 'audio/ogg; codecs=opus' });
          return;
        }
        chunks.push(chunk);
      });

      ffmpeg.on('close', (code) => {
        if (settled) return;
        const output = Buffer.concat(chunks, totalBytes);
        const isOggOpus = output.subarray(0, 4).toString('ascii') === 'OggS' && output.includes(Buffer.from('OpusHead'));
        if (code === 0 && !excedeuLimite && isOggOpus) {
          finish({ buffer: output, mimetype: 'audio/ogg; codecs=opus' });
          return;
        }
        finish({ buffer: Buffer.alloc(0), mimetype: 'audio/ogg; codecs=opus' });
      });

      ffmpeg.on('error', () => {
        logWarn('TTS', 'FFmpeg indisponível ou falhou; resposta por áudio será omitida.');
        finish({ buffer: Buffer.alloc(0), mimetype: 'audio/ogg; codecs=opus' });
      });

      ffmpeg.stdin.on('error', () => {
        finish({ buffer: Buffer.alloc(0), mimetype: 'audio/ogg; codecs=opus' });
      });
      ffmpeg.stdin.end(mp3Buffer);
    } catch {
      falha();
    }
  });
}

/**
 * Sintetiza texto em áudio neural brasileiro (Edge TTS - Microsoft Neural)
 * e tenta converter para OGG Opus. Sem uma conversão validada, o áudio não é enviado.
 * 
 * @param {string} texto Texto a ser falado
 * @param {string} [voz=DEFAULT_VOICE] Identificador da voz em pt-BR
 * @returns {Promise<{ sucesso: boolean, buffer?: Buffer, mimetype?: string, textoFalado?: string, erro?: string }>}
 */
export async function gerarAudioVoz(texto, voz = DEFAULT_VOICE) {
  const textoLimpo = limparTextoParaFala(texto);

  if (!textoLimpo || textoLimpo.length < 2) {
    return {
      sucesso: false,
      erro: 'Texto vazio para síntese de voz',
    };
  }

  try {
    const vozEscolhida = (voz && voz.startsWith('pt-BR')) ? voz : DEFAULT_VOICE;
    const cacheKey = `${vozEscolhida}\u0000${textoLimpo}`;
    const cached = ttsCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < TTS_CACHE_TTL_MS) {
      return {
        sucesso: true,
        buffer: Buffer.from(cached.buffer),
        mimetype: cached.mimetype,
        textoFalado: textoLimpo,
      };
    }
    if (cached) ttsCache.delete(cacheKey);

    const mp3Buffer = await ttsCircuit.execute(async () => {
      const tts = new EdgeTTS();
      // IMPORTANTE: O 2º parâmetro DEVE ser a voz pt-BR, senão o EdgeTTS usa a voz americana padrão en-US-AnaNeural!
      await tts.synthesize(textoLimpo, vozEscolhida);
      return tts.toBuffer();
    });

    if (!mp3Buffer || mp3Buffer.length === 0 || mp3Buffer.length > MAX_TTS_AUDIO_BYTES) {
      throw new Error('Buffer de voz retornado pelo sintetizador está vazio.');
    }

    // Converte para OGG Opus nativo para tocar perfeitamente em celulares (WhatsApp mobile)
    const { buffer: audioFinal, mimetype } = await converterParaOggOpus(mp3Buffer);
    if (!audioFinal || audioFinal.length === 0 || audioFinal.length > MAX_TTS_AUDIO_BYTES) {
      throw new Error('Áudio sintetizado excede o limite permitido.');
    }

    ttsCache.set(cacheKey, {
      buffer: Buffer.from(audioFinal),
      mimetype,
      createdAt: Date.now(),
    });
    while (ttsCache.size > TTS_CACHE_MAX_ITEMS) {
      ttsCache.delete(ttsCache.keys().next().value);
    }

    return {
      sucesso: true,
      buffer: audioFinal,
      mimetype,
      textoFalado: textoLimpo,
    };
  } catch (err) {
    logError('TTS', `Falha ao gerar voz neural: ${err?.message || err}`);
    return {
      sucesso: false,
      erro: 'Não foi possível gerar o áudio agora.',
    };
  }
}

export default {
  DEFAULT_VOICE,
  removerAcentos,
  clientePediuAudio,
  limparTextoParaFala,
  converterParaOggOpus,
  gerarAudioVoz,
};
