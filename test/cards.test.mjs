import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ERAS, TYPES, isShort, normalize } from '../logic.js';

const cards = JSON.parse(readFileSync(new URL('../cards.json', import.meta.url), 'utf8'));

test('every card is well-formed', () => {
  const ids = new Set();
  for (const c of cards) {
    const where = JSON.stringify(c);
    assert.match(c.id, /^c\d{4}$/, where);
    assert.ok(!ids.has(c.id), `duplicate id: ${where}`);
    ids.add(c.id);
    assert.ok(c.front?.trim(), `empty front: ${where}`);
    assert.ok(c.back?.trim() && isShort(c.back), `back missing or over 10 chars: ${where}`);
    assert.ok(ERAS.includes(c.era) && c.era !== '기타', `bad era: ${where}`);
    assert.ok(TYPES.includes(c.type), `bad type: ${where}`);
    const n = Number(c.id.slice(1));
    if (n > 584) assert.ok(c.tier === 1 || c.tier === 2, `new card needs tier 1|2: ${where}`);
    else assert.equal(c.tier, undefined, `original card must not have tier: ${where}`);
  }
});

test('fronts are unique', () => {
  const fronts = cards.map(c => c.front.trim());
  const dups = fronts.filter((f, i) => fronts.indexOf(f) !== i);
  assert.deepEqual(dups, []);
});

test('every era has at least the planned 90% of cards', () => {
  const plan = { '선사': 20, '고조선·초기국가': 30, '삼국': 70, '통일신라·발해': 50, '고려': 80,
    '조선 전기': 70, '조선 후기': 70, '개항기': 50, '일제강점기': 40, '현대': 20 };
  for (const [era, n] of Object.entries(plan)) {
    const have = cards.filter(c => c.era === era).length;
    assert.ok(have >= Math.floor(n * 0.9), `${era}: ${have} < ${Math.floor(n * 0.9)}`);
  }
});

test('fronts are unique after normalization', () => {
  const seen = new Map();
  const dups = [];
  for (const c of cards) {
    const k = normalize(c.front);
    if (seen.has(k)) dups.push(`${seen.get(k)} = ${c.id}`);
    else seen.set(k, c.id);
  }
  assert.deepEqual(dups, []);
});

test('original 584 cards keep their position', () => {
  cards.slice(0, 584).forEach((c, i) => assert.equal(c.id, `c${String(i + 1).padStart(4, '0')}`));
});
