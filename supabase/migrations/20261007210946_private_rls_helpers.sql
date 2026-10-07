-- Hardening after `supabase db advisors`:
-- functions in `public` are callable through the API (/rest/v1/rpc/...).
-- RLS helpers and trigger functions are internal, so they move out of reach.

-- RLS helpers → `private` schema (not exposed by the API). Policies reference
-- functions by OID, so existing policies keep working after the move.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.is_group_member(uuid)   set schema private;
alter function public.is_group_owner(uuid)    set schema private;
alter function public.shares_group_with(uuid) set schema private;

-- Trigger functions: nobody should call these directly.
revoke execute on function public.handle_new_user()  from public, anon, authenticated;
revoke execute on function public.handle_new_group() from public, anon, authenticated;
