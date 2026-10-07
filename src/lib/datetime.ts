// Date helpers for the app. Timezone math is shared with the Edge Function.
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
