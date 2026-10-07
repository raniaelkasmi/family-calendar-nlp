-- =============================================================================
-- Phase 4: real-time shared calendar.
--
-- Changes to a group's events are broadcast on a private Realtime channel
-- named 'group:<group_id>'. Only members of that group can subscribe (RLS on
-- realtime.messages). This is Supabase's recommended approach over Postgres
-- Changes, which can't apply RLS to deletes.
-- =============================================================================

-- Broadcast every insert/update/delete on events to the group's channel.
create function private.broadcast_event_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'group:' || coalesce(new.group_id, old.group_id)::text,
    tg_op,          -- event name: INSERT / UPDATE / DELETE
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;

create trigger events_broadcast
  after insert or update or delete on public.events
  for each row execute function private.broadcast_event_change();

-- Participants changes are broadcast on the parent event's group channel.
-- (When an event is deleted, its participants cascade; the event's own
-- DELETE broadcast is enough, so a missing parent is skipped.)
create function private.broadcast_participant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid;
begin
  select e.group_id into gid from public.events e where e.id = coalesce(new.event_id, old.event_id);
  if gid is not null then
    perform realtime.broadcast_changes(
      'group:' || gid::text, tg_op, tg_op, tg_table_name, tg_table_schema, new, old
    );
  end if;
  return null;
end;
$$;

create trigger event_participants_broadcast
  after insert or delete on public.event_participants
  for each row execute function private.broadcast_participant_change();

revoke execute on function private.broadcast_event_change(), private.broadcast_participant_change()
  from public, anon, authenticated;

-- Only members of a group can receive its channel's broadcasts.
create policy "group members receive their group's broadcasts" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.group_members m
      where m.user_id = (select auth.uid())
        and 'group:' || m.group_id::text = (select realtime.topic())
    )
  );


-- Edit an event and its participants in one transaction.
-- security invoker: RLS applies, so only the event's creator can change it.
create function public.update_event(
  p_event_id        uuid,
  p_title           text,
  p_start_at        timestamptz,
  p_end_at          timestamptz,
  p_all_day         boolean,
  p_location        text,
  p_participant_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ids uuid[] := coalesce(p_participant_ids, '{}');
  n   int;
begin
  update public.events
  set title = trim(p_title),
      start_at = p_start_at,
      end_at = p_end_at,
      all_day = p_all_day,
      location = nullif(trim(coalesce(p_location, '')), '')
  where id = p_event_id;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Event not found or not yours' using errcode = 'P0002';
  end if;

  delete from public.event_participants
  where event_id = p_event_id and not (user_id = any (ids));

  insert into public.event_participants (event_id, user_id)
  select distinct p_event_id, uid from unnest(ids) as uid
  on conflict do nothing;
end;
$$;

revoke execute on function public.update_event(uuid, text, timestamptz, timestamptz, boolean, text, uuid[])
  from public, anon;
grant execute on function public.update_event(uuid, text, timestamptz, timestamptz, boolean, text, uuid[])
  to authenticated;
