// Date helpers for the app. Timezone math is shared with the Edge Function.
import {
  addDays as plusDays,
  dateToUtcMidnight as dayToUtc,
  utcMidnightToDate as utcToDay,
  utcToWall as toWall,
} from '../../supabase/functions/_shared/zoned-time';
export {
  addDays,
  dateToUtcMidnight,
  utcMidnightToDate,
  utcToWall,
  wallToUtc,
} from '../../supabase/functions/_shared/zoned-time';

const DAY_MS = 24 * 60 * 60 * 1000;

/** All-day events are stored as UTC-midnight "floating" dates, so they're shown in UTC. */
export function displayTimeZone(allDay: boolean, userTimeZone: string) {
  return allDay ? 'UTC' : userTimeZone;
}

export function formatDay(instant: Date, timeZone: string) {
  return instant.toLocaleDateString(undefined, { timeZone, weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatTime(instant: Date, timeZone: string) {
  return instant.toLocaleTimeString(undefined, { timeZone, hour: '2-digit', minute: '2-digit' });
}

/** "Thu 8 Oct · 19:00–20:00", "Sat 24 Oct – Mon 26 Oct · all day". */
export function formatEventWhen(
  event: { start_at: string; end_at: string | null; all_day: boolean },
  userTimeZone: string,
) {
  const start = new Date(event.start_at);
  const end = event.end_at ? new Date(event.end_at) : null;
  if (event.all_day) {
    const lastDay = end ? new Date(end.getTime() - DAY_MS) : start;
    const sameDay = lastDay.getTime() <= start.getTime();
    return sameDay
      ? `${formatDay(start, 'UTC')} · all day`
      : `${formatDay(start, 'UTC')} – ${formatDay(lastDay, 'UTC')} · all day`;
  }
  const tz = userTimeZone;
  if (!end) return `${formatDay(start, tz)} · ${formatTime(start, tz)}`;
  const sameDay = formatDay(start, tz) === formatDay(end, tz);
  return sameDay
    ? `${formatDay(start, tz)} · ${formatTime(start, tz)}–${formatTime(end, tz)}`
    : `${formatDay(start, tz)} ${formatTime(start, tz)} – ${formatDay(end, tz)} ${formatTime(end, tz)}`;
}

// ----------------------------------------------------------------------------- calendar days
// A "day" is a YYYY-MM-DD string in the viewer's timezone.

/** Today in the given timezone. */
export function todayIn(timeZone: string) {
  return toWall(new Date(), timeZone).date;
}

/** The Monday of the week containing `day`. */
export function mondayOf(day: string) {
  const weekday = dayToUtc(day).getUTCDay(); // 0 = Sunday
  return plusDays(day, -((weekday + 6) % 7));
}

/** "Thursday 8 October" for a day header. */
export function formatDayHeader(day: string) {
  return dayToUtc(day).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** "5 – 11 Oct" for a week starting on `monday`. */
export function formatWeekRange(monday: string) {
  const fmt = (d: string) => dayToUtc(d).toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short' });
  return `${fmt(monday)} – ${fmt(plusDays(monday, 6))}`;
}

/**
 * The viewer's days an event appears on. All-day events cover each of their
 * dates; timed events appear on the day they start in the viewer's timezone.
 */
export function eventDays(event: { start_at: string; end_at: string | null; all_day: boolean }, timeZone: string) {
  const start = new Date(event.start_at);
  if (!event.all_day) return [toWall(start, timeZone).date];
  const first = utcToDay(start);
  const lastExclusive = event.end_at ? utcToDay(new Date(event.end_at)) : plusDays(first, 1);
  const days: string[] = [];
  for (let d = first; d < lastExclusive && days.length < 366; d = plusDays(d, 1)) days.push(d);
  return days.length ? days : [first];
}
