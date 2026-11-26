-- Keep the existing enabled-content and owner/manager access while avoiding
-- overlapping authenticated SELECT policies for site_content.
drop policy if exists "site_content_authenticated_read" on public.site_content;
drop policy if exists "site_content_staff_read_all" on public.site_content;

create policy "site_content_staff_read_all"
  on public.site_content
  for select
  to authenticated
  using (
    enabled
    or (select private.has_role(array['owner'::text, 'manager'::text]))
    or (select private.can_access_module('settings'::text, false))
  );

-- Index the role foreign keys added by the configurable-roles migration.
create index if not exists panel_members_role_idx
  on public.panel_members (role);

create index if not exists panel_roles_created_by_idx
  on public.panel_roles (created_by);
