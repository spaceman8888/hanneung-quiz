import { test } from 'node:test';
import assert from 'node:assert/strict';
import { today, normalize, isShort, ERAS,
  hashId, parseQuizlet, mergeCards, pickChoices, orderLabel, makeOrderQuestion,
  entry, review, recall, migrate, dayOf, MATURE, noteIndex, itemRecall,
  makePhotoQuestion, project, MAP, MAP_VIEW,
  buildBatch, weakBatch, counts, createSession, submit,
  loadJSON, validateBackup, isStats,
  gichulHits, byHits, examScore, leaks, chainIndex, answerGrade, ownerCard, missLines, setMyNote, chainStyle, rounds, currentRound, mergeIds,
  RETRY_GAP, current, logShown, logAnswer, dayGoal, cheatSheet, photoAsk, PERIODS, bumpStreak, streakNow, weekDay, studyPlan, assignMocks, finalBatch, mockMisses, NEXT_EXAM } from '../logic.js';

test('today formats local date', () => {
  assert.equal(today(new Date(2026, 0, 5)), '2026-01-05');
});

test('normalize strips spaces and punctuation', () => {
  assert.equal(normalize(' 귀주 대첩. '), '귀주대첩');
});

test('isShort: 10 chars ok, 11 not', () => {
  assert.ok(isShort('1234567890'));
  assert.ok(!isShort('12345678901'));
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

test('pickChoices: 5 unique choices including answer (like the exam)', () => {
  const pool = [mk(1, '왕건'), mk(2, '광종'), mk(3, '성종'), mk(4, '현종'), mk(5, '숙종'), mk(6, '문종')];
  const ch = pickChoices(pool[0], pool);
  assert.equal(ch.length, 5);
  assert.ok(ch.includes('왕건'));
  assert.equal(new Set(ch).size, 5);
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
    assert.deepEqual([...pickChoices(pool[0], pool)].sort(), ['광종', '별무반', '성종', '왕건', '현종']);
  }
});

const T = '2026-10-06';
const cardsN = n => Array.from({ length: n }, (_, i) => mk('k' + i, 'ans' + i));

test('createSession: queue holds every batch card once, in order', () => {
  const s = createSession([mk('a', '왕건'), mk('b', '광종')], { b: { seen: true } });
  assert.deepEqual(s.queue.map(q => q.card.id), ['a', 'b']);
});

test('submit: correct answer finishes the card immediately (multiple choice only)', () => {
  const s = createSession([mk('a', '왕건'), mk('b', '광종')], { a: { seen: true } });
  assert.equal(submit(s, true).id, 'a');
  assert.equal(submit(s, true).id, 'b');
  assert.equal(s.queue.length, 0);
  assert.equal(s.wrong.size, 0);
});

test('submit: a miss waits RETRY_GAP answers, then comes first; it repeats until right', () => {
  const s = createSession(cardsN(50), {});
  assert.equal(submit(s, false), null);
  assert.ok(s.wrong.has('k0'));
  for (let i = 0; i < RETRY_GAP; i++) { assert.notEqual(current(s).card.id, 'k0'); submit(s, true); }
  assert.equal(current(s).card.id, 'k0');      // after 20 other answers
  submit(s, false);
  for (let i = 0; i < RETRY_GAP; i++) { assert.notEqual(current(s).card.id, 'k0'); submit(s, true); }
  assert.equal(current(s).card.id, 'k0');
  assert.equal(submit(s, true).id, 'k0');
});

test('createSession: the next batch carries waiting misses, the answer count and graded cards', () => {
  const s = createSession([mk('a', '왕건')], {});
  s.saved.add('a');
  submit(s, false);
  assert.equal(current(s), null);         // batch done, the miss still waits
  const t = createSession(cardsN(25), s);
  assert.ok(t.saved.has('a'));
  for (let i = 0; i < RETRY_GAP; i++) { assert.notEqual(current(t).card.id, 'a'); submit(t, true); }
  assert.equal(current(t).card.id, 'a');
});

test('logShown / logAnswer: count shows and answers, keep the rest; an unseen card stays new', () => {
  let p = logShown(undefined);
  assert.equal(p.shown, 1);
  assert.equal(p.s, 0);
  assert.ok('s' in p);                    // migrate keeps it
  p = logAnswer(logAnswer(logShown(p), false), true);
  assert.deepEqual([p.shown, p.right, p.wrong], [2, 1, 1]);
  const q = logAnswer(review(undefined, 3, 0), true);
  assert.deepEqual([q.right, q.due], [1, review(undefined, 3, 0).due]);
  assert.deepEqual(migrate({ x: q }, 5).x, q);
});

const fakeStorage = data => ({ getItem: k => (k in data ? data[k] : null) });

test('loadJSON: missing key -> fallback, ok', () => {
  assert.deepEqual(loadJSON(fakeStorage({}), 'p', {}), { value: {}, ok: true });
});

test('loadJSON: valid JSON', () => {
  assert.deepEqual(loadJSON(fakeStorage({ p: '{"a":1}' }), 'p', {}), { value: { a: 1 }, ok: true });
});

test('loadJSON: corrupted JSON -> fallback, not ok', () => {
  assert.deepEqual(loadJSON(fakeStorage({ p: '{oops' }), 'p', []), { value: [], ok: false });
});

test('loadJSON: storage throws or is null -> fallback, not ok', () => {
  const throwing = { getItem() { throw new Error('SecurityError'); } };
  assert.deepEqual(loadJSON(throwing, 'p', 1), { value: 1, ok: false });
  assert.deepEqual(loadJSON(null, 'p', 1), { value: 1, ok: false });
});

test('pickChoices: falls back era+type -> same era -> deck', () => {
  const c = (back, era, type) => ({ back, era, type });
  const card = c('A', '고려', '인물');
  const pool = [card, c('B', '고려', '인물'), c('C', '고려', '사건'), c('D', '고려', '제도'),
    c('X', '삼국', '인물'), c('Y', '조선 전기', '인물')];
  for (let i = 0; i < 30; i++) {
    const ch = pickChoices(card, pool);
    assert.equal(ch.length, 5);
    assert.ok(['A', 'B', 'C', 'D'].every(x => ch.includes(x)), ch.join());
  }
});

test('dayOf: consecutive local days differ by 1', () => {
  assert.equal(dayOf(new Date(2026, 9, 8, 23, 59)) - dayOf(new Date(2026, 9, 7, 0, 1)), 1);
});

test('review: new card initial stability by grade, interval = stability', () => {
  const g3 = review(undefined, 3, 100);
  assert.ok(Math.abs(g3.s - 3.173) < 1e-9);
  assert.deepEqual([g3.last, g3.due, g3.lapses], [100, 103, 0]);
  assert.equal(review(undefined, 1, 100).due, 101);        // relearn tomorrow (in-session repeats come first)
  assert.equal(review(undefined, 4, 100).due, 116);        // 이미 알아요 -> checked again in ~2 weeks
  assert.equal(review({ flagged: true }, 3, 0).flagged, true);
});

test('review: correct answers on time grow the interval; difficulty stays in [1, 10]', () => {
  let p, day = 0;
  const gaps = [];
  for (let i = 0; i < 5; i++) { p = review(p, 3, day); gaps.push(p.due - day); day = p.due; }
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1] * 2, gaps.join());
  assert.ok(p.d >= 1 && p.d <= 10);
});

test('review: wrong on a seen card is a lapse, shrinks stability, raises difficulty', () => {
  const p = review(review(undefined, 3, 0), 3, 3);
  const q = review(p, 1, p.due);
  assert.equal(q.lapses, 1);
  assert.ok(q.s < p.s && q.d > p.d);
  assert.equal(review(undefined, 1, 0).lapses, 0);         // first sight is learning, not a lapse
});

test('review: reviewing again the same day barely changes stability', () => {
  const p = review(undefined, 3, 0);
  assert.ok(review(p, 3, 0).s - p.s < 1e-9);
});

