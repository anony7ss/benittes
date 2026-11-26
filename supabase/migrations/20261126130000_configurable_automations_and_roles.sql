-- Configurable WhatsApp reminders/messages and owner-managed custom roles.

alter table public.whatsapp_bot_session
  add column if not exists automations_enabled boolean not null default false,
  add column if not exists notify_on_appointment boolean not null default false,
  add column if not exists appointment_reminders_enabled boolean not null default false,
  add column if not exists appointment_reminder_minutes integer not null default 1440,
  add column if not exists appointment_reminder_message text not null default 'Olá, {{nome}}! Passando para lembrar do seu horário na {{oficina}} em {{data}} às {{hora}}. Serviço: {{servico}}. Se precisar alterar, fale com a equipe.',
  add column if not exists quote_followups_enabled boolean not null default false,
  add column if not exists quote_followup_hours integer not null default 24,
  add column if not exists quote_followup_message text not null default 'Olá, {{nome}}! O orçamento {{servico}} da {{oficina}} ainda está aguardando sua resposta. Você pode consultar os detalhes por aqui: {{link}}',
  add column if not exists service_followups_enabled boolean not null default false,
  add column if not exists service_followup_days integer not null default 90,
  add column if not exists service_followup_message text not null default 'Olá, {{nome}}! Já faz um tempo desde o serviço {{servico}} do veículo {{placa}}. Se estiver na hora da próxima revisão, a equipe da {{oficina}} pode ajudar.',
  add column if not exists auto_quote_message_template text not null default 'Olá, {{nome}}! Aqui é da {{oficina}}. Preparamos o orçamento {{servico}} para {{veiculo}} no valor de {{valor}}. Você aprova a execução? Responda Aprovar ou Recusar.',
  add column if not exists owner_human_alert_message text not null default '🙋 *Atendimento humano solicitado*\nCliente: {{nome}}\nTelefone: {{telefone}}\nMotivo: {{motivo}}',
  add column if not exists owner_quote_alert_message text not null default '🔔 *Resposta de orçamento*\nCliente: {{nome}}\nVeículo: {{placa}}\nServiço: {{servico}}\nValor: {{valor}}\nDecisão: {{decisao}}',
  add column if not exists owner_appointment_alert_message text not null default '📅 *Novo agendamento via WhatsApp*\nCliente: {{nome}} ({{telefone}})\nServiço: {{servico}}\nData: {{data}} às {{hora}}\nPlaca: {{placa}}';

alter table public.whatsapp_bot_session
  drop constraint if exists whatsapp_bot_session_appointment_reminder_minutes_check,
  add constraint whatsapp_bot_session_appointment_reminder_minutes_check check (appointment_reminder_minutes between 15 and 10080),
  drop constraint if exists whatsapp_bot_session_quote_followup_hours_check,
  add constraint whatsapp_bot_session_quote_followup_hours_check check (quote_followup_hours between 1 and 720),
  drop constraint if exists whatsapp_bot_session_service_followup_days_check,
  add constraint whatsapp_bot_session_service_followup_days_check check (service_followup_days between 1 and 3650);

alter table public.whatsapp_outbox
  add column if not exists dedupe_key text;

alter table public.whatsapp_outbox
  drop constraint if exists whatsapp_outbox_status_check,
  add constraint whatsapp_outbox_status_check check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled'));

create unique index if not exists whatsapp_outbox_dedupe_key_idx
  on public.whatsapp_outbox (dedupe_key);

