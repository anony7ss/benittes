alter table public.service_price_rules
  add column if not exists vehicle_make text,
  add column if not exists vehicle_model text,
  add column if not exists year_from smallint,
  add column if not exists year_to smallint;

alter table public.service_price_rules
  add constraint service_price_rules_vehicle_application_check
  check (
    service_id is not null
    and price > 0
    and (
      nullif(btrim(vehicle_make), '') is not null
      or nullif(btrim(vehicle_model), '') is not null
    )
    and (vehicle_make is null or char_length(btrim(vehicle_make)) between 1 and 100)
    and (vehicle_model is null or char_length(btrim(vehicle_model)) between 1 and 120)
    and (year_from is null or year_from between 1900 and 2200)
    and (year_to is null or year_to between 1900 and 2200)
    and (year_from is null or year_to is null or year_to >= year_from)
  );

create index if not exists service_price_rules_vehicle_lookup_idx
  on public.service_price_rules (service_id, vehicle_make, vehicle_model, year_from, year_to)
  where active = true;
