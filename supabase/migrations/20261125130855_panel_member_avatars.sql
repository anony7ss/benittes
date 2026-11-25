create table public.panel_member_avatars (
  user_id uuid primary key references public.panel_members(user_id) on delete cascade,
  photo text check (octet_length(photo) <= 65536 and photo ~ '^data:image/jpeg;base64,/9j/[A-Za-z0-9+/]*={0,2}$')
);
alter table public.panel_member_avatars enable row level security;
revoke all on public.panel_member_avatars from public, anon, authenticated;
grant select, insert, update on public.panel_member_avatars to service_role;