test('recall: 90% at t = stability, 0 for unseen, decreasing', () => {
  const p = review(undefined, 3, 0);
  assert.ok(Math.abs(recall({ ...p, s: 10, last: 0 }, 10) - 0.9) < 1e-9);
  assert.equal(recall(undefined, 5), 0);
  assert.ok(recall(p, 1) > recall(p, 5));
});

test('migrate: old entries become one review dated today; FSRS entries kept', () => {
  const m = migrate({
    a: { seen: true, done: true, lapses: 2, flagged: true },
    b: { seen: true, stage: 1, lapses: 0 },
    c: { seen: true, lapses: 1 },
    d: { flagged: true },
    e: { s: 5, d: 5, last: 1, due: 6, lapses: 0 },
  }, 100);
  assert.deepEqual([m.a.due, m.a.lapses, m.a.flagged], [116, 2, true]);
  assert.equal(m.b.due, 103);
  assert.deepEqual([m.c.due, m.c.lapses], [101, 1]);
  assert.deepEqual(m.d, { flagged: true, lapses: 0 });
  assert.deepEqual(m.e, { s: 5, d: 5, last: 1, due: 6, lapses: 0 });
  assert.deepEqual(migrate(m, 200), m);
});

const S = (s, last, due, lapses = 0) => ({ s, d: 5, last, due, lapses });

test('buildBatch: due (least remembered first) -> new -> ahead; mature cards still come back', () => {
  const progress = {
    k0: S(2, 0, 2),            // due, recall at day 10 lower than k4
    k1: S(30, 0, 30),          // ahead
    k3: S(40, 0, 9),           // mature but due
    k4: S(9, 0, 9),
  };
  const ids = buildBatch(cardsN(6), progress, { day: 10, size: 10 }).map(c => c.id);
  assert.deepEqual(ids, ['k0', 'k4', 'k3', 'k2', 'k5', 'k1']);
});

test('buildBatch newFirst: today\'s new cards before reviews; reviews of missed cards before the rest', () => {
  const progress = {
    k0: S(2, 0, 2),                         // due, answered right so far, least remembered
    k1: { ...S(9, 0, 9), miss: 1 },         // due, missed before
    k2: { ...S(MATURE, 0, 9), miss: 1 },    // due, missed once but 완료 since: counts as right
  };
  const ids = o => buildBatch(cardsN(6), progress, { day: 10, size: 10, ...o }).map(c => c.id);
  assert.deepEqual(ids({}), ['k1', 'k0', 'k2', 'k3', 'k4', 'k5']);
  assert.deepEqual(ids({ newFirst: 2 }), ['k3', 'k4', 'k1', 'k0', 'k2', 'k5']);
  assert.deepEqual(ids({ newFirst: 9 }), ['k3', 'k4', 'k5', 'k1', 'k0', 'k2']);
});

test('buildBatch: size cap, era and type filter', () => {
  const cs = [...cardsN(10), mk('j1', 'x', '조선 전기'), { ...mk('b', '세종'), type: '시기' }];
  assert.equal(buildBatch(cs, {}, { day: 0 }).length, 7);
  assert.deepEqual(buildBatch(cs, {}, { day: 0, eras: ['조선 전기'] }).map(c => c.id), ['j1']);
  assert.deepEqual(buildBatch(cs, {}, { day: 0, type: '시기' }).map(c => c.id), ['b']);
});

test('buildBatch: several eras — only those eras, new cards mixed at random, each era keeps file order', () => {
  const cs = [...Array.from({ length: 10 }, (_, i) => mk('g' + i, 'g' + i, '고려')),
    ...Array.from({ length: 10 }, (_, i) => mk('j' + i, 'j' + i, '조선 전기')), mk('x', 'x', '삼국')];
  const firsts = new Set();
  for (let s = 1; s <= 20; s++) {
    const ids = buildBatch(cs, {}, { day: 0, eras: ['고려', '조선 전기'], rng: seeded(s) }).map(c => c.id);
    assert.equal(ids.length, 7);
    assert.ok(!ids.includes('x'));
    for (const e of ['g', 'j']) {
      const mine = ids.filter(id => id[0] === e);
      assert.deepEqual(mine, mine.map((_, i) => e + i), `seed ${s}`);   // 0, 1, 2… in file order
    }
    assert.ok(ids.some(id => id[0] === 'g') && ids.some(id => id[0] === 'j'), `seed ${s}`);
    firsts.add(ids[0][0]);
  }
  assert.equal(firsts.size, 2);   // not always the same era first
});

test('buildBatch: one card per subject per batch while others are left, then the rest', () => {
  const cs = [mk('a', '광종'), { ...mk('b', '과거제 실시'), front: '광종', type: '판별' }, mk('c', '세종'), { ...mk('d', '광종'), type: '시기' }, mk('e', '태조')];
  assert.deepEqual(buildBatch(cs, {}, { day: 0, size: 3 }).map(c => c.id), ['a', 'c', 'e']);
  assert.deepEqual(buildBatch(cs, {}, { day: 0, size: 5 }).map(c => c.id), ['a', 'c', 'e', 'b', 'd']);
});

test('weakBatch: one card per subject first', () => {
  const progress = { a: S(3, 0, 3, 3), b: S(3, 0, 3, 2), c: S(3, 0, 3, 1) };
  const cs = [mk('a', '광종'), mk('b', '광종'), mk('c', '세종')];
  assert.deepEqual(weakBatch(cs, progress, { day: 4, size: 2 }).map(c => c.id), ['a', 'c']);
});

test('chainStyle: a mature card with 자료 lines is asked 기출형 about half the time', () => {
  const mature = S(MATURE, 0, MATURE), young = S(MATURE - 1, 0, MATURE - 1);
  assert.equal(chainStyle(mature, true, () => 0.3), true);
  assert.equal(chainStyle(mature, true, () => 0.7), false);
  assert.equal(chainStyle(young, true, () => 0.3), false);
  assert.equal(chainStyle(mature, false, () => 0.3), false);
  assert.equal(chainStyle(undefined, true, () => 0.3), false);
});

test('weakBatch: several eras', () => {
  const progress = { g: S(3, 0, 3, 1), j: S(3, 0, 3, 2), x: S(3, 0, 3, 5) };
  const cs = [mk('g', 'a', '고려'), mk('j', 'b', '조선 전기'), mk('x', 'c', '삼국')];
  assert.deepEqual(weakBatch(cs, progress, { day: 4, eras: ['고려', '조선 전기'] }).map(c => c.id), ['j', 'g']);
});

test('weakBatch: lapsed and not mature, most lapses first, skip honored', () => {
  const progress = { k0: S(3, 0, 3, 1), k1: S(3, 0, 3, 3), k2: S(1, 0, 1, 1), k3: S(50, 0, 50, 5) };
  assert.deepEqual(weakBatch(cardsN(5), progress, { day: 4 }).map(c => c.id), ['k1', 'k2', 'k0']);
  assert.deepEqual(weakBatch(cardsN(5), progress, { day: 4, skip: new Set(['k1']) }).map(c => c.id), ['k2', 'k0']);
});

test('counts', () => {
  const progress = { k0: S(3, 0, 3, 1), k1: S(30, 0, 30), k2: S(MATURE, 0, 5, 2) };
  const r = counts(cardsN(5), progress, 5);
  assert.deepEqual({ ...r, recall: undefined }, { due: 2, fresh: 2, learning: 1, done: 2, weak: 1, recall: undefined });
  assert.ok(r.recall > 2 && r.recall < 3);
});

test('weekDay: 0 = Sunday; 2026-11-07 and the 81회 exam day are Saturdays', () => {
  assert.equal(weekDay(dayOf(new Date(2026, 10, 7))), 6);
  assert.equal(weekDay(dayOf(new Date(NEXT_EXAM.date + 'T00:00'))), 6);
  assert.equal(weekDay(dayOf(new Date(2026, 10, 8))), 0);
});

const NOV7 = dayOf(new Date(2026, 10, 7)), NOV28 = dayOf(new Date(2026, 10, 28));

