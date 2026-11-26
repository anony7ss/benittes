import { supabase } from './supabase.js';
import config from './config.js';
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

const SERVICE_CACHE_TTL_MS = 60 * 1000;
let serviceCatalogCache = { expiresAt: 0, data: null, pending: null };

function moneyBR(val) {
  const num = Number(val ?? 0);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function positiveAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function normalizeCatalogText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pricingMode(service) {
  const mode = String(service?.details?.pricing_mode || '');
  if (['fixed', 'vehicle', 'assessment'].includes(mode)) return mode;
  return positiveAmount(service?.base_price) ? 'fixed' : 'assessment';
}

function resolveBotServicePrice(service, rules, vehicle) {
  const mode = pricingMode(service);
  if (mode === 'fixed') {
    const amount = positiveAmount(service?.details?.preco_promo) || positiveAmount(service?.base_price);
    return amount
      ? { amount, mode, message: 'Valor fixo cadastrado.' }
      : { amount: null, mode: 'assessment', message: 'A oficina vai confirmar o valor no orçamento.' };
  }
  if (mode === 'assessment') {
    return { amount: null, mode, message: 'A oficina vai confirmar o valor no orçamento.' };
  }

  const make = normalizeCatalogText(vehicle?.marca);
  const model = normalizeCatalogText(vehicle?.modelo);
  const rawYear = Number(vehicle?.ano);
  const year = Number.isInteger(rawYear) && rawYear >= 1900 && rawYear <= 2200 ? rawYear : null;
  if (!make || !model) {
    const missing = [!make ? 'marca' : '', !model ? 'modelo' : ''].filter(Boolean);
    return { amount: null, mode, message: `Para preparar seu orçamento, me informe ${missing.join(' e ')} do carro.` };
  }

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  if (year === null && (rules || []).some((rule) => {
    if (rule.active === false || rule.service_id !== service.id) return false;
    const ruleMake = normalizeCatalogText(rule.vehicle_make);
    const ruleModel = normalizeCatalogText(rule.vehicle_model);
    const yearFrom = rule.year_from == null ? null : Number(rule.year_from);
    const yearTo = rule.year_to == null ? null : Number(rule.year_to);
    return positiveAmount(rule.price) !== null
      && (ruleMake || ruleModel)
      && (!ruleMake || ruleMake === make)
      && (!ruleModel || ruleModel === model)
      && (yearFrom !== null || yearTo !== null)
      && (!rule.valid_from || rule.valid_from <= today)
      && (!rule.valid_until || rule.valid_until >= today);
  })) {
    return { amount: null, mode, message: 'Para preparar seu orçamento, me informe o ano do carro.' };
  }
  const matched = (rules || []).flatMap((rule) => {
    if (rule.active === false || rule.service_id !== service.id) return [];
    const ruleMake = normalizeCatalogText(rule.vehicle_make);
    const ruleModel = normalizeCatalogText(rule.vehicle_model);
    const amount = positiveAmount(rule.price);
    const yearFrom = rule.year_from == null ? null : Number(rule.year_from);
    const yearTo = rule.year_to == null ? null : Number(rule.year_to);
    if ((!ruleMake && !ruleModel) || !amount) return [];
    if (ruleMake && ruleMake !== make) return [];
    if (ruleModel && ruleModel !== model) return [];
    if ((yearFrom !== null || yearTo !== null) && year === null) return [];
    if (yearFrom !== null && (!Number.isInteger(yearFrom) || year < yearFrom)) return [];
    if (yearTo !== null && (!Number.isInteger(yearTo) || year > yearTo)) return [];
    if (rule.valid_from && rule.valid_from > today) return [];
    if (rule.valid_until && rule.valid_until < today) return [];
    const yearSpecificity = yearFrom == null && yearTo == null
      ? 0
      : yearFrom != null && yearTo != null
        ? 10000 - Math.min(9999, yearTo - yearFrom)
        : 1000;
    const vehicleSpecificity = ruleMake && ruleModel ? 10_000_000 : ruleMake || ruleModel ? 1_000_000 : 0;
    return [{ amount, specificity: vehicleSpecificity + yearSpecificity }];
  });

  if (matched.length === 0) {
    return { amount: null, mode, message: 'Vou pedir à oficina que confirme o orçamento antes de te passar o valor.' };
  }
  const specificity = Math.max(...matched.map((item) => item.specificity));
  const best = matched.filter((item) => item.specificity === specificity);
  if (new Set(best.map((item) => item.amount)).size > 1) {
    return { amount: null, mode, message: 'Vou pedir à oficina que confirme o valor antes de te passar uma informação incorreta.' };
  }
  return { amount: best[0].amount, mode, message: 'Valor confirmado para este orçamento.' };
}

function hasFinalApprovalPrice(record) {
  const total = positiveAmount(record?.total);
  if (!total) return false;
  const items = Array.isArray(record?.details?.items) ? record.details.items : [];
  const approved = items.filter((item) => item?.approved !== false);
  return (items.length === 0 || approved.length > 0)
    && approved.every((item) => positiveAmount(item?.unit_price) !== null);
}

function phoneMatchesVariations(rawPhone, variations) {
  const clean = String(rawPhone || '').replace(/\D/g, '');
  if (!clean) return false;
  return variations.some((v) => clean === String(v || '').replace(/\D/g, ''));
}

function applyMessageTemplate(template, values) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = values[key];
    return value === null || value === undefined ? '' : String(value);
  }).trim();
}

