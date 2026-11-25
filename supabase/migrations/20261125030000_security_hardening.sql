-- Security hardening for the public website, panel and WhatsApp integrations.

-- Store only keyed hashes of rate-limit subjects; never persist IPs, emails or tokens.
create table if not exists private.api_rate_limits (
  scope text not null,
  subject_hash text not null,
  hit_count integer not null default 0,
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (scope, subject_hash),
  check (scope ~ '^[a-z0-9_-]{1,64}$'),
  check (subject_hash ~ '^[0-9a-f]{64}$'),
  check (hit_count >= 0)
);
alter table private.api_rate_limits enable row level security;
revoke all on table private.api_rate_limits from public, anon, authenticated, service_role;
create index if not exists api_rate_limits_expires_at_idx on private.api_rate_limits (expires_at);

create or replace function public.consume_api_rate_limit(
  p_scope text,
  p_subject_hash text,
  p_max_hits integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_time_value timestamptz := pg_catalog.clock_timestamp();
  current_count integer;
begin
  if p_scope is null or p_scope !~ '^[a-z0-9_-]{1,64}$'
     or p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$'
     or p_max_hits < 1 or p_max_hits > 1000
     or p_window_seconds < 10 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit parameters';
  end if;

  insert into private.api_rate_limits as limits (
    scope, subject_hash, hit_count, window_started_at, expires_at
  ) values (
    p_scope, p_subject_hash, 1, current_time_value,
    current_time_value + pg_catalog.make_interval(secs => p_window_seconds)
  )
  on conflict (scope, subject_hash) do update set
    hit_count = case when limits.expires_at <= current_time_value then 1 else limits.hit_count + 1 end,
    window_started_at = case when limits.expires_at <= current_time_value then current_time_value else limits.window_started_at end,
    expires_at = case when limits.expires_at <= current_time_value
      then current_time_value + pg_catalog.make_interval(secs => p_window_seconds)
      else limits.expires_at end
  returning hit_count into current_count;

  if pg_catalog.random() < 0.01 then
    delete from private.api_rate_limits where expires_at < current_time_value;
  end if;

  return current_count <= p_max_hits;
end;
$function$;
revoke all on function public.consume_api_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer) to service_role;

-- A browser can read only the one published identity record needed by the website.
drop policy if exists site_content_anon_read_published on public.site_content;
create policy site_content_anon_read_identity on public.site_content
  for select to anon using (enabled and key = 'identidade');

-- Contact submissions now go through the validated server route and service role.
drop policy if exists contact_messages_public_insert on public.contact_messages;
revoke insert on table public.contact_messages from anon;
revoke all on function private.contact_submission_allowed(text) from public, anon;
revoke usage on schema private from anon;

-- The WhatsApp tables are used only by the trusted bot and server routes. RLS alone
-- is insufficient because the REST roles had table-level grants, so remove both.
do $block$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'whatsapp_bot_session', 'whatsapp_logs', 'whatsapp_outbox',
    'whatsapp_chat_control', 'whatsapp_messages', 'whatsapp_lid_mapping'
  ] loop
    policy_name := table_name || '_staff';
    execute pg_catalog.format('drop policy if exists %I on public.%I', policy_name, table_name);
    execute pg_catalog.format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute pg_catalog.format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$block$;

-- Authenticated clients never need OTP hashes, codes, expirations or login tokens.
alter table public.panel_members
  add column if not exists two_factor_code_hash text,
  add column if not exists two_factor_temp_token_expires_at timestamptz,
  add column if not exists two_factor_pending_phone text;
revoke all on table public.panel_members from public, anon, authenticated;
grant select (user_id, email, full_name, role, active, created_at, updated_at, phone, two_factor_enabled)
  on table public.panel_members to authenticated;
grant insert (user_id, email, full_name, role, active, phone, two_factor_enabled)
  on table public.panel_members to authenticated;
grant update (email, full_name, role, active, phone, two_factor_enabled)
  on table public.panel_members to authenticated;
grant delete on table public.panel_members to authenticated;
grant all on table public.panel_members to service_role;

-- Harden application-owned SECURITY DEFINER functions against search-path shadowing.
alter function private.has_role(text[]) set search_path = '';
alter function private.can_access_module(text, boolean) set search_path = '';
alter function private.can_access_contacts(boolean) set search_path = '';
alter function private.write_audit_log() set search_path = '';
alter function private.contact_submission_allowed(text) set search_path = '';
revoke all on function private.has_role(text[]) from public, anon;
revoke all on function private.can_access_module(text, boolean) from public, anon;
revoke all on function private.can_access_contacts(boolean) from public, anon;
revoke all on function private.write_audit_log() from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on function private.has_role(text[]) to authenticated, service_role;
grant execute on function private.can_access_module(text, boolean) to authenticated, service_role;
grant execute on function private.can_access_contacts(boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
