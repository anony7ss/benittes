-- Public submissions use table INSERT + RLS. The rate-limit helper stays in
-- the non-exposed private schema and is only called while the policy runs.
drop function if exists public.submit_contact(text, text, text, text);

create index if not exists audit_logs_actor_user_idx on public.audit_logs(actor_user_id);
create index if not exists panel_records_created_by_idx on public.panel_records(created_by);
create index if not exists site_content_updated_by_idx on public.site_content(updated_by);

create or replace function private.contact_submission_allowed(candidate_email text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select char_length(candidate_email) between 3 and 254
    and candidate_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and (
      select count(*) < 3
      from public.contact_messages
      where lower(email) = lower(btrim(candidate_email))
        and created_at > now() - interval '15 minutes'
    );
$$;

revoke all on function private.contact_submission_allowed(text) from public, authenticated;
grant usage on schema private to anon;
grant execute on function private.contact_submission_allowed(text) to anon;
grant insert on public.contact_messages to anon;

drop policy if exists "contact_messages_public_insert" on public.contact_messages;
create policy "contact_messages_public_insert" on public.contact_messages
for insert to anon
with check ((select private.contact_submission_allowed(email)));

drop policy if exists "site_content_public_read" on public.site_content;
drop policy if exists "site_content_owner_read_all" on public.site_content;
create policy "site_content_anon_read_published" on public.site_content
for select to anon using (enabled);
create policy "site_content_authenticated_read" on public.site_content
for select to authenticated using (enabled or (select private.has_role(array['owner','manager'])));
