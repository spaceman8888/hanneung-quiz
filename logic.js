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
