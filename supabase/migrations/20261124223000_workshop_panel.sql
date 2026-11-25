-- Benittes Oficina Mecânica: schema inicial para painel e mensagens públicas.
-- O navegador usa apenas a chave publishable; RLS e RPCs são a fronteira de segurança.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.panel_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  full_name text check (full_name is null or char_length(full_name) <= 120),
  role text not null check (role in ('owner', 'manager', 'advisor', 'technician', 'finance')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.panel_records (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in (
    'clients', 'vehicles', 'services', 'prices', 'packages', 'quotes',
    'work-orders', 'inspections', 'appointments', 'finance', 'cash-closing',
    'inventory', 'purchases', 'suppliers', 'sales', 'employees', 'warranties',
    'fleets', 'crm', 'reports', 'documents', 'notifications', 'settings'
  )),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  status text not null default 'novo' check (status in ('novo', 'em_andamento', 'aguardando', 'concluido', 'cancelado')),
  description text check (description is null or char_length(description) <= 4000),
  amount numeric(12,2) check (amount is null or amount >= 0),
  customer_name text check (customer_name is null or char_length(customer_name) <= 160),
  customer_email text check (customer_email is null or (char_length(customer_email) <= 254 and customer_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  phone text check (phone is null or char_length(phone) <= 32),
  vehicle text check (vehicle is null or char_length(vehicle) <= 180),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  email text not null check (char_length(email) between 3 and 254 and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  message text not null check (char_length(btrim(message)) between 10 and 2000),
  status text not null default 'new' check (status in ('new', 'read', 'replied', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_content (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  value jsonb not null check (jsonb_typeof(value) = 'object'),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  module text not null,
  record_id text,
  record_title text,
  created_at timestamptz not null default now()
);

create index if not exists panel_records_module_created_idx on public.panel_records(module, created_at desc);
create index if not exists panel_records_status_idx on public.panel_records(module, status);
create index if not exists contact_messages_created_idx on public.contact_messages(created_at desc);
create index if not exists contact_messages_email_created_idx on public.contact_messages(lower(email), created_at desc);
create index if not exists contact_messages_status_idx on public.contact_messages(status, created_at desc);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

create or replace function private.has_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.panel_members as member
    where member.user_id = (select auth.uid())
      and member.active
      and member.role = any(required_roles)
  );
$$;

create or replace function private.can_access_module(module_name text, write_access boolean default false)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.panel_members as member
    where member.user_id = (select auth.uid())
      and member.active
      and case member.role
        when 'owner' then true
        when 'manager' then true
        when 'advisor' then module_name = any(array['clients','vehicles','services','prices','packages','quotes','work-orders','inspections','appointments','crm','documents','notifications'])
        when 'technician' then module_name = any(array['vehicles','work-orders','inspections','appointments','inventory','warranties'])
        when 'finance' then module_name = any(array['finance','cash-closing','purchases','suppliers','sales','reports','documents'])
        else false
      end
      and (not write_access or member.role <> '')
  );
$$;

create or replace function private.can_access_contacts(write_access boolean default false)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select private.has_role(array['owner','manager','advisor']);
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  row_data jsonb;
  row_id text;
  row_title text;
  audit_module text;
  actor_email_value text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  audit_module := case tg_table_name
    when 'contact_messages' then 'contatos'
    when 'site_content' then 'site'
    when 'panel_members' then 'usuarios'
    else coalesce(row_data->>'module', tg_table_name)
  end;
  row_id := coalesce(row_data->>'id', row_data->>'key', row_data->>'user_id');
  row_title := coalesce(row_data->>'title', row_data->>'name', row_data->>'key', row_data->>'email');
  select member.email into actor_email_value
  from public.panel_members as member
  where member.user_id = (select auth.uid()) and member.active;
  insert into public.audit_logs(actor_user_id, actor_email, action, module, record_id, record_title)
  values ((select auth.uid()), actor_email_value, lower(tg_op), audit_module, row_id, left(row_title, 180));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.submit_contact(p_name text, p_email text, p_message text, p_website text default '')
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_message text := btrim(coalesce(p_message, ''));
  created_message_id uuid;
  recent_count integer;
begin
  -- Honeypot: reply as if accepted without retaining automated submissions.
  if char_length(btrim(coalesce(p_website, ''))) > 0 then
    return null;
  end if;
  if char_length(normalized_name) < 2 or char_length(normalized_name) > 100 then
    raise exception using errcode = '22023', message = 'Informe um nome entre 2 e 100 caracteres.';
  end if;
  if char_length(normalized_email) < 3 or char_length(normalized_email) > 254
    or normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Informe um e-mail válido.';
  end if;
  if char_length(normalized_message) < 10 or char_length(normalized_message) > 2000 then
    raise exception using errcode = '22023', message = 'A mensagem precisa ter entre 10 e 2000 caracteres.';
  end if;

  select count(*) into recent_count
  from public.contact_messages
  where lower(email) = normalized_email
    and created_at > now() - interval '15 minutes';
  if recent_count >= 3 then
    raise exception using errcode = 'P0001', message = 'Muitas mensagens recentes. Tente novamente mais tarde.';
  end if;

  insert into public.contact_messages(name, email, message)
  values (normalized_name, normalized_email, normalized_message)
  returning id into created_message_id;
  return created_message_id;
end;
$$;

revoke all on function private.has_role(text[]) from public, anon;
revoke all on function private.can_access_module(text, boolean) from public, anon;
revoke all on function private.can_access_contacts(boolean) from public, anon;
revoke all on function private.touch_updated_at() from public, anon, authenticated;
revoke all on function private.write_audit_log() from public, anon, authenticated;
grant execute on function private.has_role(text[]) to authenticated;
grant execute on function private.can_access_module(text, boolean) to authenticated;
grant execute on function private.can_access_contacts(boolean) to authenticated;
revoke all on function public.submit_contact(text, text, text, text) from public, authenticated;
grant execute on function public.submit_contact(text, text, text, text) to anon, authenticated;

drop trigger if exists panel_members_touch_updated_at on public.panel_members;
create trigger panel_members_touch_updated_at before update on public.panel_members for each row execute function private.touch_updated_at();
drop trigger if exists panel_records_touch_updated_at on public.panel_records;
create trigger panel_records_touch_updated_at before update on public.panel_records for each row execute function private.touch_updated_at();
drop trigger if exists contact_messages_touch_updated_at on public.contact_messages;
create trigger contact_messages_touch_updated_at before update on public.contact_messages for each row execute function private.touch_updated_at();
drop trigger if exists site_content_touch_updated_at on public.site_content;
create trigger site_content_touch_updated_at before update on public.site_content for each row execute function private.touch_updated_at();

drop trigger if exists panel_records_audit on public.panel_records;
create trigger panel_records_audit after insert or update or delete on public.panel_records for each row execute function private.write_audit_log();
drop trigger if exists contact_messages_audit on public.contact_messages;
create trigger contact_messages_audit after insert or update or delete on public.contact_messages for each row execute function private.write_audit_log();
drop trigger if exists site_content_audit on public.site_content;
create trigger site_content_audit after insert or update or delete on public.site_content for each row execute function private.write_audit_log();
drop trigger if exists panel_members_audit on public.panel_members;
create trigger panel_members_audit after insert or update or delete on public.panel_members for each row execute function private.write_audit_log();

alter table public.panel_members enable row level security;
alter table public.panel_records enable row level security;
alter table public.contact_messages enable row level security;
alter table public.site_content enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.panel_members, public.panel_records, public.contact_messages, public.site_content, public.audit_logs from public, anon, authenticated;
grant select, insert, update, delete on public.panel_members to authenticated;
grant select, insert, update, delete on public.panel_records to authenticated;
grant select, update, delete on public.contact_messages to authenticated;
grant select, insert, update, delete on public.site_content to authenticated;
grant select on public.site_content to anon;
grant select on public.audit_logs to authenticated;

drop policy if exists "panel_members_read_self_or_owner" on public.panel_members;
create policy "panel_members_read_self_or_owner" on public.panel_members
for select to authenticated
using (user_id = (select auth.uid()) or (select private.has_role(array['owner'])));
drop policy if exists "panel_members_owner_insert" on public.panel_members;
create policy "panel_members_owner_insert" on public.panel_members
for insert to authenticated with check ((select private.has_role(array['owner'])));
drop policy if exists "panel_members_owner_update" on public.panel_members;
create policy "panel_members_owner_update" on public.panel_members
for update to authenticated using ((select private.has_role(array['owner']))) with check ((select private.has_role(array['owner'])));
drop policy if exists "panel_members_owner_delete" on public.panel_members;
create policy "panel_members_owner_delete" on public.panel_members
for delete to authenticated using ((select private.has_role(array['owner'])));

drop policy if exists "panel_records_role_read" on public.panel_records;
create policy "panel_records_role_read" on public.panel_records
for select to authenticated using ((select private.can_access_module(module, false)));
drop policy if exists "panel_records_role_insert" on public.panel_records;
create policy "panel_records_role_insert" on public.panel_records
for insert to authenticated with check (
  (select private.can_access_module(module, true))
  and (created_by is null or created_by = (select auth.uid()))
);
drop policy if exists "panel_records_role_update" on public.panel_records;
create policy "panel_records_role_update" on public.panel_records
for update to authenticated
using ((select private.can_access_module(module, true)))
with check ((select private.can_access_module(module, true)));
drop policy if exists "panel_records_role_delete" on public.panel_records;
create policy "panel_records_role_delete" on public.panel_records
for delete to authenticated using ((select private.can_access_module(module, true)));

drop policy if exists "contact_messages_staff_read" on public.contact_messages;
create policy "contact_messages_staff_read" on public.contact_messages
for select to authenticated using ((select private.can_access_contacts(false)));
drop policy if exists "contact_messages_staff_update" on public.contact_messages;
create policy "contact_messages_staff_update" on public.contact_messages
for update to authenticated using ((select private.can_access_contacts(true))) with check ((select private.can_access_contacts(true)));
drop policy if exists "contact_messages_staff_delete" on public.contact_messages;
create policy "contact_messages_staff_delete" on public.contact_messages
for delete to authenticated using ((select private.can_access_contacts(true)));

drop policy if exists "site_content_public_read" on public.site_content;
create policy "site_content_public_read" on public.site_content
for select to anon, authenticated using (enabled);
drop policy if exists "site_content_owner_read_all" on public.site_content;
create policy "site_content_owner_read_all" on public.site_content
for select to authenticated using ((select private.has_role(array['owner','manager'])));
drop policy if exists "site_content_manager_insert" on public.site_content;
create policy "site_content_manager_insert" on public.site_content
for insert to authenticated with check ((select private.has_role(array['owner','manager'])));
drop policy if exists "site_content_manager_update" on public.site_content;
create policy "site_content_manager_update" on public.site_content
for update to authenticated using ((select private.has_role(array['owner','manager']))) with check ((select private.has_role(array['owner','manager'])));
drop policy if exists "site_content_manager_delete" on public.site_content;
create policy "site_content_manager_delete" on public.site_content
for delete to authenticated using ((select private.has_role(array['owner','manager'])));

drop policy if exists "audit_logs_manager_read" on public.audit_logs;
create policy "audit_logs_manager_read" on public.audit_logs
for select to authenticated using ((select private.has_role(array['owner','manager'])));

insert into public.site_content(key, value, enabled)
values (
  'identidade',
  '{"nome":"Benittes Oficina Mecânica","logo":"/benittes-logo.png","whatsapp":"","email":"","instagram":"","corPrincipal":"#174b88"}'::jsonb,
  true
), (
  'guias',
  $json${"itens":[{"slug":"diagnostico","nome":"Diagnóstico automotivo","resumo":"Do sintoma à investigação da causa.","icone":"engine","contexto":"Uma luz no painel, uma falha intermitente ou uma partida mais demorada são pistas. O histórico do veículo ajuda a orientar a avaliação antes de qualquer decisão sobre peças.","observar":["Em que momento a falha aparece?","Qual luz ou mensagem apareceu no painel?","Houve alguma intervenção recente?"]},{"slug":"manutencao-preventiva","nome":"Manutenção preventiva","resumo":"Tempo, quilometragem e histórico de revisão.","icone":"wrench","contexto":"O plano de manutenção do fabricante considera tanto o tempo quanto a distância percorrida. Consultar o manual e os registros das últimas revisões ajuda a identificar o que precisa de atenção.","observar":["Qual é a quilometragem atual?","Quando foi feita a última revisão?","Quais itens já foram substituídos?"]},{"slug":"freios","nome":"Sistema de freios","resumo":"Pedal, discos, pastilhas e sinais de desgaste.","icone":"disc","contexto":"Mudanças na resposta do pedal, vibrações e ruídos durante a frenagem merecem avaliação. Relate o que percebeu sem tentar reproduzir uma situação de risco.","observar":["O pedal mudou de curso ou resistência?","Em qual condição surgiu o ruído?","Alguma luz de advertência acendeu?"]},{"slug":"suspensao-e-direcao","nome":"Suspensão e direção","resumo":"Estabilidade e contato com o piso.","icone":"steering-wheel","contexto":"Puxadas para um lado, batidas em irregularidades e desgaste desigual dos pneus podem ter diferentes origens. As condições da via e o histórico de impactos ajudam a descrever o comportamento.","observar":["Em que tipo de piso percebeu o sintoma?","O volante vibra ou fica desalinhado?","Houve impacto recente em buraco ou guia?"]}]}
  $json$::jsonb,
  true
), (
  'fotos',
  $json${"itens":[{"id":"bloco","nome":"Bloco do motor","detalhe":"O conjunto mecânico visto de perto.","alt":"Detalhe lateral de um motor desmontado na bancada"},{"id":"bancada","nome":"Trabalho de bancada","detalhe":"A escala do trabalho manual.","alt":"Mãos com luvas trabalhando no cabeçote de um motor"},{"id":"cofre","nome":"Sob o capô","detalhe":"Uma vista do compartimento do motor.","alt":"Capô aberto sobre o compartimento do motor na oficina"}]}
  $json$::jsonb,
  true
), (
  'perguntas',
  $json${"itens":[["Quais dados do veículo devo separar?","Modelo, ano, quilometragem e histórico recente de manutenção. Se houver um sintoma, anote quando ele começou e em quais condições aparece."],["Como confirmar se um serviço está disponível?","Os guias apresentam temas de manutenção. A disponibilidade para cada modelo e tipo de reparo deve ser confirmada diretamente com a oficina."],["Consigo agendar pelo site?","O agendamento online ainda não está disponível. Consulte a página de contato para ver os canais divulgados pela Benittes."],["Como é definido o valor de um reparo?","O orçamento depende do veículo, da avaliação e das peças e horas de trabalho necessárias. Confirme o escopo e as condições com a oficina antes de autorizar o serviço."]]}
  $json$::jsonb,
  true
)
on conflict (key) do nothing;
