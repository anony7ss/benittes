-- Private, server-mediated AI agents for the staff panel.
-- The browser never receives direct table access or the service-role key.

create table if not exists public.panel_agent_profiles (
  agent_key text primary key check (agent_key in ('gabriel', 'nathalia', 'caio', 'marina')),
  enabled boolean not null default true,
  objectives text[] not null default '{}',
  knowledge text[] not null default '{}',
  agreements text[] not null default '{}',
  memories text[] not null default '{}',
  alerts jsonb not null default '[]'::jsonb check (jsonb_typeof(alerts) = 'array'),
  routines jsonb not null default '[]'::jsonb check (jsonb_typeof(routines) = 'array'),
  revision integer not null default 0 check (revision >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.panel_agent_profiles (agent_key, objectives, knowledge, agreements)
values
  ('gabriel', array['Apoiar decisões sobre serviços, aplicação por veículo e estimativas internas.'], array['Catálogo de serviços e regras de preço cadastradas pela oficina.'], array['Nunca inventar preço nem alterar dados da oficina sem confirmação.']),
  ('nathalia', array['Organizar atendimento e agenda sem expor dados desnecessários.'], array['Agendamentos e serviços autorizados para a equipe.'], array['Não confirmar horário sem consultar a agenda.']),
  ('caio', array['Acompanhar execução das ordens de serviço e identificar pendências.'], array['Ordens de serviço, veículos e checklists autorizados.'], array['Não alterar ordem, status ou veículo sem ação explícita e confirmada.']),
  ('marina', array['Apresentar resumos financeiros objetivos e verificáveis.'], array['Indicadores agregados de contas e movimentos financeiros.'], array['Não expor dados financeiros individuais além do necessário.'])
on conflict (agent_key) do nothing;

create table if not exists public.panel_agent_conversations (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null references public.panel_agent_profiles(agent_key) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nova conversa' check (char_length(btrim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists panel_agent_conversations_owner_recent_idx
  on public.panel_agent_conversations (user_id, last_message_at desc);
create index if not exists panel_agent_conversations_agent_idx
  on public.panel_agent_conversations (agent_key, last_message_at desc);

create table if not exists public.panel_agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.panel_agent_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 12000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists panel_agent_messages_conversation_recent_idx
  on public.panel_agent_messages (conversation_id, created_at desc);

create table if not exists public.panel_agent_change_proposals (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.panel_agent_conversations(id) on delete cascade,
  agent_key text not null references public.panel_agent_profiles(agent_key) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  change_type text not null check (change_type in (
    'objective_add', 'objective_remove', 'agreement_add', 'agreement_remove',
    'memory_add', 'alert_add', 'alert_remove', 'routine_create', 'routine_remove', 'routine_set_enabled'
  )),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'applying', 'approved', 'rejected', 'expired')),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists panel_agent_proposals_conversation_idx
  on public.panel_agent_change_proposals (conversation_id, created_at);

create table if not exists public.panel_agent_routine_runs (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null,
  agent_key text not null references public.panel_agent_profiles(agent_key) on delete cascade,
  routine_name text not null check (char_length(btrim(routine_name)) between 1 and 120),
  run_date date not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  has_alert boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (routine_id, run_date)
);
create index if not exists panel_agent_routine_runs_recent_idx
  on public.panel_agent_routine_runs (agent_key, started_at desc);

alter table public.panel_agent_profiles enable row level security;
alter table public.panel_agent_conversations enable row level security;
alter table public.panel_agent_messages enable row level security;
alter table public.panel_agent_change_proposals enable row level security;
alter table public.panel_agent_routine_runs enable row level security;

revoke all on public.panel_agent_profiles, public.panel_agent_conversations,
  public.panel_agent_messages, public.panel_agent_change_proposals,
  public.panel_agent_routine_runs from public, anon, authenticated;
grant all on public.panel_agent_profiles, public.panel_agent_conversations,
  public.panel_agent_messages, public.panel_agent_change_proposals,
  public.panel_agent_routine_runs to service_role;

-- A private bucket for staff chat uploads. Signed URLs are short-lived; the
-- object paths are scoped to a staff user and conversation by the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agent-chat-private',
  'agent-chat-private',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/webm', 'audio/ogg', 'audio/opus', 'audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/wav', 'audio/x-wav'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The existing permission editor also manages access to the new module.
update public.panel_roles
set permissions = pg_catalog.jsonb_set(permissions, '{agents}', '{"read":true,"write":true}'::jsonb, true),
    updated_at = now()
where role_key in ('manager');

update public.panel_roles
set permissions = pg_catalog.jsonb_set(permissions, '{agents}', '{"read":true,"write":false}'::jsonb, true),
    updated_at = now()
where role_key in ('advisor', 'technician', 'finance');

notify pgrst, 'reload schema';
