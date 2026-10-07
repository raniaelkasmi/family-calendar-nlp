-- =============================================================================
-- RLS check — verifies that users only see and change what they should.
--
-- Run:  npx supabase db query --linked -f supabase/tests/rls_check.sql
--   or paste into Supabase dashboard → SQL Editor → Run.
--
-- Creates two throwaway users (Alice, Bob), impersonates each one, records
-- PASS/FAIL per rule, then deletes everything it created. Everything happens
-- in one DO block, so an unexpected error leaves no data behind either.
-- =============================================================================

create temp table if not exists rls_results (ord int, check_name text, passed boolean);
truncate rls_results;

do $$
declare
  alice uuid := '00000000-0000-4000-a000-00000000a11c';
  bob   uuid := '00000000-0000-4000-a000-000000000b0b';
  ga uuid;  -- Alice's group
  gb uuid;  -- Bob's group
  eb uuid;  -- Bob's event in gb
  ma uuid;  -- Alice's parsed message in gb
  mb uuid;  -- Bob's draft message in gb
  saved uuid;
  ib text;  -- Bob's valid invite code
  ix text;  -- an expired invite code for gb
  gid uuid;
  n int;
  ok boolean;
  names  text[]    := '{}';
  passes boolean[] := '{}';
begin
  -- ---------------------------------------------------------------- setup (admin)
  delete from public.groups where created_by in (alice, bob);
  delete from auth.users where id in (alice, bob);

  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', alice, 'authenticated', 'authenticated',
     'rls-alice@example.test', '{"display_name":"Alice","timezone":"Europe/Paris"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', bob, 'authenticated', 'authenticated',
     'rls-bob@example.test', '{"display_name":"Bob","timezone":"Not/AZone"}', now(), now());

  names := array_append(names, 'profile auto-created with sign-up name + timezone');
  passes := passes || exists (select 1 from public.profiles
    where id = alice and display_name = 'Alice' and timezone = 'Europe/Paris');

  names := array_append(names, 'invalid timezone at sign-up falls back to UTC');
  passes := passes || exists (select 1 from public.profiles where id = bob and timezone = 'UTC');

  -- ---------------------------------------------------------------- as Bob
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.groups (name) values ('Bob family') returning id into gb;
  insert into public.events (group_id, title, start_at) values (gb, 'Bob dinner', now()) returning id into eb;
  insert into public.group_invites (group_id) values (gb) returning code into ib;
  reset role;
  insert into public.group_invites (group_id, created_by, expires_at)
  values (gb, bob, now() - interval '1 minute') returning code into ix;
  -- Messages are written by the Edge Function (service role), so as admin here.
  insert into public.parsed_messages (group_id, user_id, raw_text)
  values (gb, bob, 'dinner tomorrow 8pm') returning id into mb;

  names := array_append(names, 'group creator becomes owner automatically');
  passes := passes || exists (select 1 from public.group_members
    where group_id = gb and user_id = bob and role = 'owner');

  -- ---------------------------------------------------------------- as Alice (outsider)
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.groups (name) values ('Alice family') returning id into ga;

  names := array_append(names, 'outsider sees only her own group');
  passes := passes || ((select count(*) from public.groups) = 1 and exists (select 1 from public.groups where id = ga));

  names := array_append(names, 'outsider cannot see other group''s events');
  passes := passes || not exists (select 1 from public.events where group_id = gb);

  names := array_append(names, 'outsider cannot see other group''s messages');
  passes := passes || not exists (select 1 from public.parsed_messages where group_id = gb);

  names := array_append(names, 'outsider cannot see other group''s members');
  passes := passes || not exists (select 1 from public.group_members where group_id = gb);

  names := array_append(names, 'outsider cannot see other group''s invites');
  passes := passes || not exists (select 1 from public.group_invites where group_id = gb);

  names := array_append(names, 'outsider cannot see a stranger''s profile');
  passes := passes || not exists (select 1 from public.profiles where id = bob);

  ok := false;
  begin
    insert into public.events (group_id, title, start_at) values (gb, 'intrusion', now());
  exception when insufficient_privilege then ok := true;
  end;
  names := array_append(names, 'outsider cannot add an event to other group');
  passes := passes || ok;

  ok := false;
  begin
    insert into public.group_members (group_id, user_id) values (gb, alice);
  exception when insufficient_privilege then ok := true;
  end;
  names := array_append(names, 'nobody can join a group by inserting membership directly');
  passes := passes || ok;

  update public.events set title = 'hacked' where id = eb;
  get diagnostics n = row_count;
  names := array_append(names, 'outsider cannot edit other group''s event');
  passes := passes || (n = 0);
  reset role;

  -- ---------------------------------------------------------------- as anonymous
  set local role anon;
  ok := false;
  begin
    perform 1 from public.groups;
  exception when insufficient_privilege then ok := true;
  end;
  names := array_append(names, 'logged-out client has no table access');
  passes := passes || ok;

  ok := false;
  begin
    perform public.join_group(ib);
  exception when insufficient_privilege then ok := true;
  end;
  names := array_append(names, 'logged-out client cannot use an invite');
  passes := passes || ok;
  reset role;

  -- ---------------------------------------------------------------- Alice joins Bob's group with the invite
  set local role authenticated;  -- claims still Alice

  names := array_append(names, 'invite preview: unknown and expired codes reveal nothing');
  passes := passes || (not exists (select 1 from public.invite_preview('0123456789abcdef'))
    and not exists (select 1 from public.invite_preview(ix)));

  names := array_append(names, 'invite preview: valid code (any format) shows group name and size');
  passes := passes || exists (select 1 from public.invite_preview(
      upper(substr(ib, 1, 4) || '-' || substr(ib, 5, 4) || ' ' || substr(ib, 9, 4) || '-' || substr(ib, 13, 4)))
    where group_name = 'Bob family' and member_count = 1 and not already_member);

  ok := false;
  begin
    perform public.join_group(ix);
  exception when no_data_found then ok := true;
  end;
  names := array_append(names, 'expired invite code is refused');
  passes := passes || (ok and not exists (select 1 from public.groups where id = gb));

  gid := public.join_group(ib);
  names := array_append(names, 'valid invite code joins the group as a member');
  passes := passes || (gid = gb and exists (select 1 from public.group_members
    where group_id = gb and user_id = alice and role = 'member'));

  gid := public.join_group(ib);
  names := array_append(names, 'joining twice is harmless');
  passes := passes || (gid = gb and (select count(*) from public.group_members
    where group_id = gb and user_id = alice) = 1);

  names := array_append(names, 'member sees the group, its events and group mates');
  passes := passes || (exists (select 1 from public.groups where id = gb)
    and exists (select 1 from public.events where id = eb)
    and exists (select 1 from public.profiles where id = bob));

  update public.events set title = 'hacked' where id = eb;
  get diagnostics n = row_count;
  names := array_append(names, 'member cannot edit someone else''s event');
  passes := passes || (n = 0);

  delete from public.group_members where group_id = gb and user_id = bob;
  get diagnostics n = row_count;
  names := array_append(names, 'member cannot remove another member');
  passes := passes || (n = 0);

  delete from public.groups where id = gb;
  get diagnostics n = row_count;
  names := array_append(names, 'member (not owner) cannot delete the group');
  passes := passes || (n = 0);

  ok := false;
  begin
    insert into public.parsed_messages (group_id, user_id, raw_text) values (gb, alice, 'fake');
  exception when insufficient_privilege then ok := true;
  end;
  names := array_append(names, 'users cannot insert messages directly (only the Edge Function)');
  passes := passes || ok;

  names := array_append(names, 'a member cannot see someone else''s draft');
  passes := passes || not exists (select 1 from public.parsed_messages where id = mb);

  reset role;
  insert into public.parsed_messages (group_id, user_id, raw_text, parsed_json)
  values (gb, alice, 'lunch friday 12:30', jsonb_build_object('normalized', jsonb_build_object(
    'title', 'Lunch', 'start_at', '2030-01-04T11:30:00Z', 'end_at', '2030-01-04T12:30:00Z',
    'all_day', false, 'location', null, 'participant_ids', jsonb_build_array(bob))))
  returning id into ma;
  set local role authenticated;  -- claims still Alice

  ok := false;
  begin
    update public.parsed_messages set parsed_json = '{"title":"edited"}' where id = ma;
  exception when insufficient_privilege then ok := true;
  end;
  names := array_append(names, 'model output (parsed_json) is read-only after insert');
  passes := passes || ok;

  ok := false;
  begin
    perform public.save_event_from_message(mb, 'stolen', now(), null, false, null, null);
  exception when no_data_found then ok := true;
  end;
  names := array_append(names, 'cannot save someone else''s draft');
  passes := passes || ok;

  saved := public.save_event_from_message(ma, 'Lunch with Bob', '2030-01-04T11:30:00Z',
    '2030-01-04T12:30:00Z', false, null, array[bob]);
  names := array_append(names, 'saving a draft creates the event, participants and correction label');
  passes := passes || (
    exists (select 1 from public.events where id = saved and title = 'Lunch with Bob')
    and exists (select 1 from public.event_participants where event_id = saved and user_id = bob)
    and exists (select 1 from public.parsed_messages where id = ma and event_id = saved
      and outcome = 'saved' and was_corrected
      and corrected_json -> 'corrected_fields' = '["title"]'::jsonb));

  ok := false;
  begin
    perform public.save_event_from_message(ma, 'again', now(), null, false, null, null);
  exception when no_data_found then ok := true;
  end;
  names := array_append(names, 'a draft can only be saved once');
  passes := passes || ok;

  update public.parsed_messages set outcome = 'discarded' where id = ma;
  get diagnostics n = row_count;
  names := array_append(names, 'author can update the outcome of own message');
  passes := passes || (n = 1);
  update public.parsed_messages set outcome = 'saved' where id = ma;

  delete from public.group_members where group_id = gb and user_id = alice;
  get diagnostics n = row_count;
  names := array_append(names, 'member can leave a group');
  passes := passes || (n = 1);
  reset role;

  -- ---------------------------------------------------------------- Bob (owner) tries to leave
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.group_members where group_id = gb and user_id = bob;
  get diagnostics n = row_count;
  names := array_append(names, 'owner cannot leave (only delete the group)');
  passes := passes || (n = 0);

  names := array_append(names, 'group members see saved messages from others');
  passes := passes || exists (select 1 from public.parsed_messages where id = ma);
  reset role;

  -- ---------------------------------------------------------------- cleanup (admin)
  delete from public.groups where id in (ga, gb);
  delete from auth.users where id in (alice, bob);

  insert into rls_results
  select i, names[i], passes[i] from generate_subscripts(names, 1) as i;
end;
$$;

select
  case when passed then 'PASS' else 'FAIL' end as result,
  check_name
from rls_results
order by ord;
