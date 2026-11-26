-- Remove the internal Agents module and its persisted data.
begin;

-- The empty agent-chat-private bucket was removed with the Supabase Storage API.

-- Remove module-only role flags and audit events while preserving shared tables.
update public.panel_roles
set permissions = permissions - 'agents',
    updated_at = now()
where permissions ? 'agents';

delete from public.audit_logs
where module = 'agents';

drop table if exists public.panel_agent_messages;
drop table if exists public.panel_agent_change_proposals;
drop table if exists public.panel_agent_routine_runs;
drop table if exists public.panel_agent_conversations;
drop table if exists public.panel_agent_profiles;

notify pgrst, 'reload schema';
commit;
