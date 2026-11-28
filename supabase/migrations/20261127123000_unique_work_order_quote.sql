-- One work order can be generated from a quote only once.
create unique index if not exists work_orders_quote_id_unique
  on public.work_orders (quote_id)
  where quote_id is not null;