test('studyPlan: learn until a week before, then final, eve, exam; mocks on learning Sundays and final weekends', () => {
  const { days } = studyPlan({ day: NOV7, exam: NOV28, hours: { wd: 3, we: 6 }, fresh: 100 });
  assert.equal(days.length, 22);
  const at = d => days[d - NOV7];
  assert.deepEqual(days.filter(x => x.phase === 'learn').map(x => x.day), Array.from({ length: 14 }, (_, i) => NOV7 + i));
  assert.equal(at(NOV28 - 7).phase, 'final');
  assert.equal(at(NOV28 - 1).phase, 'eve');
  assert.equal(at(NOV28).phase, 'exam');
  assert.deepEqual(days.filter(x => x.mock).map(x => x.day - NOV7), [1, 8, 14, 15]);   // 11/8, 11/15 (Sun), 11/21–22 (final weekend)
  assert.deepEqual([at(NOV7).min, at(NOV7 + 2).min], [360, 180]);
});

test('studyPlan: new cards follow study time (weekends more; optional mocks take none), sum to what fits, none after learning', () => {
  const hours = { wd: 3, we: 6 };
  const all = studyPlan({ day: NOV7, exam: NOV28, hours, fresh: 300 });
  assert.equal(all.fit, 300);
  assert.equal(all.days.reduce((s, x) => s + x.fresh, 0), 300);
  assert.ok(all.days.filter(x => x.phase !== 'learn').every(x => x.fresh === 0));
  assert.deepEqual([all.days[0].fresh, all.days[1].fresh, all.days[2].fresh], [33, 34, 16]);   // Sat 360 · Sun 360 · Mon 180 of 3,240 min
  assert.equal(studyPlan({ day: NOV7, exam: NOV28, hours, fresh: 1773 }).fit, 1773);   // first rounds only: 1,773 × 1.25 < 3,240 min
  const big = studyPlan({ day: NOV7, exam: NOV28, hours, fresh: 3000 });
  assert.equal(big.fit, 2592);                     // 3,240 min / 1.25 min a card
  assert.ok(big.weHours > 8 && big.weHours < 8.5);   // (3,750 − 1,800 weekday) / 4 weekend days ≈ 8.1 h
  assert.equal(studyPlan({ day: NOV7, exam: NOV28, hours: { wd: 0, we: 0 }, fresh: 50 }).fit, 0);
  assert.ok(studyPlan({ day: NOV28 - 3, exam: NOV28, hours, fresh: 50 }).days.every(x => x.fresh === 0));
});

test('dayGoal: learn = new target + missed reviews (start of day); other reviews extra; final = reviews the hours hold', () => {
  assert.deepEqual(dayGoal({ phase: 'learn', target: 158, newDone: 58, weakDue: 7, weakDone: 3 }), { goal: 168, done: 61 });
  assert.deepEqual(dayGoal({ phase: 'learn', target: 10, newDone: 25, weakDue: 0, weakDone: 0 }), { goal: 10, done: 10 });   // extra new cards don't pass 100%
  assert.deepEqual(dayGoal({ phase: 'final', min: 180, seen: 2000, revDone: 100 }), { goal: 540, done: 100 });
  assert.deepEqual(dayGoal({ phase: 'final', min: 180, seen: 300, revDone: 400 }), { goal: 300, done: 300 });
  assert.deepEqual(dayGoal({ phase: 'eve', min: 180, seen: 2000 }), { goal: 180, done: 0 });   // one light hour
  assert.deepEqual(dayGoal({ phase: 'exam' }), { goal: 0, done: 0 });
});

test('bumpStreak / streakNow: goal days in a row; a missed day starts over; twice a day counts once', () => {
  let s = { last: '', n: 0 };
  s = bumpStreak(s, '2026-11-08', '2026-11-07');
  assert.deepEqual(s, { last: '2026-11-08', n: 1 });
  assert.equal(bumpStreak(s, '2026-11-08', '2026-11-07'), s);
  s = bumpStreak(s, '2026-11-09', '2026-11-08');
  assert.equal(s.n, 2);
  assert.equal(streakNow(s, '2026-11-10', '2026-11-09'), 2);   // today not yet reached: still alive
  assert.equal(streakNow(s, '2026-11-11', '2026-11-10'), 0);   // a day missed
  assert.deepEqual(bumpStreak(s, '2026-11-11', '2026-11-10'), { last: '2026-11-11', n: 1 });
});

test('assignMocks: newest past exams first, done ones skipped; the last mock gets the unseen newest exam', () => {
  const past = Array.from({ length: 23 }, (_, i) => 57 + i);
  const plan = () => studyPlan({ day: NOV7, exam: NOV28, hours: { wd: 3, we: 6 }, fresh: 0 }).days;
  let days = plan();
  assignMocks(days, new Set([79]), past);
  assert.deepEqual(days.filter(x => x.mock).map(x => x.n), [78, 77, 76, NEXT_EXAM.n - 1]);
  days = plan();
  assignMocks(days, new Set([NEXT_EXAM.n - 1]), past);
  assert.deepEqual(days.filter(x => x.mock).map(x => x.n), [79, 78, 77, 76]);
});

test('finalBatch: learned cards only, most exam-day loss first (forgetting × past-exam use), not twice a day', () => {
  const day = 100, exam = 107;
  const progress = { a: S(2, 90, 92), b: S(50, 90, 140), d: S(2, day, 102), e: S(2, 90, 92) };
  const cs = ['a', 'b', 'c', 'd', 'e'].map(id => mk(id, id));
  const hits = new Map([['e', 3]]);
  assert.deepEqual(finalBatch(cs, progress, { day, exam, hits }).map(c => c.id), ['e', 'a', 'b']);
  assert.deepEqual(finalBatch(cs, progress, { day, exam, hits, skip: new Set(['e']) }).map(c => c.id), ['a', 'b']);
});

test('mockMisses: wrong numbers of that exam -> its known questions in order and their cards', () => {
  const qs = [{ n: 79, q: 12, s: '광종', cards: ['c'] }, { n: 79, q: 3, s: '동예', cards: ['a', 'b'] }, { n: 78, q: 3, s: 'x', cards: ['x'] }];
  const m = mockMisses(qs, 79, [12, 3, 40]);
  assert.deepEqual(m.qs.map(q => q.q), [3, 12]);
  assert.deepEqual([...m.ids].sort(), ['a', 'b', 'c']);
  assert.equal(mockMisses(qs, 80, [3]).ids.size, 0);
});

test('isStats', () => {
  assert.ok(isStats({ date: '', count: 0 }));
  assert.ok(isStats({ tick: 3, date: '', count: 0, fresh: 2 }));
  assert.ok(!isStats({ date: 1, count: 0 }));
  assert.ok(!isStats({ date: '', count: -1 }));
  assert.ok(!isStats(null));
});

test('validateBackup: v2 and v1 backups', () => {
  assert.ok(validateBackup({ progress: {} }));
  assert.ok(validateBackup({ version: 2, progress: {}, customCards: [], stats: { tick: 5, date: '2026-10-07', count: 3 } }));
  assert.ok(validateBackup({ version: 1, progress: {}, settings: { newLimit: 20 }, newToday: { date: '', count: 0 } }));
  assert.ok(!validateBackup(null));
  assert.ok(!validateBackup('x'));
  assert.ok(!validateBackup({}));
  assert.ok(!validateBackup({ progress: [] }));
  assert.ok(validateBackup({ progress: {}, myNotes: { c1: '내 메모' } }));
  assert.ok(!validateBackup({ progress: {}, myNotes: ['x'] }));
  assert.ok(!validateBackup({ progress: {}, customCards: {} }));
  assert.ok(!validateBackup({ progress: {}, stats: { date: '', count: 1.5 } }));
  assert.ok(validateBackup({ progress: {}, hours: { wd: 3, we: 6.5 }, mocks: [{ n: 79, date: '2026-11-08', score: 72, wrong: [3, 12] }, { n: 80, date: '2026-11-22', score: null, wrong: [] }] }));
  assert.ok(!validateBackup({ progress: {}, hours: { wd: 3 } }));
  assert.ok(validateBackup({ progress: {}, streak: { last: '2026-11-08', n: 3 } }));
  assert.ok(!validateBackup({ progress: {}, streak: { last: '2026-11-08', n: -1 } }));
  assert.ok(!validateBackup({ progress: {}, mocks: [{ n: 79, date: '2026-11-08', score: 72, wrong: ['3'] }] }));
});

