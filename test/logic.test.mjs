import { test } from 'node:test';
import assert from 'node:assert/strict';
import { today, normalize, isShort, ERAS,
  hashId, parseQuizlet, mergeCards, pickChoices, orderLabel, makeOrderQuestion,
  entry, schedule, markKnown, relapse, reopen,
  buildBatch, practiceBatch, counts, createSession, submit,
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
    assert.deepEqual([...ch].sort(), ['A', 'B', 'C', 'D']);
  }
});

const E = o => ({ ...entry(undefined), ...o });

test('entry: defaults and v1 migration drops due', () => {
  assert.deepEqual(entry(undefined), { stage: 0, next: 0, seen: false, flagged: false, lapses: 0, streak: 0, done: false });
  assert.deepEqual(entry({ stage: 2, due: '2026-10-06', seen: true, flagged: true }),
    { stage: 2, next: 0, seen: true, flagged: true, lapses: 0, streak: 0, done: false });
});

test('schedule: first learning (mistakes not counted as lapses)', () => {
  assert.deepEqual(schedule(undefined, { wrong: false }, 100), E({ seen: true, next: 120 }));
  assert.deepEqual(schedule(undefined, { wrong: true }, 100), E({ seen: true, next: 110 }));
  assert.deepEqual(schedule({ flagged: true }, { wrong: false }, 0), E({ seen: true, flagged: true, next: 20 }));
});

test('schedule: correct reviews climb GAPS', () => {
  let p = schedule(undefined, { wrong: false }, 0);
  p = schedule(p, { wrong: false }, 20);
  assert.deepEqual(p, E({ seen: true, stage: 1, streak: 1, next: 70 }));
  p = schedule(p, { wrong: false }, 70);
  assert.deepEqual(p, E({ seen: true, stage: 2, streak: 2, next: 190 }));
});

test('schedule: never-wrong card is done after 3 correct reviews', () => {
  let p = schedule(undefined, { wrong: false }, 0);
  for (const t of [20, 70]) p = schedule(p, { wrong: false }, t);
  assert.equal(p.done, false);
  p = schedule(p, { wrong: false }, 190);
  assert.equal(p.done, true);
  assert.equal(p.streak, 3);
});

test('schedule: review wrong -> lapse, reset, relearn gap', () => {
  const prev = E({ seen: true, stage: 3, streak: 2 });
  assert.deepEqual(schedule(prev, { wrong: true }, 500), E({ seen: true, stage: 0, streak: 0, lapses: 1, next: 510 }));
});

test('schedule: lapsed card is done only after a correct review at the last stage', () => {
  let p = schedule(E({ seen: true, lapses: 1, stage: 3, streak: 5 }), { wrong: false }, 0);
  assert.deepEqual([p.stage, p.done, p.next], [4, false, 700]);
  p = schedule(p, { wrong: false }, 700);
  assert.deepEqual([p.stage, p.done], [4, true]);
});

test('schedule: weak card (lapses >= 2) gets half gaps, rounded up', () => {
  const p = schedule(E({ seen: true, lapses: 2, stage: 1 }), { wrong: false }, 0);
  assert.deepEqual([p.stage, p.next], [2, 60]);
  assert.equal(schedule(E({ seen: true, lapses: 3 }), { wrong: false }, 0).next, 25);
});

test('markKnown / relapse / reopen', () => {
  assert.deepEqual(markKnown(undefined), E({ seen: true, done: true }));
  assert.deepEqual(relapse(E({ seen: true, done: true, stage: 4, streak: 3, lapses: 1 }), 50),
    E({ seen: true, stage: 0, streak: 0, lapses: 2, next: 60 }));
  assert.deepEqual(reopen(E({ seen: true, done: true, stage: 2, streak: 3 }), 99),
    E({ seen: true, stage: 0, streak: 0, next: 99 }));
});

test('buildBatch: due (most lapses first) -> new -> ahead; done excluded', () => {
  const progress = {
    k0: E({ seen: true, next: 5 }),
    k1: E({ seen: true, next: 3, lapses: 2 }),
    k2: E({ seen: true, next: 50 }),
    k3: E({ seen: true, done: true }),
    k4: E({ seen: true, next: 1 }),
  };
  const ids = buildBatch(cardsN(10), progress, { tick: 10, size: 10 }).map(c => c.id);
  assert.deepEqual(ids, ['k1', 'k4', 'k0', 'k5', 'k6', 'k7', 'k8', 'k9', 'k2']);
});

test('buildBatch: size cap and era filter', () => {
  const cs = [...cardsN(10), mk('j1', 'x', '조선 전기')];
  assert.equal(buildBatch(cs, {}, { tick: 0 }).length, 7);
  assert.deepEqual(buildBatch(cs, {}, { tick: 0, era: '조선 전기' }).map(c => c.id), ['j1']);
});

