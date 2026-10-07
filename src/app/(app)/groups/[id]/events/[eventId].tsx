import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { EventForm, type EventValues, type FormMember } from '@/components/event-form';
import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { formatEventWhen } from '@/lib/datetime';
import { supabase } from '@/lib/supabase';
import { useGroupRealtime } from '@/lib/use-group-realtime';

type EventDetail = {
  title: string;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  location: string | null;
  createdBy: string | null;
  creatorName: string | null;
  participants: FormMember[];
};

export default function EventScreen() {
  const { id: groupId, eventId } = useLocalSearchParams<{ id: string; eventId: string }>();
  const { session, profile } = useAuth();
  const timeZone = profile?.timezone ?? 'UTC';

  // undefined = loading, null = deleted or not visible
  const [event, setEvent] = useState<EventDetail | null | undefined>(undefined);
  const [members, setMembers] = useState<FormMember[]>([]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [eventRes, membersRes] = await Promise.all([
      supabase
        .from('events')
        .select(
          'title, start_at, end_at, all_day, location, created_by, creator:profiles(display_name), event_participants(user_id, profiles(display_name))',
        )
        .eq('id', eventId)
        .maybeSingle(),
      supabase.from('group_members').select('user_id, profiles(display_name)').eq('group_id', groupId),
    ]);
    if (eventRes.error || membersRes.error) {
      setError('Could not load this event.');
      return;
    }
    const e = eventRes.data;
    setEvent(
      e && {
        title: e.title,
        start_at: e.start_at,
        end_at: e.end_at,
        all_day: e.all_day,
        location: e.location,
        createdBy: e.created_by,
        creatorName: e.creator?.display_name ?? null,
        participants: e.event_participants.map((p) => ({
          userId: p.user_id,
          displayName: p.profiles?.display_name ?? 'Unknown',
        })),
      },
    );
    setMembers(
      membersRes.data
        .map((m) => ({ userId: m.user_id, displayName: m.profiles?.display_name ?? 'Unknown' }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    );
  }, [eventId, groupId]);

  useEffect(() => {
    let cancelled = false;
    // Defer so state updates happen in a callback, not synchronously in the effect.
    Promise.resolve().then(() => {
      if (!cancelled) load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Someone else may edit or delete this event while it's open.
  useGroupRealtime(groupId, load);

  const isCreator = !!event && event.createdBy === session?.user.id;

  async function saveEdit(v: EventValues) {
    const { error } = await supabase.rpc('update_event', {
      p_event_id: eventId,
      p_title: v.title,
      p_start_at: v.start.toISOString(),
      p_end_at: v.end.toISOString(),
      p_all_day: v.allDay,
      p_location: v.location,
      p_participant_ids: v.participantIds,
    });
    if (error) return 'Could not save your changes. Please try again.';
    setEditing(false);
    await load();
    return null;
  }

  function confirmDelete() {
    Alert.alert('Delete this event?', 'It will disappear from everyone’s calendar.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          const { error } = await supabase.from('events').delete().eq('id', eventId);
          setDeleting(false);
          if (error) setError('Could not delete the event. Please try again.');
          else router.back();
        },
      },
    ]);
  }

  if (event === undefined) {
    return (
      <Screen hasHeader>
        <ThemedText themeColor="textSecondary">Loading…</ThemedText>
      </Screen>
    );
  }

  if (event === null) {
    return (
      <Screen hasHeader>
        <Stack.Screen options={{ title: 'Event' }} />
        <ThemedText themeColor="textSecondary">This event was deleted.</ThemedText>
        <Button title="Back" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (editing) {
    return (
      <Screen hasHeader centered={false}>
        <Stack.Screen options={{ title: 'Edit event' }} />
        <EventForm
          initial={{
            title: event.title,
            allDay: event.all_day,
            start: new Date(event.start_at),
            end: event.end_at ? new Date(event.end_at) : new Date(new Date(event.start_at).getTime() + 3600000),
            location: event.location ?? '',
            participantIds: event.participants.map((p) => p.userId),
          }}
          members={members}
          timeZone={timeZone}
          submitLabel="Save changes"
          onSubmit={saveEdit}
          footer={<Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} />}
        />
      </Screen>
    );
  }

  return (
    <Screen hasHeader centered={false}>
      <Stack.Screen options={{ title: 'Event' }} />
      <ThemedText type="subtitle">{event.title}</ThemedText>
      <ThemedText>{formatEventWhen(event, timeZone)}</ThemedText>
      {event.location && <ThemedText themeColor="textSecondary">{event.location}</ThemedText>}

      <ThemedView style={styles.section}>
        <ThemedText type="smallBold">
          {event.participants.length === 0
            ? 'No participants yet'
            : `${event.participants.length} ${event.participants.length === 1 ? 'participant' : 'participants'}`}
        </ThemedText>
        {event.participants.map((p) => (
          <ThemedText key={p.userId}>{p.displayName}</ThemedText>
        ))}
      </ThemedView>

      {event.creatorName && (
        <ThemedText type="small" themeColor="textSecondary">
          Added by {event.creatorName}
        </ThemedText>
      )}

      <ErrorText message={error} />
      {isCreator && (
        <ThemedView style={styles.section}>
          <Button title="Edit" onPress={() => setEditing(true)} />
          <Button title="Delete" variant="secondary" onPress={confirmDelete} loading={deleting} />
        </ThemedView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
});