test('ERAS has 통시대 before 기타', () => {
  assert.deepEqual(ERAS.slice(-3), ['현대', '통시대', '기타']);
});


test('pickChoices: same kind first (sites with sites)', () => {
  const s = (id, back) => ({ id, front: 'f' + id, back, era: '선사', type: '문화재' });
  const pool = [s(1, '송국리 유적'), s(2, '붉은 간토기'), s(3, '세형 동검'), s(4, '거친무늬 거울'),
    s(5, '암사동 유적'), s(6, '흔암리 유적'), s(7, '전곡리 유적')];
  for (let i = 0; i < 20; i++) {
    const ch = pickChoices(pool[0], pool);
    assert.ok(['송국리 유적', '암사동 유적', '전곡리 유적', '흔암리 유적'].every(x => ch.includes(x)), ch.join());
  }
});

test('pickChoices: kings with kings (same last character)', () => {
  const k = (id, back) => ({ id, front: 'f' + id, back, era: '통일신라·발해', type: '인물' });
  const pool = [k(1, '신문왕'), k(2, '김대성'), k(3, '성덕왕'), k(4, '최치원'), k(5, '경덕왕'), k(6, '장보고'), k(7, '원성왕')];
  for (let i = 0; i < 20; i++) {
    const ch = pickChoices(pool[0], pool);
    assert.ok(['경덕왕', '성덕왕', '신문왕', '원성왕'].every(x => ch.includes(x)), ch.join());
  }
});

test('pickChoices: 시기 cards use only same-era 시기 answers (fewer if needed); others never get 시기 answers', () => {
  const p = (id, back, era = '일제강점기') => ({ id, front: 'f' + id, back, era, type: '시기' });
  const other = { id: 9, front: 'x', back: '신간회', era: '일제강점기', type: '단체' };
  const pool = [p(1, '무단 통치기'), p(2, '문화 통치기'), p(3, '민족 말살 통치기'), p(4, '문화 통치기'), other, p(5, '박정희 정부', '현대')];
  for (let i = 0; i < 20; i++) {
    assert.deepEqual([...pickChoices(pool[0], pool)].sort(), ['무단 통치기', '문화 통치기', '민족 말살 통치기']);
  }
  assert.deepEqual(pickChoices(other, pool), ['신간회']);
});

test('buildBatch: type filter', () => {
  const cs = [mk('a', 'x'), { ...mk('b', '세종'), type: '시기' }];
  assert.deepEqual(buildBatch(cs, {}, { tick: 0, type: '시기' }).map(c => c.id), ['b']);
});

test('pickChoices: 시기 distractors prefer kings of the same country (first country named)', () => {
  const p = (id, front, back) => ({ id, front, back, era: '통일신라·발해', type: '시기' });
  const pool = [
    p(1, '발해의 장문휴 산둥 공격 — 어느 왕 때?', '무왕'), p(2, '발해의 상경 천도 — 어느 왕 때?', '문왕'),
    p(3, '발해 해동성국 — 어느 왕 때?', '선왕'),
    p(4, '신라의 녹읍 폐지 — 어느 왕 때?', '신문왕'), p(5, '신라의 정전 지급 — 어느 왕 때?', '성덕왕'),
    p(6, '신라 독서삼품과 — 어느 왕 때?', '원성왕'), p(7, '신라의 발해 공격 — 어느 왕 때?', '성덕왕'),
    p(8, '신라의 청해진 설치 — 어느 왕 때?', '흥덕왕'), p(9, '신라 김헌창의 난 — 어느 왕 때?', '헌덕왕'),
  ];
  for (let i = 0; i < 30; i++) {
    const ch = pickChoices(pool[0], pool);
    assert.ok(ch.includes('문왕') && ch.includes('선왕'), ch.join());
  }
  for (let i = 0; i < 30; i++) {
    const ch = pickChoices(pool[3], pool);          // 신라 card: no 발해 king among the options
    assert.ok(!ch.some(b => ['무왕', '문왕', '선왕'].includes(b)), ch.join());
  }
});

const seeded = s => () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
const ev = (id, back, year, era = '고려', type = '사건') => ({ id, front: 'f' + id, back, era, type, year });
const YEARS = [918, 936, 956, 993, 1010, 1019, 1107, 1126, 1135, 1170, 1198, 1231];
const dated = YEARS.map((y, i) => ev('y' + i, '사건' + i, y));

test('orderLabel: 시기 strips the question ending, others use back', () => {
  assert.equal(orderLabel({ type: '시기', front: '노비안검법 실시 — 어느 왕 때?', back: '광종' }), '노비안검법 실시');
  assert.equal(orderLabel({ type: '사건', front: 'x', back: '귀주 대첩' }), '귀주 대첩');
});

test('makeOrderQuestion first: 5 options ≥ gap apart, distinct labels, answer is earliest', () => {
  for (let s = 1; s <= 40; s++) {
    const q = makeOrderQuestion(dated, { kind: 'first', rng: seeded(s) });
    assert.ok(q);
    assert.equal(q.options.length, 5);
    assert.equal(new Set(q.options.map(orderLabel)).size, 5);
    for (const a of q.options) for (const b of q.options) if (a !== b) assert.ok(Math.abs(a.year - b.year) >= 3);
    assert.equal(q.answer.year, Math.min(...q.options.map(o => o.year)));
  }
});

test('makeOrderQuestion between: answer inside, wrong outside, ends not among options', () => {
  let made = 0;
  for (let s = 1; s <= 40; s++) {
    const q = makeOrderQuestion(dated, { kind: 'between', rng: seeded(s) });
    if (!q) continue;
    made++;
    const [a, b] = q.ends;
    assert.equal(q.options.length, 5);
    assert.ok(q.options.includes(q.answer));
    assert.ok(q.answer.year >= a.year + 3 && q.answer.year <= b.year - 3);
    for (const o of q.options) if (o !== q.answer) assert.ok(o.year <= a.year - 3 || o.year >= b.year + 3);
    assert.ok(!q.options.includes(a) && !q.options.includes(b));
  }
  assert.ok(made > 0);
});

test('makeOrderQuestion: null when not enough dated cards; era filter uses adjacent eras only', () => {
  assert.equal(makeOrderQuestion(dated.slice(0, 2), { kind: 'first' }), null);
  assert.equal(makeOrderQuestion(dated.slice(0, 2), { kind: 'between' }), null);
  const mixed = [...dated, ev('s1', '삼국사건', 500, '삼국'), ev('j1', '조선후기사건', 1750, '조선 후기')];
  for (let s = 1; s <= 20; s++) {
    const q = makeOrderQuestion(mixed, { eras: ['고려'], kind: 'first', rng: seeded(s) });
    assert.ok(q.options.every(o => o.era === '고려'));
  }
});

test('makeOrderQuestion: several eras — each question from one of them', () => {
  const two = [
    ...Array.from({ length: 30 }, (_, i) => ev('g' + i, '고려사건' + i, 918 + i * 10, '고려')),
    ...Array.from({ length: 30 }, (_, i) => ev('h' + i, '후기사건' + i, 1600 + i * 10, '조선 후기')),
    ...Array.from({ length: 30 }, (_, i) => ev('k' + i, '일제사건' + i, 1910 + i, '일제강점기')),
  ];
  const got = new Set();
  for (let s = 1; s <= 30; s++) {
    const q = makeOrderQuestion(two, { eras: ['고려', '일제강점기'], kind: 'first', rng: seeded(s) });
    const e = new Set(q.options.map(c => c.era));
    assert.equal(e.size, 1, `seed ${s}`);
    got.add([...e][0]);
  }
  assert.deepEqual([...got].sort(), ['고려', '일제강점기']);
});

