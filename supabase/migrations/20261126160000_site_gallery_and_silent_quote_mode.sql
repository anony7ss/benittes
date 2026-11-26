-- Configurable public gallery and a non-conversational WhatsApp response mode.

alter table public.whatsapp_bot_session
  add column if not exists response_mode text not null default 'conversational';

alter table public.whatsapp_bot_session
  drop constraint if exists whatsapp_bot_session_response_mode_check,
  add constraint whatsapp_bot_session_response_mode_check
    check (response_mode in ('conversational', 'quote_only'));

create table if not exists public.site_gallery_media (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  alt_text text not null default '' check (char_length(alt_text) <= 240),
  caption text not null default '' check (char_length(caption) <= 500),
  media_type text not null check (media_type in ('image', 'video')),
  mime_type text not null,
  asset_source text not null default 'storage' check (asset_source in ('local', 'storage')),
  storage_path text unique,
  local_path text,
  status text not null default 'uploading' check (status in ('uploading', 'published')),
  is_published boolean not null default false,
  show_on_home boolean not null default false,
  gallery_order integer not null default 0 check (gallery_order >= 0),
  home_order integer not null default 0 check (home_order >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_gallery_media_source_path_check check (
    (asset_source = 'storage' and storage_path is not null and local_path is null)
    or
    (asset_source = 'local' and storage_path is null and local_path ~ '^/media/[A-Za-z0-9_-]+-1536\.webp$')
  ),
  constraint site_gallery_media_home_images_only check (not show_on_home or media_type = 'image')
);

create index if not exists site_gallery_media_public_order_idx
  on public.site_gallery_media (gallery_order, created_at)
  where is_published and status = 'published';

create index if not exists site_gallery_media_home_order_idx
  on public.site_gallery_media (home_order, created_at)
  where is_published and status = 'published' and show_on_home and media_type = 'image';

alter table public.site_gallery_media enable row level security;
revoke all on table public.site_gallery_media from public, anon, authenticated;
grant all on table public.site_gallery_media to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-gallery',
  'site-gallery',
  true,
  52428800,
  array['image/webp', 'video/mp4', 'video/webm', 'video/quicktime']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Register the three existing local photos so their public visibility and order
-- are manageable from the new gallery screen without moving or replacing files.
insert into public.site_gallery_media (
  id, title, alt_text, caption, media_type, mime_type, asset_source, local_path,
  status, is_published, show_on_home, gallery_order, home_order
)
values
  ('00000000-0000-4000-8000-000000000001', 'Correia dentada', 'Correia dentada e componentes do sistema de distribuição expostos durante inspeção', 'Inspeção de componentes do sistema de distribuição.', 'image', 'image/webp', 'local', '/media/bloco-1536.webp', 'published', true, true, 1, 3),
  ('00000000-0000-4000-8000-000000000002', 'Cabeçote em inspeção', 'Cabeçote aberto no cofre do motor, com o eixo de comando exposto para inspeção', 'Uma visão próxima dos componentes internos do motor.', 'image', 'image/webp', 'local', '/media/bancada-1536.webp', 'published', true, true, 2, 1),
  ('00000000-0000-4000-8000-000000000003', 'Diagnóstico no cofre', 'Automóvel clássico em uma oficina com o capô aberto para avaliação mecânica', 'Avaliação do conjunto mecânico com o veículo na oficina.', 'image', 'image/webp', 'local', '/media/cofre-1536.webp', 'published', true, true, 3, 2)
on conflict (id) do nothing;

-- Existing managers can manage site media; other roles remain unchanged unless
-- the owner explicitly grants them access in the role editor.
update public.panel_roles
set permissions = pg_catalog.jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{gallery}',
  '{"read":true,"write":true}'::jsonb,
  true
), updated_at = now()
where role_key = 'manager';

notify pgrst, 'reload schema';
