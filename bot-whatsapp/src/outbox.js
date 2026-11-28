import { supabase } from './supabase.js';
import { sendHumanizedMedia, sendHumanizedMessage } from './queue.js';
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
  if (kind.startsWith("2fa_") || kind === "direct" || kind === "chat_manual") return true;
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
    const now = new Date();
    const nowIso = now.toISOString();
    const staleBefore = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const { data: recovered, error: recoveryError } = await supabase
      .from('whatsapp_outbox')
      .update({ status: 'pending', processing_at: null, next_attempt_at: nowIso, error: 'Envio retomado após interrupção do processador.' })
      .eq('status', 'processing')
      .or(`processing_at.is.null,processing_at.lt.${staleBefore}`)
      .select('id');
    if (recoveryError) {
      logError('Outbox', 'Não foi possível recuperar envios interrompidos: ' + recoveryError.message);
      return;
    }
    if (recovered?.length) logInfo('Outbox', `${recovered.length} envio(s) interrompido(s) retornaram à fila.`);

    const { data: pending, error } = await supabase
      .from('whatsapp_outbox')
      .select('*')
      .eq('status', 'pending')
      .lte('next_attempt_at', nowIso)
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
      const canSendWithoutAutomationConfig = String(item.kind || '').startsWith('2fa_') || item.kind === 'direct' || item.kind === 'chat_manual';
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
        .update({ status: 'processing', processing_at: new Date().toISOString(), last_attempt_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('status', 'pending')
        .lte('next_attempt_at', new Date().toISOString())
        .select('id');

      if (claimErr) {
        logError('Outbox', `Não foi possível reservar o envio ${item.id}: ${claimErr.message}`);
        continue;
      }
      if (!claimed?.length) continue;

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

        let sentMessage;
        let messageBody = String(item.message || '');
        let mediaPath = null;
        const mediaType = ['image', 'audio', 'video'].includes(String(item.media_type)) ? String(item.media_type) : null;
        if (mediaType && typeof item.media_url === 'string' && item.media_url.startsWith('storage://')) {
          mediaPath = item.media_url.slice('storage://'.length);
          if (!new RegExp(`^${normalized}/[0-9a-f-]{36}\\.(jpg|png|webp|gif|ogg|opus|mp3|m4a|webm|mp4)$`, 'i').test(mediaPath)) {
            throw new Error('O caminho do anexo não corresponde à conversa.');
          }
          const { data: file, error: mediaError } = await supabase.storage.from('whatsapp-chat-media').download(mediaPath);
          if (mediaError || !file) throw new Error('Não foi possível carregar o anexo para envio.');
          const mediaBuffer = Buffer.from(await file.arrayBuffer());
          const ext = mediaPath.split('.').at(-1)?.toLowerCase();
          const mediaMime = mediaType === 'image'
            ? ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' })[ext] || 'image/jpeg'
            : mediaType === 'video'
              ? (ext === 'webm' ? 'video/webm' : 'video/mp4')
              : ({ ogg: 'audio/ogg; codecs=opus', opus: 'audio/opus', mp3: 'audio/mpeg', m4a: 'audio/mp4', webm: 'audio/webm' })[ext] || 'audio/ogg; codecs=opus';
          sentMessage = await sendHumanizedMedia(currentSocket, jid, mediaBuffer, {
            mediaType,
            mimetype: mediaMime,
            caption: item.message || '',
            senderType: 'admin_manual',
            immediate: true,
            skipChatLog: true,
          });
          if (!messageBody) messageBody = mediaType === 'image' ? '[Imagem enviada]' : mediaType === 'audio' ? '🎤 Áudio enviado' : '[Vídeo enviado]';
        } else {
          sentMessage = await sendHumanizedMessage(currentSocket, jid, item.message, { senderType: 'admin_manual', skipChatLog: true });
        }
        await registrarMensagemChat({
          phone: normalized,
          direction: 'outgoing',
          senderName: isTwoFactorMessage ? 'Sistema' : 'Equipe',
          body: isTwoFactorMessage ? '[código de verificação oculto]' : messageBody,
          mediaType,
          mediaUrl: mediaPath,
          status: 'sent',
          messageKey: sentMessage?.key?.id || null,
          outboxId: item.id,
        });

        if (!isTwoFactorMessage && item.kind === 'chat_manual') {
          const pauseMinutes = Number.isInteger(Number(item.ai_pause_minutes)) ? Number(item.ai_pause_minutes) : 30;
          const paused = await pausarIaParaContato(normalized, pauseMinutes);
          if (paused === false) logError('IA', `A mensagem foi enviada, mas a pausa do bot não confirmou para ${normalized}.`);
          else logInfo('IA', `Pausa automática por ${pauseMinutes || 'tempo indeterminado'} após atendimento manual para ${normalized}.`);
        }

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

        const { error: sentUpdateError } = await supabase
          .from('whatsapp_outbox')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            processing_at: null,
            error: null,
            ...(isTwoFactorMessage ? { message: '[mensagem de verificação removida]' } : {}),
          })
          .eq('id', item.id)
          .eq('status', 'processing');

        if (sentUpdateError) {
          logError('Outbox', `Mensagem enviada, mas não foi possível registrar o estado de ${item.id}: ${sentUpdateError.message}`);
        }

        logAction('Outbox', `Enviado (${item.kind || 'direct'}) para ${normalized}`);
      } catch (err) {
        const retryCount = Number(item.retry_count || 0) + 1;
        const retryStatus = retryCount >= 6 ? 'failed' : 'pending';
        const delaySeconds = Math.min(60 * 60, 15 * (2 ** Math.min(retryCount - 1, 8)));
        const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
        const { error: retryUpdateError } = await supabase
          .from('whatsapp_outbox')
          .update({
            status: retryStatus,
            retry_count: retryCount,
            processing_at: null,
            next_attempt_at: nextAttemptAt,
            error: String(err instanceof Error ? err.message : err).slice(0, 1000),
          })
          .eq('id', item.id)
          .eq('status', 'processing');

        logError('Outbox', `Falha ao enviar para ${item.phone}: ${err instanceof Error ? err.message : err}`);
        if (retryUpdateError) logError('Outbox', `Não foi possível registrar a tentativa de ${item.id}: ${retryUpdateError.message}`);
        if (retryStatus === 'failed') {
          await supabase.from('whatsapp_messages').update({ status: 'failed' }).eq('outbox_id', item.id);
        }
      }

      await sleep(900);
    }
  } finally {
    isProcessing = false;
  }
}

export function iniciarProcessadorOutbox(socket) {
  currentSocket = socket;

  if (!socket) {
    if (realtimeSubscription) {
      try { supabase.removeChannel(realtimeSubscription); } catch {}
      realtimeSubscription = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    return;
  }

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
