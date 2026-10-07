export const GAPS = [20, 50, 120, 300, 700];
export const RELEARN_GAP = 10;
export const FAST_DONE_STREAK = 3;
export const WEAK_LAPSES = 2;
export const SHORT_MAX = 10;
export const BATCH_SIZE = 7;
export const ERAS = ['선사', '고조선·초기국가', '삼국', '통일신라·발해', '고려', '조선 전기', '조선 후기', '개항기', '일제강점기', '현대', '통시대', '기타'];
export const TYPES = ['인물', '사건', '제도', '문화재', '단체', '세시풍속', '시기', '판별', '기타'];

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

const BLANK = { stage: 0, next: 0, seen: false, flagged: false, lapses: 0, streak: 0, done: false };

export function entry(prev) {
  const { due, ...rest } = prev ?? {};
  return { ...BLANK, ...rest };
}

export function relapse(prev, tick) {
  const p = entry(prev);
  return { ...p, seen: true, done: false, stage: 0, streak: 0, lapses: p.lapses + 1, next: tick + RELEARN_GAP };
}

export function schedule(prev, { wrong }, tick) {
  const p = entry(prev);
  if (!p.seen) return { ...p, seen: true, stage: 0, streak: 0, next: tick + (wrong ? RELEARN_GAP : GAPS[0]) };
  if (wrong) return relapse(p, tick);
  const streak = p.streak + 1;
  const done = (p.lapses === 0 && streak >= FAST_DONE_STREAK) || p.stage === GAPS.length - 1;
  const stage = Math.min(p.stage + 1, GAPS.length - 1);
  const gap = p.lapses >= WEAK_LAPSES ? Math.ceil(GAPS[stage] / 2) : GAPS[stage];
  return { ...p, stage, streak, done, next: tick + gap };
}

export function markKnown(prev) {
  return { ...entry(prev), seen: true, done: true };
}

export function reopen(prev, tick) {
  return { ...entry(prev), done: false, stage: 0, streak: 0, next: tick };
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

export function pickChoices(card, pool, rng = Math.random) {
  const cls = c => (c.type === '시기' || c.type === '판별' ? c.type : '');
  const others = pool.filter(c => c.back !== card.back && cls(c) === cls(card)
    && !(card.type === '판별' && c.front === card.front));
  const sameEra = others.filter(c => c.era === card.era);
  let tiers;
  if (card.type === '시기') {
    const nat = nationOf(card.front);
    tiers = [sameEra.filter(c => nationOf(c.front) === nat), sameEra];
  } else if (card.type === '판별') {
    tiers = [sameEra.filter(c => c.group === card.group), sameEra];
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
  const wrong = [...new Set(tiers.flatMap(t => shuffle(t.map(c => c.back), rng)))].slice(0, 3);
  return shuffle([card.back, ...wrong], rng);
}

export function buildBatch(cards, progress, { tick, era = null, type = null, size = BATCH_SIZE }) {
  const p = id => entry(progress[id]);
  const pool = cards.filter(c => (!era || c.era === era) && (!type || c.type === type) && !p(c.id).done);
  const seen = pool.filter(c => p(c.id).seen);
  const due = seen.filter(c => p(c.id).next <= tick)
    .sort((a, b) => p(b.id).lapses - p(a.id).lapses || p(a.id).next - p(b.id).next);
  const fresh = pool.filter(c => !p(c.id).seen);
  const ahead = seen.filter(c => p(c.id).next > tick).sort((a, b) => p(a.id).next - p(b.id).next);
  return [...due, ...fresh, ...ahead].slice(0, size);
}

export function practiceBatch(cards, progress, { mode, skip = new Set(), era = null, size = BATCH_SIZE, rng = Math.random }) {
  const p = id => entry(progress[id]);
  const pool = cards.filter(c => (!era || c.era === era) && !skip.has(c.id));
  if (mode === 'check') return shuffle(pool.filter(c => p(c.id).done), rng).slice(0, size);
  return pool.filter(c => !p(c.id).done && p(c.id).lapses > 0)
    .sort((a, b) => p(b.id).lapses - p(a.id).lapses || p(a.id).next - p(b.id).next)
    .slice(0, size);
}

export function counts(cards, progress, tick) {
  const r = { due: 0, fresh: 0, learning: 0, done: 0, weak: 0 };
  for (const c of cards) {
    const p = entry(progress[c.id]);
    if (p.done) r.done++;
    else if (!p.seen) r.fresh++;
    else {
      r.learning++;
      if (p.next <= tick) r.due++;
      if (p.lapses > 0) r.weak++;
    }
  }
  return r;
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
  return isObj(v) && isCount(v.tick) && typeof v.date === 'string' && isCount(v.count);
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
  const pool = cards.filter(c => Number.isInteger(c.year) && c.type !== '판별'
    && (!era || Math.abs(ERAS.indexOf(c.era) - i) <= 1));
  const k = kind ?? (rng() < 0.5 ? 'first' : 'between');
  if (k === 'first') {
    const options = pickApart(pool, 4, ORDER_GAP, rng);
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
    const wrong = answer && pickApart(outside, 3, 0, rng, [a, b, answer]);
    if (wrong) return { kind: k, prompt: `(가) ${orderLabel(a)} 와(과) (나) ${orderLabel(b)} 사이에 있었던 일은?`, options: shuffle([answer, ...wrong], rng), answer, ends: [a, b] };
  }
  return null;
}