create table if not exists public.panel_roles (
  role_key text primary key check (role_key ~ '^[a-z][a-z0-9_-]{0,49}$'),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  is_system boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists panel_roles_name_lower_idx on public.panel_roles (lower(name));

insert into public.panel_roles (role_key, name, permissions, is_system)
values
  ('owner', 'Proprietário', '{"*":{"read":true,"write":true}}'::jsonb, true),
  ('manager', 'Gerente', '{"dashboard":{"read":true,"write":false},"appointments":{"read":true,"write":true},"work-orders":{"read":true,"write":true},"quotes":{"read":true,"write":true},"inspections":{"read":true,"write":true},"clients":{"read":true,"write":true},"vehicles":{"read":true,"write":true},"services":{"read":true,"write":true},"prices":{"read":true,"write":true},"packages":{"read":true,"write":true},"inventory":{"read":true,"write":true},"purchases":{"read":true,"write":true},"suppliers":{"read":true,"write":true},"finance":{"read":true,"write":true},"cash-closing":{"read":true,"write":true},"sales":{"read":true,"write":true},"reports":{"read":true,"write":false},"contacts":{"read":true,"write":true},"crm":{"read":true,"write":true},"documents":{"read":true,"write":true},"notifications":{"read":true,"write":true},"employees":{"read":true,"write":true},"warranties":{"read":true,"write":true},"fleets":{"read":true,"write":true},"settings":{"read":true,"write":true},"bot":{"read":true,"write":true},"ponto":{"read":true,"write":true},"account":{"read":true,"write":true},"audit":{"read":true,"write":false}}'::jsonb, true),
  ('advisor', 'Consultor', '{"dashboard":{"read":true,"write":false},"account":{"read":true,"write":false},"ponto":{"read":true,"write":true},"contacts":{"read":true,"write":true},"appointments":{"read":true,"write":true},"work-orders":{"read":true,"write":true},"quotes":{"read":true,"write":true},"inspections":{"read":true,"write":true},"clients":{"read":true,"write":true},"vehicles":{"read":true,"write":true},"services":{"read":true,"write":true},"prices":{"read":true,"write":true},"packages":{"read":true,"write":true},"crm":{"read":true,"write":true},"documents":{"read":true,"write":true},"notifications":{"read":true,"write":true}}'::jsonb, true),
  ('technician', 'Técnico', '{"dashboard":{"read":true,"write":false},"account":{"read":true,"write":false},"ponto":{"read":true,"write":true},"vehicles":{"read":true,"write":true},"work-orders":{"read":true,"write":true},"inspections":{"read":true,"write":true},"appointments":{"read":true,"write":true},"inventory":{"read":true,"write":true},"warranties":{"read":true,"write":true}}'::jsonb, true),
  ('finance', 'Financeiro', '{"dashboard":{"read":true,"write":false},"account":{"read":true,"write":false},"ponto":{"read":true,"write":true},"finance":{"read":true,"write":true},"cash-closing":{"read":true,"write":true},"purchases":{"read":true,"write":true},"suppliers":{"read":true,"write":true},"sales":{"read":true,"write":true},"reports":{"read":true,"write":false},"documents":{"read":true,"write":true}}'::jsonb, true)
on conflict (role_key) do nothing;

alter table public.panel_members drop constraint if exists panel_members_role_check;
alter table public.panel_members drop constraint if exists panel_members_role_fkey;
alter table public.panel_members
  add constraint panel_members_role_fkey foreign key (role) references public.panel_roles(role_key) on update cascade on delete restrict;

alter table public.panel_roles enable row level security;
revoke all on public.panel_roles from public, anon, authenticated;
grant select, insert, update, delete on public.panel_roles to authenticated;
grant all on public.panel_roles to service_role;
drop policy if exists panel_roles_active_read on public.panel_roles;
create policy panel_roles_active_read on public.panel_roles
  for select to authenticated
  using (exists (select 1 from public.panel_members m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists panel_roles_owner_insert on public.panel_roles;
create policy panel_roles_owner_insert on public.panel_roles
  for insert to authenticated with check ((select private.has_role(array['owner'])));
drop policy if exists panel_roles_owner_update on public.panel_roles;
create policy panel_roles_owner_update on public.panel_roles
  for update to authenticated using ((select private.has_role(array['owner']))) with check ((select private.has_role(array['owner'])));
drop policy if exists panel_roles_owner_delete on public.panel_roles;
create policy panel_roles_owner_delete on public.panel_roles
  for delete to authenticated using ((select private.has_role(array['owner'])) and not is_system and role_key <> 'owner');

create or replace function private.can_access_module(module_name text, write_access boolean default false)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.panel_members member
    join public.panel_roles role_config on role_config.role_key = member.role
    where member.user_id = (select auth.uid())
      and member.active
      and (
        member.role = 'owner'
        or coalesce(role_config.permissions -> '*' ->> case when write_access then 'write' else 'read' end, 'false') = 'true'
        or coalesce(role_config.permissions -> module_name ->> case when write_access then 'write' else 'read' end, 'false') = 'true'
        or (
          not write_access
          and module_name = any(array['work-orders','quotes','appointments','clients','vehicles','finance','sales','inventory'])
          and coalesce(role_config.permissions -> 'reports' ->> 'read', 'false') = 'true'
        )
      )
  );
$$;

create or replace function private.can_access_contacts(write_access boolean default false)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select private.can_access_module('contacts', write_access);
$$;

alter function private.can_access_module(text, boolean) set search_path = '';
alter function private.can_access_contacts(boolean) set search_path = '';
revoke all on function private.can_access_module(text, boolean) from public, anon;
revoke all on function private.can_access_contacts(boolean) from public, anon;
grant execute on function private.can_access_module(text, boolean) to authenticated, service_role;
grant execute on function private.can_access_contacts(boolean) to authenticated, service_role;

drop policy if exists workshop_settings_read on public.workshop_settings;
drop policy if exists workshop_settings_insert on public.workshop_settings;
drop policy if exists workshop_settings_update on public.workshop_settings;
drop policy if exists workshop_settings_delete on public.workshop_settings;
create policy workshop_settings_read on public.workshop_settings
  for select to authenticated using (
    (key like 'ponto-%' and (select private.can_access_module('ponto', false)))
    or (key not like 'ponto-%' and (select private.can_access_module('settings', false)))
  );
create policy workshop_settings_insert on public.workshop_settings
  for insert to authenticated with check (
    (key like 'ponto-%' and (select private.can_access_module('ponto', true)))
    or (key not like 'ponto-%' and (select private.can_access_module('settings', true)))
  );
create policy workshop_settings_update on public.workshop_settings
  for update to authenticated
  using (
    (key like 'ponto-%' and (select private.can_access_module('ponto', true)))
    or (key not like 'ponto-%' and (select private.can_access_module('settings', true)))
  )
  with check (
    (key like 'ponto-%' and (select private.can_access_module('ponto', true)))
    or (key not like 'ponto-%' and (select private.can_access_module('settings', true)))
  );
create policy workshop_settings_delete on public.workshop_settings
  for delete to authenticated using (
    (key like 'ponto-%' and (select private.can_access_module('ponto', true)))
    or (key not like 'ponto-%' and (select private.can_access_module('settings', true)))
  );

drop policy if exists "site_content_owner_read_all" on public.site_content;
drop policy if exists "site_content_manager_insert" on public.site_content;
drop policy if exists "site_content_manager_update" on public.site_content;
drop policy if exists "site_content_manager_delete" on public.site_content;
create policy site_content_staff_read_all on public.site_content
  for select to authenticated using ((select private.can_access_module('settings', false)));
create policy site_content_staff_insert on public.site_content
  for insert to authenticated with check ((select private.can_access_module('settings', true)));
create policy site_content_staff_update on public.site_content
  for update to authenticated using ((select private.can_access_module('settings', true))) with check ((select private.can_access_module('settings', true)));
create policy site_content_staff_delete on public.site_content
  for delete to authenticated using ((select private.can_access_module('settings', true)));

drop policy if exists "audit_logs_manager_read" on public.audit_logs;
create policy audit_logs_permission_read on public.audit_logs
  for select to authenticated using (
    (select private.can_access_module('audit', false))
    or (select private.can_access_module('account', false) and (select private.has_role(array['owner','manager'])))
  );

drop trigger if exists panel_roles_touch_updated_at on public.panel_roles;
create trigger panel_roles_touch_updated_at before update on public.panel_roles
  for each row execute function private.touch_updated_at();
drop trigger if exists panel_roles_audit on public.panel_roles;
create trigger panel_roles_audit after insert or update or delete on public.panel_roles
  for each row execute function private.write_audit_log();

notify pgrst, 'reload schema';
