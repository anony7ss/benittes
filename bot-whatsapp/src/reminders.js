import { supabase } from './supabase.js';
import config from './config.js';
import { logError, logInfo, logReminder, updateStatus } from './terminal.js';

const TICK_MS = 60_000;
let timer = null;
let running = false;

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(date);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
}

function applyTemplate(template, values) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = values[key];
    return value === null || value === undefined ? '' : String(value);
  }).trim();
}

function phoneForOutbox(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length <= 11 && !digits.startsWith('55') ? `55${digits}` : digits;
}

async function enqueueOnce({ key, phone, message, kind, relatedId }) {
  const cleanPhone = phoneForOutbox(phone);
  if (!cleanPhone || !message) return false;
  const { data, error } = await supabase.from('whatsapp_outbox').upsert({
    phone: cleanPhone,
    message,
    kind,
    related_id: relatedId,
    dedupe_key: key,
    status: 'pending',
  }, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id');
  if (error) throw error;
  return Boolean(data?.length);
}

async function processAppointments(settings, now) {
  if (!settings.appointment_reminders_enabled) return;
  const leadMs = Number(settings.appointment_reminder_minutes || 1440) * 60_000;
  const dueLimit = new Date(now.getTime() + leadMs).toISOString();
  const { data, error } = await supabase.from('appointments')
    .select('id,title,service_type,customer_name,contact_phone,vehicle_plate,starts_at,status')
    .in('status', ['novo', 'em_andamento', 'aguardando', 'scheduled'])
    .not('contact_phone', 'is', null)
    .gte('starts_at', now.toISOString())
    .lte('starts_at', dueLimit)
    .order('starts_at', { ascending: true })
    .limit(200);
  if (error) throw error;

  for (const appointment of data || []) {
    const start = new Date(appointment.starts_at);
    if (start.getTime() - leadMs > now.getTime()) continue;
    const message = applyTemplate(settings.appointment_reminder_message, {
      nome: appointment.customer_name || 'cliente',
      oficina: config.workshopName,
      data: formatDate(appointment.starts_at),
      hora: formatTime(appointment.starts_at),
      servico: appointment.service_type || appointment.title || 'serviço agendado',
      placa: appointment.vehicle_plate || '',
      link: '',
    });
    if (await enqueueOnce({
      key: `appointment_reminder:${appointment.id}`,
      phone: appointment.contact_phone,
      message,
      kind: 'reminder_appointment',
      relatedId: appointment.id,
    })) logReminder(appointment.customer_name, 'agendamento', appointment.title, formatTime(appointment.starts_at));
  }
}

async function processQuoteFollowups(settings, now) {
  if (!settings.quote_followups_enabled) return;
  const dueBefore = new Date(now.getTime() - Number(settings.quote_followup_hours || 24) * 3_600_000).toISOString();
  const { data, error } = await supabase.from('quotes')
    .select('id,reference,customer_name,phone,vehicle_plate,total,details,created_at,status')
    .eq('status', 'aguardando')
    .not('phone', 'is', null)
    .lte('created_at', dueBefore)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;

  for (const quote of data || []) {
    const approval = String(quote.details?.aprovacao || 'pendente').toLowerCase();
    if (['aprovado', 'recusado', 'cancelado'].includes(approval)) continue;
    const token = String(quote.details?.public_token || '').trim();
    const link = token && config.publicSiteUrl
      ? `${config.publicSiteUrl.replace(/\/$/, '')}/orcamento/${encodeURIComponent(token)}`
      : '';
    const message = applyTemplate(settings.quote_followup_message, {
      nome: quote.customer_name || 'cliente',
      oficina: config.workshopName,
      servico: quote.reference || 'orçamento',
      placa: quote.vehicle_plate || '',
      valor: formatMoney(quote.total),
      data: formatDate(quote.created_at),
      link,
    });
    if (await enqueueOnce({
      key: `quote_followup:${quote.id}`,
      phone: quote.phone,
      message,
      kind: 'reminder_quote',
      relatedId: quote.id,
    })) logReminder(quote.customer_name, 'orçamento pendente', quote.reference, '');
  }
}

async function processServiceFollowups(settings, now) {
  if (!settings.service_followups_enabled) return;
  const dueBefore = new Date(now.getTime() - Number(settings.service_followup_days || 90) * 86_400_000).toISOString();
  const { data, error } = await supabase.from('work_orders')
    .select('id,reference,customer_name,phone,vehicle_plate,updated_at,status')
    .eq('status', 'concluido')
    .not('phone', 'is', null)
    .lte('updated_at', dueBefore)
    .order('updated_at', { ascending: true })
    .limit(200);
  if (error) throw error;

  for (const order of data || []) {
    const message = applyTemplate(settings.service_followup_message, {
      nome: order.customer_name || 'cliente',
      oficina: config.workshopName,
      servico: order.reference || 'serviço realizado',
      placa: order.vehicle_plate || '',
      data: formatDate(order.updated_at),
      link: '',
    });
    if (await enqueueOnce({
      key: `service_followup:${order.id}`,
      phone: order.phone,
      message,
      kind: 'reminder_service',
      relatedId: order.id,
    })) logReminder(order.customer_name, 'revisão', order.reference, '');
  }
}

export async function processarLembretes() {
  if (running) return;
  running = true;
  try {
    const { data: settings, error } = await supabase.from('whatsapp_bot_session')
      .select('automations_enabled,appointment_reminders_enabled,appointment_reminder_minutes,appointment_reminder_message,quote_followups_enabled,quote_followup_hours,quote_followup_message,service_followups_enabled,service_followup_days,service_followup_message')
      .eq('id', 'default')
      .maybeSingle();
    if (error) throw error;
    if (!settings || settings.automations_enabled === false) {
      updateStatus('reminders', 'Pausado');
      return;
    }

    const active = settings.appointment_reminders_enabled || settings.quote_followups_enabled || settings.service_followups_enabled;
    updateStatus('reminders', active ? 'Ativo' : 'Pausado');
    if (!active) return;

    const now = new Date();
    await processAppointments(settings, now);
    await processQuoteFollowups(settings, now);
    await processServiceFollowups(settings, now);
  } catch (error) {
    updateStatus('reminders', 'Erro de configuração');
    logError('Lembretes', error instanceof Error ? error.message : String(error));
  } finally {
    running = false;
  }
}

export function iniciarProcessadorLembretes() {
  if (timer) clearInterval(timer);
  logInfo('Lembretes', 'Agendador automático iniciado; cada lembrete usa chave para evitar duplicidade.');
  processarLembretes().catch(() => {});
  timer = setInterval(() => processarLembretes().catch(() => {}), TICK_MS);
  if (timer.unref) timer.unref();
}
