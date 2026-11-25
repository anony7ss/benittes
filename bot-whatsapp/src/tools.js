import { supabase } from './supabase.js';
import { obterVariacoesTelefone, normalizarTelefoneBR } from './phone-utils.js';
import { pausarIaParaContato } from './web-sync.js';
import { logAction, logWarn } from './terminal.js';

const STATUS_LABELS = {
  novo: 'Novo / Recebido',
  em_andamento: 'Em andamento (No Box)',
  aguardando: 'Aguardando aprovação / peça',
  concluido: 'Concluído / Pronto',
  cancelado: 'Cancelado / Recusado',
};

function moneyBR(val) {
  const num = Number(val ?? 0);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function phoneMatchesVariations(rawPhone, variations) {
  const clean = String(rawPhone || '').replace(/\D/g, '');
  if (!clean) return false;
  return variations.some((v) => clean.endsWith(v.slice(-8)) || v.endsWith(clean.slice(-8)));
}

async function notifyOwner(message) {
  try {
    const { data: botCfg } = await supabase
      .from('whatsapp_bot_session')
      .select('owner_phone')
      .eq('id', 'default')
      .maybeSingle();
    const ownerPhone = normalizarTelefoneBR(botCfg?.owner_phone || '');
    if (!ownerPhone) return;
    await supabase.from('whatsapp_outbox').insert({
      phone: ownerPhone,
      message,
      kind: 'owner_alert',
      status: 'pending',
    });
  } catch {}
}

export async function listarServicos(categoria = '') {
  const { data, error } = await supabase
    .from('services')
    .select('id, name, category, description, base_price, details')
    .eq('active', true)
    .order('name', { ascending: true })
    .limit(100);

  if (error) return { ok: false, erro: 'Não foi possível consultar os serviços.' };

  const catFilter = String(categoria || '').trim().toLowerCase();
  const list = (data || [])
    .filter((s) => !catFilter || String(s.category || '').toLowerCase().includes(catFilter))
    .map((s) => ({
      nome: s.name,
      categoria: s.category || 'Geral',
      valor: moneyBR(s.base_price),
      preco_promocional: s.details?.preco_promo ? moneyBR(s.details.preco_promo) : null,
      duracao: s.details?.duracao || null,
      descricao: s.description || null,
    }));

  return { ok: true, total: list.length, servicos: list };
}

export async function consultarEstabelecimento() {
  const { data } = await supabase
    .from('workshop_settings')
    .select('key, value')
    .in('key', ['estabelecimento', 'horarios']);

  const map = new Map((data || []).map((r) => [r.key, r.value?.details || {}]));
  const est = map.get('estabelecimento') || {};
  const hor = map.get('horarios') || {};

  const endereco = [
    est.logradouro,
    est.numero,
    est.complemento,
    est.bairro,
    est.cidade && est.uf ? `${est.cidade}/${est.uf}` : est.cidade || est.uf,
    est.cep ? `CEP ${est.cep}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  const dias = Array.isArray(hor.days)
    ? hor.days.map((d) => ({
        dia: d.label,
        aberto: Boolean(d.open),
        horario: d.open ? `${d.start} às ${d.end}${d.hasBreak ? ` (pausa ${d.breakStart}–${d.breakEnd})` : ''}` : 'Fechado',
      }))
    : [];

  return {
    ok: true,
    nome: est.nome || 'Benittes Oficina Mecânica',
    slogan: est.slogan || null,
    whatsapp: est.whatsapp || null,
    telefone: est.telefone || null,
    email: est.email || null,
    instagram: est.instagram || null,
    endereco: endereco || null,
    maps_url: est.maps_url || null,
    garantia_dias: est.garantia_dias || '90',
    horarios: dias,
    folgas_proximas: Array.isArray(hor.holidays) ? hor.holidays.slice(0, 5) : [],
  };
}

export async function consultarStatusOS({ placa = '' }, context = {}) {
  const phone = String(context.telefone || '').replace(/\D/g, '');
  const variations = phone ? obterVariacoesTelefone(phone) : [];
  const cleanPlaca = String(placa || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  const [{ data: osRows }, { data: quoteRows }] = await Promise.all([
    supabase.from('work_orders').select('*').order('created_at', { ascending: false }).limit(80),
    supabase.from('quotes').select('*').order('created_at', { ascending: false }).limit(80),
  ]);

  const matchRow = (row) => {
    const rowPlate = String(row.vehicle_plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleanPlaca && rowPlate === cleanPlaca) return true;
    if (variations.length > 0 && phoneMatchesVariations(row.phone, variations)) return true;
    return false;
  };

  const osList = (osRows || []).filter(matchRow).slice(0, 5).map((r) => ({
    id: r.id,
    tipo: 'Ordem de Serviço',
    servico: r.reference,
    placa: r.vehicle_plate || 'Não informada',
    cliente: r.customer_name || null,
    valor: moneyBR(r.total),
    status_codigo: r.status,
    status: STATUS_LABELS[r.status] || r.status,
    aprovacao: r.details?.aprovacao || 'pendente',
    tecnico: r.details?.tecnico || null,
    box: r.details?.box || null,
    observacoes: r.notes || null,
  }));

  const quotesList = (quoteRows || []).filter(matchRow).slice(0, 5).map((r) => ({
    id: r.id,
    tipo: 'Orçamento',
    servico: r.reference,
    placa: r.vehicle_plate || 'Não informada',
    cliente: r.customer_name || null,
    valor: moneyBR(r.total),
    status_codigo: r.status,
    status: STATUS_LABELS[r.status] || r.status,
    aprovacao: r.details?.aprovacao || (r.status === 'concluido' ? 'aprovado' : r.status === 'cancelado' ? 'recusado' : 'pendente'),
    validade: r.valid_until || null,
    observacoes: r.notes || null,
  }));

  return {
    ok: true,
    ordens_de_servico: osList,
    orcamentos: quotesList,
    encontrou: osList.length > 0 || quotesList.length > 0,
  };
}

export async function responderOrcamento({ decisao, placa = '', motivo = '' }, context = {}) {
  const phone = String(context.telefone || '').replace(/\D/g, '');
  if (!phone) {
    return { ok: false, erro: 'Não consegui identificar o seu número de WhatsApp.' };
  }

  const normDecision = String(decisao || '').toLowerCase();
  const isApproved = normDecision === 'aprovado' || normDecision === 'aceitar' || normDecision === 'sim';
  const isRejected = normDecision === 'recusado' || normDecision === 'recusar' || normDecision === 'nao';
  if (!isApproved && !isRejected) {
    return { ok: false, erro: 'Decisão inválida. Informe aprovado ou recusado.' };
  }

  const variations = obterVariacoesTelefone(phone);
  const cleanPlaca = String(placa || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const today = new Date().toISOString().slice(0, 10);

  // 1. Procura OS pendente de aprovação primeiro
  const { data: osRows } = await supabase
    .from('work_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  const pendingOs = (osRows || []).find((r) => {
    if (r.status === 'cancelado' || r.status === 'concluido') return false;
    const apr = String(r.details?.aprovacao || 'pendente');
    if (apr !== 'pendente') return false;
    if (cleanPlaca && String(r.vehicle_plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === cleanPlaca) return true;
    return phoneMatchesVariations(r.phone, variations);
  });

  if (pendingOs) {
    const nextDetails = {
      ...(pendingOs.details || {}),
      aprovacao: isApproved ? 'aprovado' : 'recusado',
      ...(isApproved ? { aprovado_em: today } : { recusado_em: today, motivo_recusa: motivo || null }),
      respondido_via: 'whatsapp',
    };
    const nextStatus = isApproved
      ? (pendingOs.status === 'novo' ? 'em_andamento' : pendingOs.status)
      : 'cancelado';

    const { error } = await supabase
      .from('work_orders')
      .update({ status: nextStatus, details: nextDetails })
      .eq('id', pendingOs.id);

    if (error) return { ok: false, erro: 'Falha ao atualizar a Ordem de Serviço.' };

    logAction('Orçamento OS', `${pendingOs.reference} (${pendingOs.vehicle_plate || phone}) -> ${isApproved ? 'APROVADO' : 'RECUSADO'}`);
    await notifyOwner(
      `🔔 *Resposta de Orçamento (OS)*\n` +
      `Cliente: ${pendingOs.customer_name || phone}\n` +
      `Veículo: ${pendingOs.vehicle_plate || '—'}\n` +
      `Serviço: ${pendingOs.reference}\n` +
      `Valor: ${moneyBR(pendingOs.total)}\n` +
      `Decisão: *${isApproved ? 'APROVADO ✅' : 'RECUSADO ❌'}*` +
      (motivo ? `\nMotivo: ${motivo}` : ''),
    );

    return {
      ok: true,
      tipo: 'Ordem de Serviço',
      servico: pendingOs.reference,
      placa: pendingOs.vehicle_plate,
      valor: moneyBR(pendingOs.total),
      decisao: isApproved ? 'aprovado' : 'recusado',
      novo_status: STATUS_LABELS[nextStatus] || nextStatus,
    };
  }

  // 2. Se não houver OS pendente, procura Orçamento pendente
  const { data: quoteRows } = await supabase
    .from('quotes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  const pendingQuote = (quoteRows || []).find((r) => {
    if (r.status === 'cancelado' || r.status === 'concluido') return false;
    if (cleanPlaca && String(r.vehicle_plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === cleanPlaca) return true;
    return phoneMatchesVariations(r.phone, variations);
  });

  if (pendingQuote) {
    const nextDetails = {
      ...(pendingQuote.details || {}),
      aprovacao: isApproved ? 'aprovado' : 'recusado',
      ...(isApproved ? { aprovado_em: today } : { recusado_em: today, motivo_recusa: motivo || null }),
      respondido_via: 'whatsapp',
    };
    const nextStatus = isApproved ? 'concluido' : 'cancelado';

    const { error } = await supabase
      .from('quotes')
      .update({ status: nextStatus, details: nextDetails })
      .eq('id', pendingQuote.id);

    if (error) return { ok: false, erro: 'Falha ao atualizar o Orçamento.' };

    logAction('Orçamento', `${pendingQuote.reference} (${pendingQuote.vehicle_plate || phone}) -> ${isApproved ? 'APROVADO' : 'RECUSADO'}`);
    await notifyOwner(
      `🔔 *Resposta de Orçamento*\n` +
      `Cliente: ${pendingQuote.customer_name || phone}\n` +
      `Veículo: ${pendingQuote.vehicle_plate || '—'}\n` +
      `Serviço: ${pendingQuote.reference}\n` +
      `Valor: ${moneyBR(pendingQuote.total)}\n` +
      `Decisão: *${isApproved ? 'APROVADO ✅' : 'RECUSADO ❌'}*`,
    );

    return {
      ok: true,
      tipo: 'Orçamento',
      servico: pendingQuote.reference,
      placa: pendingQuote.vehicle_plate,
      valor: moneyBR(pendingQuote.total),
      decisao: isApproved ? 'aprovado' : 'recusado',
      novo_status: STATUS_LABELS[nextStatus] || nextStatus,
    };
  }

  return {
    ok: false,
    encontrou: false,
    mensagem: 'Não encontrei nenhum orçamento ou OS pendente de aprovação para o seu número.',
  };
}

export async function consultarHorarios({ data }) {
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(String(data))) {
    return { ok: false, mensagem: 'Informe a data no formato YYYY-MM-DD.' };
  }

  const { data: horRow } = await supabase
    .from('workshop_settings')
    .select('value')
    .eq('key', 'horarios')
    .maybeSingle();

  const hor = horRow?.value?.details || {};
  const holidays = Array.isArray(hor.holidays) ? hor.holidays : [];
  const holiday = holidays.find((h) => h.date === data && h.allDay);
  if (holiday) {
    return { ok: true, data, fechado: true, motivo: holiday.reason || 'Feriado / Folga' };
  }

  const weekdayIndex = new Date(`${data}T12:00:00-03:00`).getDay();
  const keyOrder = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  const dayKey = keyOrder[weekdayIndex];
  const dayCfg = Array.isArray(hor.days) ? hor.days.find((d) => d.key === dayKey) : null;

  if (dayCfg && !dayCfg.open) {
    return { ok: true, data, fechado: true, motivo: `Oficina fechada (${dayCfg.label})` };
  }

  const startStr = dayCfg?.start || '08:00';
  const endStr = dayCfg?.end || '18:00';
  const pausa = dayCfg?.hasBreak ? `${dayCfg.breakStart} às ${dayCfg.breakEnd}` : null;

  return {
    ok: true,
    data,
    fechado: false,
    horario_funcionamento: `${startStr} às ${endStr}`,
    pausa,
    qualquer_horario_no_expediente: true,
    observacao: 'O cliente pode vir em qualquer horário dentro do expediente de funcionamento.',
  };
}

export async function agendarVisita({ nome, servico, data, hora = '09:00', placa = '', observacoes = '' }, context = {}) {
  const phone = String(context.telefone || '').replace(/\D/g, '');
  if (!nome || !servico || !data) {
    return { ok: false, mensagem: 'Informe nome, serviço e data.' };
  }

  const cleanHora = /^\d{2}:\d{2}$/.test(String(hora || '').trim()) ? String(hora).trim() : '09:00';
  const startsAt = new Date(`${data}T${cleanHora}:00-03:00`);
  if (Number.isNaN(startsAt.getTime())) {
    return { ok: false, mensagem: 'Data ou horário inválido.' };
  }

  const { data: created, error } = await supabase
    .from('appointments')
    .insert({
      title: servico,
      service_type: servico,
      customer_name: nome,
      contact_phone: phone || null,
      vehicle_plate: placa ? String(placa).toUpperCase() : null,
      starts_at: startsAt.toISOString(),
      notes: observacoes || null,
      status: 'novo',
      details: { data, hora: cleanHora, servico, origem: 'whatsapp' },
    })
    .select('*')
    .single();

  if (error) return { ok: false, erro: 'Não foi possível concluir o agendamento.' };

  logAction('Agendamento', `${nome} · ${servico} em ${data} ${cleanHora}`);
  await notifyOwner(
    `📅 *Novo Agendamento via WhatsApp*\n` +
    `Cliente: ${nome} (${phone})\n` +
    `Serviço: ${servico}\n` +
    `Data: ${data} (${cleanHora})` +
    (placa ? `\nPlaca: ${String(placa).toUpperCase()}` : ''),
  );

  return { ok: true, id: created?.id, data, hora: cleanHora, servico, nome };
}

export async function verificarOficinaFechadaAgora() {
  try {
    const [{ data: horRow }, { data: botCfg }] = await Promise.all([
      supabase.from('workshop_settings').select('value').eq('key', 'horarios').maybeSingle(),
      supabase
        .from('whatsapp_bot_session')
        .select('closed_auto_reply_enabled, closed_auto_reply_message')
        .eq('id', 'default')
        .maybeSingle(),
    ]);

    if (botCfg?.closed_auto_reply_enabled === false) {
      return { fechada: false };
    }

    const hor = horRow?.value?.details || {};
    const nowBr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const ymd = `${nowBr.getFullYear()}-${String(nowBr.getMonth() + 1).padStart(2, '0')}-${String(nowBr.getDate()).padStart(2, '0')}`;
    const nowMin = nowBr.getHours() * 60 + nowBr.getMinutes();

    const toMin = (hhmm) => {
      const [h, m] = String(hhmm || '00:00').split(':').map(Number);
      return h * 60 + (m || 0);
    };

    const holidays = Array.isArray(hor.holidays) ? hor.holidays : [];
    const holiday = holidays.find((h) => h.date === ymd);
    let isClosed = false;

    if (holiday) {
      if (holiday.allDay) {
        isClosed = true;
      } else if (nowMin >= toMin(holiday.startTime) && nowMin < toMin(holiday.endTime)) {
        isClosed = true;
      }
    }

    if (!isClosed && Array.isArray(hor.days)) {
      const keyOrder = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
      const dayCfg = hor.days.find((d) => d.key === keyOrder[nowBr.getDay()]);
      if (dayCfg) {
        if (!dayCfg.open) {
          isClosed = true;
        } else {
          const startMin = toMin(dayCfg.start || '08:00');
          const endMin = toMin(dayCfg.end || '18:00');
          if (nowMin < startMin || nowMin >= endMin) {
            isClosed = true;
          }
        }
      }
    }

    return {
      fechada: isClosed,
      mensagem:
        botCfg?.closed_auto_reply_message ||
        'Olá! 👋 No momento a *Benittes Oficina Mecânica* está fechada. Assim que retomarmos o atendimento, responderemos sua mensagem!',
    };
  } catch {
    return { fechada: false };
  }
}

export async function chamarAtendente({ motivo = 'Solicitação do cliente' }, context = {}) {
  const phone = String(context.telefone || '').replace(/\D/g, '');
  if (phone) {
    await pausarIaParaContato(phone, 120);
  }
  logWarn('Atendente', `Cliente ${phone || 'desconhecido'} solicitou atendimento humano: ${motivo}`);
  await notifyOwner(
    `🙋 *Atendimento Humano Solicitado*\n` +
    `Cliente: ${context.nome || phone || 'Não identificado'}\n` +
    `Telefone: ${phone || '—'}\n` +
    `Motivo: ${motivo}`,
  );
  return { ok: true, pausado_minutos: 120 };
}

export const ferramentasSchema = [
  {
    type: 'function',
    function: {
      name: 'listarServicos',
      description: 'Lista os serviços ativos da oficina com valores e duração. Sempre chame antes de informar preços.',
      parameters: {
        type: 'object',
        properties: {
          categoria: { type: 'string', description: 'Filtro opcional de categoria (ex: Freios, Óleo, Revisão).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultarEstabelecimento',
      description: 'Consulta endereço, telefone, horários de funcionamento, pausas e folgas da oficina.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultarStatusOS',
      description: 'Consulta o status de Ordens de Serviço e Orçamentos do cliente pelo número ou placa.',
      parameters: {
        type: 'object',
        properties: {
          placa: { type: 'string', description: 'Placa opcional do veículo.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'responderOrcamento',
      description: 'Registra a aprovação ou recusa do cliente para uma Ordem de Serviço ou Orçamento pendente.',
      parameters: {
        type: 'object',
        properties: {
          decisao: { type: 'string', enum: ['aprovado', 'recusado'], description: 'aprovado se o cliente aceitou, recusado se recusou.' },
          placa: { type: 'string', description: 'Placa opcional se mencionada.' },
          motivo: { type: 'string', description: 'Motivo opcional em caso de recusa.' },
        },
        required: ['decisao'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultarHorarios',
      description: 'Consulta horários disponíveis na oficina para uma data (YYYY-MM-DD).',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'Data no formato YYYY-MM-DD.' },
        },
        required: ['data'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agendarVisita',
      description: 'Agenda uma visita/serviço na oficina para qualquer horário dentro do funcionamento (não precisa exigir horário exato).',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          servico: { type: 'string' },
          data: { type: 'string', description: 'YYYY-MM-DD' },
          hora: { type: 'string', description: 'HH:MM opcional (padrão 09:00 se cliente não informar)' },
          placa: { type: 'string' },
          observacoes: { type: 'string' },
        },
        required: ['nome', 'servico', 'data'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chamarAtendente',
      description: 'Transfere a conversa para um atendente humano da oficina e pausa a IA.',
      parameters: {
        type: 'object',
        properties: {
          motivo: { type: 'string' },
        },
      },
    },
  },
];

export async function executarFerramenta(nome, args = {}, context = {}) {
  switch (nome) {
    case 'listarServicos':
      return listarServicos(args.categoria);
    case 'consultarEstabelecimento':
      return consultarEstabelecimento();
    case 'consultarStatusOS':
      return consultarStatusOS(args, context);
    case 'responderOrcamento':
      return responderOrcamento(args, context);
    case 'consultarHorarios':
      return consultarHorarios(args);
    case 'agendarVisita':
      return agendarVisita(args, context);
    case 'chamarAtendente':
      return chamarAtendente(args, context);
    default:
      return { ok: false, erro: `Ferramenta desconhecida: ${nome}` };
  }
}
