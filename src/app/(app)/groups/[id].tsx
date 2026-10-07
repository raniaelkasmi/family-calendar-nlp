import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, Share, StyleSheet } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { formatInviteCode, getOrCreateInvite, inviteLink } from '@/lib/invites';
import { supabase } from '@/lib/supabase';
import { formatTimezone } from '@/lib/timezones';

type Member = { userId: string; role: string; displayName: string; timezone: string };

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const myId = session?.user.id;

  const [name, setName] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<'invite' | 'leave' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [groupRes, membersRes] = await Promise.all([
      supabase.from('groups').select('name').eq('id', id).maybeSingle(),
      supabase
        .from('group_members')
        .select('user_id, role, profiles(display_name, timezone)')
        .eq('group_id', id),
    ]);
    if (groupRes.error || membersRes.error) {
      setError('Could not load this group. Pull down to retry.');
      return;
    }
    // RLS hides groups you're not in, so "no row" also means "not a member".
    if (!groupRes.data) {
      setNotFound(true);
      return;
    }
    setError(null);
    setName(groupRes.data.name);
    setMembers(
      membersRes.data
        .map((m) => ({
          userId: m.user_id,
          role: m.role,
          displayName: m.profiles?.display_name ?? 'Unknown',
          timezone: m.profiles?.timezone ?? 'UTC',
        }))
        // Owner first, then alphabetical.
        .sort((a, b) =>
          a.role === b.role ? a.displayName.localeCompare(b.displayName) : a.role === 'owner' ? -1 : 1,
        ),
    );
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const isOwner = members.some((m) => m.userId === myId && m.role === 'owner');

  async function invite() {
    setBusy('invite');
    setError(null);
    try {
      const { code, expires_at } = await getOrCreateInvite(id);
      const until = new Date(expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
      await Share.share({
        message:
          `Join "${name}" on Agenda Proches!\n\n` +
          `Code: ${formatInviteCode(code)}\n` +
          `Link: ${inviteLink(code)}\n\n` +
          `Valid until ${until}.`,
      });
    } catch {
      setError('Could not create an invitation. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  function confirmLeave() {
    Alert.alert(`Leave "${name}"?`, 'You will no longer see this group or its calendar.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          setBusy('leave');
          const { error } = await supabase.from('group_members').delete().eq('group_id', id).eq('user_id', myId!);
          setBusy(null);
          if (error) setError('Could not leave the group. Please try again.');
          else router.back();
        },
      },
    ]);
  }

  function confirmDelete() {
    Alert.alert(`Delete "${name}"?`, 'This deletes the group and its whole calendar for everyone. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy('leave');
          const { error } = await supabase.from('groups').delete().eq('id', id);
          setBusy(null);
          if (error) setError('Could not delete the group. Please try again.');
          else router.back();
        },
      },
    ]);
  }

  if (notFound) {
    return (
      <Screen hasHeader>
        <Stack.Screen options={{ title: 'Group' }} />
        <ThemedText themeColor="textSecondary">This group doesn&apos;t exist or you&apos;re not a member.</ThemedText>
        <Button title="Back to my groups" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen hasHeader centered={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Stack.Screen options={{ title: name }} />

      <ThemedView type="backgroundElement" style={styles.placeholder}>
        <ThemedText type="small" themeColor="textSecondary">
          The shared calendar and message feed will appear here.
        </ThemedText>
      </ThemedView>

      <ThemedText type="smallBold">
        {members.length} {members.length === 1 ? 'member' : 'members'}
      </ThemedText>
      {members.map((m) => (
        <ThemedView key={m.userId} style={styles.member}>
          <ThemedText>
            {m.displayName}
            {m.userId === myId ? ' (you)' : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {m.role === 'owner' ? 'Owner · ' : ''}
            {formatTimezone(m.timezone)}
          </ThemedText>
        </ThemedView>
      ))}

      <ErrorText message={error} />
      <Button title="Invite people" onPress={invite} loading={busy === 'invite'} />
      {isOwner ? (
        <Button title="Delete group" variant="secondary" onPress={confirmDelete} loading={busy === 'leave'} />
      ) : (
        <Button title="Leave group" variant="secondary" onPress={confirmLeave} loading={busy === 'leave'} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  member: {
    gap: Spacing.half,
  },
});
