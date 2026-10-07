import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

type GroupItem = { id: string; name: string; memberCount: number };

export default function MyGroupsScreen() {
  const [groups, setGroups] = useState<GroupItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // RLS only returns the groups I'm a member of.
    const { data, error } = await supabase
      .from('groups')
      .select('id, name, group_members(count)')
      .order('created_at', { ascending: true });
    if (error) {
      setError('Could not load your groups. Pull down to retry.');
      return;
    }
    setError(null);
    setGroups(
      data.map((g) => ({ id: g.id, name: g.name, memberCount: g.group_members[0]?.count ?? 0 })),
    );
  }, []);

  // Reload every time the screen comes back into view (after creating, joining or leaving).
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

  return (
    <Screen hasHeader centered={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <ErrorText message={error} />

      {groups?.length === 0 && (
        <ThemedView style={styles.empty}>
          <ThemedText type="smallBold">No groups yet</ThemedText>
          <ThemedText themeColor="textSecondary">
            Create a group for your family or friends, or join one with an invitation code.
          </ThemedText>
        </ThemedView>
      )}

      {groups?.map((group) => (
        <Link key={group.id} href={{ pathname: '/groups/[id]', params: { id: group.id } }} asChild>
          <Pressable accessibilityRole="button">
            {({ pressed }) => (
              <ThemedView type="backgroundElement" style={[styles.card, pressed && styles.pressed]}>
                <ThemedText type="smallBold" style={styles.cardTitle}>
                  {group.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
                </ThemedText>
              </ThemedView>
            )}
          </Pressable>
        </Link>
      ))}

      <ThemedView style={styles.actions}>
        <Button title="New group" onPress={() => router.push('/groups/new')} />
        <Button title="Join with a code" variant="secondary" onPress={() => router.push('/join')} />
      </ThemedView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 24,
  },
  pressed: {
    opacity: 0.7,
  },
  actions: {
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
});
