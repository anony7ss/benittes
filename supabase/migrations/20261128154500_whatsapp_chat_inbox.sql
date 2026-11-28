-- Secure admin inbox for WhatsApp conversations and private chat media.

alter table public.whatsapp_messages
  add column if not exists status text not null default 'received',
  add column if not exists from_me boolean generated always as (direction = 'outgoing') stored,
  add column if not exists message_key text,
  add column if not exists media_url text,
  add column if not exists outbox_id uuid references public.whatsapp_outbox(id) on delete set null;

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_status_check,
  add constraint whatsapp_messages_status_check
    check (status in ('queued', 'sent', 'delivered', 'read', 'received', 'failed'));

create unique index if not exists whatsapp_messages_message_key_uidx
  on public.whatsapp_messages (message_key)
  where message_key is not null;

create unique index if not exists whatsapp_messages_outbox_id_uidx
  on public.whatsapp_messages (outbox_id)
  where outbox_id is not null;

create index if not exists whatsapp_messages_phone_created_id_idx
  on public.whatsapp_messages (phone, created_at desc, id desc);

alter table public.whatsapp_outbox
  add column if not exists ai_pause_minutes integer not null default 30,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.whatsapp_outbox
  drop constraint if exists whatsapp_outbox_ai_pause_minutes_check,
  add constraint whatsapp_outbox_ai_pause_minutes_check
    check (ai_pause_minutes between 0 and 43200);

alter table public.whatsapp_chat_control
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists internal_note text,
  add column if not exists last_read_at timestamptz;

alter table public.whatsapp_chat_control
  drop constraint if exists whatsapp_chat_control_internal_note_check,
  add constraint whatsapp_chat_control_internal_note_check
    check (internal_note is null or char_length(internal_note) <= 2000);

create index if not exists whatsapp_chat_control_archived_updated_idx
  on public.whatsapp_chat_control (is_archived, updated_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whatsapp-chat-media',
  'whatsapp-chat-media',
  false,
  16777216,
  array['image/jpeg','image/png','image/webp','image/gif','audio/ogg','audio/opus','audio/mpeg','audio/mp4','audio/x-m4a','audio/webm','video/mp4','video/webm']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Chat data is accessed only through server routes that enforce the panel
-- session and the dedicated `chat` permission. Bot workers use service_role.
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_chat_control enable row level security;
alter table public.whatsapp_outbox enable row level security;
revoke all on public.whatsapp_messages, public.whatsapp_chat_control, public.whatsapp_outbox from public, anon, authenticated;
grant all on public.whatsapp_messages, public.whatsapp_chat_control, public.whatsapp_outbox to service_role;

update public.panel_roles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{chat}',
  '{"read":true,"write":true}'::jsonb,
  true
), updated_at = now()
where role_key in ('manager', 'advisor');

notify pgrst, 'reload schema';
