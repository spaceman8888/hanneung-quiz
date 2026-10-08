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
// grade: 1 = wrong/모르겠어요, 3 = correct, 4 = 이미 알아요. Days are integers (dayOf).
const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5, FACTOR = 19 / 81;   // recall(t = s) = 0.9, so the interval for 90% retention is s days
export const MATURE = 21;               // 완료: still ≥ 90% recall three weeks out

export function dayOf(d = new Date()) {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}

const BLANK = { s: 0, d: 0, last: 0, due: 0, lapses: 0, flagged: false };

export function entry(prev) {
  return { ...BLANK, ...prev };
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
  return { ...p, s, d, last: day, due: day + Math.max(1, Math.round(s)), lapses: p.lapses + (p.s && grade === 1 ? 1 : 0) };
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

export function buildBatch(cards, progress, { day, era = null, type = null, ids = null, skip = new Set(), size = BATCH_SIZE }) {
  const p = id => entry(progress[id]);
  const forgot = (a, b) => recall(progress[a.id], day) - recall(progress[b.id], day);
  const pool = cards.filter(c => (!era || c.era === era) && (!type || c.type === type)
    && (!ids || ids.has(c.id)) && !skip.has(c.id));
  const seen = pool.filter(c => p(c.id).s);
  const due = seen.filter(c => p(c.id).due <= day).sort(forgot);
  const fresh = pool.filter(c => !p(c.id).s);
  const ahead = seen.filter(c => p(c.id).due > day).sort(forgot);
  return [...due, ...fresh, ...ahead].slice(0, size);
}

export function weakBatch(cards, progress, { day, skip = new Set(), era = null, size = BATCH_SIZE }) {
  const p = id => entry(progress[id]);
  return cards.filter(c => (!era || c.era === era) && !skip.has(c.id) && p(c.id).lapses > 0 && p(c.id).s < MATURE)
    .sort((a, b) => p(b.id).lapses - p(a.id).lapses || recall(progress[a.id], day) - recall(progress[b.id], day))
    .slice(0, size);
}

export function counts(cards, progress, day) {
  const r = { due: 0, fresh: 0, learning: 0, done: 0, weak: 0, recall: 0 };
  for (const c of cards) {
    const p = entry(progress[c.id]);
    if (!p.s) { r.fresh++; continue; }
    if (p.s >= MATURE) r.done++;
    else { r.learning++; if (p.lapses > 0) r.weak++; }
    if (p.due <= day) r.due++;
    r.recall += recall(p, day);
  }
  return r;
}

// New cards per day so every card is introduced a week before the exam.
export function dailyNew(fresh, today, exam) {
  return Math.ceil(fresh / Math.max(1, exam - today - 7));
}

export function createSession(batch) {
  return {
    queue: batch.map(card => ({ card })),
    wrong: new Set(),
  };
}

export function submit(session, correct) {
  const item = session.queue.shift();
  if (!correct) {
    session.wrong.add(item.card.id);
    session.queue.splice(Math.min(2, session.queue.length), 0, item);
    return null;
  }
  return item.card;
}

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

export function validateBackup(data) {
  return isObj(data) && isObj(data.progress)
    && (data.customCards === undefined || Array.isArray(data.customCards))
    && (data.stats === undefined || isStats(data.stats));
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

export function makeOrderQuestion(cards, { era = null, kind = null, rng = Math.random } = {}) {
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

const MODERN = new Set(['개항기', '대한 제국']);   // 대한 제국 (1897~) is part of 개항기
const related = (a, b) => a.includes(b) || b.includes(a) || (MODERN.has(a) && MODERN.has(b));   // 신라 ↔ 통일 신라: both would be right

// 사진 고르기: "다음 중 <period>의 문화유산은?" — one photo of that period, four from unrelated periods.
export function makePhotoQuestion(cards, { era = null, rng = Math.random } = {}) {
  const photos = cards.filter(c => c.type === '사진');
  const candidates = photos.filter(c => !era || c.era === era);
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
