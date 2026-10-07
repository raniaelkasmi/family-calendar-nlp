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
  insert into public.parsed_messages (group_id, raw_text) values (gb, 'dinner tomorrow 8pm');
  insert into public.group_invites (group_id) values (gb);
  reset role;

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
  reset role;

  -- ---------------------------------------------------------------- Alice joins Bob's group
  insert into public.group_members (group_id, user_id) values (gb, alice);

  set local role authenticated;  -- claims still Alice
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

  insert into public.parsed_messages (group_id, raw_text, parsed_json)
  values (gb, 'lunch friday', '{"title":"Lunch"}') returning id into ma;

  ok := false;
  begin
    update public.parsed_messages set parsed_json = '{"title":"edited"}' where id = ma;
  exception when insufficient_privilege then ok := true;
  end;
  names := array_append(names, 'model output (parsed_json) is read-only after insert');
  passes := passes || ok;

  update public.parsed_messages set was_corrected = true, corrected_json = '{"title":"Lunch!"}' where id = ma;
  get diagnostics n = row_count;
  names := array_append(names, 'author can record a correction on own message');
  passes := passes || (n = 1);

  delete from public.group_members where group_id = gb and user_id = alice;
  get diagnostics n = row_count;
  names := array_append(names, 'member can leave a group');
  passes := passes || (n = 1);
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
