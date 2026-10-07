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
    assert.ok(c.back?.trim() && (c.type === '판별' ? c.back.length <= 40 : isShort(c.back)), `back missing or too long: ${where}`);
    if (c.type === '판별') assert.ok(typeof c.group === 'string' && c.group, `판별 needs group: ${where}`);
    if (c.year !== undefined) assert.ok(Number.isInteger(c.year) && c.year >= -3000 && c.year <= 2026, `bad year: ${where}`);
    assert.ok(ERAS.includes(c.era) && c.era !== '기타', `bad era: ${where}`);
    assert.ok(TYPES.includes(c.type), `bad type: ${where}`);
    const n = Number(c.id.slice(1));
    if (n > 584) assert.ok(c.tier === 1 || c.tier === 2, `new card needs tier 1|2: ${where}`);
    else assert.equal(c.tier, undefined, `original card must not have tier: ${where}`);
  }
});

test('fronts are unique', () => {
  const fronts = cards.filter(c => c.type !== '판별').map(c => c.front.trim());
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
  for (const c of cards.filter(c => c.type !== '판별')) {
    const k = normalize(c.front);
    if (seen.has(k)) dups.push(`${seen.get(k)} = ${c.id}`);
    else seen.set(k, c.id);
  }
  assert.deepEqual(dups, []);
});

test('판별 cards: (front, back) unique and back not in front', () => {
  const seen = new Set();
  for (const c of cards.filter(c => c.type === '판별')) {
    const k = c.front + '|' + c.back;
    assert.ok(!seen.has(k), `dup 판별: ${c.id}`);
    seen.add(k);
    assert.ok(!c.front.includes(c.back), `back in front: ${c.id}`);
  }
});

test('original 584 cards keep their position', () => {
  cards.slice(0, 584).forEach((c, i) => assert.equal(c.id, `c${String(i + 1).padStart(4, '0')}`));
});

test('new cards ordered: tier 1 before tier 2, eras chronological within a tier', () => {
  const added = cards.slice(584);
  const key = c => [c.tier, ERAS.indexOf(c.era)];
  for (let i = 1; i < added.length; i++) {
    const [ta, ea] = key(added[i - 1]), [tb, eb] = key(added[i]);
    assert.ok(ta < tb || (ta === tb && ea <= eb), `order: ${added[i - 1].id} before ${added[i].id}`);
  }
});

const PERIOD = {
  '선사': b => ['구석기 시대', '신석기 시대', '청동기 시대', '철기 시대'].includes(b),
  '고조선·초기국가': b => ['고조선', '부여', '고구려', '옥저', '동예', '삼한'].includes(b),
  '일제강점기': b => ['무단 통치기', '문화 통치기', '민족 말살 통치기'].includes(b),
  '현대': b => /정부$/.test(b) || b === '장면 내각',
};
const ENDING = { '선사': '— 어느 시대?', '고조선·초기국가': '— 어느 나라?', '일제강점기': '— 어느 통치 시기?', '현대': '— 어느 정부 때?' };

test('시기 cards follow the period rules', () => {
  for (const c of cards.filter(c => c.type === '시기')) {
    const where = JSON.stringify(c);
    assert.ok(!['개항기', '통시대', '기타'].includes(c.era), `era: ${where}`);
    assert.ok((PERIOD[c.era] ?? (() => true))(c.back), `back: ${where}`);
    assert.ok(c.front.endsWith(ENDING[c.era] ?? '— 어느 왕 때?'), `ending: ${where}`);
    assert.ok(!normalize(c.front).includes(normalize(c.back)), `answer in question: ${where}`);
  }
});
