export const SHORT_MAX = 10;
export const BATCH_SIZE = 7;
export const CHOICES = 5;
export const ERAS = ['선사', '고조선·초기국가', '삼국', '통일신라·발해', '고려', '조선 전기', '조선 후기', '개항기', '일제강점기', '현대', '통시대', '기타'];
export const TYPES = ['인물', '사건', '제도', '문화재', '단체', '세시풍속', '시기', '판별', '사진', '지도', '기타'];

const pad = n => String(n).padStart(2, '0');

export function today(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function normalize(s) {
  return String(s).replace(/[\s\p{P}ㆍ~]/gu, '').toLowerCase();
}

export function isShort(answer) {
  return answer.length <= SHORT_MAX;
}

// FSRS-5 memory model (github.com/open-spaced-repetition), default weights.
// grade (answerGrade): 1 = wrong/모르겠어요, 2 = right but slow, 3 = right, 4 = 이미 알아요 then right. Days are integers (dayOf).
const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5, FACTOR = 19 / 81;   // recall(t = s) = 0.9, so the interval for 90% retention is s days
export const MATURE = 21;               // 완료: still ≥ 90% recall three weeks out

export function dayOf(d = new Date()) {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}

const BLANK = { s: 0, d: 0, last: 0, due: 0, lapses: 0, flagged: false };

// miss: every wrong answer, first sight too (lapses: only misses after learning). Before v21 only lapses were kept.
export function entry(prev) {
  return { ...BLANK, miss: prev?.lapses ?? 0, ...prev };
}

export function recall(prev, day) {
  const p = entry(prev);
  return p.s ? (1 + FACTOR * Math.max(0, day - p.last) / p.s) ** DECAY : 0;
}

const clampD = d => Math.min(10, Math.max(1, d));
const initD = g => clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1);

export function review(prev, grade, day) {
  const p = entry(prev);
  let s = W[grade - 1], d = initD(grade);
  if (p.s) {
    const r = recall(p, day);
    d = clampD(W[7] * initD(4) + (1 - W[7]) * (p.d - W[6] * (grade - 3) * (10 - p.d) / 9));
    s = grade === 1
      ? Math.min(W[11] * p.d ** -W[12] * ((p.s + 1) ** W[13] - 1) * Math.exp(W[14] * (1 - r)), p.s / Math.exp(W[17] * W[18]))
      : p.s * (1 + Math.exp(W[8]) * (11 - p.d) * p.s ** -W[9] * Math.expm1(W[10] * (1 - r))
        * (grade === 2 ? W[15] : 1) * (grade === 4 ? W[16] : 1));
  }
  return { ...p, s, d, last: day, due: day + Math.max(1, Math.round(s)), lapses: p.lapses + (p.s && grade === 1 ? 1 : 0), miss: p.miss + (grade === 1 ? 1 : 0),
    run: grade === 1 ? (p.run ?? 0) + 1 : 0 };   // run: graded misses in a row (a session's retries end right, so only first answers count)
}

// v1–v6 entries ({ seen, done, lapses, ... }) become one FSRS review dated today.
export function migrate(progress, day) {
  return Object.fromEntries(Object.entries(progress).map(([id, p]) => {
    if ('s' in p) return [id, p];
    const base = { flagged: !!p.flagged, lapses: p.lapses ?? 0 };
    return [id, p.seen ? { ...review(base, p.done ? 4 : p.lapses ? 1 : 3, day), lapses: base.lapses } : base];
  }));
}

export function hashId(front, back) {
  let h = 5381;
  for (const ch of front + '\t' + back) h = (h * 33 + ch.codePointAt(0)) >>> 0;
  return 'q' + h.toString(16);
}

export function parseQuizlet(text, era = '기타') {
  const cards = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const i = line.indexOf('\t');
    const front = i < 0 ? '' : line.slice(0, i).trim();
    const back = i < 0 ? '' : line.slice(i + 1).trim();
    if (!front || !back) { skipped++; continue; }
    cards.push({ id: hashId(front, back), front, back, era, type: '기타' });
  }
  return { cards, skipped };
}

