import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet } from 'react-native';

import { DateTimeField } from '@/components/date-time-field';
import { EventForm, type EventValues, type FormMember } from '@/components/event-form';
import { Button, ErrorText, TextField } from '@/components/form';
import { Screen } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { addDays, formatDay, formatTime, todayIn, utcToWall, wallToUtc } from '@/lib/datetime';
import { supabase } from '@/lib/supabase';
import { formatTimezone } from '@/lib/timezones';
import { findSlots, type DayWindow, type Slot, type SlotPerson } from '@shared/find-slots.ts';

const DURATIONS = [30, 60, 120, 180];
const WINDOWS: Record<'any' | 'day' | 'evening', DayWindow> = {
  any: { start: '08:00', end: '22:00' },
  day: { start: '09:00', end: '18:00' },
  evening: { start: '18:00', end: '22:00' },
};
const DAY_MS = 24 * 60 * 60 * 1000;

type Person = SlotPerson & { displayName: string };
type Period = '7' | '14' | 'custom';

function durationLabel(min: number) {
  return min < 60 ? `${min} min` : `${min / 60} h`;
}

export default function FindTimeScreen() {
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const theme = useTheme();
  const viewerTz = profile?.timezone ?? 'UTC';
  const today = todayIn(viewerTz);

  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [duration, setDuration] = useState(60);
  const [period, setPeriod] = useState<Period>('7');
  const [customFrom, setCustomFrom] = useState(() => wallToUtc(today, '12:00', viewerTz));
  const [customTo, setCustomTo] = useState(() => wallToUtc(addDays(today, 6), '12:00', viewerTz));
  const [windowKey, setWindowKey] = useState<keyof typeof WINDOWS>('evening');
  const [place, setPlace] = useState('');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<Slot | null>(null);

  useEffect(() => {
    supabase
      .from('group_members')
      .select('user_id, profiles(display_name, timezone)')
      .eq('group_id', groupId)
      .then(({ data, error }) => {
        if (error) return setError('Could not load the group members.');
        const list = data
          .map((m) => ({
            id: m.user_id,
            name: m.profiles?.display_name ?? 'Unknown',
            displayName: m.profiles?.display_name ?? 'Unknown',
            timeZone: m.profiles?.timezone ?? 'UTC',
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName));
        setPeople(list);
        setSelected(list.map((p) => p.id));
      });
  }, [groupId]);

  function toggle(personId: string) {
    setSlots(null);
    setSelected((ids) => (ids.includes(personId) ? ids.filter((x) => x !== personId) : [...ids, personId]));
  }

  async function search() {
    if (selected.length === 0) return setError('Pick at least one person.');
    const firstDay = period === 'custom' ? utcToWall(customFrom, viewerTz).date : today;
    const lastDay =
      period === 'custom' ? utcToWall(customTo, viewerTz).date : addDays(today, Number(period) - 1);
    if (lastDay < firstDay) return setError('The end date must be after the start date.');

    const from = wallToUtc(firstDay, '00:00', viewerTz);
    const to = wallToUtc(addDays(lastDay, 1), '00:00', viewerTz);
    setSearching(true);
    setError(null);
    // Busy times across all of their groups, without any details (see busy_times()).
    const { data, error } = await supabase.rpc('busy_times', {
      p_user_ids: selected,
      p_from: new Date(from.getTime() - DAY_MS).toISOString(),
      p_to: new Date(to.getTime() + DAY_MS).toISOString(),
      p_place: place.trim() || undefined,
    });
    setSearching(false);
    if (error) return setError('Could not check availability. Please try again.');

    setSlots(
      findSlots({
        people: people.filter((p) => selected.includes(p.id)),
        busy: data.map((b) => ({ userId: b.user_id, start: new Date(b.start_at), end: new Date(b.end_at) })),
        durationMin: duration,
        from,
        to,
        window: WINDOWS[windowKey],
        now: new Date(),
        viewerTimeZone: viewerTz,
      }),
    );
  }

  async function createEvent(values: EventValues) {
    const { data, error } = await supabase.rpc('create_event', {
      p_group_id: groupId,
      p_title: values.title,
      p_start_at: values.start.toISOString(),
      p_end_at: values.end.toISOString(),
      p_all_day: values.allDay,
      p_location: values.location,
      p_participant_ids: values.participantIds,
    });
    if (error) return 'Could not create the event. Please try again.';
    setCreating(null);
    router.replace({ pathname: '/groups/[id]/events/[eventId]', params: { id: groupId, eventId: data } });
    return null;
  }

  const chosen = people.filter((p) => selected.includes(p.id));
  // People whose timezone differs from mine get their own local time on each suggestion.
  const otherZones = [...new Set(chosen.map((p) => p.timeZone))].filter((tz) => tz !== viewerTz);
  const formMembers: FormMember[] = people.map((p) => ({ userId: p.id, displayName: p.displayName }));

  return (
    <Screen hasHeader centered={false}>
      <ThemedText type="smallBold">Who</ThemedText>
      <ThemedView style={styles.chips}>
        {people.map((p) => {
          const on = selected.includes(p.id);
          return (
            <Pressable
              key={p.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => toggle(p.id)}
              style={[styles.chip, { borderColor: on ? theme.primary : theme.border }, on && { backgroundColor: theme.primary }]}>
              <ThemedText type="small" style={on ? { color: theme.onPrimary } : undefined}>
                {p.displayName}
              </ThemedText>
            </Pressable>
          );
        })}
      </ThemedView>

      <ThemedText type="smallBold">How long</ThemedText>
      <Segmented
        options={DURATIONS.map((d) => ({ value: String(d), label: durationLabel(d) }))}
        value={String(duration)}
        onChange={(v) => {
          setDuration(Number(v));
          setSlots(null);
        }}
      />

      <ThemedText type="smallBold">When</ThemedText>
      <Segmented
        options={[
          { value: '7', label: 'Next 7 days' },
          { value: '14', label: 'Next 14 days' },
          { value: 'custom', label: 'Dates…' },
        ]}
        value={period}
        onChange={(v) => {
          setPeriod(v);
          setSlots(null);
        }}
      />
      {period === 'custom' && (
        <ThemedView style={styles.row}>
          <DateTimeField value={customFrom} mode="date" timeZoneName={viewerTz} onChange={setCustomFrom} accessibilityLabel="From" />
          <ThemedText themeColor="textSecondary">to</ThemedText>
          <DateTimeField value={customTo} mode="date" timeZoneName={viewerTz} onChange={setCustomTo} accessibilityLabel="To" />
        </ThemedView>
      )}

      <ThemedText type="smallBold">Time of day (in each person&apos;s timezone)</ThemedText>
      <Segmented
        options={[
          { value: 'any', label: 'Any 8–22' },
          { value: 'day', label: 'Day 9–18' },
          { value: 'evening', label: 'Evening 18–22' },
        ]}
        value={windowKey}
        onChange={(v) => {
          setWindowKey(v);
          setSlots(null);
        }}
      />

      <TextField
        label="Where (optional)"
        value={place}
        onChangeText={(t) => {
          setPlace(t);
          setSlots(null);
        }}
        placeholder="e.g. Lyon: people on a trip there count as free"
      />

      <ErrorText message={error} />
      <Button title="Find times" onPress={search} loading={searching} />

      {slots && slots.length === 0 && (
        <ThemedText themeColor="textSecondary">
          No time works for everyone. Try a longer period, a wider time of day, or fewer people.
        </ThemedText>
      )}
      {slots?.map((s) => (
        <ThemedView key={s.start.toISOString()} type="backgroundElement" style={styles.slot}>
          <ThemedText type="smallBold" style={styles.slotTitle}>
            {formatDay(s.start, viewerTz)} · {formatTime(s.start, viewerTz)}–{formatTime(s.end, viewerTz)}
          </ThemedText>
          {otherZones.map((tz) => (
            <ThemedText key={tz} type="small" themeColor="textSecondary">
              {formatTime(s.start, tz)}–{formatTime(s.end, tz)} for{' '}
              {chosen.filter((p) => p.timeZone === tz).map((p) => p.displayName).join(', ')} ({formatTimezone(tz)})
            </ThemedText>
          ))}
          <Pressable accessibilityRole="button" onPress={() => setCreating(s)} hitSlop={8}>
            <ThemedText themeColor="primary">Create event</ThemedText>
          </Pressable>
        </ThemedView>
      ))}

      <Modal
        visible={creating !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCreating(null)}>
        <ThemedView style={styles.flex}>
          <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
            <ThemedText type="subtitle">New event</ThemedText>
            {creating && (
              <EventForm
                initial={{
                  title: '',
                  allDay: false,
                  start: creating.start,
                  end: creating.end,
                  location: place.trim(),
                  participantIds: selected,
                }}
                members={formMembers}
                timeZone={viewerTz}
                submitLabel="Create event"
                onSubmit={createEvent}
                footer={<Button title="Cancel" variant="secondary" onPress={() => setCreating(null)} />}
              />
            )}
          </ScrollView>
        </ThemedView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  slot: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  slotTitle: {
    fontSize: 17,
  },
  sheet: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
