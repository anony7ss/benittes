-- Add details jsonb and denormalized display columns to dedicated domain tables
-- so every module saves in its own table while preserving all UI fields.

alter table public.clients add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.vehicles add column if not exists customer_name text;
alter table public.vehicles add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.services add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.appointments add column if not exists customer_name text;
alter table public.appointments add column if not exists vehicle_plate text;
alter table public.appointments add column if not exists amount numeric(12,2);
alter table public.appointments add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.quotes add column if not exists customer_name text;
alter table public.quotes add column if not exists phone text;
alter table public.quotes add column if not exists vehicle_plate text;
alter table public.quotes add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.work_orders add column if not exists customer_name text;
alter table public.work_orders add column if not exists phone text;
alter table public.work_orders add column if not exists vehicle_plate text;
alter table public.work_orders add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.inspections add column if not exists customer_name text;
alter table public.inspections add column if not exists phone text;
alter table public.inspections add column if not exists vehicle_plate text;
alter table public.inspections add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.finance_entries add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.inventory_items add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.sales add column if not exists customer_name text;
alter table public.sales add column if not exists phone text;
alter table public.sales add column if not exists vehicle_plate text;
alter table public.sales add column if not exists details jsonb not null default '{}'::jsonb;

-- Migrate existing rows from panel_records into their dedicated tables (idempotent)
insert into public.clients (id, full_name, email, phone, notes, active, created_by, created_at, updated_at, details)
select id, coalesce(nullif(btrim(customer_name), ''), title), customer_email, phone, description, (status <> 'cancelado'), created_by, created_at, updated_at, details
from public.panel_records where module = 'clients'
on conflict (id) do nothing;

insert into public.vehicles (id, license_plate, make, model, trim, fuel_type, notes, status, customer_name, created_by, created_at, updated_at, details)
select id, coalesce(nullif(btrim(vehicle), ''), title), details->>'marca', coalesce(nullif(btrim(details->>'modelo'), ''), title), title, details->>'combustivel', description, status, customer_name, created_by, created_at, updated_at, details
from public.panel_records where module = 'vehicles'
on conflict do nothing;

insert into public.services (id, name, category, description, base_price, active, created_by, created_at, updated_at, details)
select id, title, details->>'categoria', description, coalesce(amount, 0), (status <> 'cancelado'), created_by, created_at, updated_at, details
from public.panel_records where module = 'services'
on conflict (id) do nothing;

insert into public.quotes (id, reference, notes, total, status, customer_name, phone, vehicle_plate, created_by, created_at, updated_at, details)
select id, title, description, coalesce(amount, 0), status, customer_name, phone, vehicle, created_by, created_at, updated_at, details
from public.panel_records where module = 'quotes'
on conflict (id) do nothing;

insert into public.work_orders (id, reference, notes, total, status, customer_name, phone, vehicle_plate, created_by, created_at, updated_at, details)
select id, title, description, coalesce(amount, 0), status, customer_name, phone, vehicle, created_by, created_at, updated_at, details
from public.panel_records where module = 'work-orders'
on conflict (id) do nothing;
