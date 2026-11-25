-- WhatsApp Bot & 2FA tables for Benittes Oficina

create table if not exists public.whatsapp_bot_session (
  id text primary key default 'default',
  status text not null default 'disconnected' check (status in ('connected', 'qr_ready', 'connecting', 'disconnected')),
  qr_code text,
  phone_connected text,
  profile_name text,
  ai_mode text not null default 'opencode',
  ai_model text,
  ai_enabled boolean not null default true,
  auto_send_quotes boolean not null default true,
  owner_phone text,
  notify_on_human_transfer boolean not null default true,
  notify_on_quote_response boolean not null default true,
  audio_mode text not null default 'direct_request' check (audio_mode in ('direct_request', 'mirror', 'always', 'disabled')),
  audio_voice text not null default 'pt-BR-FranciscaNeural',
  last_heartbeat timestamptz,
  action_requested text,
  updated_at timestamptz not null default now()
);

insert into public.whatsapp_bot_session (id, status)
values ('default', 'disconnected')
on conflict (id) do nothing;

create table if not exists public.whatsapp_logs (
  id uuid primary key default gen_random_uuid(),
  level text not null default 'info',
  tag text not null default 'Sistema',
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_whatsapp_logs_created on public.whatsapp_logs (created_at desc);

create table if not exists public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  message text not null,
  media_url text,
  media_type text,
  kind text not null default 'direct',
  related_id uuid,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  retry_count integer not null default 0,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_whatsapp_outbox_status_created on public.whatsapp_outbox (status, created_at asc);

create table if not exists public.whatsapp_chat_control (
  phone text primary key,
  ai_paused boolean not null default false,
  ai_paused_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  direction text not null check (direction in ('incoming', 'outgoing')),
  sender_name text,
  body text not null,
  media_type text,
  created_at timestamptz not null default now()
);
create index if not exists idx_whatsapp_messages_phone_created on public.whatsapp_messages (phone, created_at desc);

create table if not exists public.whatsapp_lid_mapping (
  lid text primary key,
  phone text not null,
  updated_at timestamptz not null default now()
);

-- 2FA columns on panel_members
alter table public.panel_members
  add column if not exists phone text,
  add column if not exists two_factor_enabled boolean not null default false,
  add column if not exists two_factor_code text,
  add column if not exists two_factor_expires_at timestamptz,
  add column if not exists two_factor_temp_token text;

-- Enable RLS on all bot tables
alter table public.whatsapp_bot_session enable row level security;
alter table public.whatsapp_logs enable row level security;
alter table public.whatsapp_outbox enable row level security;
alter table public.whatsapp_chat_control enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_lid_mapping enable row level security;

-- Policies for authenticated panel members (owner / manager)
drop policy if exists "whatsapp_bot_session_staff" on public.whatsapp_bot_session;
create policy "whatsapp_bot_session_staff" on public.whatsapp_bot_session
  for all to authenticated
  using (exists (select 1 from public.panel_members m where m.user_id = auth.uid() and m.active))
  with check (exists (select 1 from public.panel_members m where m.user_id = auth.uid() and m.active and m.role in ('owner', 'manager')));

drop policy if exists "whatsapp_logs_staff" on public.whatsapp_logs;
create policy "whatsapp_logs_staff" on public.whatsapp_logs
  for all to authenticated
  using (exists (select 1 from public.panel_members m where m.user_id = auth.uid() and m.active))
  with check (exists (select 1 from public.panel_members m where m.user_id = auth.uid() and m.active));

drop policy if exists "whatsapp_outbox_staff" on public.whatsapp_outbox;
create policy "whatsapp_outbox_staff" on public.whatsapp_outbox
  for all to authenticated
  using (exists (select 1 from public.panel_members m where m.user_id = auth.uid() and m.active))
  with check (exists (select 1 from public.panel_members m where m.user_id = auth.uid() and m.active));

drop policy if exists "whatsapp_chat_control_staff" on public.whatsapp_chat_control;
create policy "whatsapp_chat_control_staff" on public.whatsapp_chat_control
  for all to authenticated
  using (exists (select 1 from public.panel_members m where m.user_id = auth.uid() and m.active))
  with check (exists (select 1 from public.panel_members m where m.user_id = auth.uid() and m.active));

drop policy if exists "whatsapp_messages_staff" on public.whatsapp_messages;
create policy "whatsapp_messages_staff" on public.whatsapp_messages
  for all to authenticated
  using (exists (select 1 from public.panel_members m where m.user_id = auth.uid() and m.active))
  with check (exists (select 1 from public.panel_members m where m.user_id = auth.uid() and m.active));

drop policy if exists "whatsapp_lid_mapping_staff" on public.whatsapp_lid_mapping;
create policy "whatsapp_lid_mapping_staff" on public.whatsapp_lid_mapping
  for all to authenticated
  using (exists (select 1 from public.panel_members m where m.user_id = auth.uid() and m.active))
  with check (exists (select 1 from public.panel_members m where m.user_id = auth.uid() and m.active));

notify pgrst, 'reload schema';
