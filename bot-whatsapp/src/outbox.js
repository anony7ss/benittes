import { supabase } from './supabase.js';
import { sendHumanizedMessage } from './queue.js';
import { logAction, logError, logInfo } from './terminal.js';
import { resolverJidWhatsApp } from './phone-utils.js';
import { registrarMensagemChat, pausarIaParaContato } from './web-sync.js';

let isProcessing = false;
let realtimeSubscription = null;
let pollInterval = null;
let currentSocket = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function automaticMessageEnabled(item, settings) {
  const kind = String(item.kind || "");
  if (kind.startsWith("2fa_") || kind === "direct") return true;
  if (settings?.automations_enabled === false) return false;
  if (kind === "quote" || kind === "os_quote") return settings?.auto_send_quotes !== false;
  if (kind === "reminder_appointment") return settings?.appointment_reminders_enabled === true;
  if (kind === "reminder_quote") return settings?.quote_followups_enabled === true;
  if (kind === "reminder_service") return settings?.service_followups_enabled === true;
  if (kind === "owner_human") return settings?.notify_on_human_transfer !== false;
  if (kind === "owner_quote") return settings?.notify_on_quote_response !== false;
  if (kind === "owner_appointment") return settings?.notify_on_appointment !== false;
  return true;
}

export async function processarOutboxPendente() {
  if (isProcessing || !currentSocket) return;
  isProcessing = true;

  try {
    const { data: pending, error } = await supabase
      .from('whatsapp_outbox')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(20);

    if (error || !pending?.length) return;

    const { data: settings, error: settingsError } = await supabase
      .from('whatsapp_bot_session')
      .select('automations_enabled,auto_send_quotes,appointment_reminders_enabled,quote_followups_enabled,service_followups_enabled,notify_on_human_transfer,notify_on_quote_response,notify_on_appointment')
      .eq('id', 'default')
      .maybeSingle();
    if (settingsError) {
      logError('Outbox', 'Não foi possível validar os controles de automação: ' + settingsError.message);
    }

    for (const item of pending) {
      if (!currentSocket) break;
      const canSendWithoutAutomationConfig = String(item.kind || '').startsWith('2fa_') || item.kind === 'direct';
      if (settingsError && !canSendWithoutAutomationConfig) continue;

      if (!automaticMessageEnabled(item, settings)) {
        await supabase
          .from('whatsapp_outbox')
          .update({ status: 'cancelled', error: 'Automação desativada nas configurações.' })
          .eq('id', item.id)
          .eq('status', 'pending');
        logInfo('Outbox', 'Envio automático ' + item.kind + ' cancelado porque foi desativado nas configurações.');
        continue;
      }

      const { data: claimed, error: claimErr } = await supabase
        .from('whatsapp_outbox')
        .update({ status: 'processing' })
        .eq('id', item.id)
        .eq('status', 'pending')
        .select('id');

      if (claimErr || !claimed?.length) continue;

      try {
        const isTwoFactorMessage = String(item.kind || '').startsWith('2fa_');
        const cleanDigits = String(item.phone || '').replace(/\D/g, '');
        const normalized = cleanDigits.length <= 11 && !cleanDigits.startsWith('55')
          ? `55${cleanDigits}`
          : cleanDigits;
        const jid = await resolverJidWhatsApp(currentSocket, normalized);

        if (!jid) {
          throw new Error(`Número inválido para WhatsApp: ${item.phone}`);
        }

        if (typeof currentSocket.assertSessions === 'function') {
          await currentSocket.assertSessions([jid], true).catch(() => {});
        }
        if (typeof currentSocket.presenceSubscribe === 'function') {
          await currentSocket.presenceSubscribe(jid).catch(() => {});
        }

        await sendHumanizedMessage(currentSocket, jid, item.message);
        await registrarMensagemChat({
          phone: normalized,
          direction: 'outgoing',
          senderName: 'Sistema (Direto)',
          body: isTwoFactorMessage ? '[código de verificação oculto]' : item.message,
        });

        if (!isTwoFactorMessage && item.kind === 'direct') {
          const { data: settings } = await supabase
            .from('whatsapp_bot_session')
            .select('human_reply_pause_minutes')
            .eq('id', 'default')
            .maybeSingle();
          const pauseMinutes = Number(settings?.human_reply_pause_minutes ?? 30);
          if (pauseMinutes > 0) {
            await pausarIaParaContato(normalized, pauseMinutes);
            logInfo('IA', `Pausa automática por ${pauseMinutes} min após mensagem manual para ${normalized}.`);
          }
        }

        await supabase
          .from('whatsapp_outbox')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            error: null,
            ...(isTwoFactorMessage ? { message: '[mensagem de verificação removida]' } : {}),
          })
          .eq('id', item.id);

        logAction('Outbox', `Enviado (${item.kind || 'direct'}) para ${normalized}`);
      } catch (err) {
        const retryCount = Number(item.retry_count || 0) + 1;
        await supabase
          .from('whatsapp_outbox')
          .update({
            status: retryCount >= 3 ? 'failed' : 'pending',
            retry_count: retryCount,
            error: err instanceof Error ? err.message : String(err),
          })
          .eq('id', item.id);

        logError('Outbox', `Falha ao enviar para ${item.phone}: ${err instanceof Error ? err.message : err}`);
      }

      await sleep(900);
    }
  } finally {
    isProcessing = false;
  }
}

export function iniciarProcessadorOutbox(socket) {
  currentSocket = socket;

  if (realtimeSubscription) {
    try { supabase.removeChannel(realtimeSubscription); } catch {}
  }
  if (pollInterval) clearInterval(pollInterval);

  realtimeSubscription = supabase
    .channel('whatsapp-outbox-watch')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'whatsapp_outbox' },
      () => {
        processarOutboxPendente().catch(() => {});
      },
    )
    .subscribe();

  pollInterval = setInterval(() => {
    processarOutboxPendente().catch(() => {});
  }, 6000);
  if (pollInterval.unref) pollInterval.unref();

  logInfo('Outbox', 'Processador de envios diretos (Orçamentos/OS e 2FA) ativo.');
  processarOutboxPendente().catch(() => {});
}
