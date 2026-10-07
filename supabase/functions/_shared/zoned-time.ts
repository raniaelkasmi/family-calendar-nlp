// Timezone math with no dependencies (only Intl), shared by the Edge Function,
// the evaluation script (Node) and the app (Hermes).
//
// "Wall time" = what a clock on the wall shows in a given timezone,
// e.g. date "2026-10-30" + time "18:00" in "Europe/Paris".

export type WallTime = { date: string; time: string; weekday: string };

const pad = (n: number) => String(n).padStart(2, '0');

function partsIn(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24, // some engines print midnight as "24"
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: get('weekday'),
  };
}

/** UTC offset of `timeZone` at `instant`, in minutes (Paris in summer → 120). */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - wholeSeconds) / 60000);
}

/** The wall date/time/weekday that `instant` shows in `timeZone`. */
export function utcToWall(instant: Date, timeZone: string): WallTime {
  const p = partsIn(instant, timeZone);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
    weekday: p.weekday,
  };
}

/** The instant when clocks in `timeZone` show `date` (YYYY-MM-DD) `time` (HH:MM). */
export function wallToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const asIfUtc = Date.UTC(y, m - 1, d, h, min);
  // Guess with the offset at that moment, then correct once if a DST change
  // falls between the guess and the answer.
  const first = offsetMinutes(new Date(asIfUtc), timeZone);
  let result = asIfUtc - first * 60000;
  const second = offsetMinutes(new Date(result), timeZone);
  if (second !== first) result = asIfUtc - second * 60000;
  return new Date(result);
}

/** "2026-10-30" + 3 → "2026-11-02" (calendar arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Midnight UTC of a calendar date. All-day events are stored this way (a "floating" date). */
export function dateToUtcMidnight(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** The calendar date of an all-day event's stored instant. */
export function utcMidnightToDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
