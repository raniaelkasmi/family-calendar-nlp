-- =============================================================================
-- Phase 3: natural-language messages → events.
--
-- * parsed_messages rows are written only by the parse-message Edge Function
--   (service role), so parsed_json is always genuine model output.
-- * Drafts are private: everyone in the group sees messages that became
--   events; unsaved or discarded messages are visible to their author only.
-- * Saving a draft goes through save_event_from_message(), which creates the
--   event + participants and records the user's corrections in one transaction.
-- =============================================================================

-- 'saved' or 'discarded' once the author decides; null while still a draft.
alter table public.parsed_messages
  add column outcome text check (outcome in ('saved', 'discarded'));

create index parsed_messages_user_id_created_at_idx on public.parsed_messages (user_id, created_at);

-- Only the Edge Function inserts messages.
drop policy "parsed_messages: insert own" on public.parsed_messages;
revoke insert on public.parsed_messages from authenticated;

-- Authors may update only the decision fields.
revoke update on public.parsed_messages from authenticated;
grant update (was_corrected, corrected_json, event_id, outcome) on public.parsed_messages to authenticated;

drop policy "parsed_messages: read if member" on public.parsed_messages;
create policy "parsed_messages: own, or saved in my groups" on public.parsed_messages
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (event_id is not null and private.is_group_member(group_id))
  );


-- Creates the event from a draft message and records what the user changed
-- compared to the model's parse (the accuracy label for the dataset).
-- security invoker: runs with the caller's rights, so all RLS policies apply.
create function public.save_event_from_message(
  p_message_id      uuid,
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
  msg       record;
  parsed    jsonb;
  ids       uuid[] := coalesce(p_participant_ids, '{}');
  loc       text   := nullif(trim(coalesce(p_location, '')), '');
  fields    text[] := '{}';
  new_event uuid;
  n         int;
begin
  select m.group_id, m.parsed_json into msg
  from public.parsed_messages m
  where m.id = p_message_id and m.user_id = (select auth.uid()) and m.event_id is null;
  if not found then
    raise exception 'Draft not found or already saved' using errcode = 'P0002';
  end if;

  insert into public.events (group_id, title, start_at, end_at, all_day, location)
  values (msg.group_id, trim(p_title), p_start_at, p_end_at, p_all_day, loc)
  returning id into new_event;

  insert into public.event_participants (event_id, user_id)
  select distinct new_event, uid from unnest(ids) as uid;

  -- Which fields did the user change compared to the model's normalized parse?
  parsed := msg.parsed_json -> 'normalized';
  if parsed is null or jsonb_typeof(parsed) <> 'object' then
    fields := array['created_manually'];
  else
    if parsed ->> 'title' is distinct from trim(p_title) then
      fields := array_append(fields, 'title');
    end if;
    if (parsed ->> 'start_at')::timestamptz is distinct from p_start_at then
      fields := array_append(fields, 'start_at');
    end if;
    if (parsed ->> 'end_at')::timestamptz is distinct from p_end_at then
      fields := array_append(fields, 'end_at');
    end if;
    if (parsed ->> 'all_day')::boolean is distinct from p_all_day then
      fields := array_append(fields, 'all_day');
    end if;
    if nullif(trim(coalesce(parsed ->> 'location', '')), '') is distinct from loc then
      fields := array_append(fields, 'location');
    end if;
    if (select coalesce(array_agg(x::uuid order by x::uuid), '{}')
        from jsonb_array_elements_text(coalesce(parsed -> 'participant_ids', '[]')) x)
       is distinct from
       (select coalesce(array_agg(distinct x order by x), '{}') from unnest(ids) x) then
      fields := array_append(fields, 'participants');
    end if;
  end if;

  update public.parsed_messages
  set event_id = new_event,
      outcome = 'saved',
      was_corrected = cardinality(fields) > 0,
      corrected_json = case when cardinality(fields) > 0 then jsonb_build_object(
        'title', trim(p_title),
        'start_at', p_start_at,
        'end_at', p_end_at,
        'all_day', p_all_day,
        'location', loc,
        'participant_ids', to_jsonb(ids),
        'corrected_fields', to_jsonb(fields)
      ) end
  where id = p_message_id and event_id is null;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Draft already saved' using errcode = 'P0002';
  end if;

  return new_event;
end;
$$;

revoke execute on function public.save_event_from_message(uuid, text, timestamptz, timestamptz, boolean, text, uuid[])
  from public, anon;
grant execute on function public.save_event_from_message(uuid, text, timestamptz, timestamptz, boolean, text, uuid[])
  to authenticated;
