import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { normalizeInviteCode } from '@/lib/invites';
import { supabase } from '@/lib/supabase';

type Preview = { groupId: string; groupName: string; memberCount: number; alreadyMember: boolean };

export default function JoinGroupScreen() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = normalizeInviteCode(params.code ?? '');

  // undefined = loading, null = invalid or expired code
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('invite_preview', { invite_code: code }).then(({ data, error }) => {
      if (cancelled) return;
      const row = data?.[0];
      if (error || !row) {
        setPreview(null);
        return;
      }
      setPreview({
        groupId: row.group_id,
        groupName: row.group_name,
        memberCount: row.member_count,
        alreadyMember: row.already_member,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  function openGroup(groupId: string) {
    router.replace({ pathname: '/groups/[id]', params: { id: groupId } });
  }

  async function join() {
    setJoining(true);
    setError(null);
    const { data: groupId, error } = await supabase.rpc('join_group', { invite_code: code });
    setJoining(false);
    if (error) {
      setError(
        error.code === 'P0002'
          ? 'This invitation is no longer valid. Ask for a new one.'
          : 'Could not join the group. Please try again.',
      );
      return;
    }
    openGroup(groupId);
  }

  if (preview === undefined) {
    return (
      <Screen hasHeader>
        <ThemedText themeColor="textSecondary">Checking invitation…</ThemedText>
      </Screen>
    );
  }

  if (preview === null) {
    return (
      <Screen hasHeader>
        <ThemedText type="smallBold">Invitation not valid</ThemedText>
        <ThemedText themeColor="textSecondary">
          This code doesn&apos;t exist or has expired. Ask a group member to send you a new invitation.
        </ThemedText>
        <Button title="Back to my groups" variant="secondary" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const members = `${preview.memberCount} ${preview.memberCount === 1 ? 'member' : 'members'}`;

  if (preview.alreadyMember) {
    return (
      <Screen hasHeader>
        <ThemedText type="subtitle">{preview.groupName}</ThemedText>
        <ThemedText themeColor="textSecondary">You&apos;re already in this group ({members}).</ThemedText>
        <Button title="Open group" onPress={() => openGroup(preview.groupId)} />
      </Screen>
    );
  }

  return (
    <Screen hasHeader>
      <ThemedText themeColor="textSecondary">You&apos;ve been invited to join</ThemedText>
      <ThemedText type="subtitle">{preview.groupName}</ThemedText>
      <ThemedText themeColor="textSecondary">
        {members}. Members can see each other&apos;s names, timezones and the shared calendar.
      </ThemedText>
      <ErrorText message={error} />
      <Button title="Join group" onPress={join} loading={joining} />
      <Button title="Not now" variant="secondary" onPress={() => router.replace('/')} />
    </Screen>
  );
}
