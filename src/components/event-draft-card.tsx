import { useState } from 'react';
import { Pressable, StyleSheet, Switch } from 'react-native';

import { DateTimeField } from '@/components/date-time-field';
import { Button, ErrorText, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, dateToUtcMidnight, utcMidnightToDate, utcToWall, wallToUtc } from '@/lib/datetime';
import { LOW_CONFIDENCE, type ParseResponse } from '@/lib/parse-message';
import { supabase } from '@/lib/supabase';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Member = { userId: string; displayName: string };

type Props = {
  draft: ParseResponse;
  members: Member[];
  /** The author's timezone: timed events are shown and edited in it. */
  timeZone: string;
  onSaved: () => void;
  onDiscarded: () => void;
  /** Discard and put the text back in the input to rephrase it. */
  onRephrase: () => void;
};

function nextFullHour() {
  return new Date(Math.ceil(Date.now() / HOUR_MS) * HOUR_MS);
}

/**
 * What the assistant understood, fully editable before saving.
 * All-day events use UTC-midnight dates and an exclusive end.
 */
export function EventDraftCard({ draft, members, timeZone, onSaved, onDiscarded, onRephrase }: Props) {
  const theme = useTheme();
  const initial = draft.event;

  const [title, setTitle] = useState(initial?.title ?? '');
  const [allDay, setAllDay] = useState(initial?.all_day ?? false);
  const [start, setStart] = useState(() => (initial ? new Date(initial.start_at) : nextFullHour()));
  const [end, setEnd] = useState(() =>
    initial ? new Date(initial.end_at) : new Date(nextFullHour().getTime() + HOUR_MS),
  );
  const [location, setLocation] = useState(initial?.location ?? '');
  const [participantIds, setParticipantIds] = useState<string[]>(initial?.participant_ids ?? []);
  const [busy, setBusy] = useState<'save' | 'discard' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickerZone = allDay ? 'UTC' : timeZone;
  // For all-day events the end is exclusive; show the last day instead.
  const shownEnd = allDay ? new Date(end.getTime() - DAY_MS) : end;

  const needsAttention = draft.failed || !draft.is_event || draft.confidence < LOW_CONFIDENCE || !initial;
  const notice = draft.failed
    ? "The assistant couldn't read this message. You can fill in the event yourself."
    : (draft.clarification_question ??
      (!draft.is_event ? "This doesn't look like an event. You can still create one by hand." : null));

  function changeStart(next: Date) {
    // Keep the duration when the start moves.
    const duration = end.getTime() - start.getTime();
    setStart(next);
    setEnd(new Date(next.getTime() + Math.max(duration, allDay ? DAY_MS : 0)));
  }

  function changeEnd(next: Date) {
    setEnd(allDay ? new Date(next.getTime() + DAY_MS) : next);
  }

  function toggleAllDay(value: boolean) {
    setAllDay(value);
    if (value) {
      const day = utcToWall(start, timeZone).date;
      setStart(dateToUtcMidnight(day));
      setEnd(dateToUtcMidnight(addDays(day, 1)));
    } else {
      const day = utcMidnightToDate(start);
      const s = wallToUtc(day, '12:00', timeZone);
      setStart(s);
      setEnd(new Date(s.getTime() + HOUR_MS));
    }
  }

  function toggleParticipant(id: string) {
    setParticipantIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function save() {
    if (!title.trim()) return setError('Please give the event a title.');
    if (end.getTime() <= start.getTime()) return setError('The end must be after the start.');
    setBusy('save');
    setError(null);
    const { error } = await supabase.rpc('save_event_from_message', {
      p_message_id: draft.message_id,
      p_title: title.trim(),
      p_start_at: start.toISOString(),
      p_end_at: end.toISOString(),
      p_all_day: allDay,
      p_location: location.trim(),
      p_participant_ids: participantIds,
    });
    setBusy(null);
    if (error) return setError('Could not save the event. Please try again.');
    onSaved();
  }

  async function discard(then: () => void) {
    setBusy('discard');
    // Recorded for the dataset: the user rejected this parse.
    await supabase.from('parsed_messages').update({ outcome: 'discarded' }).eq('id', draft.message_id);
    setBusy(null);
    then();
  }

  return (
    <ThemedView style={styles.card}>
      {needsAttention && notice && (
        <ThemedView type="backgroundElement" style={styles.notice}>
          <ThemedText>{notice}</ThemedText>
          <Pressable accessibilityRole="button" onPress={() => discard(onRephrase)} hitSlop={8}>
            <ThemedText themeColor="primary">Rephrase my message</ThemedText>
          </Pressable>
        </ThemedView>
      )}

      <TextField label="Title" value={title} onChangeText={setTitle} placeholder="What's happening?" maxLength={200} />

      <ThemedView style={styles.row}>
        <ThemedText type="smallBold">All day</ThemedText>
        <Switch value={allDay} onValueChange={toggleAllDay} accessibilityLabel="All day" />
      </ThemedView>

      <ThemedView style={styles.row}>
        <ThemedText type="smallBold">{allDay ? 'From' : 'Starts'}</ThemedText>
        <ThemedView style={styles.pickers}>
          <DateTimeField value={start} mode="date" timeZoneName={pickerZone} onChange={changeStart} accessibilityLabel="Start date" />
          {!allDay && (
            <DateTimeField value={start} mode="time" timeZoneName={pickerZone} onChange={changeStart} accessibilityLabel="Start time" />
          )}
        </ThemedView>
      </ThemedView>

      <ThemedView style={styles.row}>
        <ThemedText type="smallBold">{allDay ? 'To' : 'Ends'}</ThemedText>
        <ThemedView style={styles.pickers}>
          <DateTimeField value={shownEnd} mode="date" timeZoneName={pickerZone} onChange={changeEnd} accessibilityLabel="End date" />
          {!allDay && (
            <DateTimeField value={shownEnd} mode="time" timeZoneName={pickerZone} onChange={changeEnd} accessibilityLabel="End time" />
          )}
        </ThemedView>
      </ThemedView>

      <TextField label="Location" value={location} onChangeText={setLocation} placeholder="Optional" maxLength={200} />

      <ThemedView style={styles.field}>
        <ThemedText type="smallBold">Who&apos;s in?</ThemedText>
        <ThemedView style={styles.chips}>
          {members.map((m) => {
            const selected = participantIds.includes(m.userId);
            return (
              <Pressable
                key={m.userId}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => toggleParticipant(m.userId)}
                style={[
                  styles.chip,
                  { borderColor: selected ? theme.primary : theme.border },
                  selected && { backgroundColor: theme.primary },
                ]}>
                <ThemedText type="small" style={selected ? { color: theme.onPrimary } : undefined}>
                  {m.displayName}
                </ThemedText>
              </Pressable>
            );
          })}
        </ThemedView>
        {draft.unmatched_participants.length > 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            Not in this group: {draft.unmatched_participants.join(', ')}
          </ThemedText>
        )}
      </ThemedView>

      <ErrorText message={error} />
      <Button title="Save to calendar" onPress={save} loading={busy === 'save'} />
      <Button title="Discard" variant="secondary" onPress={() => discard(onDiscarded)} loading={busy === 'discard'} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three,
  },
  notice: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  pickers: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + Spacing.half,
  },
});
