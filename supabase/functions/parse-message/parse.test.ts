// Offline tests (no API call) for timezone math and normalization.
//   npm run test:parser

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addDays, utcToWall, wallToUtc } from '../_shared/zoned-time.ts';
import { buildUserPrompt, matchParticipants, normalize, validateModelOutput, type ParseInput } from './parse.ts';

const members = [
  { id: 'r', name: 'Rania El Kasmi' },
  { id: 's', name: 'Sara' },
  { id: 'y', name: 'Youssef' },
];
const input: ParseInput = {
  text: 'test',
  timezone: 'Europe/Paris',
  now: new Date('2026-10-07T08:00:00Z'),
  author: members[0],
  members,
};
const model = (o: Record<string, unknown>) =>
  validateModelOutput({ is_event: true, title: 'X', all_day: false, participants: [], confidence: 0.9, ...o });

test('wall time → UTC across the October DST change in Paris', () => {
  assert.equal(wallToUtc('2026-10-08', '19:00', 'Europe/Paris').toISOString(), '2026-10-08T17:00:00.000Z');
  assert.equal(wallToUtc('2026-10-30', '18:00', 'Europe/Paris').toISOString(), '2026-10-30T17:00:00.000Z');
});

test('wall time → UTC in other timezones', () => {
  assert.equal(wallToUtc('2026-12-20', '14:00', 'Asia/Tokyo').toISOString(), '2026-12-20T05:00:00.000Z');
  assert.equal(wallToUtc('2026-10-08', '09:00', 'America/New_York').toISOString(), '2026-10-08T13:00:00.000Z');
  assert.equal(wallToUtc('2026-10-08', '09:00', 'UTC').toISOString(), '2026-10-08T09:00:00.000Z');
});

test('UTC → wall time and date arithmetic', () => {
  assert.deepEqual(utcToWall(new Date('2026-10-07T22:30:00Z'), 'Europe/Paris'), {
    date: '2026-10-08',
    time: '00:30',
    weekday: 'Thu',
  });
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('prompt context: local now and a calendar starting today', () => {
  const prompt = buildUserPrompt(input);
  assert.match(prompt, /2026-10-07 10:00 \(Wed\)/);
  assert.match(prompt, /2026-10-08 Thursday \(tomorrow\)/);
});

test('timed event: converts to UTC, default 1h duration', () => {
  const { event } = normalize(model({ date: '2026-10-08', start_time: '19:00' }), input);
  assert.equal(event?.start_at, '2026-10-08T17:00:00.000Z');
  assert.equal(event?.end_at, '2026-10-08T18:00:00.000Z');
  assert.equal(event?.all_day, false);
});

test('end time after midnight rolls to the next day', () => {
  const { event } = normalize(model({ date: '2026-10-09', start_time: '20:00', end_time: '01:00' }), input);
  assert.equal(event?.end_at, '2026-10-09T23:00:00.000Z');
});

test('no time → all-day, stored as UTC midnight with exclusive end', () => {
  const { event } = normalize(model({ date: '2026-10-24', end_date: '2026-10-26', start_time: null }), input);
  assert.equal(event?.all_day, true);
  assert.equal(event?.start_at, '2026-10-24T00:00:00.000Z');
  assert.equal(event?.end_at, '2026-10-27T00:00:00.000Z');
});

test('not an event or missing date → no event', () => {
  assert.equal(normalize(model({ is_event: false, date: '2026-10-08' }), input).event, null);
  assert.equal(normalize(model({ date: null }), input).event, null);
});

test('validation rejects malformed values', () => {
  const out = validateModelOutput({ is_event: true, date: '2026-02-31', start_time: '25:00', confidence: 7, language: 'de' });
  assert.equal(out.date, null);
  assert.equal(out.start_time, null);
  assert.equal(out.confidence, 1);
  assert.equal(out.language, 'other');
  assert.equal(validateModelOutput({ start_time: '9:15' }).start_time, '09:15');
});

test('participants: accents, case and unique first names; others unmatched', () => {
  const { ids, unmatched } = matchParticipants(['sara', 'Rania', 'YOUSSEF', 'maman'], members);
  assert.deepEqual(ids.sort(), ['r', 's', 'y']);
  assert.deepEqual(unmatched, ['maman']);
  assert.deepEqual(matchParticipants(['Sàra'], members).ids, ['s']);
});
