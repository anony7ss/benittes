/**
 * Guardrails de Segurança e Proteção de Escopo para o Bot WhatsApp da Benittes Oficina
 */

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|the)?\s*(instructions|prompts|rules|commands)/i,
  /ignore\s+todas\s+(as)?\s*(instruções|regras|diretrizes)/i,
  /esqueça\s+(todas\s+as\s+regras|o\s+que\s+te\s+disseram|tudo\s+anterior|as\s+instruções)/i,
  /(you\s+are\s+now|now\s+you\s+are|act\s+as|pretend\s+to\s+be)\s+.*(different|unfiltered|dan|developer|jailbreak|gpt)/i,
  /(você\s+agora\s+é|aja\s+como|finja\s+ser|comporte-se\s+como)\s+.*(hacker|programador|assistente|dan|dev)/i,
  /\b(modo\s+desenvolvedor|developer\s+mode|dan\s+mode|jailbreak)\b/i,
  /(qual\s+é|me\s+mostre|revele|imprima|copie|repita)\s+(o\s+seu|as\s+suas)?\s*(system\s+prompt|prompt\s+do\s+sistema|instruções\s+iniciais|regras\s+secretas)/i,
  /(what\s+is\s+your|show\s+me\s+your|print\s+your)\s+(system\s+prompt|instructions|initial\s+prompt)/i,
  /\b(?:decod(?:ifique|ificar)|converta|revele|imprima|mostre)\b.{0,80}\b(base64|rot13|hex(?:adecimal)?|cifra)\b/i,
  /\b(?:reveal|show|print|decode|convert)\b.{0,80}\b(base64|rot13|hex(?:adecimal)?|cipher)\b/i,
  /\b(?:system|developer|internal)\s+(?:prompt|instructions?|rules?|message)\b/i,
  /\b(?:prompt|instruções|regras)\b.{0,80}\b(?:ocultas?|secretas?|internas?|originais?)\b/i,
  /bypass\s+(safety|rules|filters)/i,
];

const CODE_REQUEST_PATTERNS = [
  /(escreva|faça|crie|gere|monte)\s+(um\s+)?(script|código|programa|função|algoritmo)\s+(em|usando|de)?\s*(python|javascript|typescript|c\+\+|java|php|ruby|bash|sql|rust|golang|html)/i,
  /(write|make|create|generate)\s+(a\s+)?(script|code|program|function)\s+(in)?\s*(python|javascript|typescript|c\+\+|java|php|ruby|bash|sql)/i,
  /```(python|javascript|typescript|bash|sh|c|cpp|php|ruby|sql)/i,
  /\bimport\s+os\b|\bimport\s+sys\b|\bdef\s+[a-zA-Z_]+\s*\(|\bconsole\.log\(|\bSELECT\s+\*\s+FROM/i,
];

const OFF_TOPIC_PATTERNS = [
  /(faça|escreva|redija|crie)\s+(uma\s+)?(redação|dissertação|resumo\s+de\s+livro|poema\s+sobre|trabalho\s+escolar|artigo)/i,
  /(calcule|resolva|quanto\s+é)\s+.*(\bderivada\b|\bintegral\b|\bbhaskara\b|\braiz\s+quadrada\b|\d+\s*[\+\-\*\/^%]\s*\d+)/i,
  /(quem\s+vai\s+ganhar\s+a\s+eleição|qual\s+seu\s+posicionamento\s+político)/i,
];

const INTERNAL_OUTPUT_PATTERNS = [
  /(?:system\s+prompt|developer\s+message|prompt\s+do\s+sistema|instruções\s+internas|regras\s+secretas)/i,
  /(?:SUPABASE_|OPENCODE_|OPENAI_|GROQ_)[A-Z0-9_]{3,}/i,
  /(?:service[_ -]?role|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=]/i,
  /https?:\/\/[^\s]*(?:supabase\.co|opencode\.ai|localhost:\d+)/i,
];

const MAX_INPUT_CHARS = 6000;
const MAX_OUTPUT_CHARS = 6000;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const INVISIBLE_DIRECTIONAL_CHARS = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;

function normalizarParaDeteccao(texto) {
  return texto
    .normalize('NFKC')
    .replace(CONTROL_CHARS, ' ')
    .replace(INVISIBLE_DIRECTIONAL_CHARS, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function padraoEncontraTexto(pattern, variantes) {
  return variantes.some((variante) => {
    pattern.lastIndex = 0;
    return pattern.test(variante);
  });
}

export const RESPOSTAS_DEFENSIVAS = {
  injection: 'Oi! Sou a assistente virtual da Benittes Oficina Mecânica. Cuido exclusivamente do atendimento aos clientes, orçamentos, status de serviços e agendamentos. Como posso te ajudar com seu veículo hoje?',
  code: 'Oi! Aqui no WhatsApp eu ajudo apenas com serviços automotivos, orçamentos, acompanhamento de OS e agendamentos da Benittes Oficina Mecânica. Como posso ajudar com o seu carro?',
  offTopic: 'Oi! Aqui no WhatsApp eu atendo exclusivamente dúvidas sobre serviços, orçamentos, status de veículo e agendamentos na Benittes Oficina Mecânica. Como posso te ajudar hoje?',
};

export function verificarSegurancaEntrada(texto) {
  if (!texto || typeof texto !== 'string') {
    return { bloqueado: false };
  }

  const textoLimpo = texto.trim();
  const textoDeteccao = normalizarParaDeteccao(textoLimpo);
  const variantes = [textoLimpo, textoDeteccao];

  if (textoLimpo.length > MAX_INPUT_CHARS || textoDeteccao.length > MAX_INPUT_CHARS) {
    return {
      bloqueado: true,
      motivo: 'input_too_long',
      resposta: RESPOSTAS_DEFENSIVAS.offTopic,
    };
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (padraoEncontraTexto(pattern, variantes)) {
      return {
        bloqueado: true,
        motivo: 'prompt_injection',
        resposta: RESPOSTAS_DEFENSIVAS.injection,
      };
    }
  }

  for (const pattern of CODE_REQUEST_PATTERNS) {
    if (padraoEncontraTexto(pattern, variantes)) {
      return {
        bloqueado: true,
        motivo: 'code_request',
        resposta: RESPOSTAS_DEFENSIVAS.code,
      };
    }
  }

  for (const pattern of OFF_TOPIC_PATTERNS) {
    if (padraoEncontraTexto(pattern, variantes)) {
      return {
        bloqueado: true,
        motivo: 'off_topic',
        resposta: RESPOSTAS_DEFENSIVAS.offTopic,
      };
    }
  }

  return { bloqueado: false };
}

export function verificarSegurancaSaida(texto) {
  if (!texto || typeof texto !== 'string') {
    return { segura: false, motivo: 'empty_output', resposta: RESPOSTAS_DEFENSIVAS.offTopic };
  }

  const textoLimpo = texto.trim();
  if (textoLimpo.length > MAX_OUTPUT_CHARS) {
    return { segura: false, motivo: 'output_too_long', resposta: RESPOSTAS_DEFENSIVAS.offTopic };
  }

  const textoDeteccao = normalizarParaDeteccao(textoLimpo);
  for (const pattern of INTERNAL_OUTPUT_PATTERNS) {
    if (padraoEncontraTexto(pattern, [textoLimpo, textoDeteccao])) {
      return { segura: false, motivo: 'internal_leak', resposta: RESPOSTAS_DEFENSIVAS.injection };
    }
  }

  return { segura: true, resposta: textoLimpo };
}
