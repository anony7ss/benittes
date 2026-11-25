alter table public.whatsapp_bot_session
  add column if not exists ai_paused_phones text[] not null default '{}';

alter table public.whatsapp_bot_session
  add constraint whatsapp_bot_session_ai_paused_phones_check
  check (
    cardinality(ai_paused_phones) <= 200
    and array_position(ai_paused_phones, null) is null
    and array_position(ai_paused_phones, '') is null
  );