test('pickChoices 판별: never another fact of the same subject; same group first; isolated from other types', () => {
  const j = (id, front, back, group = '고려 왕') => ({ id, front, back, era: '고려', type: '판별', group });
  const pool = [
    j(1, '광종', '노비안검법 실시'), j(2, '광종', '과거제 시행'),
    j(3, '성종', '12목 설치'), j(4, '현종', '5도 양계 정비'), j(5, '문종', '경정 전시과'),
    j(6, '최승로', '시무 28조 건의', '고려 인물'), { id: 7, front: 'x', back: '귀주 대첩', era: '고려', type: '사건' },
  ];
  for (let i = 0; i < 30; i++) {
    const ch = pickChoices(pool[0], pool);
    assert.deepEqual([...ch].sort(), ['12목 설치', '5도 양계 정비', '경정 전시과', '노비안검법 실시', '시무 28조 건의'].sort());
  }
  assert.ok(!pickChoices(pool[6], pool).some(b => ['12목 설치', '과거제 시행'].includes(b)));
});

test('makeOrderQuestion without era filter: all options (and ends) come from one era', () => {
  const two = [
    ...Array.from({ length: 30 }, (_, i) => ev('g' + i, '고려사건' + i, 918 + i * 10, '고려')),
    ...Array.from({ length: 30 }, (_, i) => ev('h' + i, '후기사건' + i, 1600 + i * 10, '조선 후기')),
  ];
  for (let s = 1; s <= 30; s++) for (const kind of ['first', 'between']) {
    const q = makeOrderQuestion(two, { kind, rng: seeded(s) });
    assert.ok(q);
    const all = [...q.options, ...(q.ends ?? [])];
    assert.equal(new Set(all.map(c => c.era)).size, 1, `seed ${s} ${kind}`);
  }
});

test('pickChoices 판별: no distractor whose back mentions the asked subject', () => {
  const j = (id, front, back) => ({ id, front, back, era: '고려', type: '판별', group: '고려 왕' });
  const pool = [j(1, '광종', '노비안검법 실시'), j(2, '성종', '광종 때 과거제를 시행한 인물과 달리 12목 설치'),
    j(3, '현종', '거란 침입 때 나주 피난'), j(4, '목종', '강조의 정변으로 폐위'), j(5, '경종', '전시과 처음 제정')];
  for (let s = 1; s <= 20; s++) assert.ok(!pickChoices(pool[0], pool, seeded(s)).includes(pool[1].back));
});

test('makeOrderQuestion between prompt has a space before 와(과) only once, none before it', () => {
  const q = makeOrderQuestion(dated, { kind: 'between', rng: seeded(3) });
  assert.match(q.prompt, /^\(가\) .+와\(과\) \(나\) .+ 사이에 있었던 일은\?$/);
  assert.ok(!q.prompt.includes(' 와(과)'));
});

const NOTES = [{ era: '고려', flow: ['a', 'b', 'c'], topics: [
  { title: '왕', items: [{ id: 'x', head: '광종', key: 'k', why: 'w', cards: ['k0', 'k1'] }] },
  { title: '헷갈리는 것', items: [{ id: 'y', head: 't', key: 'k', why: 'w', cards: ['k1', 'k2'] }] }] }];

test('noteIndex: card -> first item in document order', () => {
  const idx = noteIndex(NOTES);
  assert.equal(idx.get('k0').id, 'x');
  assert.equal(idx.get('k1').id, 'x');
  assert.equal(idx.get('k2').id, 'y');
  assert.equal(idx.get('k9'), undefined);
});

test('itemRecall: mean recall of linked cards, unseen = 0', () => {
  const item = NOTES[0].topics[0].items[0];
  assert.equal(itemRecall(item, {}, 5), 0);
  const r = itemRecall(item, { k0: S(10, 0, 10) }, 10);
  assert.ok(Math.abs(r - 0.45) < 1e-9);
});

test('buildBatch: ids limits the pool, skip ends the round', () => {
  const ids = new Set(['k1', 'k3']);
  assert.deepEqual(buildBatch(cardsN(5), {}, { day: 0, ids }).map(c => c.id), ['k1', 'k3']);
  assert.deepEqual(buildBatch(cardsN(5), {}, { day: 0, ids, skip: new Set(['k1', 'k3']) }), []);
});

const ph = (id, back, period, kind = '탑', era = '고려') => ({ id, front: '사진 속 문화유산은?', back, era, type: '사진', period, kind, img: `img/${id}.jpg` });

test('pickChoices 사진: only photo answers, same kind first', () => {
  const pool = [ph('a', '석가탑', '통일 신라'), ph('b', '다보탑', '통일 신라'), ph('c', '월정사 탑', '고려'), ph('d', '정림사 탑', '백제'),
    ph('e', '미륵사 탑', '백제'), ph('f', '반가사유상', '삼국', '불상'), { id: 'x', front: 'x', back: '세종', era: '고려', type: '인물' }];
  for (let s = 1; s <= 20; s++) {
    const ch = pickChoices(pool[0], pool, seeded(s));
    assert.equal(ch.length, 5);
    assert.ok(['석가탑', '다보탑', '월정사 탑', '정림사 탑', '미륵사 탑'].every(x => ch.includes(x)), ch.join());
  }
});

test('pickChoices 지도: only map answers, same era first', () => {
  const m = (id, back, era) => ({ id, front: '지도에 ● 표시된 곳은?', back, era, type: '지도', geo: [37, 127] });
  const pool = [m('a', '행주산성', '조선 전기'), m('b', '한산도', '조선 전기'), m('c', '진주성', '조선 전기'), m('d', '명량', '조선 전기'),
    m('e', '탄금대', '조선 전기'), m('f', '귀주', '고려'), ph('p', '석가탑', '통일 신라')];
  for (let s = 1; s <= 20; s++) {
    const ch = pickChoices(pool[0], pool, seeded(s));
    assert.deepEqual([...ch].sort(), ['명량', '진주성', '탄금대', '한산도', '행주산성']);
  }
});

test('makePhotoQuestion: one answer of the period, 4 others from unrelated periods, distinct names', () => {
  const pool = [ph('a', '석가탑', '통일 신라'), ph('b', '분황사 탑', '신라'), ph('c', '월정사 탑', '고려'), ph('d', '정림사 탑', '백제'),
    ph('e', '미륵사 탑', '백제'), ph('f', '경천사 탑', '고려'), ph('g', '원각사 탑', '조선 전기'), ph('h', '감은사 탑', '통일 신라')];
  for (let s = 1; s <= 40; s++) {
    const q = makePhotoQuestion(pool, { rng: seeded(s) });
    assert.ok(q);
    assert.equal(q.options.length, 5);
    assert.ok(q.options.includes(q.answer));
    const p = q.answer.period;
    assert.equal(q.prompt, `다음 중 ${p}의 문화유산은?`);
    for (const o of q.options) if (o !== q.answer) assert.ok(!o.period.includes(p) && !p.includes(o.period), `${p} vs ${o.period}`);
    assert.equal(new Set(q.options.map(o => o.back)).size, 5);
  }
  assert.equal(makePhotoQuestion(pool.slice(0, 2)), null);
});

test('makePhotoQuestion: era filter limits the answer, not the distractors', () => {
  const pool = [ph('a', '석가탑', '통일 신라', '탑', '통일신라·발해'), ph('c', '월정사 탑', '고려'), ph('d', '정림사 탑', '백제', '탑', '삼국'),
    ph('e', '미륵사 탑', '백제', '탑', '삼국'), ph('f', '경천사 탑', '고려'), ph('g', '원각사 탑', '조선 전기', '탑', '조선 전기')];
  for (let s = 1; s <= 20; s++) assert.equal(makePhotoQuestion(pool, { eras: ['통일신라·발해'], rng: seeded(s) }).answer.id, 'a');
});

