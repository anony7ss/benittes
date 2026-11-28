-- Idempotent operational records and a ledger for every inventory quantity change.

create unique index if not exists work_orders_quote_id_unique
  on public.work_orders (quote_id)
  where quote_id is not null;

create unique index if not exists finance_entries_source_work_order_unique
  on public.finance_entries ((details ->> 'source_work_order_id'))
  where details ? 'source_work_order_id' and details ->> 'source_work_order_id' is not null;

create unique index if not exists sales_source_work_order_unique
  on public.sales ((details ->> 'source_work_order_id'))
  where details ? 'source_work_order_id' and details ->> 'source_work_order_id' is not null;

create unique index if not exists finance_entries_inventory_movement_unique
  on public.finance_entries ((details ->> 'source_inventory_movement_id'))
  where details ? 'source_inventory_movement_id' and details ->> 'source_inventory_movement_id' is not null;

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  source_type text not null check (source_type in ('purchase', 'work_order', 'adjustment')),
  source_id uuid not null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  quantity_delta numeric(12,2) not null check (quantity_delta <> 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  memo text check (memo is null or char_length(memo) <= 500),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_type, source_id, inventory_item_id)
);

create index if not exists inventory_movements_created_idx
  on public.inventory_movements (created_at desc);
create index if not exists inventory_movements_work_order_idx
  on public.inventory_movements (work_order_id, created_at desc)
  where work_order_id is not null;
create index if not exists inventory_movements_source_idx
  on public.inventory_movements (source_type, source_id);

alter table public.inventory_movements enable row level security;
revoke all on public.inventory_movements from public, anon, authenticated;
grant select on public.inventory_movements to authenticated;
grant all on public.inventory_movements to service_role;
drop policy if exists inventory_movements_read on public.inventory_movements;
create policy inventory_movements_read on public.inventory_movements
  for select to authenticated
  using ((select private.can_access_module('inventory', false)));

