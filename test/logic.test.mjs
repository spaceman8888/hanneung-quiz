import { test } from 'node:test';
import assert from 'node:assert/strict';
import { today, addDays, normalize, isCorrect, isShort, schedule,
  hashId, parseQuizlet, mergeCards, pickChoices } from '../logic.js';

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

test('parseQuizlet: tab-separated, CRLF, skips bad lines', () => {
  const { cards, skipped } = parseQuizlet('9서당 10정\t신문왕\r\n\n탭없는줄\n\t뒤만있음\n 귀주대첩 \t 강감찬 ', '고려');
  assert.equal(cards.length, 2);
  assert.equal(skipped, 2);
  assert.deepEqual(cards[1], { id: hashId('귀주대첩', '강감찬'), front: '귀주대첩', back: '강감찬', era: '고려', type: '기타' });
});

test('parseQuizlet: default era is 기타', () => {
  assert.equal(parseQuizlet('a\tb').cards[0].era, '기타');
});

test('hashId is stable and content-based', () => {
  assert.equal(hashId('a', 'b'), hashId('a', 'b'));
  assert.notEqual(hashId('a', 'b'), hashId('a', 'c'));
  assert.match(hashId('a', 'b'), /^q[0-9a-f]+$/);
});

test('mergeCards: importing same set twice adds nothing', () => {
  const { cards } = parseQuizlet('a\tb\nc\td');
  const first = mergeCards([], cards);
  assert.equal(first.added, 2);
  const second = mergeCards(first.merged, cards);
  assert.deepEqual([second.added, second.dup, second.merged.length], [0, 2, 2]);
});

const mk = (id, back, era = '고려', type = '인물') => ({ id, front: 'f' + id, back, era, type });

test('pickChoices: 4 unique choices including answer', () => {
  const pool = [mk(1, '왕건'), mk(2, '광종'), mk(3, '성종'), mk(4, '현종'), mk(5, '숙종')];
  const ch = pickChoices(pool[0], pool);
  assert.equal(ch.length, 4);
  assert.ok(ch.includes('왕건'));
  assert.equal(new Set(ch).size, 4);
});

test('pickChoices: tiny pool and duplicate answers give no duplicates', () => {
  const pool = [mk(1, '왕건'), mk(2, '왕건'), mk(3, '광종')];
  const ch = pickChoices(pool[0], pool);
  assert.deepEqual([...ch].sort(), ['광종', '왕건']);
});

test('pickChoices: prefers same era and type', () => {
  const pool = [mk(1, '왕건'), mk(2, '광종'), mk(3, '성종'), mk(4, '현종'),
    mk(5, '세종', '조선 전기'), mk(6, '태조', '조선 전기'), mk(7, '별무반', '고려', '단체')];
  for (let i = 0; i < 20; i++) {
    assert.deepEqual([...pickChoices(pool[0], pool)].sort(), ['광종', '성종', '왕건', '현종']);
  }
});