test('makePhotoQuestion: several eras — answer from any of them', () => {
  const pool = [ph('a', '석가탑', '통일 신라', '탑', '통일신라·발해'), ph('c', '월정사 탑', '고려'), ph('d', '정림사 탑', '백제', '탑', '삼국'),
    ph('e', '미륵사 탑', '백제', '탑', '삼국'), ph('f', '경천사 탑', '고려'), ph('g', '원각사 탑', '조선 전기', '탑', '조선 전기')];
  const got = new Set();
  for (let s = 1; s <= 30; s++) got.add(makePhotoQuestion(pool, { eras: ['통일신라·발해', '조선 전기'], rng: seeded(s) }).answer.id);
  assert.deepEqual([...got].sort(), ['a', 'g']);
});

test('project: corners and Seoul land inside the map', () => {
  const [w, h] = MAP_VIEW.split(' ').slice(2).map(Number);
  assert.deepEqual(project(MAP.lat1, MAP.lon0), [0, 0]);
  const [x, y] = project(37.57, 126.98);
  assert.ok(x > 0 && x < w && y > 0 && y < h);
  assert.deepEqual(project(MAP.lat0, MAP.lon1), [w, h]);
});

test('map.json: one land path for the map view, small', async () => {
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(new URL('../map.json', import.meta.url), 'utf8');
  const m = JSON.parse(raw);
  assert.equal(m.view, MAP_VIEW);
  assert.match(m.d, /^M/);
  assert.ok(raw.length < 150_000, `${raw.length} bytes`);
});

test('pickChoices 지도: cards asking the same question come first (삼포 with 삼포)', () => {
  const m = (id, back, front, era = '조선 전기') => ({ id, front, back, era, type: '지도', geo: [35, 129] });
  const P = '삼포 중 지도의 ● 지점은?', B = '지도의 ●에서 있었던 전투는?';
  const pool = [m('a', '부산포', P), m('b', '제포', P), m('c', '염포', P), m('d', '행주 대첩', B), m('e', '진주 대첩', B),
    m('f', '한산도 대첩', B), m('g', '명량 대첩', B), m('h', '귀주 대첩', B, '고려')];
  for (let s = 1; s <= 20; s++) {
    const ch = pickChoices(pool[0], pool, seeded(s));
    assert.ok(ch.includes('제포') && ch.includes('염포'), ch.join());
    assert.ok(!ch.includes('귀주 대첩'), ch.join());
  }
});

test('makePhotoQuestion: 개항기 and 대한 제국 never compete (both would be right)', () => {
  const pool = [ph('a', '수자기', '개항기', '비석·기타', '개항기'), ph('b', '독립문', '대한 제국', '건축', '개항기'), ph('c', '환구단', '대한 제국', '건축', '개항기'),
    ph('d', '석가탑', '통일 신라'), ph('e', '월정사 탑', '고려'), ph('f', '정림사 탑', '백제'), ph('g', '원각사 탑', '조선 전기'), ph('h', '진전사 탑', '통일 신라')];
  for (let s = 1; s <= 40; s++) {
    const q = makePhotoQuestion(pool, { rng: seeded(s) });
    if (!q || !['개항기', '대한 제국'].includes(q.answer.period)) continue;
    assert.ok(q.options.filter(o => ['개항기', '대한 제국'].includes(o.period)).length === 1, q.options.map(o => o.back).join());
  }
});

test('pickChoices 사진: cards asking the same question come first (tomb murals with tombs)', () => {
  const T = '사진 속 벽화가 그려진 고분은?';
  const pool = [{ ...ph('a', '안악 3호분', '고구려', '고분·유물'), front: T }, { ...ph('b', '무용총', '고구려', '고분·유물'), front: T },
    { ...ph('c', '강서대묘', '고구려', '고분·유물'), front: T }, { ...ph('d', '각저총', '고구려', '고분·유물'), front: T },
    { ...ph('e', '쌍영총', '고구려', '고분·유물'), front: T }, ph('f', '거친무늬 거울', '청동기', '고분·유물'), ph('g', '정병', '고려', '고분·유물')];
  for (let s = 1; s <= 20; s++) {
    assert.deepEqual([...pickChoices(pool[0], pool, seeded(s))].sort(), ['각저총', '강서대묘', '무용총', '쌍영총', '안악 3호분']);
  }
});

test('gichulHits counts past questions per card; byHits puts most-tested first, ties keep file order', () => {
  const hits = gichulHits([{ era: '고려', cards: ['b', 'c'] }, { era: '고려', cards: ['c'] }]);
  assert.deepEqual([...hits].sort(), [['b', 1], ['c', 2]]);
  const cs = ['a', 'b', 'c', 'd'].map(id => mk(id, id));
  assert.deepEqual(byHits(cs, hits).map(c => c.id), ['c', 'b', 'a', 'd']);
});

test('examScore: guessing only = 20, everything remembered = 100, era with most points to gain', () => {
  const qs = [{ era: '고려', cards: ['a', 'b'] }, { era: '고려', cards: ['b'] }, { era: '현대', cards: ['c'] }];
  const none = examScore(qs, {}, 10);
  assert.equal(Math.round(none.score), 20);
  assert.equal(none.era, '고려');
  assert.equal(Math.round(none.pts), Math.round(80 * 2 / 3));
  const all = { a: S(1e9, 0, 1e9), b: S(1e9, 0, 1e9), c: S(1e9, 0, 1e9) };
  assert.equal(Math.round(examScore(qs, all, 10).score), 100);
  const onlyC = examScore(qs, { c: S(1e9, 0, 1e9) }, 10);
  assert.equal(onlyC.era, '고려');
  assert.equal(Math.round(onlyC.score), Math.round(20 + 80 / 3));
});

test('leaks: shared key word (particles stripped, both directions); generic words do not count', () => {
  assert.ok(leaks('벼농사 시작, 고인돌 축조', '많은 인력을 동원해 고인돌을 축조함'));
  assert.ok(leaks('독도', '독도를 울릉도에 편입함'));
  assert.ok(!leaks('영고, 사출도', '전쟁 때 소의 발굽으로 길흉을 점침'));
  assert.ok(!leaks('간석기 사용 시작', '농경을 시작해 식량을 생산함'));   // 사용·시작 are generic
  assert.ok(leaks('16품계 · 5방', '6좌평 아래 16관등을 운영함'));   // shared number
  assert.ok(leaks('8개 유적', '8곳으로 이루어짐'));
});

test('chainIndex: 자료 from same-era 기출 clues (subject name removed) and same-era plain cards, leaks dropped', () => {
  const j = (id, front, back, era = '조선 후기') => ({ id, front, back, era, type: '판별', group: 'g' });
  const cs = [
    j('j1', '정조', '『대전통편』을 편찬함'),
    j('j2', '정조', '규장각을 설치함'),
    j('j3', '중추원', '군사 기밀과 왕명 출납을 맡음', '고려'),
    { id: 'p1', front: '규장각 설치, 장용영 창설, 수원 화성 축조', back: '정조', era: '조선 후기', type: '인물' },
    { id: 'p2', front: '독립 협회가 의회로 개편하려 한 기구', back: '중추원', era: '개항기', type: '제도' },
    { id: 't1', front: '신해통공 — 어느 왕 때?', back: '정조', era: '조선 후기', type: '시기' },
  ];
  const sets = [
    { era: '조선 후기', subject: '정조', clues: ['화성 행차', '정조 어필', '현륭원'] },
    { era: '조선 후기', subject: '정조', clues: ['정조', '현륭원'] },   // 1 clue left after removing the name → unused
    { era: '고려', subject: '정조', clues: ['다른', '시대'] },
  ];
  const idx = chainIndex(cs, sets);
  assert.deepEqual(idx.get('j1'), ['화성 행차 · 현륭원', '규장각 설치, 장용영 창설, 수원 화성 축조']);
  assert.deepEqual(idx.get('j2'), ['화성 행차 · 현륭원']);   // the plain card gives 규장각 away
  assert.ok(!idx.has('j3'));   // 개항기 중추원 is a different institution
  assert.ok(!idx.has('p1') && !idx.has('t1'));
});

test('answerGrade: wrong 1, sure and right 4, slow right 2, else 3', () => {
  assert.equal(answerGrade(false, { sure: true }), 1);
  assert.equal(answerGrade(true, { sure: true, ms: 1e6 }), 4);
  assert.equal(answerGrade(true, { ms: 6000 + 150 * 100 + 1, chars: 100 }), 2);
  assert.equal(answerGrade(true, { ms: 6000 + 150 * 100, chars: 100 }), 3);   // reading five 판별 options takes ~20 s
  assert.equal(answerGrade(true, {}), 3);   // no timing (app was hidden) → Good
});

