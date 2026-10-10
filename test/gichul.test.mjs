import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ERAS, chainIndex } from '../logic.js';

const cards = JSON.parse(readFileSync(new URL('../cards.json', import.meta.url)));
const { questions, sets } = JSON.parse(readFileSync(new URL('../gichul.json', import.meta.url)));
const ids = new Set(cards.map(c => c.id));

test('gichul.json: every question links existing cards and a known era', () => {
  assert.ok(questions.length > 1000);
  for (const q of questions) {
    assert.ok(ERAS.includes(q.era), q.era);
    assert.ok(q.cards.length && q.cards.every(id => ids.has(id)), JSON.stringify(q));
  }
});

test('gichul.json: clue sets name a subject that has 판별 cards', () => {
  const subjects = new Set(cards.filter(c => c.type === '판별').map(c => c.front));
  for (const s of sets) {
    assert.ok(subjects.has(s.subject) && ERAS.includes(s.era), JSON.stringify(s));
    assert.ok(s.clues.length && s.clues.every(k => typeof k === 'string' && k.trim()), JSON.stringify(s));
  }
});

test('기출형: most 판별 cards get 자료, none shows the subject name', () => {
  const idx = chainIndex(cards, sets);
  assert.ok(idx.size > 700, String(idx.size));
  const byId = new Map(cards.map(c => [c.id, c]));
  for (const [id, lines] of idx) for (const l of lines) assert.ok(!l.includes(byId.get(id).front), `${id}: ${l}`);
});

test('gichul.json: 판별 questions also link their subject\'s 판별 cards (order, score)', () => {
  const judge = new Set(cards.filter(c => c.type === '판별').map(c => c.id));
  const linked = new Set(questions.flatMap(q => q.cards).filter(id => judge.has(id)));
  assert.ok(linked.size > 300, String(linked.size));
});