create table if not exists public.work_order_events (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid references public.work_orders(id) on delete set null,
  work_order_reference text not null,
  event_type text not null check (event_type in ('created', 'status_changed', 'updated', 'deleted')),
  summary text not null check (char_length(summary) between 1 and 240),
  from_status text,
  to_status text,
  total numeric(12,2),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists work_order_events_order_created_idx
  on public.work_order_events (work_order_id, created_at desc);
alter table public.work_order_events enable row level security;
revoke all on public.work_order_events from public, anon, authenticated;
grant select on public.work_order_events to authenticated;
grant all on public.work_order_events to service_role;
drop policy if exists work_order_events_read on public.work_order_events;
create policy work_order_events_read on public.work_order_events
  for select to authenticated
  using ((select private.can_access_module('work-orders', false)));

create or replace function private.capture_work_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.work_order_events (
      work_order_id, work_order_reference, event_type, summary, to_status, total, actor_user_id
    ) values (
      new.id, new.reference, 'created', 'Ordem de serviço criada', new.status, new.total, auth.uid()
    );
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.work_order_events (
      work_order_id, work_order_reference, event_type, summary, from_status, total, actor_user_id
    ) values (
      old.id, old.reference, 'deleted', 'Ordem de serviço excluída', old.status, old.total, auth.uid()
    );
    return old;
  elsif old.status is distinct from new.status then
    insert into public.work_order_events (
      work_order_id, work_order_reference, event_type, summary, from_status, to_status, total, actor_user_id
    ) values (
      new.id, new.reference, 'status_changed', 'Etapa da ordem de serviço alterada', old.status, new.status, new.total, auth.uid()
    );
  elsif old.reference is distinct from new.reference
     or old.total is distinct from new.total
     or old.notes is distinct from new.notes
     or old.diagnosis is distinct from new.diagnosis
     or old.details is distinct from new.details then
    insert into public.work_order_events (
      work_order_id, work_order_reference, event_type, summary, from_status, to_status, total, actor_user_id
    ) values (
      new.id, new.reference, 'updated', 'Dados da ordem de serviço atualizados', old.status, new.status, new.total, auth.uid()
    );
    return new;
  end if;
  return new;
end;
$$;
revoke all on function private.capture_work_order_event() from public, anon, authenticated;
drop trigger if exists work_orders_capture_event on public.work_orders;
create trigger work_orders_capture_event
  after insert or update or delete on public.work_orders
  for each row execute function private.capture_work_order_event();

-- A single trigger records opening balances, purchases, OS consumption, and manual adjustments.
create or replace function private.capture_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric(12,2);
  v_source_type text;
  v_source_id uuid;
  v_work_order_id uuid;
  v_unit_cost numeric(12,2);
  v_memo text;
begin
  if tg_op = 'INSERT' then
    v_delta := new.quantity;
  else
    v_delta := new.quantity - old.quantity;
  end if;
  if v_delta = 0 then return new; end if;

  v_source_type := coalesce(nullif(pg_catalog.current_setting('benittes.stock_source', true), ''), 'adjustment');
  if v_source_type not in ('purchase', 'work_order', 'adjustment') then
    v_source_type := 'adjustment';
  end if;
  v_source_id := nullif(pg_catalog.current_setting('benittes.stock_source_id', true), '')::uuid;
  if v_source_id is null then v_source_id := gen_random_uuid(); end if;
  v_work_order_id := nullif(pg_catalog.current_setting('benittes.stock_work_order_id', true), '')::uuid;
  v_unit_cost := coalesce(
    nullif(pg_catalog.current_setting('benittes.stock_unit_cost', true), '')::numeric,
    case when tg_op = 'UPDATE' then old.unit_cost else new.unit_cost end,
    0
  );
  v_memo := nullif(left(coalesce(pg_catalog.current_setting('benittes.stock_memo', true), ''), 500), '');
  if v_memo is null then
    v_memo := case when tg_op = 'INSERT' then 'Saldo inicial' else 'Ajuste manual de estoque' end;
  end if;

  insert into public.inventory_movements (
    inventory_item_id, source_type, source_id, work_order_id,
    quantity_delta, unit_cost, memo, actor_user_id
  ) values (
    new.id, v_source_type, v_source_id, v_work_order_id,
    v_delta, greatest(v_unit_cost, 0), v_memo, auth.uid()
  );
  return new;
end;
$$;
revoke all on function private.capture_inventory_movement() from public, anon, authenticated;
drop trigger if exists inventory_items_capture_movement on public.inventory_items;
create trigger inventory_items_capture_movement
  after insert or update of quantity on public.inventory_items
  for each row execute function private.capture_inventory_movement();

alter table public.whatsapp_outbox
  add column if not exists processing_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists last_attempt_at timestamptz;
create index if not exists whatsapp_outbox_pending_due_idx
  on public.whatsapp_outbox (status, next_attempt_at, created_at asc);

create or replace function public.finalize_work_order(p_work_order_id uuid, p_patch jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.work_orders%rowtype;
  v_old_status text;
  v_details jsonb;
  v_parts jsonb;
  v_part jsonb;
  v_item public.inventory_items%rowtype;
  v_item_id uuid;
  v_qty numeric(12,2);
  v_part_total numeric(12,2) := 0;
  v_amount numeric(12,2);
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_digits text;
  v_phone text;
  v_message text;
  v_cfg jsonb;
  v_finish_action text;
begin
  if auth.uid() is null or not private.can_access_module('work-orders', true) then
    raise exception using errcode = '42501', message = 'Acesso negado para concluir a ordem de serviço.';
  end if;
  if p_work_order_id is null or jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object'
     or pg_catalog.pg_column_size(coalesce(p_patch, '{}'::jsonb)) > 1048576 then
    raise exception using errcode = '22023', message = 'Dados da ordem de serviço inválidos.';
  end if;
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as patch_key(key)
    where key not in ('reference','customer_name','phone','vehicle_plate','total','notes','status','details')
  ) then
    raise exception using errcode = '22023', message = 'A atualização contém campos não permitidos.';
  end if;
  if p_patch ->> 'status' is distinct from 'concluido' then
    raise exception using errcode = '22023', message = 'A ordem precisa estar sendo concluída.';
  end if;

  select * into v_order from public.work_orders where id = p_work_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Ordem de serviço não encontrada.'; end if;
  v_old_status := v_order.status;
  v_details := case
    when p_patch ? 'details' and jsonb_typeof(p_patch -> 'details') = 'object' then p_patch -> 'details'
    else coalesce(v_order.details, '{}'::jsonb)
  end;
  begin
    v_amount := case when p_patch ? 'total' then (p_patch ->> 'total')::numeric else v_order.total end;
  exception when others then
    raise exception using errcode = '22023', message = 'O valor da ordem de serviço é inválido.';
  end;
  if v_amount is null or v_amount < 0 or v_amount > 10000000 then
    raise exception using errcode = '22023', message = 'O valor da ordem de serviço é inválido.';
  end if;

  v_parts := case when jsonb_typeof(v_details -> 'pecas') = 'array' then v_details -> 'pecas' else '[]'::jsonb end;
  if jsonb_array_length(v_parts) > 100 then
    raise exception using errcode = '22023', message = 'A ordem contém peças demais.';
  end if;
  for v_part in select value from jsonb_array_elements(v_parts)
  loop
    if jsonb_typeof(v_part) <> 'object'
       or coalesce(v_part ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'Uma peça da ordem não tem um identificador válido.';
    end if;
    begin
      v_qty := (v_part ->> 'quantidade')::numeric;
      if v_part ->> 'valor_unitario' is not null then
        if (v_part ->> 'valor_unitario')::numeric < 0 or (v_part ->> 'valor_unitario')::numeric > 1000000 then
          raise exception using errcode = '22023', message = 'O preço de uma peça é inválido.';
        end if;
        v_part_total := v_part_total + v_qty * (v_part ->> 'valor_unitario')::numeric;
      end if;
    exception when others then
      raise exception using errcode = '22023', message = 'A quantidade ou o preço de uma peça é inválido.';
    end;
    if v_qty <= 0 or v_qty > 10000 then
      raise exception using errcode = '22023', message = 'A quantidade de uma peça está fora do limite.';
    end if;
  end loop;
  if v_amount + 0.01 < v_part_total then
    raise exception using errcode = '22023', message = 'O total da OS não cobre os valores das peças.';
  end if;

  update public.work_orders set
    reference = case when p_patch ? 'reference' then left(btrim(p_patch ->> 'reference'), 80) else reference end,
    customer_name = case when p_patch ? 'customer_name' then nullif(left(btrim(p_patch ->> 'customer_name'), 160), '') else customer_name end,
    phone = case when p_patch ? 'phone' then nullif(left(btrim(p_patch ->> 'phone'), 32), '') else phone end,
    vehicle_plate = case when p_patch ? 'vehicle_plate' then nullif(left(btrim(p_patch ->> 'vehicle_plate'), 32), '') else vehicle_plate end,
    total = v_amount,
    notes = case when p_patch ? 'notes' then nullif(left(p_patch ->> 'notes', 8000), '') else notes end,
    details = v_details,
    status = 'concluido',
    updated_at = now()
  where id = p_work_order_id
  returning * into v_order;

  -- Lock each item and apply one ledger movement per item for this OS.
  if v_old_status is distinct from 'concluido' then
    for v_item_id, v_qty in
      select (value ->> 'id')::uuid, sum((value ->> 'quantidade')::numeric)
      from jsonb_array_elements(v_parts)
      group by (value ->> 'id')::uuid
    loop
      select * into v_item from public.inventory_items where id = v_item_id for update;
      if not found then
        raise exception using errcode = '22023', message = 'Uma peça selecionada não existe mais no estoque.';
      end if;
      if v_item.quantity < v_qty then
        raise exception using errcode = '22023', message = 'Estoque insuficiente para concluir esta ordem.';
      end if;
      if not exists (
        select 1 from public.inventory_movements
        where source_type = 'work_order' and source_id = v_order.id and inventory_item_id = v_item.id
      ) then
        perform pg_catalog.set_config('benittes.stock_source', 'work_order', true);
        perform pg_catalog.set_config('benittes.stock_source_id', v_order.id::text, true);
        perform pg_catalog.set_config('benittes.stock_work_order_id', v_order.id::text, true);
        perform pg_catalog.set_config('benittes.stock_unit_cost', coalesce(v_item.unit_cost, 0)::text, true);
        perform pg_catalog.set_config('benittes.stock_memo', left('Uso na OS ' || v_order.reference, 500), true);
        update public.inventory_items set quantity = quantity - v_qty, updated_at = now() where id = v_item.id;
      end if;
    end loop;
    v_details := v_details || jsonb_build_object('inventory_deducted', true);
  end if;

  if v_old_status is distinct from 'concluido' then
    if v_amount > 0 and not exists (
      select 1 from public.finance_entries where details ->> 'source_work_order_id' = v_order.id::text
    ) then
      insert into public.finance_entries (
        description, direction, category, party_name, client_id, due_at, paid_at, amount,
        payment_method, status, created_by, details
      ) values (
        left('OS: ' || v_order.reference || case when v_order.vehicle_plate is not null then ' (' || v_order.vehicle_plate || ')' else '' end, 240),
        'receivable', 'Ordem de Serviço', v_order.customer_name, v_order.client_id, v_today, v_today,
        v_amount, nullif(v_details ->> 'forma_pagamento', ''), 'concluido', auth.uid(),
        jsonb_build_object('tipo','receber','categoria','Ordem de Serviço','vencimento',v_today,'source_work_order_id',v_order.id)
      );
    end if;

    if v_amount > 0 and not exists (
      select 1 from public.sales where details ->> 'source_work_order_id' = v_order.id::text
    ) then
      insert into public.sales (
        reference, client_id, vehicle_id, sold_at, payment_method, total, notes, status,
        created_by, customer_name, phone, vehicle_plate, details
      ) values (
        left('OS: ' || v_order.reference, 100), v_order.client_id, v_order.vehicle_id, now(),
        coalesce(nullif(v_details ->> 'forma_pagamento', ''), 'Pix'), v_amount,
        case when v_order.vehicle_plate is not null then 'Ordem de serviço finalizada (' || v_order.vehicle_plate || ')' else 'Ordem de serviço finalizada' end,
        'concluido', auth.uid(), v_order.customer_name, v_order.phone, v_order.vehicle_plate,
        jsonb_build_object('source_work_order_id',v_order.id,'forma_pagamento',coalesce(nullif(v_details ->> 'forma_pagamento',''),'Pix'),'finance_synced',true)
      );
    end if;

    -- Queue the notification in the same transaction; the bot sends it asynchronously.
    if not coalesce((v_details ->> 'notified_finished')::boolean, false) then
    v_digits := pg_catalog.regexp_replace(coalesce(v_order.phone, ''), '[^0-9]', '', 'g');
    if pg_catalog.length(v_digits) >= 10 then
      v_phone := case when pg_catalog.length(v_digits) <= 11 and left(v_digits, 2) <> '55' then '55' || v_digits else v_digits end;
      v_message := '✅ Serviço finalizado — Benittes Oficina Mecânica' || E'\n\n'
        || 'Olá' || case when v_order.customer_name is not null then ', ' || v_order.customer_name else '' end || '!' || E'\n'
        || case when v_order.vehicle_plate is not null then 'Veículo: ' || v_order.vehicle_plate || E'\n' else '' end
        || 'Serviço: ' || v_order.reference || E'\n\nSeu veículo já está pronto para retirada.';
      insert into public.whatsapp_outbox (phone, message, kind, related_id, status, dedupe_key)
      values (v_phone, v_message, 'os_finished', v_order.id, 'pending', 'os-finished:' || v_order.id::text)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
      v_details := v_details || jsonb_build_object('notified_finished', true);
    end if;
    end if;
    v_details := v_details || jsonb_build_object('finalized_at', coalesce(v_details ->> 'finalized_at', now()::text));
    if v_amount > 0 then
      v_details := v_details || jsonb_build_object('finance_synced', true, 'sale_synced', true);
    end if;
  end if;

  select value into v_cfg from public.workshop_settings
  where key in ('os_config', 'os-config') order by key limit 1;
  v_finish_action := coalesce(v_cfg -> 'details' ->> 'pos_finalizacao', 'manter');
  if v_finish_action = 'arquivar' then
    v_details := v_details || jsonb_build_object('archived', true, 'archived_at', v_today);
  end if;
  update public.work_orders set details = v_details, updated_at = now()
  where id = v_order.id returning * into v_order;

  if v_finish_action = 'apagar' then
    delete from public.work_orders where id = v_order.id;
    v_details := v_details || jsonb_build_object('deleted_after_finalize', true);
  end if;
  return to_jsonb(v_order) || jsonb_build_object('details', v_details);
end;
$$;
revoke all on function public.finalize_work_order(uuid, jsonb) from public, anon;
grant execute on function public.finalize_work_order(uuid, jsonb) to authenticated;

create or replace function public.register_inventory_purchase(
  p_request_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_total_cost numeric,
  p_supplier_name text default null,
  p_create_payable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_items%rowtype;
  v_movement public.inventory_movements%rowtype;
  v_new_qty numeric(12,2);
  v_unit_cost numeric(12,2);
  v_supplier text := nullif(left(btrim(coalesce(p_supplier_name, '')), 180), '');
begin
  if auth.uid() is null or not private.can_access_module('inventory', true) then
    raise exception using errcode = '42501', message = 'Acesso negado ao estoque.';
  end if;
  if coalesce(p_create_payable, false) and coalesce(p_total_cost, 0) > 0
     and not private.can_access_module('finance', true) then
    raise exception using errcode = '42501', message = 'Seu perfil não pode criar contas a pagar.';
  end if;
  if p_request_id is null or p_inventory_item_id is null
     or p_quantity is null or p_quantity <= 0 or p_quantity > 100000
     or p_total_cost is null or p_total_cost < 0 or p_total_cost > 100000000 then
    raise exception using errcode = '22023', message = 'Os dados da compra são inválidos.';
  end if;

  select * into v_item from public.inventory_items where id = p_inventory_item_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Item de estoque não encontrado.'; end if;
  v_unit_cost := round(p_total_cost / p_quantity, 2);

  select * into v_movement from public.inventory_movements
  where source_type = 'purchase' and source_id = p_request_id and inventory_item_id = p_inventory_item_id;
  if found then
    if v_movement.quantity_delta <> p_quantity or v_movement.unit_cost <> v_unit_cost then
      raise exception using errcode = '23505', message = 'Este identificador de compra já foi usado com outros valores.';
    end if;
    return jsonb_build_object('movement', to_jsonb(v_movement), 'duplicate', true);
  end if;

  v_new_qty := v_item.quantity + p_quantity;
  perform pg_catalog.set_config('benittes.stock_source', 'purchase', true);
  perform pg_catalog.set_config('benittes.stock_source_id', p_request_id::text, true);
  perform pg_catalog.set_config('benittes.stock_work_order_id', '', true);
  perform pg_catalog.set_config('benittes.stock_unit_cost', v_unit_cost::text, true);
  perform pg_catalog.set_config('benittes.stock_memo', left('Compra recebida' || case when v_supplier is not null then ' · ' || v_supplier else '' end, 500), true);
  update public.inventory_items
  set quantity = v_new_qty,
      unit_cost = case when v_new_qty > 0 then round(((v_item.quantity * v_item.unit_cost) + p_total_cost) / v_new_qty, 2) else v_unit_cost end,
      details = case when v_supplier is not null then coalesce(details, '{}'::jsonb) || jsonb_build_object('fornecedor', v_supplier) else details end,
      updated_at = now()
  where id = v_item.id;

  select * into v_movement from public.inventory_movements
  where source_type = 'purchase' and source_id = p_request_id and inventory_item_id = p_inventory_item_id;

  if p_create_payable and p_total_cost > 0 then
    insert into public.finance_entries (
      description, direction, category, party_name, supplier_id, due_at, amount, notes, status, created_by, details
    ) values (
      left('Compra: ' || v_item.name || ' (' || p_quantity::text || 'x)', 240),
      'payable', 'Compras / Fornecedores', v_supplier, null,
      (now() at time zone 'America/Sao_Paulo')::date, p_total_cost,
      'Compra vinculada à movimentação de estoque.', 'open', auth.uid(),
      jsonb_build_object('tipo','pagar','categoria','Compras / Fornecedores','source_inventory_movement_id',v_movement.id,'source_purchase_request_id',p_request_id)
    );
  end if;

  return jsonb_build_object('movement', to_jsonb(v_movement), 'duplicate', false);
end;
$$;
revoke all on function public.register_inventory_purchase(uuid, uuid, numeric, numeric, text, boolean) from public, anon;
grant execute on function public.register_inventory_purchase(uuid, uuid, numeric, numeric, text, boolean) to authenticated;
