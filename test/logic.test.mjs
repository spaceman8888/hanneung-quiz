import { test } from 'node:test';
import assert from 'node:assert/strict';
import { today, normalize, isShort, ERAS,
  hashId, parseQuizlet, mergeCards, pickChoices, orderLabel, makeOrderQuestion,
  entry, review, recall, migrate, dayOf, dailyNew, MATURE, noteIndex, itemRecall,
  makePhotoQuestion, project, MAP, MAP_VIEW,
  buildBatch, weakBatch, counts, createSession, submit,
  loadJSON, validateBackup, isStats } from '../logic.js';

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

test('submit: wrong reinserts 2 behind and records wrong', () => {
  const s = createSession(cardsN(4), {});
  submit(s, false);
  assert.deepEqual(s.queue.map(q => q.card.id), ['k1', 'k2', 'k0', 'k3']);
  assert.ok(s.wrong.has('k0'));
});

test('submit: wrong on last remaining card keeps it until answered', () => {
  const s = createSession([mk('a', '왕건')], { a: { seen: true, stage: 2, due: T } });
  assert.equal(submit(s, false), null);
  assert.equal(s.queue.length, 1);
  assert.equal(submit(s, true).id, 'a');
  assert.ok(s.wrong.has('a'));
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

test('dailyNew: spread new cards to finish a week before the exam', () => {
  assert.equal(dailyNew(300, 0, 37), 10);
  assert.equal(dailyNew(300, 0, 5), 300);
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
  assert.ok(!validateBackup({ progress: {}, customCards: {} }));
  assert.ok(!validateBackup({ progress: {}, stats: { date: '', count: 1.5 } }));
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
