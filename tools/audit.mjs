// Measures guessable multiple-choice questions. Usage: node tools/audit.mjs [--list]
import { readFileSync } from 'node:fs';
import { pickChoices, normalize } from '../logic.js';

const cards = JSON.parse(readFileSync(new URL('../cards.json', import.meta.url), 'utf8'));
const RUNS = 20;
const kind = s => normalize(s).slice(-2);
const chunks = s => { const n = normalize(s), r = []; for (let i = 0; i + 2 <= n.length; i++) r.push(n.slice(i, i + 2)); return r; };
const odd = [], leak = [];
for (const c of cards) {
  const f = normalize(c.front);
  const hit = b => chunks(b).some(x => f.includes(x));
  const sameKindExists = cards.some(d => d.back !== c.back && kind(d.back) === kind(c.back));
  let o = 0, l = 0;
  for (let t = 0; t < RUNS; t++) {
    const wrong = pickChoices(c, cards).filter(x => x !== c.back);
    if (sameKindExists && wrong.length && wrong.every(w => kind(w) !== kind(c.back))) o++;
    if (hit(c.back) && !wrong.some(hit)) l++;
  }
  if (o > RUNS / 2) odd.push(c);
  if (l > RUNS / 2) leak.push(c);
}
console.log(`cards ${cards.length} · odd-one-out ${odd.length} · answer-leaked ${leak.length}`);
if (process.argv.includes('--list')) for (const c of leak) console.log(`${c.id}\t${c.back}\t${c.front}`);