test('buildBatch: never empty until everything is done', () => {
  const ahead = { k0: E({ seen: true, next: 900 }), k1: E({ seen: true, next: 800 }) };
  assert.deepEqual(buildBatch(cardsN(2), ahead, { tick: 0 }).map(c => c.id), ['k1', 'k0']);
  const done = { k0: E({ seen: true, done: true }), k1: E({ seen: true, done: true }) };
  assert.equal(buildBatch(cardsN(2), done, { tick: 0 }).length, 0);
});

test('buildBatch: v1 progress entries are due immediately', () => {
  const b = buildBatch(cardsN(3), { k2: { stage: 1, due: '2026-10-09', seen: true } }, { tick: 0 });
  assert.equal(b[0].id, 'k2');
});

test('practiceBatch weak: not done, lapses > 0, most lapses first, skip honored', () => {
  const progress = {
    k0: E({ seen: true, lapses: 1, next: 9 }),
    k1: E({ seen: true, lapses: 3 }),
    k2: E({ seen: true, lapses: 1, next: 2 }),
    k3: E({ seen: true, lapses: 5, done: true }),
  };
  assert.deepEqual(practiceBatch(cardsN(5), progress, { mode: 'weak' }).map(c => c.id), ['k1', 'k2', 'k0']);
  assert.deepEqual(practiceBatch(cardsN(5), progress, { mode: 'weak', skip: new Set(['k1']) }).map(c => c.id), ['k2', 'k0']);
});

test('practiceBatch check: only done cards, size cap, era filter', () => {
  const cs = [...cardsN(10), mk('j1', 'x', '조선 전기')];
  const progress = Object.fromEntries(cs.map(c => [c.id, E({ seen: true, done: true })]));
  progress.k0 = E({ seen: true });
  const b = practiceBatch(cs, progress, { mode: 'check' });
  assert.equal(b.length, 7);
  assert.ok(b.every(c => c.id !== 'k0'));
  assert.deepEqual(practiceBatch(cs, progress, { mode: 'check', era: '조선 전기' }).map(c => c.id), ['j1']);
});

test('counts', () => {
  const progress = {
    k0: E({ seen: true, next: 0, lapses: 1 }),
    k1: E({ seen: true, next: 99 }),
    k2: E({ seen: true, done: true, lapses: 2 }),
  };
  assert.deepEqual(counts(cardsN(5), progress, 10), { due: 1, fresh: 2, learning: 2, done: 1, weak: 1 });
});

test('isStats', () => {
  assert.ok(isStats({ tick: 0, date: '', count: 0 }));
  assert.ok(!isStats({ tick: 0, date: 1, count: 0 }));
  assert.ok(!isStats({ tick: -1, date: '', count: 0 }));
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
  assert.ok(!validateBackup({ progress: {}, stats: { tick: 1.5, date: '', count: 0 } }));
});

test('ERAS has 통시대 before 기타', () => {
  assert.deepEqual(ERAS.slice(-3), ['현대', '통시대', '기타']);
});


test('pickChoices: same kind first (sites with sites)', () => {
  const s = (id, back) => ({ id, front: 'f' + id, back, era: '선사', type: '문화재' });
  const pool = [s(1, '송국리 유적'), s(2, '붉은 간토기'), s(3, '세형 동검'), s(4, '거친무늬 거울'),
    s(5, '암사동 유적'), s(6, '흔암리 유적'), s(7, '전곡리 유적')];
  for (let i = 0; i < 20; i++) {
    assert.deepEqual([...pickChoices(pool[0], pool)].sort(), ['송국리 유적', '암사동 유적', '전곡리 유적', '흔암리 유적']);
  }
});

test('pickChoices: kings with kings (same last character)', () => {
  const k = (id, back) => ({ id, front: 'f' + id, back, era: '통일신라·발해', type: '인물' });
  const pool = [k(1, '신문왕'), k(2, '김대성'), k(3, '성덕왕'), k(4, '최치원'), k(5, '경덕왕'), k(6, '장보고'), k(7, '원성왕')];
  for (let i = 0; i < 20; i++) {
    assert.deepEqual([...pickChoices(pool[0], pool)].sort(), ['경덕왕', '성덕왕', '신문왕', '원성왕']);
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
    p(8, '신라의 청해진 설치 — 어느 왕 때?', '흥덕왕'),
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

test('makeOrderQuestion first: 4 options ≥ gap apart, distinct labels, answer is earliest', () => {
  for (let s = 1; s <= 40; s++) {
    const q = makeOrderQuestion(dated, { kind: 'first', rng: seeded(s) });
    assert.ok(q);
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options.map(orderLabel)).size, 4);
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
    assert.equal(q.options.length, 4);
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
    const q = makeOrderQuestion(mixed, { era: '고려', kind: 'first', rng: seeded(s) });
    assert.ok(q.options.every(o => o.era === '고려'));
  }
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
    assert.deepEqual([...ch].sort(), ['12목 설치', '5도 양계 정비', '경정 전시과', '노비안검법 실시'].sort());
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
