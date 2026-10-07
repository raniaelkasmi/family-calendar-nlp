import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/form';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  addDays,
  eventDays,
  formatDayHeader,
  formatTime,
  formatWeekRange,
  mondayOf,
  todayIn,
  wallToUtc,
} from '@/lib/datetime';
import { supabase } from '@/lib/supabase';

type CalendarEvent = {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  location: string | null;
  participantCount: number;
};
type Mode = 'week' | 'list';

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 100;

type Props = {
  groupId: string;
  /** The viewer's timezone: days and times are shown in it. */
  timeZone: string;
  /** Changes whenever the group's events change (Realtime), to trigger a reload. */
  version: number;
};

export function GroupCalendar({ groupId, timeZone, version }: Props) {
  const theme = useTheme();
  const today = todayIn(timeZone);
  const [mode, setMode] = useState<Mode>('week');
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let query = supabase
      .from('events')
      .select('id, title, start_at, end_at, all_day, location, event_participants(count)')
      .eq('group_id', groupId)
      .order('start_at', { ascending: true });

    if (mode === 'week') {
      // One day of margin on each side: all-day events are UTC dates, and
      // eventDays() below decides which of the viewer's days they fall on.
      const from = new Date(wallToUtc(monday, '00:00', timeZone).getTime() - DAY_MS).toISOString();
      const to = new Date(wallToUtc(addDays(monday, 7), '00:00', timeZone).getTime() + DAY_MS).toISOString();
      query = query.lt('start_at', to).or(`end_at.gt.${from},end_at.is.null`);
    } else {
      query = query.or(`end_at.gt.${new Date().toISOString()},start_at.gte.${new Date().toISOString()}`).limit(LIST_LIMIT);
    }

    query.then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setError('Could not load the calendar.');
        return;
      }
      setError(null);
      setEvents(
        data.map((e) => ({
          id: e.id,
          title: e.title,
          start_at: e.start_at,
          end_at: e.end_at,
          all_day: e.all_day,
          location: e.location,
          participantCount: e.event_participants[0]?.count ?? 0,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [groupId, timeZone, mode, monday, version]);

  // Group events by the viewer's day. All-day events first, then by start time.
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events ?? []) {
    for (const day of eventDays(e, timeZone)) {
      const key = mode === 'list' && day < today ? today : day; // ongoing events show under today
      if (mode === 'list' && byDay.get(key)?.some((x) => x.id === e.id)) continue;
      byDay.set(key, [...(byDay.get(key) ?? []), e]);
    }
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start_at.localeCompare(b.start_at));
  }

  const days =
    mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(monday, i)) : [...byDay.keys()].sort();

  return (
    <ThemedView style={styles.flex}>
      <ThemedView style={styles.toolbar}>
        <Segmented
          options={[
            { value: 'week', label: 'Week' },
            { value: 'list', label: 'Upcoming' },
          ]}
          value={mode}
          onChange={setMode}
        />
        <Button
          title="Find a time"
          variant="secondary"
          onPress={() => router.push({ pathname: '/groups/[id]/find-time', params: { id: groupId } })}
        />
        {mode === 'week' && (
          <ThemedView style={styles.weekNav}>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous week" hitSlop={12} onPress={() => setMonday(addDays(monday, -7))}>
              <ThemedText type="subtitle" themeColor="primary">‹</ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to this week" onPress={() => setMonday(mondayOf(today))}>
              <ThemedText type="smallBold">{formatWeekRange(monday)}</ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next week" hitSlop={12} onPress={() => setMonday(addDays(monday, 7))}>
              <ThemedText type="subtitle" themeColor="primary">›</ThemedText>
            </Pressable>
          </ThemedView>
        )}
      </ThemedView>

      <ScrollView contentContainerStyle={styles.content}>
        {error && <ThemedText themeColor="danger">{error}</ThemedText>}
        {mode === 'list' && events?.length === 0 && (
          <ThemedText themeColor="textSecondary">Nothing coming up. Write a plan in the feed to add one.</ThemedText>
        )}

        {days.map((day) => {
          const list = byDay.get(day) ?? [];
          const isToday = day === today;
          return (
            <ThemedView key={day} style={styles.day}>
              <ThemedText type="smallBold" themeColor={isToday ? 'primary' : 'textSecondary'}>
                {isToday ? 'Today · ' : ''}
                {formatDayHeader(day)}
              </ThemedText>
              {list.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  —
                </ThemedText>
              )}
              {list.map((e) => (
                <Pressable
                  key={e.id}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/groups/[id]/events/[eventId]', params: { id: groupId, eventId: e.id } })}>
                  {({ pressed }) => (
                    <ThemedView type="backgroundElement" style={[styles.event, { borderLeftColor: theme.primary }, pressed && styles.pressed]}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.time}>
                        {e.all_day ? 'all day' : formatTime(new Date(e.start_at), timeZone)}
                      </ThemedText>
                      <ThemedView style={styles.eventBody}>
                        <ThemedText type="smallBold">{e.title}</ThemedText>
                        {(e.location || e.participantCount > 0) && (
                          <ThemedText type="small" themeColor="textSecondary">
                            {[e.location, e.participantCount > 0 && `${e.participantCount} ${e.participantCount === 1 ? 'person' : 'people'}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </ThemedText>
                        )}
                      </ThemedView>
                    </ThemedView>
                  )}
                </Pressable>
              ))}
            </ThemedView>
          );
        })}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  toolbar: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  weekNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  day: {
    gap: Spacing.one + Spacing.half,
  },
  event: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.two + Spacing.one,
    borderRadius: Spacing.two,
    borderLeftWidth: 3,
  },
  time: {
    width: 52,
  },
  eventBody: {
    flex: 1,
    gap: Spacing.half,
    backgroundColor: 'transparent',
  },
  pressed: {
    opacity: 0.7,
  },
});