async function notifyOwner(type, values, fallback) {
  try {
    const { data: botCfg } = await supabase
      .from('whatsapp_bot_session')
      .select('owner_phone,automations_enabled,notify_on_human_transfer,notify_on_quote_response,notify_on_appointment,owner_human_alert_message,owner_quote_alert_message,owner_appointment_alert_message')
      .eq('id', 'default')
      .maybeSingle();
    if (botCfg?.automations_enabled === false) return;
    const categories = {
      human: { enabled: 'notify_on_human_transfer', template: 'owner_human_alert_message', kind: 'owner_human' },
      quote: { enabled: 'notify_on_quote_response', template: 'owner_quote_alert_message', kind: 'owner_quote' },
      appointment: { enabled: 'notify_on_appointment', template: 'owner_appointment_alert_message', kind: 'owner_appointment' },
    };
    const category = categories[type];
    if (!category || botCfg?.[category.enabled] === false) return;
    const ownerPhone = normalizarTelefoneBR(botCfg?.owner_phone || '');
    if (!ownerPhone) return;
    const message = applyMessageTemplate(botCfg?.[category.template], { oficina: config.workshopName, ...values }) || fallback;
    if (!message) return;
    await supabase.from('whatsapp_outbox').insert({
      phone: ownerPhone,
      message,
      kind: category.kind,
      status: 'pending',
    });
  } catch {}
}

