-- Separate the worker's enabled state from WhatsApp account linking.
-- A fresh/unlinked worker stays idle until an owner explicitly requests a QR.
alter table public.whatsapp_bot_session
  add column if not exists bot_enabled boolean not null default true,
  add column if not exists qr_requested boolean not null default false;

alter table public.whatsapp_bot_session
  drop constraint if exists whatsapp_bot_session_status_check;

alter table public.whatsapp_bot_session
  add constraint whatsapp_bot_session_status_check
  check (status in ('connected', 'qr_ready', 'connecting', 'disconnected', 'qr_pending', 'stopped'));

notify pgrst, 'reload schema';
