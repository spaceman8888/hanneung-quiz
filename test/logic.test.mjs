import { test } from 'node:test';
import assert from 'node:assert/strict';
import { today, addDays, normalize, isCorrect, isShort, schedule } from '../logic.js';

test('today formats local date', () => {
  assert.equal(today(new Date(2026, 0, 5)), '2026-01-05');
});

test('addDays crosses month and year', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('normalize strips spaces and punctuation', () => {
  assert.equal(normalize(' 귀주 대첩. '), '귀주대첩');
});

test('isCorrect ignores spacing/punctuation/case, rejects empty and partial', () => {
  assert.ok(isCorrect('귀주 대첩', '귀주대첩'));
  assert.ok(isCorrect('ABC', 'abc'));
  assert.ok(!isCorrect('', '신문왕'));
  assert.ok(!isCorrect('  ', '신문왕'));
  assert.ok(!isCorrect('신문', '신문왕'));
});

test('isShort: 10 chars ok, 11 not', () => {
  assert.ok(isShort('1234567890'));
  assert.ok(!isShort('12345678901'));
});

test('schedule: new card -> stage 0, tomorrow', () => {
  assert.deepEqual(schedule(undefined, { wrong: false }, '2026-10-06'),
    { stage: 0, due: '2026-10-07', seen: true, flagged: false });
});

test('schedule: correct review -> next stage', () => {
  const prev = { stage: 0, due: '2026-10-06', seen: true, flagged: false };
  assert.deepEqual(schedule(prev, { wrong: false }, '2026-10-06'),
    { stage: 1, due: '2026-10-09', seen: true, flagged: false });
});

test('schedule: caps at last stage (30 days)', () => {
  const prev = { stage: 4, due: '2026-10-06', seen: true, flagged: false };
  assert.deepEqual(schedule(prev, { wrong: false }, '2026-10-06'),
    { stage: 4, due: '2026-11-05', seen: true, flagged: false });
});

test('schedule: wrong resets to stage 0', () => {
  const prev = { stage: 3, due: '2026-10-06', seen: true, flagged: false };
  assert.deepEqual(schedule(prev, { wrong: true }, '2026-10-06'),
    { stage: 0, due: '2026-10-07', seen: true, flagged: false });
});

test('schedule: keeps flagged, treats flag-only entry as new', () => {
  assert.deepEqual(schedule({ flagged: true }, { wrong: false }, '2026-10-06'),
    { stage: 0, due: '2026-10-07', seen: true, flagged: true });
});