test('review: Hard grows stability less than Good', () => {
  assert.equal(review(undefined, 2, 0).due, 1);
  const p = review(undefined, 3, 0);
  assert.ok(review(p, 2, 3).s < review(p, 3, 3).s);
});

test('ownerCard: the card a wrong option belongs to (same kind, same era first); none for 시기·지도', () => {
  const k = { id: 'k', type: '인물', era: '고려', front: '노비안검법', back: '광종' };
  const s1 = { id: 's1', type: '인물', era: '조선 전기', front: '경국대전 완성', back: '성종' };
  const s2 = { id: 's2', type: '인물', era: '고려', front: '12목 설치', back: '성종' };
  const j = { id: 'j', type: '판별', era: '고려', front: '성종', back: '12목에 지방관 파견' };
  const cards = [k, s1, s2, j];
  assert.equal(ownerCard(k, '성종', cards), s2);
  assert.equal(ownerCard({ ...j, id: 'j2', front: '광종', back: '노비안검법 실시' }, '12목에 지방관 파견', cards), j);
  assert.equal(ownerCard({ id: 'p', type: '시기', era: '고려', back: '광종' }, '성종', cards), null);
  assert.equal(ownerCard(k, '없는 답', cards), null);
});

test('missLines: how to remember first, then why, what I chose, the confusable pair', () => {
  const k = { id: 'k', type: '인물', era: '고려', front: '노비안검법', back: '광종', tip: '호족 누르기', memo: '광종 = 칼' };
  const s = { id: 's', type: '인물', era: '고려', front: '12목 설치', back: '성종', tip: '제도 정비', memo: '성종 = 설계도' };
  const item = { memo: '노트 요령', confuse: '광종 ↔ 성종' };
  const ls = missLines(k, { chose: '성종', cards: [k, s], item });
  assert.deepEqual(ls.map(l => l.k), ['memo', 'tip', 'vs', 'confuse']);
  assert.equal(ls[0].text, '🔑 광종 = 칼');
  assert.equal(ls[2].text, "↔ 내가 고른 '성종': 성종 = 설계도");
  // no own memo → the note item's; 모르겠어요 → no chosen option; no tip on the chosen card → its memo/tip/note, else nothing
  const ls2 = missLines({ ...k, memo: undefined }, { cards: [k, s], item });
  assert.deepEqual(ls2.map(l => l.text), ['🔑 노트 요령', '💡 호족 누르기', '⚠ 광종 ↔ 성종']);
  assert.deepEqual(missLines(k, { chose: '성종', cards: [k, { ...s, tip: undefined, memo: undefined }] }).map(l => l.k), ['memo', 'tip']);
  const withExp = missLines({ ...k, exp: '호족 세력을 누르려고…' }, { chose: '성종', cards: [k, s], item });
  assert.deepEqual(withExp.map(l => l.k), ['memo', 'tip', 'exp', 'vs', 'confuse']);   // the full explanation right after the one-line why
  assert.equal(withExp[2].text, '📖 호족 세력을 누르려고…');
});

test('missLines: a 판별 miss names whose fact I picked', () => {
  const j = { id: 'j', type: '판별', era: '고려', front: '광종', back: '노비안검법 실시', tip: 't' };
  const o = { id: 'o', type: '판별', era: '고려', front: '성종', back: '12목에 지방관 파견', tip: '최승로 건의' };
  assert.equal(missLines(j, { chose: o.back, cards: [j, o] }).find(l => l.k === 'vs').text, '↔ 내가 고른 보기는 성종 이야기: 최승로 건의');
});

test('missLines: missed twice or more in a row → a nudge to change how I learn it, first', () => {
  const k = { id: 'k', type: '인물', era: '고려', front: 'f', back: 'b', tip: 't', memo: 'm' };
  assert.equal(missLines(k, { run: 1 })[0].k, 'memo');
  const ls = missLines(k, { run: 3 });
  assert.equal(ls[0].k, 'again');
  assert.match(ls[0].text, /3번 연속/);
});

test('review run: graded misses in a row, back to 0 on a right answer', () => {
  let p = review(undefined, 1, 0);
  assert.equal(p.run, 1);
  p = review(p, 1, 1);
  assert.equal(p.run, 2);
  assert.equal(review(p, 3, 2).run, 0);
  assert.equal(review({ s: 3, d: 5, last: 0, due: 3, lapses: 0 }, 1, 3).run, 1);   // records from before run start at 0
});

test('buildBatch / weakBatch: missed cards with the most misses in a row first, then most misses, then least remembered', () => {
  const progress = {
    k0: { ...S(3, 0, 5), miss: 4, run: 1 },
    k1: { ...S(3, 0, 5), miss: 2, run: 3 },
    k2: { ...S(3, 0, 5), miss: 5, run: 1 },
    k3: S(1, 0, 5),                          // due, never missed: after the missed ones even though least remembered
  };
  assert.deepEqual(buildBatch(cardsN(4), progress, { day: 6, size: 10 }).map(c => c.id), ['k1', 'k2', 'k0', 'k3']);
  assert.deepEqual(weakBatch(cardsN(4), progress, { day: 6, size: 10 }).map(c => c.id), ['k1', 'k2', 'k0']);
});

test('missLines: my own note comes right after the nudge, before the app\'s lines', () => {
  const k = { id: 'k', type: '인물', era: '고려', front: 'f', back: 'b', tip: 't', memo: 'm' };
  const ls = missLines(k, { run: 2, mine: '근육왕' });
  assert.deepEqual(ls.map(l => l.k), ['again', 'mine', 'memo', 'tip']);
  assert.equal(ls[1].text, '✏️ 근육왕');
  assert.deepEqual(missLines(k).map(l => l.k), ['memo', 'tip']);
});

test('setMyNote: trims, blank deletes, input untouched', () => {
  const a = { c1: 'x' };
  assert.deepEqual(setMyNote(a, 'c2', '  근육왕 \n'), { c1: 'x', c2: '근육왕' });
  assert.deepEqual(setMyNote(a, 'c1', '   '), {});
  assert.deepEqual(a, { c1: 'x' });
});

test('rounds: past-exam cards first, then the rest, each split into even rounds of at most size', () => {
  const cs = cardsN(8);
  const hits = new Map([['k0', 3], ['k1', 1], ['k2', 2], ['k3', 1], ['k4', 1]]);
  const r = rounds(cs, hits, 2);
  assert.deepEqual(r.map(x => [x.gichul, x.cards.map(c => c.id)]),
    [[true, ['k0', 'k1']], [true, ['k2', 'k3']], [true, ['k4']], [false, ['k5', 'k6']], [false, ['k7']]]);
  assert.deepEqual(rounds(cardsN(5), new Map(), 4).map(x => x.cards.length), [3, 2]);   // 5 → 3 + 2, not 4 + 1
  assert.deepEqual(rounds([], new Map()), []);
});

test('currentRound: the first round with a card never answered, -1 when all are', () => {
  const r = rounds(cardsN(4), new Map(), 2);
  assert.equal(currentRound(r, {}), 0);
  assert.equal(currentRound(r, { k0: S(1, 0, 1), k1: S(1, 0, 1) }), 1);
  assert.equal(currentRound(r, { k0: S(1, 0, 1), k1: S(1, 0, 1), k2: S(1, 0, 1), k3: S(1, 0, 1) }), -1);
});

test('buildBatch round: new cards from the current round first (mixed eras stay inside it), due still first', () => {
  const cs = [...Array.from({ length: 6 }, (_, i) => mk('g' + i, 'g' + i, '고려')),
    ...Array.from({ length: 6 }, (_, i) => mk('j' + i, 'j' + i, '조선 전기'))];
  const round = new Set(['g0', 'g1', 'j0', 'j1']);
  for (let s = 1; s <= 20; s++) {
    const ids = buildBatch(cs, { j5: S(1, 0, 1) }, { day: 5, eras: ['고려', '조선 전기'], round, rng: seeded(s) }).map(c => c.id);
    assert.equal(ids[0], 'j5');
    assert.deepEqual(new Set(ids.slice(1, 5)), round, `seed ${s}`);
  }
});

