// Builds gichul.json from the past-exam analysis (docs/content/gichul/57~79.json) and cards.json.
// questions: past questions whose linked cards all exist (exam score, new-card priority).
// sets: 판별 questions' clue keywords for subjects that have 판별 cards (기출형 자료).
// Run: node tools/build-gichul.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const cards = JSON.parse(readFileSync('cards.json', 'utf8'));
const byId = new Map(cards.map(c => [c.id, c]));
const dir = 'docs/content/gichul';
const all = readdirSync(dir).filter(f => f.endsWith('.json')).sort().flatMap(f => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
const judged = new Set(cards.filter(c => c.type === '판별').map(c => c.front));

const mode = xs => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0][0];
const questions = all.filter(q => q.cards?.length && q.cards.every(id => byId.has(id)))
  .map(q => ({ era: mode(q.cards.map(id => byId.get(id).era)), cards: q.cards }));

const seen = new Set();
const sets = [];
for (const q of all) {
  if (q.kind !== '판별' || !judged.has(q.subject) || !q.clues?.length) continue;
  const own = (q.cards ?? []).map(id => byId.get(id)).find(c => c?.type === '판별' && c.front === q.subject);
  const set = { era: own?.era ?? q.era, subject: q.subject, clues: q.clues };
  const key = JSON.stringify(set);
  if (!seen.has(key)) { seen.add(key); sets.push(set); }
}

writeFileSync('gichul.json', JSON.stringify({ questions, sets }));
console.log(`questions ${questions.length} · sets ${sets.length} (of ${all.length} past questions)`);
