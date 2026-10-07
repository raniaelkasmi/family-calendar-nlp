import { Link, router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { EventDraftCard } from '@/components/event-draft-card';
import { ErrorText } from '@/components/form';
import { GroupCalendar } from '@/components/group-calendar';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { formatEventWhen } from '@/lib/datetime';
import { requestParse, type ParseResponse } from '@/lib/parse-message';
import { supabase } from '@/lib/supabase';
import { useGroupRealtime } from '@/lib/use-group-realtime';

type FeedItem = {
  id: string;
  eventId: string;
  rawText: string;
  author: string;
  event: { title: string; start_at: string; end_at: string | null; all_day: boolean; location: string | null };
};
type Member = { userId: string; displayName: string };

const IOS_HEADER_HEIGHT = 44;

export default function GroupFeedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const timeZone = profile?.timezone ?? 'UTC';

  const [name, setName] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [text, setText] = useState('');
  const [sentText, setSentText] = useState('');
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<ParseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'feed' | 'calendar'>('feed');
  // Bumped on every live change so the calendar reloads too.
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    const [groupRes, membersRes, feedRes] = await Promise.all([
      supabase.from('groups').select('name').eq('id', id).maybeSingle(),
      supabase.from('group_members').select('user_id, profiles(display_name)').eq('group_id', id),
      // RLS returns saved messages from everyone (drafts stay private).
      supabase
        .from('parsed_messages')
        .select(
          'id, event_id, raw_text, author:profiles(display_name), event:events(title, start_at, end_at, all_day, location)',
        )
        .eq('group_id', id)
        .not('event_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    if (groupRes.error || membersRes.error || feedRes.error) {
      setError('Could not load this group.');
      return;
    }
    setError(null);
    setName(groupRes.data?.name ?? '');
    setMembers(
      membersRes.data
        .map((m) => ({ userId: m.user_id, displayName: m.profiles?.display_name ?? 'Unknown' }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    );
    setItems(
      feedRes.data.flatMap((m) =>
        m.event && m.event_id
          ? [
              {
                id: m.id,
                eventId: m.event_id,
                rawText: m.raw_text,
                author: m.author?.display_name ?? 'Someone',
                event: m.event,
              },
            ]
          : [],
      ),
    );
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
      setVersion((v) => v + 1);
    }, [load]),
  );

  // Live updates: any member saving, editing or deleting an event.
  useGroupRealtime(id, () => {
    load();
    setVersion((v) => v + 1);
  });

  async function send() {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await requestParse(id, message);
      setSentText(message);
      setText('');
      setDraft(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function dismissDraft() {
    // Closing the sheet without saving counts as discarding (recorded for the dataset).
    if (draft) await supabase.from('parsed_messages').update({ outcome: 'discarded' }).eq('id', draft.message_id);
    setDraft(null);
  }

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen
        options={{
          title: name,
          headerRight: () => (
            <Link href={{ pathname: '/groups/[id]/members', params: { id } }} asChild>
              <Pressable accessibilityRole="button" hitSlop={8}>
                <ThemedText themeColor="primary">Members</ThemedText>
              </Pressable>
            </Link>
          ),
        }}
      />
      <ThemedView style={styles.switcher}>
        <Segmented
          options={[
            { value: 'feed', label: 'Feed' },
            { value: 'calendar', label: 'Calendar' },
          ]}
          value={view}
          onChange={setView}
        />
      </ThemedView>

      {view === 'calendar' ? (
        <GroupCalendar groupId={id} timeZone={timeZone} version={version} />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + IOS_HEADER_HEIGHT : 0}>
          {items && items.length === 0 ? (
            <ThemedView style={styles.empty}>
              <ThemedText type="smallBold">Nothing planned yet</ThemedText>
              <ThemedText themeColor="textSecondary">
                Write a plan the way you&apos;d say it, in French, English or Arabic: &quot;Dinner at Sara&apos;s
                Thursday 7pm&quot;, &quot;Vol de maman le 20 décembre à 14h&quot;.
              </ThemedText>
            </ThemedView>
          ) : (
            // Inverted: newest at the bottom, next to the input, like a chat.
            <FlatList
              inverted
              data={items ?? []}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({ pathname: '/groups/[id]/events/[eventId]', params: { id, eventId: item.eventId } })
                  }>
                  <ThemedView type="backgroundElement" style={styles.item}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.author}: “{item.rawText}”
                    </ThemedText>
                    <ThemedText type="smallBold" style={styles.itemTitle}>
                      {item.event.title}
                    </ThemedText>
                    <ThemedText type="small">{formatEventWhen(item.event, timeZone)}</ThemedText>
                    {item.event.location && (
                      <ThemedText type="small" themeColor="textSecondary">
                        {item.event.location}
                      </ThemedText>
                    )}
                  </ThemedView>
                </Pressable>
              )}
            />
          )}

          <SafeAreaView edges={['bottom']}>
            {error && (
              <ThemedView style={styles.errorRow}>
                <ErrorText message={error} />
              </ThemedView>
            )}
            <ThemedView style={[styles.inputBar, { borderTopColor: theme.border }]}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Write a plan…"
                placeholderTextColor={theme.textSecondary}
                multiline
                maxLength={500}
                editable={!sending}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                onPress={send}
                disabled={sending || !text.trim()}
                style={[styles.send, { backgroundColor: theme.primary }, (!text.trim() || sending) && styles.disabled]}>
                {sending ? (
                  <ActivityIndicator color={theme.onPrimary} />
                ) : (
                  <ThemedText style={{ color: theme.onPrimary }}>Send</ThemedText>
                )}
              </Pressable>
            </ThemedView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      )}

      <Modal visible={draft !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={dismissDraft}>
        <ThemedView style={styles.flex}>
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
              <ThemedText type="subtitle">Check the event</ThemedText>
              <ThemedText themeColor="textSecondary">“{sentText}”</ThemedText>
              {draft && (
                <EventDraftCard
                  draft={draft}
                  members={members}
                  timeZone={timeZone}
                  onSaved={() => {
                    setDraft(null);
                    load();
                  }}
                  onDiscarded={() => setDraft(null)}
                  onRephrase={() => {
                    setText(sentText);
                    setDraft(null);
                  }}
                />
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </ThemedView>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  switcher: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  item: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.half,
  },
  itemTitle: {
    fontSize: 17,
  },
  errorRow: {
    paddingHorizontal: Spacing.three,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two + Spacing.one,
    paddingBottom: Spacing.two + Spacing.one,
    fontSize: 16,
  },
  send: {
    height: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  sheet: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
