-- =============================================================================
-- Phase 5: "Find a time".
--
-- busy_times() tells the app when people are busy, across all their groups,
-- without revealing what, where, or in which group. Only people who share a
-- group with the caller can be queried.
--
-- Rules for what counts as busy for a person (participant of an event, or its
-- creator when the event has no participants):
-- * timed events: busy for their duration;
-- * all-day events without a location (birthdays...): never busy;
-- * all-day events with a location (trips): busy, unless the planned event's
--   place matches that location (you're away in Lyon, but free for plans in Lyon).
-- =============================================================================

create extension if not exists unaccent with schema extensions;

-- Loose place comparison: case- and accent-insensitive, either one containing
-- the other ("Lyon" ~ "lyon centre", "Fès" ~ "Fes"). Empty or very short → no match.
create function private.same_place(a text, b text)
returns boolean
language sql
stable
set search_path = ''
as $$
  with n as (
    select
      lower(trim(extensions.unaccent(coalesce(a, '')))) as x,
      lower(trim(extensions.unaccent(coalesce(b, '')))) as y
  )
  select length(x) >= 3 and length(y) >= 3
    and (strpos(x, y) > 0 or strpos(y, x) > 0)
  from n;
$$;

create function public.busy_times(
  p_user_ids uuid[],
  p_from     timestamptz,
  p_to       timestamptz,
  p_place    text default null
)
returns table (user_id uuid, start_at timestamptz, end_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select distinct u
    from unnest(p_user_ids) as u
    where u = (select auth.uid()) or private.shares_group_with(u)
  ),
  candidate_events as (
    select e.id, e.created_by, e.start_at,
           coalesce(e.end_at, e.start_at + interval '1 hour') as end_at,
           e.all_day, e.location
    from public.events e
    where e.start_at < p_to
      and coalesce(e.end_at, e.start_at + interval '1 hour') > p_from
      and (
        not e.all_day
        or (nullif(trim(coalesce(e.location, '')), '') is not null
            and not private.same_place(e.location, p_place))
      )
  ),
  involved as (
    select ep.user_id as who, ce.start_at, ce.end_at
    from candidate_events ce
    join public.event_participants ep on ep.event_id = ce.id
    union all
    select ce.created_by, ce.start_at, ce.end_at
    from candidate_events ce
    where not exists (select 1 from public.event_participants ep where ep.event_id = ce.id)
  )
  select distinct i.who, i.start_at, i.end_at
  from involved i
  join allowed a on a.u = i.who;
$$;

revoke execute on function private.same_place(text, text) from public, anon;
grant execute on function private.same_place(text, text) to authenticated;
revoke execute on function public.busy_times(uuid[], timestamptz, timestamptz, text) from public, anon;
grant execute on function public.busy_times(uuid[], timestamptz, timestamptz, text) to authenticated;


-- Create an event with its participants in one transaction (from "Find a time").
-- security invoker: RLS applies (member of the group, created_by = caller).
create function public.create_event(
  p_group_id        uuid,
  p_title           text,
  p_start_at        timestamptz,
  p_end_at          timestamptz,
  p_all_day         boolean,
  p_location        text,
  p_participant_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_event uuid;
begin
  insert into public.events (group_id, title, start_at, end_at, all_day, location)
  values (p_group_id, trim(p_title), p_start_at, p_end_at, p_all_day, nullif(trim(coalesce(p_location, '')), ''))
  returning id into new_event;

  insert into public.event_participants (event_id, user_id)
  select distinct new_event, uid from unnest(coalesce(p_participant_ids, '{}')) as uid;

  return new_event;
end;
$$;

revoke execute on function public.create_event(uuid, text, timestamptz, timestamptz, boolean, text, uuid[])
  from public, anon;
grant execute on function public.create_event(uuid, text, timestamptz, timestamptz, boolean, text, uuid[])
  to authenticated;
