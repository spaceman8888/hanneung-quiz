export const INTERVALS = [1, 3, 7, 14, 30];
export const SHORT_MAX = 10;
export const BATCH_SIZE = 7;
export const ERAS = ['선사', '고조선·초기국가', '삼국', '통일신라·발해', '고려', '조선 전기', '조선 후기', '개항기', '일제강점기', '현대', '기타'];
export const TYPES = ['인물', '사건', '제도', '문화재', '단체', '기타'];

const pad = n => String(n).padStart(2, '0');

export function today(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return today(d);
}

export function normalize(s) {
  return String(s).replace(/[\s.,·!?'"()\-~]/g, '').toLowerCase();
}

export function isCorrect(input, answer) {
  const n = normalize(input);
  return n !== '' && n === normalize(answer);
}

export function isShort(answer) {
  return answer.length <= SHORT_MAX;
}

export function schedule(prev, { wrong }, todayStr) {
  const flagged = prev?.flagged ?? false;
  if (wrong || !prev?.seen) return { stage: 0, due: addDays(todayStr, INTERVALS[0]), seen: true, flagged };
  const stage = Math.min(prev.stage + 1, INTERVALS.length - 1);
  return { stage, due: addDays(todayStr, INTERVALS[stage]), seen: true, flagged };
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

export function pickChoices(card, pool, rng = Math.random) {
  const others = pool.filter(c => c.back !== card.back);
  const near = shuffle(others.filter(c => c.era === card.era && c.type === card.type).map(c => c.back), rng);
  const far = shuffle(others.map(c => c.back), rng);
  const wrong = [...new Set([...near, ...far])].slice(0, 3);
  return shuffle([card.back, ...wrong], rng);
}