export function mergeCards(existing, incoming) {
  const ids = new Set(existing.map(c => c.id));
  const fresh = incoming.filter(c => !ids.has(c.id) && ids.add(c.id));
  return { merged: [...existing, ...fresh], added: fresh.length, dup: incoming.length - fresh.length };
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const kind2 = s => normalize(s).slice(-2);
const kind1 = s => normalize(s).slice(-1);

const NATIONS = ['고구려', '백제', '신라', '가야', '발해'];
const nationOf = front => {
  let best = null, at = Infinity;
  for (const n of NATIONS) { const i = front.indexOf(n); if (i >= 0 && i < at) { best = n; at = i; } }
  return best;
};

export const choiceClass = c => (['시기', '판별', '사진', '지도'].includes(c.type) ? c.type : '');

export function pickChoices(card, pool, rng = Math.random) {
  const others = pool.filter(c => c.back !== card.back && choiceClass(c) === choiceClass(card)
    && !(card.type === '판별' && (c.front === card.front || c.back.includes(card.front))));
  const sameEra = others.filter(c => c.era === card.era);
  let tiers;
  if (card.type === '시기') {
    const nat = nationOf(card.front);
    tiers = [sameEra.filter(c => nationOf(c.front) === nat), sameEra];
  } else if (card.type === '판별') {
    tiers = [sameEra.filter(c => c.group === card.group), sameEra];
  } else if (card.type === '사진') {
    const sameQ = others.filter(c => c.front === card.front);   // most share the generic prompt; specific ones (벽화 고분, 신문 기사) must stay together
    tiers = [sameQ.filter(c => c.kind === card.kind), sameQ, others.filter(c => c.kind === card.kind), others];
  } else if (card.type === '지도') {
    tiers = [sameEra.filter(c => c.front === card.front), sameEra, others];
  } else {
    const k2 = kind2(card.back), k1 = kind1(card.back);
    tiers = [
      sameEra.filter(c => kind2(c.back) === k2),
      sameEra.filter(c => c.type === card.type && kind1(c.back) === k1),
      others.filter(c => c.type === card.type && kind2(c.back) === k2),
      sameEra.filter(c => c.type === card.type),
      sameEra,
      others,
    ];
  }
  const wrong = [...new Set(tiers.flatMap(t => shuffle(t.map(c => c.back), rng)))].slice(0, CHOICES - 1);
  return shuffle([card.back, ...wrong], rng);
}

// Selected eras ([] or null = all).
export const inEras = (c, eras) => !eras?.length || eras.includes(c.era);

// Several eras: new cards from them in random turns, each era still in file order (most-tested first).
function mixEras(cards, rng) {
  const lists = [...new Set(cards.map(c => c.era))].map(e => cards.filter(c => c.era === e));
  return cards.map((_, i) => { let r = rng() * (cards.length - i); return lists.find(l => (r -= l.length) < 0).shift(); });
}

// One card per subject while other subjects are left: a sibling just answered gives the next one away and inflates its grade.
const subjectOf = c => (c.type === '판별' ? c.front : c.back);
// Also one photo/map card per batch while other cards are left, so they come mixed in, not in a run.
const MEDIA = new Set(['사진', '지도']);
function oneEach(list, size) {
  const seen = new Set(), first = [], rest = [];
  let media = 0;
  for (const c of list) {
    if (seen.has(subjectOf(c)) || (MEDIA.has(c.type) && media)) rest.push(c);
    else { seen.add(subjectOf(c)); first.push(c); media += MEDIA.has(c.type); }
  }
  return [...first, ...rest].slice(0, size);
}

// round: the current round's ids — its new cards come before any other new card.
// newFirst: how many new cards come before reviews (Infinity: every new card once first). With a deadline three weeks
// out, seeing every card once beats keeping each at 90% (simulated on the 기출 score: about +6 points).
// Reviews: cards I've missed (not yet 완료) first — most misses in a row, then most misses — then the rest, least
// remembered first.
export function buildBatch(cards, progress, { day, eras = null, type = null, ids = null, round = null, skip = new Set(), size = BATCH_SIZE, newFirst = 0, rng = Math.random }) {
  const p = id => entry(progress[id]);
  const forgot = (a, b) => recall(progress[a.id], day) - recall(progress[b.id], day);
  const weak = c => p(c.id).miss > 0 && p(c.id).s < MATURE;
  const worse = (a, b) => (p(b.id).run ?? 0) - (p(a.id).run ?? 0) || p(b.id).miss - p(a.id).miss;
  const pool = cards.filter(c => inEras(c, eras) && (!type || c.type === type)
    && (!ids || ids.has(c.id)) && !skip.has(c.id));
  const seen = pool.filter(c => p(c.id).s);
  const due = seen.filter(c => p(c.id).due <= day).sort((a, b) => weak(b) - weak(a) || (weak(a) && worse(a, b)) || forgot(a, b));
  const unseen = pool.filter(c => !p(c.id).s);
  const mix = list => (eras?.length > 1 ? mixEras(list, rng) : list);
  const fresh = round ? [...mix(unseen.filter(c => round.has(c.id))), ...mix(unseen.filter(c => !round.has(c.id)))] : mix(unseen);
  const ahead = seen.filter(c => p(c.id).due > day).sort(forgot);
  return oneEach([...fresh.slice(0, newFirst), ...due, ...fresh.slice(newFirst), ...ahead], size);
}

export function weakBatch(cards, progress, { day, skip = new Set(), eras = null, size = BATCH_SIZE }) {
  const p = id => entry(progress[id]);
  const list = cards.filter(c => inEras(c, eras) && !skip.has(c.id) && p(c.id).miss > 0 && p(c.id).s < MATURE)
    .sort((a, b) => (p(b.id).run ?? 0) - (p(a.id).run ?? 0) || p(b.id).miss - p(a.id).miss || recall(progress[a.id], day) - recall(progress[b.id], day));
  return oneEach(list, size);
}

export function counts(cards, progress, day) {
  const r = { due: 0, fresh: 0, learning: 0, done: 0, weak: 0, recall: 0 };
  for (const c of cards) {
    const p = entry(progress[c.id]);
    if (!p.s) { r.fresh++; continue; }
    if (p.s >= MATURE) r.done++;
    else { r.learning++; if (p.miss > 0) r.weak++; }
    if (p.due <= day) r.due++;
    r.recall += recall(p, day);
  }
  return r;
}

// 시험 계획 — next exam (historyexam.go.kr, checked 2026-11-07): 제81회 심화 2026-11-28 (토) 10:00. Update with each release.
export const NEXT_EXAM = { n: 81, date: '2026-11-28' };
// ponytail: fixed minutes per card; time real sessions if plans keep running long or short.
export const MIN_FIRST = 1.25, MIN_REVIEW = 1 / 3;   // a new card's first round (explanation, the retry when missed); one review

export const weekDay = day => (day + 4) % 7;   // dayOf -> 0 = Sunday (day 0, 1970-01-01, was a Thursday)

// Days from today to the exam: learn (new cards) until a week before, then final (no new cards), eve, exam.
// Mocks (optional, no time set aside): Sundays while learning, both weekend days in the final week. New cards share the
// learning days' time in proportion to it (weekends get more): today's share is the day's goal (🔥); 학습 시작 goes on
// through every new card anyway. fit = how many first rounds fit in that time; reviews get what is left, then the final
// week. weHours = weekend hours a day that would fit them all with weekday hours unchanged.
export function studyPlan({ day, exam, hours, fresh }) {
  const days = [];
  for (let d = day; d <= exam; d++) {
    const w = weekDay(d), weekend = w === 0 || w === 6;
    const phase = d === exam ? 'exam' : d === exam - 1 ? 'eve' : d >= exam - 7 ? 'final' : 'learn';
    const mock = phase === 'final' ? weekend : phase === 'learn' && w === 0;
    days.push({ day: d, weekend, phase, mock, min: Math.round(60 * (weekend ? hours.we : hours.wd)), fresh: 0, n: null });
  }
  const learn = days.filter(x => x.phase === 'learn');
  const free = x => x.min;
  const total = learn.reduce((s, x) => s + free(x), 0);
  const fit = Math.min(fresh, Math.floor(total / MIN_FIRST));
  let acc = 0, given = 0;
  for (const x of learn) { acc += free(x); const upto = total ? Math.round(fit * acc / total) : 0; x.fresh = upto - given; given = upto; }
  const we = learn.filter(x => x.weekend);
  const need = fresh * MIN_FIRST - learn.filter(x => !x.weekend).reduce((s, x) => s + free(x), 0);
  return { days, fit, weHours: we.length ? Math.max(0, need / we.length / 60) : null };
}

// 오늘 진행률. learn: today's new-card target + reviews of cards I've missed (counted as at the start of the day: due now +
// done today); the other reviews are extra. final: the reviews today's hours hold (eve: one light hour), at most every
// learned card once. Exam day: none.
export function dayGoal({ phase, target = 0, newDone = 0, weakDue = 0, weakDone = 0, revDone = 0, min = 0, seen = 0 }) {
  if (phase === 'learn') return { goal: target + weakDue + weakDone, done: Math.min(newDone, target) + weakDone };
  if (phase !== 'final' && phase !== 'eve') return { goal: 0, done: 0 };
  const goal = Math.min(seen, Math.floor((phase === 'eve' ? 60 : min) / MIN_REVIEW));
  return { goal, done: Math.min(revDone, goal) };
}

// 실전 회차 for each mock day: newest past exams first, skipping ones done; the last mock gets the newest exam the app
// has no data from (NEXT_EXAM.n - 1), kept as a test never seen.
export function assignMocks(days, done, past) {
  const unseen = NEXT_EXAM.n - 1;
  const queue = past.filter(n => !done.has(n)).sort((a, b) => b - a);
  const mocks = days.filter(x => x.mock);
  mocks.forEach((x, i) => { x.n = i === mocks.length - 1 && !done.has(unseen) ? unseen : queue.shift() ?? null; });
}

// 마무리 주간: no new cards; the cards I'll have forgotten most by the exam first, weighted by how often past exams used
// them. Cards already answered today wait (a same-day review barely helps).
export function finalBatch(cards, progress, { day, exam, hits = new Map(), eras = null, skip = new Set(), size = BATCH_SIZE }) {
  const loss = c => (1 - recall(progress[c.id], exam)) * (1 + (hits.get(c.id) ?? 0));
  const list = cards.filter(c => { const p = entry(progress[c.id]); return p.s && p.last < day && inEras(c, eras) && !skip.has(c.id); })
    .sort((a, b) => loss(b) - loss(a));
  return oneEach(list, size);
}

// 실전 채점: wrong question numbers of exam n -> the past questions the app knows (subject asked) and their cards.
export function mockMisses(questions, n, wrong) {
  const qs = questions.filter(q => q.n === n && wrong.includes(q.q)).sort((a, b) => a.q - b.q);
  return { qs, ids: new Set(qs.flatMap(q => q.cards)) };
}

// A missed card comes back after RETRY_GAP more answers, until answered right: the longer gap makes the retry a real
// recall (lag effect). prev = the session the last batch ran in: its waiting cards, answer count and graded cards carry on.
export const RETRY_GAP = 20;
export function createSession(batch, prev = null) {
  return {
    queue: batch.map(card => ({ card })),
    wrong: prev?.wrong ?? new Set(),
    later: prev?.later ?? [],      // [{ card, at }] in answer order: shown once n reaches at
    n: prev?.n ?? 0,               // answers so far
    saved: prev?.saved ?? new Set(),   // graded already (FSRS takes the first answer only)
  };
}

export function submit(session, correct) {
  const item = session.queue.shift();
  session.n++;
  if (!correct) {
    session.wrong.add(item.card.id);
    session.later.push({ card: item.card, at: session.n + RETRY_GAP });
    return null;
  }
  return item.card;
}

// The question to show: a waiting missed card whose gap has passed, else the batch's next card (null: build a new batch).
export function current(session) {
  const i = session.later.findIndex(x => x.at <= session.n);
  if (i >= 0) session.queue.unshift(session.later.splice(i, 1)[0]);
  return session.queue[0] ?? null;
}

// 풀이 기록 per card: shown (every time it comes up), right / wrong (every answer, retries too).
export const logShown = prev => ({ ...entry(prev), shown: (prev?.shown ?? 0) + 1 });
export const logAnswer = (prev, ok) => { const k = ok ? 'right' : 'wrong'; return { ...entry(prev), [k]: (prev?.[k] ?? 0) + 1 }; };

export function loadJSON(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw == null ? { value: fallback, ok: true } : { value: JSON.parse(raw), ok: true };
  } catch {
    return { value: fallback, ok: false };
  }
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = v => Number.isInteger(v) && v >= 0;

export function isStats(v) {
  return isObj(v) && typeof v.date === 'string' && isCount(v.count);
}

export const isStreak = v => isObj(v) && typeof v.last === 'string' && isCount(v.n);
// 🔥 연속: days in a row the day's goal was reached (dates as 'YYYY-MM-DD').
export const bumpStreak = (s, today, yesterday) => (s.last === today ? s : { last: today, n: s.last === yesterday ? s.n + 1 : 1 });
export const streakNow = (s, today, yesterday) => (s.last === today || s.last === yesterday ? s.n : 0);

export const isHours = v => isObj(v) && [v.wd, v.we].every(h => typeof h === 'number' && h >= 0 && h <= 24);
export const isMock = v => isObj(v) && Number.isInteger(v.n) && typeof v.date === 'string'
  && (v.score === null || isCount(v.score)) && Array.isArray(v.wrong) && v.wrong.every(Number.isInteger);

export function validateBackup(data) {
  return isObj(data) && isObj(data.progress)
    && (data.customCards === undefined || Array.isArray(data.customCards))
    && (data.stats === undefined || isStats(data.stats))
    && (data.myNotes === undefined || isObj(data.myNotes))
    && (data.hours === undefined || isHours(data.hours))
    && (data.mocks === undefined || (Array.isArray(data.mocks) && data.mocks.every(isMock)))
    && (data.streak === undefined || isStreak(data.streak));
}

export const ORDER_GAP = 3;

export function orderLabel(card) {
  return card.type === '시기' ? card.front.replace(/\s*— 어느 [^?]*\?$/, '') : card.back;
}

function pickApart(pool, n, gap, rng, taken = []) {
  const out = [];
  for (const c of shuffle(pool, rng)) {
    if ([...taken, ...out].every(o => Math.abs(o.year - c.year) >= gap && orderLabel(o) !== orderLabel(c))) out.push(c);
    if (out.length === n) return out;
  }
  return null;
}

export function makeOrderQuestion(cards, { eras = null, kind = null, rng = Math.random } = {}) {
  const era = eras?.length ? eras[Math.floor(rng() * eras.length)] : null;   // each question stays inside one era
  const i = ERAS.indexOf(era);
  const dated = cards.filter(c => Number.isInteger(c.year) && c.type !== '판별');
  let pool = dated;
  if (era) {
    const same = dated.filter(c => c.era === era);
    pool = same.length >= 8 ? same : dated.filter(c => Math.abs(ERAS.indexOf(c.era) - i) <= 1);
  } else {
    const big = ERAS.filter(e => dated.filter(c => c.era === e).length >= 30);
    if (big.length) { const e = big[Math.floor(rng() * big.length)]; pool = dated.filter(c => c.era === e); }
  }
  const k = kind ?? (rng() < 0.5 ? 'first' : 'between');
  if (k === 'first') {
    const options = pickApart(pool, CHOICES, ORDER_GAP, rng);
    if (!options) return null;
    return { kind: k, prompt: '다음 중 가장 먼저 일어난 것은?', options, answer: options.reduce((a, b) => (b.year < a.year ? b : a)) };
  }
  for (let t = 0; t < 50; t++) {
    const ends = pickApart(pool, 2, 2 * ORDER_GAP, rng);
    if (!ends) return null;
    const [a, b] = ends.sort((x, y) => x.year - y.year);
    const inside = pool.filter(c => c.year >= a.year + ORDER_GAP && c.year <= b.year - ORDER_GAP);
    const outside = pool.filter(c => c.year <= a.year - ORDER_GAP || c.year >= b.year + ORDER_GAP);
    const answer = pickApart(inside, 1, 0, rng, [a, b])?.[0];
    const wrong = answer && pickApart(outside, CHOICES - 1, 0, rng, [a, b, answer]);
    if (wrong) return { kind: k, prompt: `(가) ${orderLabel(a)}와(과) (나) ${orderLabel(b)} 사이에 있었던 일은?`, options: shuffle([answer, ...wrong], rng), answer, ends: [a, b] };
  }
  return null;
}

// 핵심 노트: card id -> first item (document order) that links it.
export function noteIndex(notes) {
  const idx = new Map();
  for (const { topics } of notes) for (const { items } of topics) for (const it of items)
    for (const id of it.cards) if (!idx.has(id)) idx.set(id, it);
  return idx;
}

export function itemRecall(item, progress, day) {
  return item.cards.reduce((s, id) => s + recall(progress[id], day), 0) / item.cards.length;
}

// 기출 (gichul.json): past questions -> linked cards.
export function gichulHits(questions) {
  const hits = new Map();
  for (const q of questions) for (const id of q.cards) hits.set(id, (hits.get(id) ?? 0) + 1);
  return hits;
}

// New cards in order of how often past exams used them; Array.sort is stable, so ties keep file order.
export const byHits = (cards, hits) => [...cards].sort((a, b) => (hits.get(b.id) ?? 0) - (hits.get(a.id) ?? 0));

// Rounds: cards (byHits order) in even chunks of at most `size`; past-exam cards first, never-tested ones (심화) after.
export const ROUND_SIZE = 100;
export function rounds(cards, hits, size = ROUND_SIZE) {
  const split = (list, gichul) => {
    const k = Math.ceil(list.length / size), n = Math.ceil(list.length / k);
    return Array.from({ length: k }, (_, i) => ({ gichul, cards: list.slice(i * n, i * n + n) }));
  };
  return [...split(cards.filter(c => hits.has(c.id)), true), ...split(cards.filter(c => !hits.has(c.id)), false)];
}
export const currentRound = (rs, progress) => rs.findIndex(r => r.cards.some(c => !entry(progress[c.id]).s));

// Merged duplicate cards (merged.json: dropped id -> kept id): a record of the dropped card moves to the kept one; both → join(kept, dropped).
export function mergeIds(obj, map, join = a => a) {
  const out = { ...obj };
  for (const [old, keep] of Object.entries(map)) {
    if (!(old in out)) continue;
    out[keep] = keep in out ? join(out[keep], out[old]) : out[old];
    delete out[old];
  }
  return out;
}

// Past questions answered with the mean recall of their cards, otherwise a 1-in-5 guess.
// era/pts: where the most points are still missed. ponytail: card recall stands in for the question, real ones are harder.
export function examScore(questions, progress, day) {
  const miss = {};
  let total = 0;
  for (const q of questions) {
    const r = q.cards.reduce((s, id) => s + recall(progress[id], day), 0) / q.cards.length;
    const m = (1 - r) * (1 - 1 / CHOICES) * 100 / questions.length;
    miss[q.era] = (miss[q.era] ?? 0) + m;
    total += m;
  }
  const [era, pts] = Object.entries(miss).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return { score: 100 - total, era, pts };
}

// Does a 자료 line give the answer away? Shared key word, particles stripped; generic words don't count.
const GENERIC = new Set(['사용', '시작', '생활', '설치', '실시', '조직', '제정', '건립', '출토', '발생', '등장', '이후', '처음', '정비',
  '편찬', '간행', '주장', '전개', '추진', '창설', '설립', '건국', '시행', '반대', '지원', '확대', '강화', '중심', '통해', '위해', '대한',
  '이름', '당시', '최초', '전국', '지역', '나라', '국가', '정부', '세력', '사람', '활동', '운동', '사건', '제도', '시대', '시기',
  '조선', '고려', '신라', '백제', '고구려', '일본', '중국', '우리', '독립', '민족', '중앙', '지방', '여러', '모든']);
const words = s => s.split(/[^가-힣A-Za-z0-9]+/)
  .flatMap(t => [t, t.replace(/(에서|으로|에게|부터|까지|과|와|을|를|이|가|은|는|의|에|로|도|만|함|됨|임)$/, '')])
  .filter(t => t.length >= 2 && !GENERIC.has(t));
const nums = s => s.match(/\d+/g) ?? [];
export const leaks = (clue, answer) => words(clue).some(t => answer.includes(t)) || words(answer).some(t => clue.includes(t))
  || nums(clue).some(n => nums(answer).includes(n));

// 쪽집게 노트: every subject (a king, state, person, group, event, period…) with what it is known for — its 판별 facts and
// the events asked as "when?" (★ = used by a past exam; near-duplicates of a fact dropped) — plus the clue keywords past
// exams gave for it and how many past questions touched it. Kings and periods sort by their earliest dated card.
const bare = s => s.replace(/^(고구려|백제|신라|통일 신라|발해|고려|조선)\s+/, '');
const eventText = c => orderLabel(c).replace(/^(고구려|백제|신라|통일 신라|발해|고려|조선)(의|가|이|는|,)?\s+/, '');
export function cheatSheet(cards, { questions = [], sets = [] } = {}) {
  const used = new Set(questions.flatMap(q => q.cards));
  const subj = new Map(), list = [];
  const add = (era, name, group) => {
    const k = era + '|' + bare(name);
    if (!subj.has(k)) { const o = { key: k, era, group, name, facts: [], ids: [], years: [], clues: [], q: 0 }; subj.set(k, o); list.push(o); }
    return subj.get(k);
  };
  const find = (era, name) => subj.get(era + '|' + bare(name))
    ?? list.find(o => o.era === era && bare(o.name).startsWith(bare(name) + ' '));   // 태조 → 태조 왕건
  for (const c of cards) if (c.type === '판별') {
    const o = add(c.era, c.front, c.group);
    o.facts.push({ t: c.back, star: used.has(c.id) });
    o.ids.push(c.id);
    if (c.year) o.years.push(c.year);
  }
  for (const c of cards) if (c.type === '시기') {
    const o = find(c.era, c.back) ?? add(c.era, c.back, kingGroup(c) ?? `${c.era} 시기`);
    const t = eventText(c), ws = words(t);
    const dup = o.facts.some(f => ws.length && ws.filter(w => f.t.includes(w)).length / ws.length >= 0.5);
    if (!dup) o.facts.push({ t, star: used.has(c.id) });
    o.ids.push(c.id);
    if (c.year) o.years.push(c.year);
  }
  for (const st of sets) {
    const o = find(st.era, st.subject);
    if (o) for (const k of st.clues) if (!o.clues.includes(k) && !k.includes(bare(o.name)) && !bare(o.name).includes(k)) o.clues.push(k);
  }
  const of = new Map(list.flatMap(o => o.ids.map(id => [id, o])));
  for (const q of questions) for (const o of new Set(q.cards.map(id => of.get(id)).filter(Boolean))) o.q++;
  for (const o of list) o.facts.sort((a, b) => b.star - a.star);
  const groups = [...new Set(list.map(o => o.group))];
  const rank = (o, i) => [groups.indexOf(o.group), reign(o) ?? (/시기$/.test(o.group) && o.years.length ? Math.min(...o.years) : Infinity), i];
  const by = list.map((o, i) => [rank(o, i), o]);
  by.sort(([a], [b]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return by.map(([, { years, ...o }]) => o);
}
// Rulers in order, by the group their cards are in; a name matches exactly, else as the start of a longer one (태조 왕건).
const REIGNS = {
  고구려: '동명성왕 유리왕 대무신왕 태조왕 고국천왕 동천왕 미천왕 고국원왕 소수림왕 광개토대왕 장수왕 문자왕 안원왕 양원왕 평원왕 영양왕 영류왕 보장왕',
  백제: '온조왕 고이왕 근초고왕 침류왕 아신왕 비유왕 개로왕 문주왕 동성왕 무령왕 성왕 위덕왕 무왕 의자왕',
  신라: '박혁거세 내물왕 실성 눌지 소지 지증왕 법흥왕 진흥왕 진평왕 선덕여왕 진덕여왕 태종무열왕 문무왕 신문왕 효소왕 성덕왕 경덕왕 혜공왕 선덕왕 원성왕 헌덕왕 흥덕왕 문성왕 경문왕 헌강왕 진성여왕 효공왕 경애왕 경순왕',
  발해: '대조영 고왕 무왕 문왕 선왕 대인선',
  고려: '태조 혜종 정종 광종 경종 성종 목종 현종 덕종 문종 순종 선종 헌종 숙종 예종 인종 의종 명종 신종 희종 강종 고종 원종 충렬왕 충선왕 충숙왕 충혜왕 충목왕 충정왕 공민왕 우왕 창왕 공양왕',
  조선: '태조 정종 태종 세종 문종 단종 세조 예종 성종 연산군 중종 인종 명종 선조 광해군 인조 효종 현종 숙종 경종 영조 정조 순조 헌종 철종 고종 순종',
  현대: '이승만 허정 장면 박정희 최규하 전두환 노태우 김영삼 김대중 노무현 이명박 박근혜 문재인 윤석열',
  일제: '무단 문화 민족말살',
};
const REIGN_OF = { '삼국 고구려 왕': '고구려', '삼국 백제 왕': '백제', '삼국 신라 왕': '신라', '통일신라 왕': '신라', '발해 왕': '발해',
  '고려 왕': '고려', '조선 전기 왕': '조선', '조선 후기 왕': '조선', '현대 정부': '현대', '일제강점기 시기': '일제' };
function reign(o) {
  const names = REIGNS[REIGN_OF[o.group]]?.split(' ');
  if (!names) return null;
  const n = normalize(bare(o.name).replace(/^발해\s*/, ''));
  const i = names.indexOf(n);
  return i >= 0 ? i : (j => (j >= 0 ? j : null))(names.findIndex(x => n.startsWith(x)));
}

// A king asked only as "when?" (a ruler of the state its question names, by the reign lists): that state's kings.
const kingGroup = c => {
  const n = nationOf(c.front);
  const [dyn, group] = c.era === '삼국' ? [n, n && `삼국 ${n} 왕`] : c.era === '통일신라·발해' ? (n === '발해' ? ['발해', '발해 왕'] : ['신라', '통일신라 왕'])
    : c.era === '고려' ? ['고려', '고려 왕'] : /^조선/.test(c.era) ? ['조선', `${c.era} 왕`] : [];
  return group && REIGNS[dyn]?.split(' ').includes(normalize(bare(c.back))) ? group : null;
};

// 기출형: 판별 card id -> 자료 lines that point to its subject (same era) without giving its answer away.
export function chainIndex(cards, sets = []) {
  const key = (era, name) => era + '|' + name;
  const lines = new Map();
  const add = (k, line) => lines.set(k, [...(lines.get(k) ?? []), line]);
  for (const s of sets) {
    const clues = s.clues.filter(k => !k.includes(s.subject) && !s.subject.includes(k));
    if (clues.length >= 2) add(key(s.era, s.subject), clues.join(' · '));
  }
  for (const c of cards) if (!choiceClass(c)) add(key(c.era, c.back), c.front);
  const idx = new Map();
  for (const c of cards) {
    if (c.type !== '판별') continue;
    const ok = [...new Set(lines.get(key(c.era, c.front)) ?? [])].filter(l => !leaks(l, c.back));
    if (ok.length) idx.set(c.id, ok);
  }
  return idx;
}

// A card already known well (mature) is asked the way the exam does about half the time: (가) 자료 → 옳은 설명.
export function chainStyle(prev, hasLines, rng = Math.random) {
  return hasLines && entry(prev).s >= MATURE && rng() < 0.5;
}

// FSRS grade of a first answer: sure ("이미 알아요") and right = Easy; right but slower than reading time allows = Hard.
// ponytail: fixed 6 s + 150 ms per character (read every option, then decide); per-user timing if it misjudges.
export function answerGrade(correct, { sure = false, ms = 0, chars = 0 } = {}) {
  if (!correct) return 1;
  if (sure) return 4;
  return ms > 6000 + 150 * chars ? 2 : 3;
}

const MODERN = new Set(['개항기', '대한 제국']);   // 대한 제국 (1897~) is part of 개항기
const related = (a, b) => a.includes(b) || b.includes(a) || (MODERN.has(a) && MODERN.has(b));   // 신라 ↔ 통일 신라: both would be right

// 사진 고르기: "다음 중 <period>의 문화유산은?" — one photo of that period, four from unrelated periods.
export function makePhotoQuestion(cards, { eras = null, rng = Math.random } = {}) {
  const photos = cards.filter(c => c.type === '사진');
  const candidates = photos.filter(c => inEras(c, eras));
  for (const period of shuffle([...new Set(candidates.map(c => c.period))], rng)) {
    const answer = shuffle(candidates.filter(c => c.period === period), rng)[0];
    const pool = photos.filter(c => !related(c.period, period));
    const ranked = [...shuffle(pool.filter(c => c.kind === answer.kind), rng), ...shuffle(pool.filter(c => c.kind !== answer.kind), rng)];
    const wrong = [];
    for (const c of ranked) if (wrong.length < CHOICES - 1 && c.back !== answer.back && !wrong.some(w => w.back === c.back)) wrong.push(c);
    if (wrong.length === CHOICES - 1) return { prompt: `다음 중 ${period}의 문화유산은?`, options: shuffle([answer, ...wrong], rng), answer };
  }
  return null;
}

// Map of the peninsula and surroundings: equirectangular, longitude scaled by cos 38°.
export const MAP = { lon0: 119, lon1: 133, lat0: 32.5, lat1: 44, k: 100 };
const COS = Math.cos(38 * Math.PI / 180);
const r1 = v => Math.round(v * 10) / 10;
export function project(lat, lon) {
  return [r1((lon - MAP.lon0) * COS * MAP.k), r1((MAP.lat1 - lat) * MAP.k)];
}
export const MAP_VIEW = `0 0 ${project(MAP.lat0, MAP.lon1).join(' ')}`;

// A photo card is asked the way the exam does: not its name but when it was made — or, for prehistory, the Three
// Kingdoms, 통일 신라 and 발해, what is true of the state that made it (one of that subject's 판별 facts, past-exam ones
// first), about half the time. Period options are the ones nearest in time, never one that would also be right.
export const PERIODS = ['구석기', '신석기', '청동기', '철기', '고조선', '고구려', '백제', '가야', '신라', '통일 신라', '발해',
  '고려', '조선 전기', '조선 후기', '개항기', '대한 제국', '일제 강점기', '현대'];
const PERIOD_SUBJECT = { 구석기: '구석기 시대', 신석기: '신석기 시대', 청동기: '청동기 시대', 고구려: '고구려', 백제: '백제', 신라: '신라',
  '통일 신라': '통일 신라', 발해: '발해' };
const PREHISTORY = new Set(['구석기', '신석기', '청동기']);
export function photoAsk(card, cards, { rng = Math.random, prefer = null } = {}) {
  const facts = cards.filter(c => c.type === '판별' && c.front === PERIOD_SUBJECT[card.period]);
  const pool = prefer && facts.some(c => prefer.has(c.id)) ? facts.filter(c => prefer.has(c.id)) : facts;
  const via = pool.length && rng() < 0.5 ? pool[Math.floor(rng() * pool.length)] : null;
  const pre = PREHISTORY.has(card.period);
  if (via) return { prompt: `${pre ? '사진 속 유물을 사용한 시대' : '사진 속 문화유산을 만든 나라'}에 대한 설명으로 옳은 것은?`, answer: via.back, opts: pickChoices(via, cards, rng), via };
  const i = PERIODS.indexOf(card.period);
  const near = PERIODS.filter(p => p !== card.period && !related(p, card.period))
    .sort((a, b) => Math.abs(PERIODS.indexOf(a) - i) - Math.abs(PERIODS.indexOf(b) - i));
  return { prompt: pre ? '사진 속 유물을 사용한 시대는?' : '사진 속 문화유산이 만들어진 시대(나라)는?', answer: card.period,
    opts: shuffle([card.period, ...shuffle(near.slice(0, 6), rng).slice(0, CHOICES - 1)], rng) };
}

// The card a wrong option belongs to: same kind of answer, same era first. 시기·지도 options (kings, places) have no single owner.
export function ownerCard(card, choice, cards) {
  if (card.type === '시기' || card.type === '지도') return null;
  const same = cards.filter(c => c.back === choice && choiceClass(c) === choiceClass(card));
  return same.find(c => c.era === card.era) ?? same[0] ?? null;
}

// The learner's own note on a card ({ id: text }); blank removes it.
export function setMyNote(notes, id, text) {
  const { [id]: _, ...rest } = notes;
  const t = text.trim();
  return t ? { ...rest, [id]: t } : rest;
}

// After a miss: a nudge if it keeps slipping, my own note, how to remember it, why, the full explanation, what the chosen
// option really was, the confusable pair.
export function missLines(card, { chose = null, cards = [], item = null, run = 0, mine = '' } = {}) {
  const o = chose ? ownerCard(card, chose, cards) : null;
  const hint = o && (o.memo ?? o.tip ?? o.note);
  const memo = card.memo ?? item?.memo;
  return [
    run >= 2 && { k: 'again', text: `${run}번 연속 틀린 카드예요. 같은 방법으로 반복하기보다 🧠 연상과 🔑 외우는 법을 소리 내어 읽고, ✏️ 메모에 내 말로 적어 보세요.` },
    mine && { k: 'mine', text: '✏️ ' + mine },
    memo && { k: 'memo', text: '🔑 ' + memo },
    card.tip && { k: 'tip', text: '💡 ' + card.tip },
    card.exp && { k: 'exp', text: '📖 ' + card.exp },
    hint && { k: 'vs', text: card.type === '판별' ? `↔ 내가 고른 보기는 ${o.front} 이야기: ${hint}` : `↔ 내가 고른 '${chose}': ${hint}` },
    item?.confuse && { k: 'confuse', text: '⚠ ' + item.confuse },
  ].filter(Boolean);
}
