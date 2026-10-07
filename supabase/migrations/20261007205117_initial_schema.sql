-- =============================================================================
-- Initial schema: profiles, groups, invitations, events, parsed messages.
--
-- Security model: Row Level Security is enabled on every table. A user only
-- sees groups they belong to, and the data (events, messages, members) of
-- those groups. All timestamps are timestamptz (stored in UTC).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- True if tz is a valid IANA timezone name known to Postgres (e.g. 'Europe/Paris').
create function public.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;


-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- One row per user, created automatically on sign-up (see handle_new_user).
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 50),
  timezone     text not null default 'UTC' check (public.is_valid_timezone(timezone)),
  created_at   timestamptz not null default now()
);

create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) between 1 and 60),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_id_idx on public.group_members (user_id);

-- Invitation links. The code is random and expires; redeeming it goes through
-- a security definer function (Phase 2), never through a direct insert.
create table public.group_invites (
  code       text primary key default left(replace(gen_random_uuid()::text, '-', ''), 16),
  group_id   uuid not null references public.groups (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
create index group_invites_group_id_idx on public.group_invites (group_id);

create table public.events (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  title      text not null check (char_length(trim(title)) between 1 and 200),
  start_at   timestamptz not null,
  end_at     timestamptz check (end_at is null or end_at >= start_at),
  all_day    boolean not null default false,
  location   text,
  created_at timestamptz not null default now()
);
create index events_group_id_start_at_idx on public.events (group_id, start_at);

create table public.event_participants (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (event_id, user_id)
);
create index event_participants_user_id_idx on public.event_participants (user_id);

-- Every natural-language message, what the model understood, and the user's
-- correction if any. This is the dataset used to measure parsing accuracy.
create table public.parsed_messages (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.groups (id) on delete cascade,
  user_id         uuid default auth.uid() references public.profiles (id) on delete set null,
  raw_text        text not null check (char_length(raw_text) between 1 and 2000),
  parsed_json     jsonb,
  was_corrected   boolean not null default false,
  corrected_json  jsonb,
  model           text,          -- which model produced parsed_json
  author_timezone text,          -- needed to evaluate relative dates afterwards
  event_id        uuid references public.events (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index parsed_messages_group_id_created_at_idx on public.parsed_messages (group_id, created_at);


-- -----------------------------------------------------------------------------
-- RLS helper functions
-- security definer: they read group_members without going through its RLS,
-- which would otherwise recurse when used inside group_members' own policies.
-- They only ever answer questions about the calling user (auth.uid()).
-- -----------------------------------------------------------------------------

create function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = (select auth.uid())
  );
$$;

create function public.is_group_owner(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

-- True if the calling user and uid are in at least one common group.
create function public.shares_group_with(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members me
    join public.group_members other on other.group_id = me.group_id
    where me.user_id = (select auth.uid()) and other.user_id = uid
  );
$$;

revoke execute on function public.is_group_member(uuid), public.is_group_owner(uuid),
  public.shares_group_with(uuid) from public, anon;
grant execute on function public.is_group_member(uuid), public.is_group_owner(uuid),
  public.shares_group_with(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

-- Create the profile when a user signs up. display_name and timezone come from
-- the sign-up metadata (supabase.auth.signUp({ options: { data } })).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_name text := trim(new.raw_user_meta_data ->> 'display_name');
  meta_tz   text := new.raw_user_meta_data ->> 'timezone';
begin
  insert into public.profiles (id, display_name, timezone)
  values (
    new.id,
    left(coalesce(nullif(meta_name, ''), split_part(new.email, '@', 1), 'Me'), 50),
    case when public.is_valid_timezone(meta_tz) then meta_tz else 'UTC' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The creator of a group automatically becomes its owner.
create function public.handle_new_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.group_members (group_id, user_id, role)
    values (new.id, new.created_by, 'owner');
  end if;
  return new;
end;
$$;

create trigger on_group_created
  after insert on public.groups
  for each row execute function public.handle_new_group();


-- -----------------------------------------------------------------------------
-- Privileges: anonymous (logged-out) clients get nothing; logged-in clients get
-- table access, then RLS policies below decide which rows.
-- -----------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Keep the dataset honest: after insert, only the correction fields can change
-- (raw_text and parsed_json stay exactly what the user wrote / the model said).
revoke update on public.parsed_messages from authenticated;
grant update (was_corrected, corrected_json, event_id) on public.parsed_messages to authenticated;


-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles           enable row level security;
alter table public.groups             enable row level security;
alter table public.group_members      enable row level security;
alter table public.group_invites      enable row level security;
alter table public.events             enable row level security;
alter table public.event_participants enable row level security;
alter table public.parsed_messages    enable row level security;

-- profiles: see yourself and people you share a group with; edit only yourself.
-- (No insert policy: the trigger creates profiles. No delete: cascades from auth.)
create policy "profiles: read self and group mates" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_group_with(id));

create policy "profiles: update self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- groups: members can read. "or created_by" lets the creator read the row
-- returned by INSERT ... RETURNING, before the owner membership is visible.
create policy "groups: read if member" on public.groups
  for select to authenticated
  using (public.is_group_member(id) or created_by = (select auth.uid()));

create policy "groups: create as self" on public.groups
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "groups: owner can rename" on public.groups
  for update to authenticated
  using (public.is_group_owner(id))
  with check (public.is_group_owner(id));

create policy "groups: owner can delete" on public.groups
  for delete to authenticated
  using (public.is_group_owner(id));

-- group_members: members see each other. No insert policy: joining only happens
-- through the owner trigger or the invite function (Phase 2).
-- A member can leave (except the owner); the owner can remove others.
create policy "group_members: read same group" on public.group_members
  for select to authenticated
  using (public.is_group_member(group_id));

create policy "group_members: leave or be removed by owner" on public.group_members
  for delete to authenticated
  using (
    (user_id = (select auth.uid()) and role <> 'owner')
    or (user_id <> (select auth.uid()) and public.is_group_owner(group_id))
  );

-- group_invites: members can see and create invites for their groups.
create policy "group_invites: read if member" on public.group_invites
  for select to authenticated
  using (public.is_group_member(group_id));

create policy "group_invites: members create" on public.group_invites
  for insert to authenticated
  with check (public.is_group_member(group_id) and created_by = (select auth.uid()));

create policy "group_invites: creator or owner deletes" on public.group_invites
  for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_group_owner(group_id));

-- events: members read and create; only the creator edits or deletes.
create policy "events: read if member" on public.events
  for select to authenticated
  using (public.is_group_member(group_id));

create policy "events: members create as self" on public.events
  for insert to authenticated
  with check (public.is_group_member(group_id) and created_by = (select auth.uid()));

create policy "events: creator updates" on public.events
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()) and public.is_group_member(group_id));

create policy "events: creator deletes" on public.events
  for delete to authenticated
  using (created_by = (select auth.uid()));

-- event_participants: visible and editable by members of the event's group;
-- a participant must themselves be a member of that group.
create policy "event_participants: read if member" on public.event_participants
  for select to authenticated
  using (exists (
    select 1 from public.events e
    where e.id = event_id and public.is_group_member(e.group_id)
  ));

create policy "event_participants: members add group mates" on public.event_participants
  for insert to authenticated
  with check (exists (
    select 1 from public.events e
    join public.group_members m on m.group_id = e.group_id
    where e.id = event_id
      and m.user_id = event_participants.user_id
      and public.is_group_member(e.group_id)
  ));

create policy "event_participants: members remove" on public.event_participants
  for delete to authenticated
  using (exists (
    select 1 from public.events e
    where e.id = event_id and public.is_group_member(e.group_id)
  ));

-- parsed_messages: members read their group's messages; you write and correct
-- only your own. No delete policy: the dataset is append-only from the app.
create policy "parsed_messages: read if member" on public.parsed_messages
  for select to authenticated
  using (public.is_group_member(group_id));

create policy "parsed_messages: insert own" on public.parsed_messages
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_group_member(group_id));

create policy "parsed_messages: correct own" on public.parsed_messages
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_group_member(group_id));
