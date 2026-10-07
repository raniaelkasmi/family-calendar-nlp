// Offline tests for "Find a time".   npm test

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findSlots, type SlotRequest } from './find-slots.ts';
import { utcToWall } from './zoned-time.ts';

const paris = { id: 'r', name: 'Rania', timeZone: 'Europe/Paris' };
const tokyo = { id: 't', name: 'Taro', timeZone: 'Asia/Tokyo' };
const evening = { start: '18:00', end: '22:00' };

const base: SlotRequest = {
  people: [paris],
  busy: [],
  durationMin: 60,
  from: new Date('2026-10-07T00:00:00Z'),
  to: new Date('2026-10-10T00:00:00Z'),
  window: evening,
  now: new Date('2026-10-07T08:00:00Z'), // Wed 10:00 in Paris
  viewerTimeZone: 'Europe/Paris',
};
const local = (d: Date, tz = 'Europe/Paris') => {
  const w = utcToWall(d, tz);
  return `${w.date} ${w.time}`;
};

test('suggests 3 slots on different days, inside the evening, centered', () => {
  const slots = findSlots(base);
  assert.equal(slots.length, 3);
  assert.deepEqual(
    slots.map((s) => local(s.start)),
    ['2026-10-07 19:30', '2026-10-08 19:30', '2026-10-09 19:30'],
  );
});

test('never suggests a slot in the past', () => {
  const slots = findSlots({ ...base, now: new Date('2026-10-07T19:00:00Z') }); // 21:00 in Paris
  assert.ok(slots.every((s) => s.start.getTime() >= Date.parse('2026-10-07T19:00:00Z')));
  // 21:00–22:00 still fits tonight's 18–22 window; nothing earlier today is offered.
  assert.equal(local(slots[0].start), '2026-10-07 21:00');
});

test('skips times when someone is busy', () => {
  const busy = [{ userId: 'r', start: new Date('2026-10-07T16:00:00Z'), end: new Date('2026-10-07T20:00:00Z') }];
  const slots = findSlots({ ...base, busy, count: 10 });
  assert.ok(slots.every((s) => local(s.start).slice(0, 10) !== '2026-10-07'));
});

test("other people's busy times are ignored", () => {
  const busy = [{ userId: 'someone-else', start: new Date('2026-10-07T00:00:00Z'), end: new Date('2026-10-10T00:00:00Z') }];
  assert.equal(findSlots({ ...base, busy }).length, 3);
});

test('respects each person\'s hours in their own timezone', () => {
  // Paris evening (18–22) and Tokyo morning hours (07 is not in 18–22 Tokyo): no overlap at all.
  assert.equal(findSlots({ ...base, people: [paris, tokyo] }).length, 0);
  // With a wide window (07–23 local), the overlap is Paris 07:00–16:00 = Tokyo 14:00–23:00.
  const slots = findSlots({ ...base, people: [paris, tokyo], window: { start: '07:00', end: '23:00' } });
  assert.ok(slots.length > 0);
  for (const s of slots) {
    const p = utcToWall(s.start, 'Europe/Paris').time;
    const t = utcToWall(s.end, 'Asia/Tokyo').time;
    assert.ok(p >= '07:00' && t <= '23:00', `${p} Paris / ends ${t} Tokyo`);
  }
});

test('works across the October DST change', () => {
  const slots = findSlots({
    ...base,
    from: new Date('2026-10-24T00:00:00Z'),
    to: new Date('2026-10-27T00:00:00Z'),
    now: new Date('2026-10-20T00:00:00Z'),
  });
  // Every slot stays inside 18–22 Paris time, before and after clocks go back.
  for (const s of slots) {
    const start = utcToWall(s.start, 'Europe/Paris').time;
    const end = utcToWall(s.end, 'Europe/Paris').time;
    assert.ok(start >= '18:00' && end <= '22:00', `${start}-${end}`);
  }
  assert.equal(slots.length, 3);
});

test('prefers some breathing room after an event', () => {
  // Busy until 19:00 Paris: 19:00 is tight, a later start should win that day.
  const busy = [{ userId: 'r', start: new Date('2026-10-07T15:00:00Z'), end: new Date('2026-10-07T17:00:00Z') }];
  const [first] = findSlots({ ...base, busy, to: new Date('2026-10-08T00:00:00Z'), count: 1 });
  assert.notEqual(local(first.start), '2026-10-07 19:00');
});

test('fills with same-day slots when there are fewer days than suggestions', () => {
  const slots = findSlots({ ...base, to: new Date('2026-10-08T00:00:00Z') });
  assert.equal(slots.length, 3);
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i - 1].end <= slots[i].start, 'no overlap');
});
