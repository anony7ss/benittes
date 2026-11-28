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
  audit_action text;
  audit_actor_id uuid;
  actor_email_value text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if tg_table_name = 'panel_members' and tg_op = 'UPDATE' then
    if old.email is not distinct from new.email
      and old.full_name is not distinct from new.full_name
      and old.role is not distinct from new.role
      and old.active is not distinct from new.active
      and old.phone is not distinct from new.phone
      and old.two_factor_enabled is not distinct from new.two_factor_enabled then
      return new;
    end if;
  end if;

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
    when 'inventory_movements' then 'estoque'
    when 'purchase_orders' then 'compras'
    when 'purchase_order_items' then 'compras'
    when 'sale_items' then 'vendas'
    when 'crm_interactions' then 'crm'
    when 'workshop_documents' then 'documentos'
    when 'panel_notifications' then 'notificacoes'
    when 'workshop_settings' then 'configuracoes'
    when 'site_gallery_media' then 'galeria'
    when 'work_order_events' then 'ordens-de-servico'
    when 'whatsapp_messages' then 'whatsapp'
    when 'whatsapp_outbox' then 'whatsapp'
    when 'whatsapp_chat_control' then 'whatsapp'
    else coalesce(row_data->>'module', tg_table_name)
  end;

  audit_action := lower(tg_op);
  if tg_table_name = 'work_order_events' then
    audit_action := coalesce(row_data->>'event_type', 'updated');
  elsif tg_table_name = 'inventory_movements' then
    audit_action := 'movement';
  elsif tg_table_name = 'whatsapp_messages' then
    audit_action := case row_data->>'direction'
      when 'incoming' then 'message_received' else 'message_sent' end;
  elsif tg_table_name = 'whatsapp_outbox' then
    if tg_op = 'UPDATE' and old.status is not distinct from new.status then
      return new;
    end if;
    if coalesce(row_data->>'kind', '') in ('2fa_code', '2fa_setup_code', '2fa_disable_code') then
      audit_action := 'two_factor_code_sent';
    elsif tg_op = 'INSERT' then
      audit_action := 'message_queued';
    else
      audit_action := 'message_status_changed';
    end if;
  elsif tg_table_name = 'whatsapp_chat_control' then
    if tg_op = 'UPDATE' and old.ai_paused is not distinct from new.ai_paused then
      return new;
    end if;
    if tg_op = 'INSERT' and coalesce(new.ai_paused, false) = false then
      return new;
    end if;
    audit_action := case when coalesce(row_data->>'ai_paused', 'false') = 'true'
      then 'chat_paused' else 'chat_resumed' end;
  end if;

  row_id := coalesce(row_data->>'id', row_data->>'key', row_data->>'user_id', row_data->>'role_key');
  row_title := left(coalesce(
    case when tg_table_name = 'work_order_events' then row_data->>'summary' end,
    case when tg_table_name = 'work_order_events' then row_data->>'work_order_reference' end,
    case when tg_table_name = 'inventory_movements' then
      concat('Movimentação ', coalesce(row_data->>'source_type', 'estoque'), ' (', row_data->>'quantity_delta', ')') end,
    case when tg_table_name = 'whatsapp_messages' then
      case row_data->>'direction' when 'incoming' then 'Mensagem recebida' else 'Mensagem enviada' end end,
    case when tg_table_name in ('whatsapp_outbox', 'whatsapp_chat_control') then 'Atendimento do WhatsApp' end,
    row_data->>'title', row_data->>'name', row_data->>'full_name', row_data->>'reference',
    row_data->>'license_plate', row_data->>'description', row_data->>'email'
  ), 180);

  audit_actor_id := coalesce(
    (select auth.uid()),
    nullif(row_data->>'actor_user_id', '')::uuid,
    nullif(row_data->>'updated_by', '')::uuid,
    nullif(row_data->>'created_by', '')::uuid
  );
  select member.email into actor_email_value
  from public.panel_members member
  where member.user_id = audit_actor_id and member.active;

  insert into public.audit_logs(actor_user_id, actor_email, action, module, record_id, record_title)
  values (audit_actor_id, actor_email_value, audit_action, audit_module, row_id, row_title);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.write_audit_log() from public, anon, authenticated;
notify pgrst, 'reload schema';