export async function listarServicos(args = {}) {
  if (typeof args === 'string') args = { categoria: args };
  let data = serviceCatalogCache.data;
  if (!data || serviceCatalogCache.expiresAt <= Date.now()) {
    if (!serviceCatalogCache.pending) {
      serviceCatalogCache.pending = Promise.all([
        supabase.from('services')
          .select('id, name, category, description, base_price, details')
          .eq('active', true)
          .order('name', { ascending: true })
          .limit(100),
        supabase.from('service_price_rules')
          .select('service_id, vehicle_make, vehicle_model, year_from, year_to, price, valid_from, valid_until, active')
          .eq('active', true)
          .limit(500),
      ])
        .then(([servicesResult, rulesResult]) => {
          if (servicesResult.error || rulesResult.error) throw servicesResult.error || rulesResult.error;
          serviceCatalogCache = {
            data: { services: servicesResult.data || [], rules: rulesResult.data || [] },
            expiresAt: Date.now() + SERVICE_CACHE_TTL_MS,
            pending: null,
          };
          return serviceCatalogCache.data;
        })
        .catch((error) => {
          serviceCatalogCache.pending = null;
          throw error;
        });
    }
    try {
      data = await serviceCatalogCache.pending;
    } catch {
      return { ok: false, erro: 'Não foi possível consultar os serviços.' };
    }
  }

  const catFilter = normalizeCatalogText(args.categoria);
  const serviceFilter = normalizeCatalogText(args.nome_servico || args.servico);
  const vehicle = { marca: args.marca, modelo: args.modelo, ano: args.ano };
  const list = (data?.services || [])
    .filter((service) => !catFilter || normalizeCatalogText(service.category).includes(catFilter))
    .filter((service) => !serviceFilter || normalizeCatalogText(service.name).includes(serviceFilter))
    .map((service) => {
      const resolution = resolveBotServicePrice(service, data?.rules || [], vehicle);
      return {
        nome: service.name,
        categoria: service.category || 'Geral',
        valor: resolution.amount === null ? null : moneyBR(resolution.amount),
        preco_definido: resolution.amount !== null,
        orientacao_preco: resolution.amount === null ? resolution.message : 'Valor confirmado para o orçamento.',
        preco_promocional: resolution.mode === 'fixed' && positiveAmount(service.details?.preco_promo)
          ? moneyBR(service.details.preco_promo)
          : null,
        duracao: service.details?.duracao || null,
        descricao: service.description || null,
      };
    });

  return { ok: true, total: list.length, veiculo_consultado: Boolean(vehicle.marca || vehicle.modelo || vehicle.ano), servicos: list };
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
    if (variations.length === 0 || !phoneMatchesVariations(row.phone, variations)) return false;
    return !cleanPlaca || rowPlate === cleanPlaca;
  };

  const osList = (osRows || []).filter(matchRow).slice(0, 5).map((r) => ({
    id: r.id,
    tipo: 'Ordem de Serviço',
    servico: r.reference,
    placa: r.vehicle_plate || 'Não informada',
    cliente: r.customer_name || null,
    valor: positiveAmount(r.total) ? moneyBR(r.total) : null,
    valor_definido: positiveAmount(r.total) !== null,
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
    valor: positiveAmount(r.total) ? moneyBR(r.total) : null,
    valor_definido: positiveAmount(r.total) !== null,
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
    if (!phoneMatchesVariations(r.phone, variations)) return false;
    return !cleanPlaca || String(r.vehicle_plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === cleanPlaca;
  });

  if (pendingOs) {
    if (isApproved && !hasFinalApprovalPrice(pendingOs)) {
      return { ok: false, erro: 'Este orçamento ainda não tem todos os preços definidos. A oficina precisa atualizar o valor antes da aprovação.' };
    }
    const nextDetails = {
      ...(pendingOs.details || {}),
      aprovacao: isApproved ? 'aprovado' : 'recusado',
      ...(isApproved ? { aprovado_em: today } : { recusado_em: today, motivo_recusa: motivo || null }),
      respondido_via: 'whatsapp',
    };
    const nextStatus = isApproved
      ? (pendingOs.status === 'novo' ? 'em_andamento' : pendingOs.status)
      : 'cancelado';

    const { data, error } = await supabase
      .from('work_orders')
      .update({ status: nextStatus, details: nextDetails })
      .eq('id', pendingOs.id)
      .eq('status', pendingOs.status)
      .eq('details', pendingOs.details || {})
      .select('id')
      .maybeSingle();

    if (error || !data) return { ok: false, erro: 'Este orçamento já recebeu uma resposta.' };

    logAction('Orçamento OS', `${pendingOs.reference} (${pendingOs.vehicle_plate || phone}) -> ${isApproved ? 'APROVADO' : 'RECUSADO'}`);
    await notifyOwner('quote', {
      nome: pendingOs.customer_name || phone,
      telefone: phone,
      placa: pendingOs.vehicle_plate || '—',
      servico: pendingOs.reference,
      valor: positiveAmount(pendingOs.total) ? moneyBR(pendingOs.total) : 'A definir',
      decisao: isApproved ? 'APROVADO ✅' : 'RECUSADO ❌',
      motivo: motivo || '',
    }, `🔔 *Resposta de Orçamento (OS)*\n` +
      `Cliente: ${pendingOs.customer_name || phone}\n` +
      `Veículo: ${pendingOs.vehicle_plate || '—'}\n` +
      `Serviço: ${pendingOs.reference}\n` +
      `Valor: ${positiveAmount(pendingOs.total) ? moneyBR(pendingOs.total) : 'A definir'}\n` +
      `Decisão: *${isApproved ? 'APROVADO ✅' : 'RECUSADO ❌'}*` +
      (motivo ? `\nMotivo: ${motivo}` : ''));

    return {
      ok: true,
      tipo: 'Ordem de Serviço',
      servico: pendingOs.reference,
      placa: pendingOs.vehicle_plate,
      valor: positiveAmount(pendingOs.total) ? moneyBR(pendingOs.total) : null,
      valor_definido: positiveAmount(pendingOs.total) !== null,
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
    if (!phoneMatchesVariations(r.phone, variations)) return false;
    return !cleanPlaca || String(r.vehicle_plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === cleanPlaca;
  });

  if (pendingQuote) {
    if (isApproved && !hasFinalApprovalPrice(pendingQuote)) {
      return { ok: false, erro: 'Este orçamento ainda não tem todos os preços definidos. A oficina precisa atualizar o valor antes da aprovação.' };
    }
    const nextDetails = {
      ...(pendingQuote.details || {}),
      aprovacao: isApproved ? 'aprovado' : 'recusado',
      ...(isApproved ? { aprovado_em: today } : { recusado_em: today, motivo_recusa: motivo || null }),
      respondido_via: 'whatsapp',
    };
    const nextStatus = isApproved ? 'concluido' : 'cancelado';

    const { data, error } = await supabase
      .from('quotes')
      .update({ status: nextStatus, details: nextDetails })
      .eq('id', pendingQuote.id)
      .eq('status', pendingQuote.status)
      .eq('details', pendingQuote.details || {})
      .select('id')
      .maybeSingle();

    if (error || !data) return { ok: false, erro: 'Este orçamento já recebeu uma resposta.' };

    logAction('Orçamento', `${pendingQuote.reference} (${pendingQuote.vehicle_plate || phone}) -> ${isApproved ? 'APROVADO' : 'RECUSADO'}`);
    await notifyOwner('quote', {
      nome: pendingQuote.customer_name || phone,
      telefone: phone,
      placa: pendingQuote.vehicle_plate || '—',
      servico: pendingQuote.reference,
      valor: positiveAmount(pendingQuote.total) ? moneyBR(pendingQuote.total) : 'A definir',
      decisao: isApproved ? 'APROVADO ✅' : 'RECUSADO ❌',
    }, `🔔 *Resposta de Orçamento*\n` +
      `Cliente: ${pendingQuote.customer_name || phone}\n` +
      `Veículo: ${pendingQuote.vehicle_plate || '—'}\n` +
      `Serviço: ${pendingQuote.reference}\n` +
      `Valor: ${positiveAmount(pendingQuote.total) ? moneyBR(pendingQuote.total) : 'A definir'}\n` +
      `Decisão: *${isApproved ? 'APROVADO ✅' : 'RECUSADO ❌'}*`);

    return {
      ok: true,
      tipo: 'Orçamento',
      servico: pendingQuote.reference,
      placa: pendingQuote.vehicle_plate,
      valor: positiveAmount(pendingQuote.total) ? moneyBR(pendingQuote.total) : null,
      valor_definido: positiveAmount(pendingQuote.total) !== null,
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
  await notifyOwner('appointment', {
    nome,
    telefone: phone,
    servico,
    data,
    hora: cleanHora,
    placa: placa ? String(placa).toUpperCase() : '—',
  }, `📅 *Novo Agendamento via WhatsApp*\n` +
    `Cliente: ${nome} (${phone})\n` +
    `Serviço: ${servico}\n` +
    `Data: ${data} (${cleanHora})` +
      (placa ? `\nPlaca: ${String(placa).toUpperCase()}` : ''));

  return { ok: true, id: created?.id, data, hora: cleanHora, servico, nome };
}

export async function verificarOficinaFechadaAgora() {
  try {
    const [{ data: horRow }, { data: botCfg }] = await Promise.all([
      supabase.from('workshop_settings').select('value').eq('key', 'horarios').maybeSingle(),
      supabase
        .from('whatsapp_bot_session')
        .select('automations_enabled,closed_auto_reply_enabled,closed_auto_reply_message')
        .eq('id', 'default')
        .maybeSingle(),
    ]);

    if (botCfg?.automations_enabled === false || botCfg?.closed_auto_reply_enabled === false) {
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
  await notifyOwner('human', {
    nome: context.nome || phone || 'Não identificado',
    telefone: phone || '—',
    motivo,
  }, `🙋 *Atendimento Humano Solicitado*\n` +
    `Cliente: ${context.nome || phone || 'Não identificado'}\n` +
    `Telefone: ${phone || '—'}\n` +
      `Motivo: ${motivo}`);
  return { ok: true, pausado_minutos: 120 };
}

export const ferramentasSchema = [
  {
    type: 'function',
    function: {
      name: 'listarServicos',
      description: 'Consulte o catálogo de serviços ativos somente se a pessoa pedir os serviços oferecidos ou perguntar o preço/valor de algum serviço. Não use para saudações, dúvidas gerais ou diagnóstico visual sem pedido de preço.',
      parameters: {
        type: 'object',
        properties: {
          categoria: { type: 'string', description: 'Filtro opcional de categoria (ex: Freios, Óleo, Revisão).' },
          nome_servico: { type: 'string', description: 'Nome do serviço perguntado, se informado.' },
          marca: { type: 'string', description: 'Marca do veículo para buscar uma tarifa específica.' },
          modelo: { type: 'string', description: 'Modelo do veículo para buscar uma tarifa específica.' },
          ano: { type: 'integer', description: 'Ano do veículo para buscar a tarifa correta.' },
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
      return listarServicos(args);
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