test('miss: every wrong answer counts, first sight too (lapses stays review misses); old records start at lapses', () => {
  const a = review(undefined, 1, 0);
  assert.deepEqual([a.miss, a.lapses], [1, 0]);
  const b = review(a, 1, 5);
  assert.deepEqual([b.miss, b.lapses], [2, 1]);
  assert.equal(review(undefined, 3, 0).miss, 0);
  assert.equal(entry({ s: 3, lapses: 2 }).miss, 2);
});

test('weakBatch and counts.weak include a card missed on first sight', () => {
  const progress = { k0: review(undefined, 1, 0), k1: review(undefined, 3, 0) };
  assert.deepEqual(weakBatch(cardsN(3), progress, { day: 1 }).map(c => c.id), ['k0']);
  assert.equal(counts(cardsN(3), progress, 1).weak, 1);
});

test('mergeIds: a merged card record moves to the kept card; both present → join(kept, dropped); input untouched', () => {
  const map = { old1: 'k1', old2: 'k2', gone: 'k3' };
  const notes = { old1: 'a', old2: 'b', k2: 'c', x: 'd' };
  assert.deepEqual(mergeIds(notes, map, (a, b) => a + '\n' + b), { k1: 'a', k2: 'c\nb', x: 'd' });
  assert.deepEqual(mergeIds(notes, map), { k1: 'a', k2: 'c', x: 'd' });   // default: keep the kept card's
  assert.deepEqual(notes, { old1: 'a', old2: 'b', k2: 'c', x: 'd' });
});

test('cheatSheet: a subject gathers its 판별 facts and "when?" events (★ past-exam first, near-duplicates dropped), clues, question count; kings in reign order', () => {
  const j = (id, front, back, group = '고려 왕') => ({ id, front, back, era: '고려', type: '판별', group });
  const t = (id, front, back) => ({ id, front: front + ' — 어느 왕 때?', back, era: '고려', type: '시기' });
  const cards = [
    j('a', '고려 성종', '최승로의 시무 28조를 받아들임'),
    j('b', '광종', '노비안검법을 실시해 호족을 약화시킴'),
    j('c', '광종', '독자적인 연호를 사용함'),
    t('d', '고려의 노비안검법 실시', '광종'),           // same as a fact → dropped
    t('e', '고려의 주현공부법 실시', '광종'),
    t('f', '고려의 12목 설치', '성종'),                 // 고려 성종 by its bare name
    t('g', '처음으로 개경을 황도라 함', '태조'),         // a king with no 판별 card yet: still listed
  ];
  const sheet = cheatSheet(cards, { questions: [{ cards: ['c', 'e'] }, { cards: ['b'] }], sets: [{ era: '고려', subject: '광종', clues: ['쌍기', '광종 즉위', '과거'] }] });
  assert.deepEqual(sheet.map(o => o.name), ['태조', '광종', '고려 성종']);   // reign order, not file order
  const k = sheet.find(o => o.name === '광종');
  assert.deepEqual(k.facts.map(f => (f.star ? '★' : '') + f.t), ['★노비안검법을 실시해 호족을 약화시킴', '★독자적인 연호를 사용함', '★주현공부법 실시']);
  assert.deepEqual(k.clues, ['쌍기', '과거']);   // '광종 즉위' names the subject → left out
  assert.equal(k.q, 2);
  assert.deepEqual(sheet.find(o => o.name === '고려 성종').facts.map(f => f.t), ['최승로의 시무 28조를 받아들임', '12목 설치']);
});

test('cheatSheet on the real deck: every dynasty\'s kings in reign order, 광종 with its past-exam facts', async () => {
  const { readFileSync } = await import('node:fs');
  const cards = JSON.parse(readFileSync(new URL('../cards.json', import.meta.url)));
  const g = JSON.parse(readFileSync(new URL('../gichul.json', import.meta.url)));
  const sheet = cheatSheet(cards, g);
  const names = group => sheet.filter(o => o.group === group).map(o => o.name);
  const before = (group, a, b) => assert.ok(names(group).indexOf(a) < names(group).indexOf(b), `${group}: ${a} before ${b}`);
  before('고려 왕', '태조 왕건', '광종'); before('고려 왕', '목종', '고려 현종'); before('고려 왕', '우왕', '공양왕');
  before('조선 후기 왕', '숙종', '경종'); before('조선 후기 왕', '경종', '영조');
  before('삼국 백제 왕', '무령왕', '성왕'); before('발해 왕', '대조영', '발해 무왕'); before('현대 정부', '박근혜 정부', '문재인 정부');
  assert.ok(sheet.find(o => o.name === '광종').facts.filter(f => f.star).length >= 5);
});

test('buildBatch: one photo/map card per batch while other cards are left', () => {
  const photo = (id, back) => ({ ...mk(id, back), type: '사진' });
  const cs = [photo('p1', '탑1'), photo('p2', '탑2'), { ...mk('m1', '전투1'), type: '지도' }, mk('t1', 'a'), mk('t2', 'b'), mk('t3', 'c')];
  assert.deepEqual(buildBatch(cs, {}, { day: 0, size: 4 }).map(c => c.id), ['p1', 't1', 't2', 't3']);
  assert.deepEqual(buildBatch(cs.slice(0, 3), {}, { day: 0, size: 4 }).map(c => c.id), ['p1', 'p2', 'm1']);   // nothing else left
});

test('photoAsk: the period it was made, with nearby periods and never one that would also be right — or a fact of the state that made it', () => {
  const p = { id: 'p', type: '사진', era: '통일신라·발해', front: '사진 속 문화유산의 이름은?', back: '감은사지 삼층 석탑', period: '통일 신라' };
  const facts = ['9주 5소경을 설치함', '국학을 설치함'].map((b, i) => ({ id: 'j' + i, type: '판별', front: '통일 신라', back: b, era: '통일신라·발해', group: '통일신라·발해 국가' }));
  const other = ['5경 15부 62주를 둠', '정혜쌍수를 내세움', '22담로에 왕족 파견', '중방이 권력 기구'].map((b, i) => ({ id: 'o' + i, type: '판별', front: ['발해', '고려', '백제', '고려'][i], back: b, era: '통일신라·발해', group: '통일신라·발해 국가' }));
  const cards = [p, ...facts, ...other];
  for (let s = 1; s <= 20; s++) {
    const a = photoAsk(p, cards, { rng: seeded(s) });
    assert.ok(a.opts.includes(a.answer) && new Set(a.opts).size === a.opts.length, JSON.stringify(a));
    if (a.via) { assert.ok(facts.includes(a.via)); assert.match(a.prompt, /만든 나라에 대한 설명/); }
    else { assert.equal(a.answer, '통일 신라'); assert.equal(a.opts.length, 5); assert.ok(!a.opts.includes('신라')); }
  }
  const kinds = new Set(Array.from({ length: 20 }, (_, s) => !!photoAsk(p, cards, { rng: seeded(s + 1) }).via));
  assert.equal(kinds.size, 2);   // both kinds come up
  const goryeo = { ...p, period: '고려', back: '월정사 팔각 구층 석탑' };
  for (let s = 1; s <= 5; s++) assert.equal(photoAsk(goryeo, cards, { rng: seeded(s) }).answer, '고려');   // no 판별 subject: always the period
  assert.ok(!photoAsk({ ...p, period: '대한 제국' }, cards, { rng: seeded(3) }).opts.includes('개항기'));
});

test('every photo card period is a known period', async () => {
  const { readFileSync } = await import('node:fs');
  const cards = JSON.parse(readFileSync(new URL('../cards.json', import.meta.url)));
  for (const c of cards.filter(c => c.type === '사진')) assert.ok(PERIODS.includes(c.period), `${c.id} ${c.period}`);
});
