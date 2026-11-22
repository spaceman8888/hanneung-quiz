import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lectureRows, rowBlanks, blankParts, normalize } from '../logic.js';

const lecs = JSON.parse(readFileSync(new URL('../blanks.json', import.meta.url), 'utf8'));

test('blanks.json: lectures in order, each with sections of rows', () => {
  assert.ok(lecs.length >= 1);
  const ns = lecs.map(l => l.n);
  assert.deepEqual(ns, [...ns].sort((a, b) => a - b));
  assert.equal(new Set(ns).size, ns.length);
  for (const l of lecs) {
    assert.ok(Number.isInteger(l.n) && l.title?.trim() && l.sections?.length, `lecture ${l.n}`);
    for (const s of l.sections) assert.ok(s.title && (s.rows?.length || s.sub?.length), `${l.n}: ${JSON.stringify(s).slice(0, 80)}`);
  }
});

test('blanks.json: every blank has an answer and a hint that does not give the answer away; ids unique', () => {
  const ids = new Set();
  for (const l of lecs) {
    const rows = lectureRows(l);
    for (const r of rows) for (const t of [r.label, ...r.lines]) {
      assert.equal(typeof t, 'string', `${r.id}`);
      assert.equal((t.match(/\{/g) ?? []).length, (t.match(/\}/g) ?? []).length, `${r.id}: ${t}`);
      for (const p of blankParts(t).parts) if (typeof p !== 'string') {
        assert.ok(p.ans.trim() && p.hint.trim(), `${r.id}: ${t}`);
        assert.ok(!normalize(p.hint).includes(normalize(p.ans)), `${r.id}: hint gives away ${p.ans}: ${p.hint}`);
      }
    }
    const bl = rows.flatMap(rowBlanks);
    assert.ok(bl.length >= 15, `${l.n}: only ${bl.length} blanks`);
    for (const b of bl) { assert.ok(!ids.has(b.id), b.id); ids.add(b.id); }
  }
});
