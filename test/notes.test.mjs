import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ERAS } from '../logic.js';

const read = f => JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const notes = read('notes.json'), cards = read('cards.json');
const byId = new Map(cards.map(c => [c.id, c]));
const items = notes.flatMap(n => n.topics.flatMap(t => t.items.map(it => ({ ...it, era: n.era }))));
const ITEM_KEYS = new Set(['id', 'head', 'key', 'why', 'confuse', 'memo', 'table', 'cards']);

test('eras in ERAS order, flow 3–6 steps, last topic is 헷갈리는 것', () => {
  assert.deepEqual(notes.map(n => n.era), ERAS.filter(e => e !== '기타'));
  for (const n of notes) {
    assert.ok(n.flow.length >= 3 && n.flow.length <= 6 && n.flow.every(s => s.trim()), n.era);
    assert.ok(n.topics.length >= 2 && n.topics.every(t => t.title && t.items.length), n.era);
    assert.equal(n.topics.at(-1).title, '헷갈리는 것', n.era);
  }
});

test('items are well-formed', () => {
  const ids = new Set();
  for (const it of items) {
    const where = `${it.era} ${it.id}`;
    assert.match(it.id, /^[a-z0-9-]+$/, where);
    assert.ok(!ids.has(it.id), `duplicate id ${where}`);
    ids.add(it.id);
    assert.ok(Object.keys(it).every(k => k === 'era' || ITEM_KEYS.has(k)), `unknown field ${where}`);
    assert.ok(it.head?.trim() && it.key?.trim() && it.key.length <= 40, `head/key ${where}`);
    assert.ok(it.why?.trim() && it.why.length <= 150, `why ${where}`);
    for (const k of ['confuse', 'memo']) assert.ok(it[k] === undefined || (it[k].trim() && it[k].length <= 60), `${k} ${where}`);
    if (it.table) assert.ok(it.table.length >= 2 && it.table.every(r => r.length === it.table[0].length && r.every(x => typeof x === 'string')), `table ${where}`);
    assert.ok(it.cards.length && new Set(it.cards).size === it.cards.length, `cards ${where}`);
    for (const id of it.cards) assert.equal(byId.get(id)?.era, it.era, `card ${id} missing or other era: ${where}`);
  }
});

test('every card is linked to a note item', () => {
  const linked = new Set(items.flatMap(it => it.cards));
  assert.deepEqual(cards.filter(c => !linked.has(c.id)).map(c => c.id), []);
});
