import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch } from 'react-native';

import { DateTimeField } from '@/components/date-time-field';
import { Button, ErrorText, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, dateToUtcMidnight, utcMidnightToDate, utcToWall, wallToUtc } from '@/lib/datetime';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type EventValues = {
  title: string;
  allDay: boolean;
  start: Date;
  end: Date; // exclusive for all-day events
  location: string;
  participantIds: string[];
};

export type FormMember = { userId: string; displayName: string };

type Props = {
  initial: EventValues;
  members: FormMember[];
  /** Timed events are shown and edited in this timezone; all-day events in UTC. */
  timeZone: string;
  submitLabel: string;
  /** Returns an error message to show, or null on success. */
  onSubmit: (values: EventValues) => Promise<string | null>;
  header?: ReactNode;
  footer?: ReactNode;
  participantsNote?: string;
};

/** Editable event fields, shared by the draft confirmation sheet and the edit screen. */
export function EventForm({ initial, members, timeZone, submitLabel, onSubmit, header, footer, participantsNote }: Props) {
  const theme = useTheme();
  const [title, setTitle] = useState(initial.title);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [location, setLocation] = useState(initial.location);
  const [participantIds, setParticipantIds] = useState(initial.participantIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickerZone = allDay ? 'UTC' : timeZone;
  // For all-day events the stored end is exclusive; show the last day instead.
  const shownEnd = allDay ? new Date(end.getTime() - DAY_MS) : end;

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
      const s = wallToUtc(utcMidnightToDate(start), '12:00', timeZone);
      setStart(s);
      setEnd(new Date(s.getTime() + HOUR_MS));
    }
  }

  function toggleParticipant(id: string) {
    setParticipantIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function submit() {
    if (!title.trim()) return setError('Please give the event a title.');
    if (end.getTime() <= start.getTime()) return setError('The end must be after the start.');
    setSaving(true);
    setError(null);
    const message = await onSubmit({ title: title.trim(), allDay, start, end, location: location.trim(), participantIds });
    setSaving(false);
    setError(message);
  }

  return (
    <ThemedView style={styles.form}>
      {header}

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
        {participantsNote && (
          <ThemedText type="small" themeColor="textSecondary">
            {participantsNote}
          </ThemedText>
        )}
      </ThemedView>

      <ErrorText message={error} />
      <Button title={submitLabel} onPress={submit} loading={saving} />
      {footer}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Spacing.three,
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
