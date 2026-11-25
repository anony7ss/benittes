-- Normalized workshop data model for Benittes. Additive migration: preserves the
-- existing owner, contact inbox, site content, audit trail, and legacy rows.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  email text check (email is null or (char_length(email) <= 254 and email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  phone text check (phone is null or char_length(phone) <= 32),
  tax_document text check (tax_document is null or char_length(tax_document) <= 24),
  birth_date date,
  preferred_channel text check (preferred_channel is null or preferred_channel in ('whatsapp','email','phone','in_person')),
  notes text check (notes is null or char_length(notes) <= 4000),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  license_plate text not null check (char_length(btrim(license_plate)) between 3 and 12),
  make text,
  model text not null check (char_length(btrim(model)) between 1 and 120),
  trim text,
  model_year smallint check (model_year is null or model_year between 1900 and 2200),
  mileage integer check (mileage is null or mileage >= 0),
  vin text check (vin is null or char_length(vin) <= 32),
  fuel_type text,
  notes text check (notes is null or char_length(notes) <= 4000),
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vehicles_license_plate_unique on public.vehicles (upper(regexp_replace(license_plate, '[^A-Za-z0-9]', '', 'g')));

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  category text,
  description text check (description is null or char_length(description) <= 4000),
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 10000),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_price_rules (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.services(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  vehicle_application text,
  price numeric(12,2) not null check (price >= 0),
  valid_from date,
  valid_until date,
  notes text check (notes is null or char_length(notes) <= 4000),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table if not exists public.service_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  description text check (description is null or char_length(description) <= 4000),
  price numeric(12,2) not null default 0 check (price >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.service_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.service_packages(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_name text not null,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 180),
  service_type text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  contact_phone text,
  notes text check (notes is null or char_length(notes) <= 4000),
  status text not null default 'scheduled',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  reference text not null check (char_length(btrim(reference)) between 1 and 80),
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  valid_until date,
  payment_terms text,
  notes text check (notes is null or char_length(notes) <= 4000),
  adjustment_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0 check (total >= 0),
  status text not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  description text not null check (char_length(btrim(description)) between 1 and 240),
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  line_total numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at timestamptz not null default now()
);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null check (char_length(btrim(reference)) between 1 and 80),
  quote_id uuid references public.quotes(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  scheduled_for timestamptz,
  odometer integer check (odometer is null or odometer >= 0),
  diagnosis text check (diagnosis is null or char_length(diagnosis) <= 8000),
  notes text check (notes is null or char_length(notes) <= 8000),
  total numeric(12,2) not null default 0 check (total >= 0),
  status text not null default 'open',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.work_order_items (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  description text not null check (char_length(btrim(description)) between 1 and 240),
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  line_total numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored,
  status text not null default 'pending',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.inspections (
  id uuid primary key default gen_random_uuid(),
  reference text not null check (char_length(btrim(reference)) between 1 and 100),
  work_order_id uuid references public.work_orders(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  inspected_at timestamptz not null default now(),
  result text not null default 'pending',
  notes text check (notes is null or char_length(notes) <= 8000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  category text,
  item text not null check (char_length(btrim(item)) between 1 and 240),
  result text not null default 'not_checked',
  notes text,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  description text not null check (char_length(btrim(description)) between 1 and 240),
  direction text not null check (direction in ('receivable','payable')),
  category text,
  party_name text,
  client_id uuid references public.clients(id) on delete set null,
  supplier_id uuid,
  due_at date,
  paid_at date,
  amount numeric(12,2) not null check (amount >= 0),
  payment_method text,
  notes text check (notes is null or char_length(notes) <= 4000),
  status text not null default 'open',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_amount numeric(12,2) not null default 0 check (opening_amount >= 0),
  closing_amount numeric(12,2) check (closing_amount is null or closing_amount >= 0),
  expected_amount numeric(12,2) check (expected_amount is null or expected_amount >= 0),
  notes text,
  status text not null default 'open',
  opened_by uuid references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 180),
  sku text,
  category text,
  quantity numeric(12,2) not null default 0 check (quantity >= 0),
  minimum_quantity numeric(12,2) not null default 0 check (minimum_quantity >= 0),
  unit text not null default 'un',
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  sale_price numeric(12,2) not null default 0 check (sale_price >= 0),
  location text,
  notes text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists inventory_items_sku_unique on public.inventory_items (upper(sku)) where sku is not null and btrim(sku) <> '';

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (char_length(btrim(legal_name)) between 1 and 180),
  trade_name text,
  tax_document text,
  email text,
  phone text,
  contact_name text,
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  notes text,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.finance_entries
  add constraint finance_entries_supplier_id_fkey foreign key (supplier_id) references public.suppliers(id) on delete set null;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null check (char_length(btrim(reference)) between 1 and 100),
  supplier_id uuid references public.suppliers(id) on delete set null,
  ordered_at date not null default current_date,
  expected_at date,
  received_at date,
  total numeric(12,2) not null default 0 check (total >= 0),
  notes text,
  status text not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  reference text not null check (char_length(btrim(reference)) between 1 and 100),
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  sold_at timestamptz not null default now(),
  payment_method text,
  total numeric(12,2) not null default 0 check (total >= 0),
  notes text,
  status text not null default 'completed',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  panel_user_id uuid references auth.users(id) on delete set null,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 160),
  position text,
  email text,
  phone text,
  hired_at date,
  notes text,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.warranties (
  id uuid primary key default gen_random_uuid(),
  reference text not null check (char_length(btrim(reference)) between 1 and 140),
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  starts_at date,
  expires_at date,
  description text,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fleets (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (char_length(btrim(legal_name)) between 1 and 180),
  tax_document text,
  contact_name text,
  email text,
  phone text,
  vehicle_count integer not null default 0 check (vehicle_count >= 0),
  notes text,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_interactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  subject text not null check (char_length(btrim(subject)) between 1 and 180),
  channel text,
  occurred_at timestamptz not null default now(),
  next_followup timestamptz,
  notes text,
  status text not null default 'open',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workshop_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  document_type text,
  related_type text,
  related_id uuid,
  file_name text,
  storage_path text,
  external_url text,
  notes text,
  status text not null default 'active',
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (external_url is null or external_url ~* '^https://')
);

create table if not exists public.panel_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  message text,
  audience text not null default 'all',
  due_at timestamptz,
  read_at timestamptz,
  status text not null default 'pending',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workshop_settings (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  scope text not null default 'general',
  value jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  description text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Access decisions are based on the private membership table, never on editable
-- auth metadata or a role supplied by the browser.
create or replace function private.can_access_module(module_name text, write_access boolean default false)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.panel_members member
    where member.user_id = (select auth.uid()) and member.active
      and case member.role
        when 'owner' then true
        when 'manager' then module_name not in ('users')
        when 'advisor' then module_name = any(array['contacts','clients','vehicles','services','prices','packages','quotes','work-orders','inspections','appointments','crm','documents','notifications'])
        when 'technician' then module_name = any(array['vehicles','work-orders','inspections','appointments','inventory','warranties'])
        when 'finance' then module_name = any(array['finance','cash-closing','purchases','suppliers','sales','reports','documents'])
        else false
      end
      and (not write_access or case member.role
        when 'owner' then true
        when 'manager' then module_name not in ('users')
        when 'advisor' then module_name = any(array['contacts','clients','vehicles','services','prices','packages','quotes','work-orders','inspections','appointments','crm','documents','notifications'])
        when 'technician' then module_name = any(array['work-orders','inspections','appointments','inventory'])
        when 'finance' then module_name = any(array['finance','cash-closing','purchases','suppliers','sales'])
        else false
      end)
  );
$$;
revoke all on function private.can_access_module(text, boolean) from public, anon;
grant execute on function private.can_access_module(text, boolean) to authenticated;

create index if not exists appointments_starts_at_idx on public.appointments(starts_at);
create index if not exists appointments_client_idx on public.appointments(client_id, starts_at desc);
create index if not exists quotes_client_idx on public.quotes(client_id, created_at desc);
create index if not exists work_orders_client_idx on public.work_orders(client_id, created_at desc);
create index if not exists work_orders_vehicle_idx on public.work_orders(vehicle_id, created_at desc);
create index if not exists inspections_vehicle_idx on public.inspections(vehicle_id, inspected_at desc);
create index if not exists finance_entries_due_idx on public.finance_entries(status, due_at);
create index if not exists cash_sessions_open_idx on public.cash_sessions(status, opened_at desc);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders(supplier_id, ordered_at desc);
create index if not exists sales_sold_at_idx on public.sales(sold_at desc);
create index if not exists warranties_expiry_idx on public.warranties(expires_at);
create index if not exists crm_interactions_followup_idx on public.crm_interactions(next_followup);

-- Every new domain table is private to authenticated staff and guarded both by
-- grants and role-aware RLS. The view-only report module has no direct table.
do $$
declare
  item record;
begin
  for item in select * from (values
    ('clients','clients'), ('vehicles','vehicles'), ('services','services'),
    ('service_price_rules','prices'), ('service_packages','packages'), ('service_package_items','packages'),
    ('appointments','appointments'), ('quotes','quotes'), ('quote_items','quotes'),
    ('work_orders','work-orders'), ('work_order_items','work-orders'),
    ('inspections','inspections'), ('inspection_items','inspections'),
    ('finance_entries','finance'), ('cash_sessions','cash-closing'),
    ('inventory_items','inventory'), ('suppliers','suppliers'),
    ('purchase_orders','purchases'), ('purchase_order_items','purchases'),
    ('sales','sales'), ('sale_items','sales'), ('employees','employees'),
    ('warranties','warranties'), ('fleets','fleets'), ('crm_interactions','crm'),
    ('workshop_documents','documents'), ('panel_notifications','notifications'),
    ('workshop_settings','settings')
  ) as modules(table_name,module_name)
  loop
    execute format('alter table public.%I enable row level security', item.table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', item.table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', item.table_name);
    execute format('drop policy if exists %I on public.%I', item.table_name || '_read', item.table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.can_access_module(%L,false)))', item.table_name || '_read', item.table_name, item.module_name);
    execute format('drop policy if exists %I on public.%I', item.table_name || '_insert', item.table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.can_access_module(%L,true)))', item.table_name || '_insert', item.table_name, item.module_name);
    execute format('drop policy if exists %I on public.%I', item.table_name || '_update', item.table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.can_access_module(%L,true))) with check ((select private.can_access_module(%L,true)))', item.table_name || '_update', item.table_name, item.module_name, item.module_name);
    execute format('drop policy if exists %I on public.%I', item.table_name || '_delete', item.table_name);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.can_access_module(%L,true)))', item.table_name || '_delete', item.table_name, item.module_name);
    execute format('drop trigger if exists %I on public.%I', item.table_name || '_touch_updated_at', item.table_name);
    if item.table_name not in ('workshop_settings','service_package_items','quote_items','work_order_items','inspection_items','purchase_order_items','sale_items') then
      execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()', item.table_name || '_touch_updated_at', item.table_name);
    end if;
    execute format('drop trigger if exists %I on public.%I', item.table_name || '_audit', item.table_name);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.write_audit_log()', item.table_name || '_audit', item.table_name);
  end loop;
end;
$$;

-- Give the audit trail useful module names and labels for normalized records.
create or replace function private.write_audit_log()
returns trigger
language plpgsql security definer
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
    when 'service_price_rules' then 'precos'
    when 'service_packages' then 'pacotes'
    when 'service_package_items' then 'pacotes'
    when 'quote_items' then 'orcamentos'
    when 'work_order_items' then 'ordens-de-servico'
    when 'inspection_items' then 'inspecoes'
    when 'finance_entries' then 'financeiro'
    when 'cash_sessions' then 'fechamento-de-caixa'
    when 'inventory_items' then 'estoque'
    when 'purchase_orders' then 'compras'
    when 'purchase_order_items' then 'compras'
    when 'sale_items' then 'vendas'
    when 'crm_interactions' then 'crm'
    when 'workshop_documents' then 'documentos'
    when 'panel_notifications' then 'notificacoes'
    when 'workshop_settings' then 'configuracoes'
    else coalesce(row_data->>'module', tg_table_name)
  end;
  row_id := coalesce(row_data->>'id', row_data->>'key', row_data->>'user_id');
  row_title := left(coalesce(row_data->>'title', row_data->>'name', row_data->>'full_name', row_data->>'reference', row_data->>'license_plate', row_data->>'description', row_data->>'email'), 180);
  select member.email into actor_email_value from public.panel_members member where member.user_id = (select auth.uid()) and member.active;
  insert into public.audit_logs(actor_user_id, actor_email, action, module, record_id, record_title)
  values ((select auth.uid()), actor_email_value, lower(tg_op), audit_module, row_id, row_title);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.write_audit_log() from public, anon, authenticated;

