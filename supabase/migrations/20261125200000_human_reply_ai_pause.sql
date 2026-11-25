alter table public.whatsapp_bot_session
  add column if not exists human_reply_pause_minutes integer not null default 30
  check (human_reply_pause_minutes in (0, 15, 30, 60, 120, 240, 480, 1440));
