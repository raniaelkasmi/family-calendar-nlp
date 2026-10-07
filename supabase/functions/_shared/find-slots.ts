// "Find a time": suggests the best slots where everyone is free, respecting
// each person's hours in their own timezone. Pure TypeScript (no I/O), used by
// the app and covered by offline tests (find-slots.test.ts).

import { utcToWall } from './zoned-time.ts';

export type SlotPerson = { id: string; name: string; timeZone: string };
export type BusyInterval = { userId: string; start: Date; end: Date };
/** Local hours, e.g. { start: '18:00', end: '22:00' }, applied in each person's own timezone. */
export type DayWindow = { start: string; end: string };

export type SlotRequest = {
  people: SlotPerson[];
  busy: BusyInterval[];
  durationMin: number;
  from: Date; // search range (instants)
  to: Date;
  window: DayWindow;
  now: Date;
  /** Days are counted in this timezone to spread suggestions (the viewer's). */
  viewerTimeZone: string;
  count?: number; // default 3
  stepMin?: number; // default 30
};

export type Slot = { start: Date; end: Date; score: number };

const MIN = 60_000;
const BREATHING_MIN = 30; // preferred gap around existing events
const HORIZON_DAYS = 14; // sooner is better, fading over two weeks

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** True if [start, end] fits within the person's local window, on a single local day. */
function fitsWindow(start: Date, end: Date, timeZone: string, window: DayWindow) {
  const s = utcToWall(start, timeZone);
  const e = utcToWall(end, timeZone);
  const sMin = minutesOf(s.time);
  // An end exactly at midnight belongs to the previous day.
  const eMin = e.date !== s.date && e.time === '00:00' ? 24 * 60 : minutesOf(e.time);
  if (e.date !== s.date && eMin !== 24 * 60) return false;
  return sMin >= minutesOf(window.start) && eMin <= minutesOf(window.end);
}

/** 1 when the slot is centered in the person's window, 0 at its edges. */
function centrality(start: Date, end: Date, timeZone: string, window: DayWindow) {
  const mid = new Date((start.getTime() + end.getTime()) / 2);
  const midMin = minutesOf(utcToWall(mid, timeZone).time);
  const wStart = minutesOf(window.start);
  const wEnd = minutesOf(window.end);
  const half = (wEnd - wStart) / 2 || 1;
  return Math.max(0, 1 - Math.abs(midMin - (wStart + half)) / half);
}

export function findSlots(req: SlotRequest): Slot[] {
  const count = req.count ?? 3;
  const step = (req.stepMin ?? 30) * MIN;
  const duration = req.durationMin * MIN;
  const ids = new Set(req.people.map((p) => p.id));
  const busy = req.busy.filter((b) => ids.has(b.userId));

  // Candidate starts on a step grid, never in the past.
  const first = Math.ceil(Math.max(req.from.getTime(), req.now.getTime()) / step) * step;
  const candidates: Slot[] = [];

  for (let t = first; t + duration <= req.to.getTime(); t += step) {
    const start = new Date(t);
    const end = new Date(t + duration);

    if (!req.people.every((p) => fitsWindow(start, end, p.timeZone, req.window))) continue;
    if (busy.some((b) => b.start.getTime() < end.getTime() && b.end.getTime() > start.getTime())) continue;

    // Score: centered in everyone's window, some room around other events, sooner.
    const center = req.people.reduce((sum, p) => sum + centrality(start, end, p.timeZone, req.window), 0) / req.people.length;
    const tight = busy.some(
      (b) =>
        Math.abs(b.end.getTime() - start.getTime()) < BREATHING_MIN * MIN ||
        Math.abs(b.start.getTime() - end.getTime()) < BREATHING_MIN * MIN,
    );
    const daysAhead = (t - req.now.getTime()) / (24 * 60 * MIN);
    const soon = Math.max(0, 1 - daysAhead / HORIZON_DAYS);
    const score = 3 * center + 2 * soon + (tight ? 0 : 1);

    candidates.push({ start, end, score });
  }

  candidates.sort((a, b) => b.score - a.score || a.start.getTime() - b.start.getTime());

  // Prefer one suggestion per day (viewer's days), then fill with non-overlapping ones.
  const picked: Slot[] = [];
  const usedDays = new Set<string>();
  for (const c of candidates) {
    if (picked.length === count) break;
    const day = utcToWall(c.start, req.viewerTimeZone).date;
    if (usedDays.has(day)) continue;
    usedDays.add(day);
    picked.push(c);
  }
  for (const c of candidates) {
    if (picked.length === count) break;
    const overlaps = picked.some((p) => p.start < c.end && c.start < p.end);
    if (!overlaps && !picked.includes(c)) picked.push(c);
  }
  return picked.sort((a, b) => a.start.getTime() - b.start.getTime());
}
