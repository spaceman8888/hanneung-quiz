// Builds gichul.json from the past-exam analysis (docs/content/gichul/57~79.json) and cards.json.
// questions: past questions whose linked cards all exist (exam score, new-card priority).
// sets: 판별 questions' clue keywords for subjects that have 판별 cards (기출형 자료); `vague: true` = checked, doesn't point to the subject.
// Run: node tools/build-gichul.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const cards = JSON.parse(readFileSync('cards.json', 'utf8'));
const byId = new Map(cards.map(c => [c.id, c]));
const dir = 'docs/content/gichul';
const all = readdirSync(dir).filter(f => f.endsWith('.json')).sort().flatMap(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
const judge = cards.filter(c => c.type === '판별');
const judged = new Set(judge.map(c => c.front));

const mode = xs => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0][0];
const cardEra = q => (q.cards?.length && q.cards.every(id => byId.has(id)) ? mode(q.cards.map(id => byId.get(id).era)) : null);
// The analysis predates 판별 cards: a 판별 question also tests its subject's 판별 cards (same era as its cards, else its own label).
const facts = q => {
  if (q.kind !== '판별') return [];
  for (const era of [cardEra(q), q.era]) { const f = judge.filter(c => c.front === q.subject && c.era === era); if (f.length) return f; }
  return [];
};
const questions = all.filter(q => cardEra(q))
  .map(q => ({ era: cardEra(q), cards: [...new Set([...q.cards, ...facts(q).map(c => c.id)])] }));

const seen = new Set();
const sets = [];
for (const q of all) {
  if (q.kind !== '판별' || q.vague || !judged.has(q.subject) || !q.clues?.length) continue;
  const set = { era: facts(q)[0]?.era ?? q.era, subject: q.subject, clues: q.clues };
  const key = JSON.stringify(set);
  if (!seen.has(key)) { seen.add(key); sets.push(set); }
}

writeFileSync('gichul.json', JSON.stringify({ questions, sets }));
console.log(`questions ${questions.length} · sets ${sets.length} (of ${all.length} past questions)`);
