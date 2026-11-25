alter table public.whatsapp_bot_session
  add column if not exists closed_auto_reply_enabled boolean not null default true,
  add column if not exists closed_auto_reply_message text default 'Olá! 👋 No momento a *Benittes Oficina Mecânica* está fechada. Assim que retomarmos o atendimento, responderemos sua mensagem!';

notify pgrst, 'reload schema';
