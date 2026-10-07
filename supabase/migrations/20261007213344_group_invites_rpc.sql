-- =============================================================================
-- Phase 2: joining groups with an invite code.
--
-- Invites are reusable until they expire (7 days by default). These two
-- functions are intentionally public RPCs (callable by logged-in users only):
-- they are the only way for a non-member to learn anything about a group,
-- and they only ever reveal it to someone who holds a valid code.
-- =============================================================================

-- Codes are 16 hex characters. Accept them with any case, spaces or dashes
-- (e.g. "3F9A-12C4-77BE-0D21").
create function public.normalize_invite_code(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(coalesce(raw, ''), '[^0-9a-fA-F]', '', 'g'));
$$;

-- What the join screen shows before you accept: group name and size.
-- Returns no row if the code is unknown or expired.
create function public.invite_preview(invite_code text)
returns table (group_id uuid, group_name text, member_count int, expires_at timestamptz, already_member boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id,
    g.name,
    (select count(*)::int from public.group_members m where m.group_id = g.id),
    i.expires_at,
    exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = (select auth.uid()))
  from public.group_invites i
  join public.groups g on g.id = i.group_id
  where i.code = public.normalize_invite_code(invite_code)
    and i.expires_at > now()
    and (select auth.uid()) is not null;
$$;

-- Adds the calling user to the invite's group as a member and returns the
-- group id. Joining a group you're already in is a no-op.
create function public.join_group(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  gid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select i.group_id into gid
  from public.group_invites i
  where i.code = public.normalize_invite_code(invite_code)
    and i.expires_at > now();

  if gid is null then
    raise exception 'Invalid or expired invite code' using errcode = 'P0002';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (gid, uid, 'member')
  on conflict (group_id, user_id) do nothing;

  return gid;
end;
$$;

revoke execute on function public.invite_preview(text), public.join_group(text) from public, anon;
grant execute on function public.invite_preview(text), public.join_group(text) to authenticated;
