# 한능검 암기 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 빈도(푼 카드 수) 기반 복습 + 완료 상태 + 자주 틀린 카드/완료 점검 모드를 넣고, 카드를 한능검 심화 전 범위(총 ~1,500장)로 확장한다.

**Architecture:** 기존 구조 유지 — 순수 로직 `logic.js`(Node 테스트), DOM `app.js`, 정적 PWA. 스케줄 로직을 날짜 기반에서 전역 카운터 `tick` 기반으로 교체하고, 카드 내용은 커버리지 맵(주제 목록)을 기준으로 시대 묶음별로 작성·사실검토한다.

**Tech Stack:** HTML/CSS/바닐라 JS(ES modules), Node 24 `node:test`, GitHub Pages. 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-07-history-quiz-v2-design.md` (이전 설계 `docs/superpowers/specs/2026-10-06-history-quiz-pwa-design.md` 중 v2가 바꾸지 않은 부분은 유효)

## Global Constraints

- 의존성 0개. 테스트: 저장소 루트에서 `node --test`.
- 간격(카드 수) `GAPS = [20, 50, 120, 300, 700]`, 재학습 간격 `RELEARN_GAP = 10`, 빠른 완료 `FAST_DONE_STREAK = 3`, 약한 카드 기준 `WEAK_LAPSES = 2`(간격 절반, 올림), 묶음 7장.
- 첫 학습 중 실수는 `lapses`에 넣지 않는다. `lapses`는 복습/연습에서 틀린 횟수.
- 하루 학습량 제한 없음. 완료 카드는 일반 학습·자주 틀린 카드에 절대 나오지 않음(완료 카드 점검에만).
- 시대(`era`): 선사, 고조선·초기국가, 삼국, 통일신라·발해, 고려, 조선 전기, 조선 후기, 개항기, 일제강점기, 현대, 통시대, 기타(가져온 카드 전용 — 기본 카드에 금지).
- 유형(`type`): 인물, 사건, 제도, 문화재, 단체, 기타.
- 정답(`back`)은 공백 포함 10자 이내 단어/고유명사.
- 기존 카드 c0001–c0584는 id·내용·순서를 바꾸지 않는다. 새 카드는 c0585부터, `tier`(1 = 빈출 핵심, 2 = 심화) 필수.
- 문제(`front`)는 정규화(공백·문장부호 제거, 소문자) 기준으로도 중복 금지. 이미 있는 사실을 다른 말로 다시 묻는 카드 금지.
- 카드 텍스트는 항상 `textContent`로 렌더링. UI 문구 한국어.
- localStorage 키: `progress`, `customCards`, `stats`. v1의 `settings`, `newToday`는 읽지 않는다.
- 커밋 메시지 끝: 빈 줄 + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Review Focus

1. 폰에 이미 쌓인 v1 기록(`due` 날짜가 있는 progress, `settings`/`newToday` 키) → 앱이 정상 부팅하고 학습한 카드는 바로 "다시 볼 카드"가 됨 (Task 1 `entry`/`buildBatch` v1 테스트, Task 2 브라우저 확인).
2. 하루에 몰아서 수백 장 풀기 → 완료되지 않은 카드가 있는 한 묶음이 비지 않음 (Task 1 "never empty" 테스트).
3. 피드백 표시 중/정답 자동 진행 중 "이미 알아요" 누름 → 무시, 중복 집계 없음 (Task 2 브라우저 확인).
4. 연습 모드 라운드를 다 풂 → 같은 카드 무한 반복 없이 "라운드 완료" 안내 (Task 1 `skip` 테스트, Task 2 브라우저 확인).
5. 새 카드가 기존 사실을 다른 표현으로 다시 묻거나 단서가 두 정답에 맞음 → 정규화 중복 테스트(Task 3) + 시대별 사실·중복 검토(Task 4–8 리뷰).

---

## File Structure

| 파일 | 변경 |
|---|---|
| `logic.js` | 스케줄/출제 함수 교체(전체 재작성 코드 제공) |
| `test/logic.test.mjs` | 날짜 기반 테스트 삭제, v2 테스트 추가 |
| `app.js` | 전체 재작성 코드 제공 |
| `index.html` | 홈·학습·관리 마크업 일부 교체 |
| `test/cards.test.mjs` | 통시대 허용, 정규화 중복·tier·순서 검사 추가 |
| `docs/content/card-coverage.md` | 새로 작성: 시대별 출제 주제 목록과 커버 여부 |
| `cards.json` | 카드 추가(c0585~), 마지막에 tier 순서 정렬 |
| `sw.js` | `CACHE = 'v2'` |

---

### Task 1: 빈도 기반 스케줄 로직

**Files:**
- Modify: `logic.js` (아래 전체 내용으로 교체)
- Modify: `test/logic.test.mjs`

**Interfaces:**
- Produces (Task 2가 사용):
  - 상수 `GAPS`, `RELEARN_GAP`, `FAST_DONE_STREAK`, `WEAK_LAPSES`, `SHORT_MAX`, `BATCH_SIZE`, `ERAS`, `TYPES`
  - `today(d?) → 'YYYY-MM-DD'`, `normalize`, `isCorrect`, `isShort`, `hashId`, `parseQuizlet`, `mergeCards`, `shuffle`, `pickChoices`, `createSession`, `submit`, `loadJSON` — 기존과 동일
  - `Progress = { stage, next, seen, flagged, lapses, streak, done }`
  - `entry(prev) → Progress` (기본값 채움, v1의 `due` 제거)
  - `schedule(prev, { wrong }, tick) → Progress`
  - `markKnown(prev) → Progress`, `relapse(prev, tick) → Progress`, `reopen(prev, tick) → Progress`
  - `buildBatch(cards, progress, { tick, era?, size? }) → Card[]`
  - `practiceBatch(cards, progress, { mode: 'weak'|'check', skip?: Set<string>, era?, size?, rng? }) → Card[]`
  - `counts(cards, progress, tick) → { due, fresh, learning, done, weak }`
  - `isStats(v) → boolean` (`{ tick: 정수 ≥ 0, date: string, count: 정수 ≥ 0 }`)
  - `validateBackup(data) → boolean`
- 삭제: `INTERVALS`, `addDays`, `newLeft`

- [ ] **Step 1: 테스트 파일 수정** — `test/logic.test.mjs`

1. import 문(3–6행)을 다음으로 교체:

```js
import { today, normalize, isCorrect, isShort, ERAS,
  hashId, parseQuizlet, mergeCards, pickChoices,
  entry, schedule, markKnown, relapse, reopen,
  buildBatch, practiceBatch, counts, createSession, submit,
  loadJSON, validateBackup, isStats } from '../logic.js';
```

2. 다음 이름의 테스트 블록을 통째로 삭제:
   - `'addDays crosses month and year'`
   - `'schedule: new card -> stage 0, tomorrow'`
   - `'schedule: correct review -> next stage'`
   - `'schedule: caps at last stage (30 days)'`
   - `'schedule: wrong resets to stage 0'`
   - `'schedule: keeps flagged, treats flag-only entry as new'`
   - `'newLeft: counts today only, never negative'`
   - `'buildBatch: due reviews first (earliest due), then new up to limit'`
   - `'buildBatch: size cap and era filter'`
   - `'buildBatch: flag-only progress entry counts as new'`
   - `'validateBackup'`
   - `'validateBackup: newLimit range'`

   (`const T`, `cardsN`, `mk`, `fakeStorage` 정의는 남긴다 — 다른 테스트가 쓴다.)

3. 파일 끝에 추가:

```js
const E = o => ({ ...entry(undefined), ...o });

test('entry: defaults and v1 migration drops due', () => {
  assert.deepEqual(entry(undefined), { stage: 0, next: 0, seen: false, flagged: false, lapses: 0, streak: 0, done: false });
  assert.deepEqual(entry({ stage: 2, due: '2026-10-06', seen: true, flagged: true }),
    { stage: 2, next: 0, seen: true, flagged: true, lapses: 0, streak: 0, done: false });
});

test('schedule: first learning (mistakes not counted as lapses)', () => {
  assert.deepEqual(schedule(undefined, { wrong: false }, 100), E({ seen: true, next: 120 }));
  assert.deepEqual(schedule(undefined, { wrong: true }, 100), E({ seen: true, next: 110 }));
  assert.deepEqual(schedule({ flagged: true }, { wrong: false }, 0), E({ seen: true, flagged: true, next: 20 }));
});

test('schedule: correct reviews climb GAPS', () => {
  let p = schedule(undefined, { wrong: false }, 0);
  p = schedule(p, { wrong: false }, 20);
  assert.deepEqual(p, E({ seen: true, stage: 1, streak: 1, next: 70 }));
  p = schedule(p, { wrong: false }, 70);
  assert.deepEqual(p, E({ seen: true, stage: 2, streak: 2, next: 190 }));
});

test('schedule: never-wrong card is done after 3 correct reviews', () => {
  let p = schedule(undefined, { wrong: false }, 0);
  for (const t of [20, 70]) p = schedule(p, { wrong: false }, t);
  assert.equal(p.done, false);
  p = schedule(p, { wrong: false }, 190);
  assert.equal(p.done, true);
  assert.equal(p.streak, 3);
});

test('schedule: review wrong -> lapse, reset, relearn gap', () => {
  const prev = E({ seen: true, stage: 3, streak: 2 });
  assert.deepEqual(schedule(prev, { wrong: true }, 500), E({ seen: true, stage: 0, streak: 0, lapses: 1, next: 510 }));
});

test('schedule: lapsed card is done only after a correct review at the last stage', () => {
  let p = schedule(E({ seen: true, lapses: 1, stage: 3, streak: 5 }), { wrong: false }, 0);
  assert.deepEqual([p.stage, p.done, p.next], [4, false, 700]);
  p = schedule(p, { wrong: false }, 700);
  assert.deepEqual([p.stage, p.done], [4, true]);
});

test('schedule: weak card (lapses >= 2) gets half gaps, rounded up', () => {
  const p = schedule(E({ seen: true, lapses: 2, stage: 1 }), { wrong: false }, 0);
  assert.deepEqual([p.stage, p.next], [2, 60]);
  assert.equal(schedule(E({ seen: true, lapses: 3 }), { wrong: false }, 0).next, 25);
});

test('markKnown / relapse / reopen', () => {
  assert.deepEqual(markKnown(undefined), E({ seen: true, done: true }));
  assert.deepEqual(relapse(E({ seen: true, done: true, stage: 4, streak: 3, lapses: 1 }), 50),
    E({ seen: true, stage: 0, streak: 0, lapses: 2, next: 60 }));
  assert.deepEqual(reopen(E({ seen: true, done: true, stage: 2, streak: 3 }), 99),
    E({ seen: true, stage: 2, streak: 0, next: 99 }));
});

test('buildBatch: due (most lapses first) -> new -> ahead; done excluded', () => {
  const progress = {
    k0: E({ seen: true, next: 5 }),
    k1: E({ seen: true, next: 3, lapses: 2 }),
    k2: E({ seen: true, next: 50 }),
    k3: E({ seen: true, done: true }),
    k4: E({ seen: true, next: 1 }),
  };
  const ids = buildBatch(cardsN(10), progress, { tick: 10, size: 10 }).map(c => c.id);
  assert.deepEqual(ids, ['k1', 'k4', 'k0', 'k5', 'k6', 'k7', 'k8', 'k9', 'k2']);
});

test('buildBatch: size cap and era filter', () => {
  const cs = [...cardsN(10), mk('j1', 'x', '조선 전기')];
  assert.equal(buildBatch(cs, {}, { tick: 0 }).length, 7);
  assert.deepEqual(buildBatch(cs, {}, { tick: 0, era: '조선 전기' }).map(c => c.id), ['j1']);
});

test('buildBatch: never empty until everything is done', () => {
  const ahead = { k0: E({ seen: true, next: 900 }), k1: E({ seen: true, next: 800 }) };
  assert.deepEqual(buildBatch(cardsN(2), ahead, { tick: 0 }).map(c => c.id), ['k1', 'k0']);
  const done = { k0: E({ seen: true, done: true }), k1: E({ seen: true, done: true }) };
  assert.equal(buildBatch(cardsN(2), done, { tick: 0 }).length, 0);
});

test('buildBatch: v1 progress entries are due immediately', () => {
  const b = buildBatch(cardsN(3), { k2: { stage: 1, due: '2026-10-09', seen: true } }, { tick: 0 });
  assert.equal(b[0].id, 'k2');
});

test('practiceBatch weak: not done, lapses > 0, most lapses first, skip honored', () => {
  const progress = {
    k0: E({ seen: true, lapses: 1, next: 9 }),
    k1: E({ seen: true, lapses: 3 }),
    k2: E({ seen: true, lapses: 1, next: 2 }),
    k3: E({ seen: true, lapses: 5, done: true }),
  };
  assert.deepEqual(practiceBatch(cardsN(5), progress, { mode: 'weak' }).map(c => c.id), ['k1', 'k2', 'k0']);
  assert.deepEqual(practiceBatch(cardsN(5), progress, { mode: 'weak', skip: new Set(['k1']) }).map(c => c.id), ['k2', 'k0']);
});

test('practiceBatch check: only done cards, size cap, era filter', () => {
  const cs = [...cardsN(10), mk('j1', 'x', '조선 전기')];
  const progress = Object.fromEntries(cs.map(c => [c.id, E({ seen: true, done: true })]));
  progress.k0 = E({ seen: true });
  const b = practiceBatch(cs, progress, { mode: 'check' });
  assert.equal(b.length, 7);
  assert.ok(b.every(c => c.id !== 'k0'));
  assert.deepEqual(practiceBatch(cs, progress, { mode: 'check', era: '조선 전기' }).map(c => c.id), ['j1']);
});

test('counts', () => {
  const progress = {
    k0: E({ seen: true, next: 0, lapses: 1 }),
    k1: E({ seen: true, next: 99 }),
    k2: E({ seen: true, done: true, lapses: 2 }),
  };
  assert.deepEqual(counts(cardsN(5), progress, 10), { due: 1, fresh: 2, learning: 2, done: 1, weak: 1 });
});

test('isStats', () => {
  assert.ok(isStats({ tick: 0, date: '', count: 0 }));
  assert.ok(!isStats({ tick: 0, date: 1, count: 0 }));
  assert.ok(!isStats({ tick: -1, date: '', count: 0 }));
  assert.ok(!isStats(null));
});

test('validateBackup: v2 and v1 backups', () => {
  assert.ok(validateBackup({ progress: {} }));
  assert.ok(validateBackup({ version: 2, progress: {}, customCards: [], stats: { tick: 5, date: '2026-10-07', count: 3 } }));
  assert.ok(validateBackup({ version: 1, progress: {}, settings: { newLimit: 20 }, newToday: { date: '', count: 0 } }));
  assert.ok(!validateBackup(null));
  assert.ok(!validateBackup('x'));
  assert.ok(!validateBackup({}));
  assert.ok(!validateBackup({ progress: [] }));
  assert.ok(!validateBackup({ progress: {}, customCards: {} }));
  assert.ok(!validateBackup({ progress: {}, stats: { tick: 1.5, date: '', count: 0 } }));
});

test('ERAS has 통시대 before 기타', () => {
  assert.deepEqual(ERAS.slice(-3), ['현대', '통시대', '기타']);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test`
Expected: FAIL — `does not provide an export named 'entry'`

- [ ] **Step 3: `logic.js` 전체 교체**

```js
export const GAPS = [20, 50, 120, 300, 700];
export const RELEARN_GAP = 10;
export const FAST_DONE_STREAK = 3;
export const WEAK_LAPSES = 2;
export const SHORT_MAX = 10;
export const BATCH_SIZE = 7;
export const ERAS = ['선사', '고조선·초기국가', '삼국', '통일신라·발해', '고려', '조선 전기', '조선 후기', '개항기', '일제강점기', '현대', '통시대', '기타'];
export const TYPES = ['인물', '사건', '제도', '문화재', '단체', '기타'];

const pad = n => String(n).padStart(2, '0');

export function today(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function normalize(s) {
  return String(s).replace(/[\s\p{P}ㆍ~]/gu, '').toLowerCase();
}

export function isCorrect(input, answer) {
  const n = normalize(input);
  return n !== '' && n === normalize(answer);
}

export function isShort(answer) {
  return answer.length <= SHORT_MAX;
}

const BLANK = { stage: 0, next: 0, seen: false, flagged: false, lapses: 0, streak: 0, done: false };

export function entry(prev) {
  const { due, ...rest } = prev ?? {};
  return { ...BLANK, ...rest };
}

export function relapse(prev, tick) {
  const p = entry(prev);
  return { ...p, seen: true, done: false, stage: 0, streak: 0, lapses: p.lapses + 1, next: tick + RELEARN_GAP };
}

export function schedule(prev, { wrong }, tick) {
  const p = entry(prev);
  if (!p.seen) return { ...p, seen: true, stage: 0, streak: 0, next: tick + (wrong ? RELEARN_GAP : GAPS[0]) };
  if (wrong) return relapse(p, tick);
  const streak = p.streak + 1;
  const done = (p.lapses === 0 && streak >= FAST_DONE_STREAK) || p.stage === GAPS.length - 1;
  const stage = Math.min(p.stage + 1, GAPS.length - 1);
  const gap = p.lapses >= WEAK_LAPSES ? Math.ceil(GAPS[stage] / 2) : GAPS[stage];
  return { ...p, stage, streak, done, next: tick + gap };
}

export function markKnown(prev) {
  return { ...entry(prev), seen: true, done: true };
}

export function reopen(prev, tick) {
  return { ...entry(prev), done: false, streak: 0, next: tick };
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
  const sameEra = others.filter(c => c.era === card.era);
  const tiers = [sameEra.filter(c => c.type === card.type), sameEra, others];
  const wrong = [...new Set(tiers.flatMap(t => shuffle(t.map(c => c.back), rng)))].slice(0, 3);
  return shuffle([card.back, ...wrong], rng);
}

export function buildBatch(cards, progress, { tick, era = null, size = BATCH_SIZE }) {
  const p = id => entry(progress[id]);
  const pool = cards.filter(c => (!era || c.era === era) && !p(c.id).done);
  const seen = pool.filter(c => p(c.id).seen);
  const due = seen.filter(c => p(c.id).next <= tick)
    .sort((a, b) => p(b.id).lapses - p(a.id).lapses || p(a.id).next - p(b.id).next);
  const fresh = pool.filter(c => !p(c.id).seen);
  const ahead = seen.filter(c => p(c.id).next > tick).sort((a, b) => p(a.id).next - p(b.id).next);
  return [...due, ...fresh, ...ahead].slice(0, size);
}

export function practiceBatch(cards, progress, { mode, skip = new Set(), era = null, size = BATCH_SIZE, rng = Math.random }) {
  const p = id => entry(progress[id]);
  const pool = cards.filter(c => (!era || c.era === era) && !skip.has(c.id));
  if (mode === 'check') return shuffle(pool.filter(c => p(c.id).done), rng).slice(0, size);
  return pool.filter(c => !p(c.id).done && p(c.id).lapses > 0)
    .sort((a, b) => p(b.id).lapses - p(a.id).lapses || p(a.id).next - p(b.id).next)
    .slice(0, size);
}

export function counts(cards, progress, tick) {
  const r = { due: 0, fresh: 0, learning: 0, done: 0, weak: 0 };
  for (const c of cards) {
    const p = entry(progress[c.id]);
    if (p.done) r.done++;
    else if (!p.seen) r.fresh++;
    else {
      r.learning++;
      if (p.next <= tick) r.due++;
      if (p.lapses > 0) r.weak++;
    }
  }
  return r;
}

export function createSession(batch, progress) {
  return {
    queue: batch.map(card => ({ card, mode: progress[card.id]?.seen && isShort(card.back) ? 'sa' : 'mc' })),
    wrong: new Set(),
  };
}

export function submit(session, correct) {
  const item = session.queue.shift();
  if (!correct) {
    session.wrong.add(item.card.id);
    session.queue.splice(Math.min(2, session.queue.length), 0, item);
    return null;
  }
  if (item.mode === 'mc' && isShort(item.card.back)) {
    session.queue.push({ card: item.card, mode: 'sa' });
    return null;
  }
  return item.card;
}

export function loadJSON(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw == null ? { value: fallback, ok: true } : { value: JSON.parse(raw), ok: true };
  } catch {
    return { value: fallback, ok: false };
  }
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = v => Number.isInteger(v) && v >= 0;

export function isStats(v) {
  return isObj(v) && isCount(v.tick) && typeof v.date === 'string' && isCount(v.count);
}

export function validateBackup(data) {
  return isObj(data) && isObj(data.progress)
    && (data.customCards === undefined || Array.isArray(data.customCards))
    && (data.stats === undefined || isStats(data.stats));
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test`
Expected: logic 테스트 전부 PASS, cards 테스트 3개 PASS. (logic 테스트: 기존 34 − 12 삭제 = 22 + 18 추가 = 40, cards 3 포함 총 43)

- [ ] **Step 5: 커밋**

```bash
git add logic.js test/logic.test.mjs
git commit -m "feat: frequency-based scheduling, mastery and practice batches"
```

---

### Task 2: v2 화면

**Files:**
- Modify: `index.html` (홈·학습·관리 일부, 스타일 2줄)
- Modify: `app.js` (아래 전체 내용으로 교체)

**Interfaces:**
- Consumes: Task 1의 `entry, schedule, markKnown, relapse, reopen, buildBatch, practiceBatch, counts, isStats, validateBackup, createSession, submit, pickChoices, isCorrect, parseQuizlet, mergeCards, loadJSON, today, ERAS`

- [ ] **Step 1: `index.html` 수정**

1. `<style>` 안의 `.stats` 규칙 줄을 다음으로 교체:

```css
  .stats { display:grid; grid-template-columns:repeat(4, 1fr); gap:4px; font-size:13px; } .stats div { text-align:center; } .stats b { display:block; font-size:24px; }
```

2. `<section id="home">` 전체를 다음으로 교체:

```html
  <section id="home">
    <header><h1>한능검 암기</h1><button id="toManage">관리</button></header>
    <div class="card stats">
      <div><b id="dueCount">0</b>다시 볼 카드</div>
      <div><b id="newCount">0</b>새 카드</div>
      <div><b id="doneCount">0</b>완료</div>
      <div><b id="todayCount">0</b>오늘 푼 카드</div>
    </div>
    <select id="eraSelect" aria-label="시대 선택"></select>
    <p><button class="primary" id="start">학습 시작</button></p>
    <div class="row"><button id="weakBtn">자주 틀린 카드</button><button id="checkBtn">완료 카드 점검</button></div>
    <p id="homeMsg" class="muted"></p>
    <p class="muted">시대별: 완료 / 학습 중 / 전체</p>
    <table id="eraTable"></table>
  </section>
```

3. 학습 화면의 `<p><button id="flag">신고</button></p>` 줄을 다음으로 교체:

```html
    <div class="row"><button id="known">이미 알아요</button><button id="flag">신고</button></div>
```

4. 관리 화면에서 다음 두 줄을 삭제:

```html
    <h2>설정</h2>
    <label>하루 새 카드 수 <input type="number" min="1" max="200" id="newLimit"></label>
```

5. 관리 화면의 `<ul id="flagList"></ul>` 줄 바로 아래에 추가:

```html
    <h2>완료 카드</h2>
    <details><summary id="doneSummary">완료 카드 (0)</summary><ul id="doneList"></ul></details>
```

- [ ] **Step 2: `app.js` 전체 교체**

```js
import * as L from './logic.js';

const $ = id => document.getElementById(id);
const warn = msg => { $('warn').textContent = msg; };
const storage = (() => { try { return localStorage; } catch { return null; } })();

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const shapes = { progress: isObj, customCards: Array.isArray, stats: L.isStats };

function load(key, fallback) {
  const r = L.loadJSON(storage, key, fallback);
  if (r.ok && shapes[key](r.value)) return r.value;
  warn('저장된 기록 일부를 읽지 못해 초기 상태로 시작합니다.');
  return fallback;
}

function save(key, value) {
  try { storage.setItem(key, JSON.stringify(value)); }
  catch { warn('저장에 실패했습니다. 관리 → 기록 백업을 권장합니다.'); }
}

function btn(label, onclick, cls) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = onclick;
  if (cls) b.className = cls;
  return b;
}

let baseCards = [];
let custom = load('customCards', []);
let progress = load('progress', {});
let stats = load('stats', { tick: 0, date: '', count: 0 });
let session = null, mode = 'normal', practiced = new Set();
let doneCount = 0, batchSize = 0, busy = false, timer = null;
const cancelTimer = () => { clearTimeout(timer); timer = null; busy = false; };

const MODE_LABEL = { normal: '학습', weak: '자주 틀린 카드', check: '완료 카드 점검' };
const EMPTY_MSG = {
  normal: '모든 카드를 완료했어요! 완료 카드 점검으로 확인해 보세요.',
  weak: '자주 틀린 카드가 없어요.',
  check: '완료 카드가 없어요.',
};

const allCards = () => [...baseCards, ...custom];
const show = id => ['home', 'study', 'manage'].forEach(s => { $(s).hidden = s !== id; });
const todayCount = () => (stats.date === L.today() ? stats.count : 0);

function fillEras(sel, withAll) {
  sel.replaceChildren(...(withAll ? [new Option('전체 시대', '')] : []), ...L.ERAS.map(e => new Option(e, e)));
}

function renderHome() {
  cancelTimer();
  const era = $('eraSelect').value;
  const n = L.counts(allCards().filter(c => !era || c.era === era), progress, stats.tick);
  $('dueCount').textContent = n.due;
  $('newCount').textContent = n.fresh;
  $('doneCount').textContent = n.done;
  $('todayCount').textContent = todayCount();
  $('weakBtn').textContent = `자주 틀린 카드 (${n.weak})`;
  $('checkBtn').textContent = `완료 카드 점검 (${n.done})`;
  $('eraTable').replaceChildren(...L.ERAS.map(e => {
    const inEra = allCards().filter(c => c.era === e);
    if (!inEra.length) return null;
    const k = L.counts(inEra, progress, stats.tick);
    const tr = document.createElement('tr');
    const name = document.createElement('td'), count = document.createElement('td');
    name.textContent = e;
    count.textContent = `${k.done} / ${k.learning} / ${inEra.length}`;
    tr.append(name, count);
    return tr;
  }).filter(Boolean));
  show('home');
}

function enterMode(m) {
  mode = m;
  practiced = new Set();
  $('homeMsg').textContent = '';
  startBatch();
}

function startBatch() {
  cancelTimer();
  const era = $('eraSelect').value || null;
  const batch = mode === 'normal'
    ? L.buildBatch(allCards(), progress, { tick: stats.tick, era })
    : L.practiceBatch(allCards(), progress, { mode, skip: practiced, era });
  if (!batch.length) {
    $('homeMsg').textContent = practiced.size ? `${MODE_LABEL[mode]}: 이번 라운드를 모두 마쳤어요.` : EMPTY_MSG[mode];
    return renderHome();
  }
  batch.forEach(c => practiced.add(c.id));
  session = L.createSession(batch, progress);
  doneCount = 0;
  batchSize = batch.length;
  show('study');
  renderQuestion();
}

function renderQuestion() {
  busy = false;
  $('feedback').replaceChildren();
  $('choices').replaceChildren();
  $('saForm').hidden = true;
  $('progressText').textContent = `${MODE_LABEL[mode]} · ${doneCount} / ${batchSize}`;
  const item = session.queue[0];
  if (!item) return renderBatchDone();
  const { card, mode: qmode } = item;
  $('qTag').textContent = `${card.era} · ${card.type} · ${qmode === 'mc' ? '객관식' : '주관식'}`;
  $('qFront').textContent = card.front;
  $('flag').hidden = false;
  $('known').hidden = mode === 'check';
  $('flag').textContent = progress[card.id]?.flagged ? '신고 취소' : '신고';
  if (qmode === 'mc') {
    $('choices').replaceChildren(...L.pickChoices(card, allCards()).map(choice => {
      const b = btn(choice, () => onAnswer(choice === card.back, b));
      return b;
    }));
  } else {
    $('saForm').hidden = false;
    $('saInput').value = '';
    $('saInput').focus();
  }
}

function renderBatchDone() {
  $('qTag').textContent = '';
  $('qFront').textContent = `묶음 완료! (${batchSize}장)`;
  $('flag').hidden = true;
  $('known').hidden = true;
  $('choices').replaceChildren(btn('다음 묶음', startBatch, 'primary'), btn('홈으로', renderHome));
}

function onAnswer(correct, button) {
  if (busy) return;
  busy = true;
  const { card, mode: qmode } = session.queue[0];
  button?.classList.add(correct ? 'ok' : 'bad');
  const p = document.createElement('p');
  p.className = correct ? 'ok' : 'bad';
  p.textContent = correct ? '정답!' : `정답: ${card.back}`;
  $('feedback').replaceChildren(p);
  if (correct) { const s = session; timer = setTimeout(() => { timer = null; if (s === session) commit(true); }, 500); return; }
  if (qmode === 'sa') $('feedback').append(btn('맞은 걸로 처리', () => commit(true)));
  $('feedback').append(btn('다음', () => commit(false), 'primary'));
}

function bumpStats() {
  stats = { tick: stats.tick + 1, date: L.today(), count: todayCount() + 1 };
  save('stats', stats);
}

function commit(correct) {
  if (!busy) return;
  const id = session.queue[0].card.id;
  const done = L.submit(session, correct);
  if (done) {
    const wrong = session.wrong.has(id);
    if (mode === 'normal') progress[id] = L.schedule(progress[id], { wrong }, stats.tick);
    else if (wrong) progress[id] = L.relapse(progress[id], stats.tick);
    save('progress', progress);
    bumpStats();
    doneCount++;
  }
  renderQuestion();
}

$('saForm').onsubmit = e => {
  e.preventDefault();
  const v = $('saInput').value;
  if (busy) { if (!timer && $('feedback').querySelector('button')) commit(false); return; }
  if (!v.trim()) return;
  onAnswer(L.isCorrect(v, session.queue[0].card.back));
};

$('known').onclick = () => {
  if (busy || !session.queue[0]) return;
  const { card } = session.queue.shift();
  progress[card.id] = L.markKnown(progress[card.id]);
  save('progress', progress);
  doneCount++;
  renderQuestion();
};

$('flag').onclick = () => {
  const id = session.queue[0].card.id;
  progress[id] = { ...progress[id], flagged: !progress[id]?.flagged };
  save('progress', progress);
  $('flag').textContent = progress[id].flagged ? '신고 취소' : '신고';
};

function cardList(cards, label, onclick) {
  return cards.map(c => {
    const li = document.createElement('li');
    li.textContent = `${c.front} → ${c.back} `;
    li.append(btn(label, () => { onclick(c); save('progress', progress); renderManage(); }));
    return li;
  });
}

function renderManage() {
  const flagged = allCards().filter(c => progress[c.id]?.flagged);
  $('flagList').replaceChildren(...cardList(flagged, '해제', c => { progress[c.id].flagged = false; }));
  if (!flagged.length) $('flagList').textContent = '없음';
  const done = allCards().filter(c => L.entry(progress[c.id]).done);
  $('doneSummary').textContent = `완료 카드 (${done.length})`;
  $('doneList').replaceChildren(...cardList(done, '완료 취소', c => { progress[c.id] = L.reopen(progress[c.id], stats.tick); }));
  show('manage');
}

$('importBtn').onclick = () => {
  const { cards, skipped } = L.parseQuizlet($('importText').value, $('importEra').value);
  const { merged, added, dup } = L.mergeCards(custom, cards);
  custom = merged;
  save('customCards', custom);
  $('importMsg').textContent = `${added}장 추가 · 중복 ${dup}장 · 건너뛴 줄 ${skipped}개`;
  if (added) $('importText').value = '';
};

$('clearCustomBtn').onclick = () => {
  custom = [];
  save('customCards', custom);
  $('importMsg').textContent = '가져온 카드를 모두 삭제했습니다';
};

$('exportBtn').onclick = () => {
  const data = { version: 2, progress, customCards: custom, stats };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = `hanneung-backup-${L.today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$('importBackupBtn').onclick = () => $('backupFile').click();
$('backupFile').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data = null;
  try { data = JSON.parse(await file.text()); } catch {}
  if (!L.validateBackup(data)) {
    $('backupMsg').textContent = '올바른 백업 파일이 아닙니다. 기존 기록은 그대로입니다.';
    return;
  }
  progress = data.progress;
  custom = data.customCards ?? custom;
  stats = data.stats ?? stats;
  save('progress', progress); save('customCards', custom); save('stats', stats);
  $('backupMsg').textContent = '불러오기 완료';
};

fillEras($('eraSelect'), true);
fillEras($('importEra'), false);
$('importEra').value = '기타';
$('eraSelect').onchange = renderHome;
$('start').onclick = () => enterMode('normal');
$('weakBtn').onclick = () => enterMode('weak');
$('checkBtn').onclick = () => enterMode('check');
$('quit').onclick = renderHome;
$('toManage').onclick = renderManage;
$('back').onclick = renderHome;

try {
  const res = await fetch('cards.json');
  const data = res.ok ? await res.json() : null;
  if (!Array.isArray(data)) throw 0;
  baseCards = data;
} catch { warn('기본 카드를 불러오지 못했습니다.'); }
renderHome();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
```

- [ ] **Step 3: 회귀 테스트**

Run: `node --test`
Expected: 43 PASS

- [ ] **Step 4: 브라우저 확인** — `python3 -m http.server 8000`(백그라운드), Playwright로 `http://localhost:8000`, 창 390×844. 시작 전 `navigator.serviceWorker.getRegistrations()` 전부 unregister, `caches` 전부 삭제, `localStorage.clear()` 후 새로고침.
1. 홈: 다시 볼 0, 새 카드 584, 완료 0, 오늘 푼 0. 시대별 표 "0 / 0 / N". 버튼 "자주 틀린 카드 (0)", "완료 카드 점검 (0)".
2. 학습 시작 → 진행 표시 "학습 · 0 / 7". 7장 모두 맞혀 묶음 완료 → 홈: 새 카드 577, 오늘 푼 7, `JSON.parse(localStorage.stats).tick === 7`.
3. "이미 알아요" → 카드가 즉시 빠지고 진행 수 +1. 홈 완료 수 +1, "완료 카드 점검 (1)". 정답 클릭 직후(500ms 안) "이미 알아요" 누르면 아무 일 없음.
4. v1 기록 시뮬레이션: `localStorage.setItem('progress', JSON.stringify({c0001:{stage:1,due:'2026-10-09',seen:true,flagged:false}}))`, `localStorage.setItem('settings','{"newLimit":20}')`, `localStorage.removeItem('stats')` 후 새로고침 → 경고 없음, 다시 볼 카드 1, 학습 시작 시 첫 문제가 c0001(9서당 10정…)이고 주관식.
5. 복습 카드를 틀림 → "다음" → 묶음 끝까지 진행 → 홈 "자주 틀린 카드 (1)". 눌러서 그 카드가 출제됨, 맞힌 뒤 "다음 묶음" → 홈으로 돌아가며 "자주 틀린 카드: 이번 라운드를 모두 마쳤어요."
6. 완료 카드 점검 → 완료 카드 출제, "이미 알아요" 버튼 숨김. 틀리면 홈 완료 수 −1.
7. 관리: "하루 새 카드 수" 없음, "완료 카드 (N)" 펼쳐서 "완료 취소" → 목록에서 빠지고 홈 다시 볼 카드 +1.
8. 관리 → 내보내기 파일의 JSON이 `version: 2`와 `stats`를 포함(파일 다운로드 대신 `exportBtn` 클릭 전 `URL.createObjectURL`을 가로채 Blob 내용 확인해도 됨).
9. 콘솔 에러 없음.
서버 종료, 브라우저 닫기, `.playwright-mcp` 삭제.

- [ ] **Step 5: 커밋**

```bash
git add index.html app.js
git commit -m "feat: v2 screens — mastery, known button, weak/check practice modes"
```

---

### Task 3: 카드 검증 강화 + 커버리지 맵

**Files:**
- Modify: `test/cards.test.mjs`
- Create: `docs/content/card-coverage.md`

- [ ] **Step 1: `test/cards.test.mjs` 수정**

1. import 줄을 `import { ERAS, TYPES, isShort, normalize } from '../logic.js';` 로 교체.
2. `'every card is well-formed'` 안의 era 검사 줄은 그대로 둔다(`기타`만 금지 → `통시대` 허용됨). 같은 블록에 tier 검사 추가 — `assert.ok(TYPES.includes(c.type), ...)` 줄 바로 아래:

```js
    const n = Number(c.id.slice(1));
    if (n > 584) assert.ok(c.tier === 1 || c.tier === 2, `new card needs tier 1|2: ${where}`);
    else assert.equal(c.tier, undefined, `original card must not have tier: ${where}`);
```

3. 파일 끝에 추가:

```js
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
```

- [ ] **Step 2: 통과 확인** — Run: `node --test` → Expected: 45 PASS(기존 카드에는 정규화 중복이 없음을 확인함).

- [ ] **Step 3: 커버리지 맵 작성** — `docs/content/card-coverage.md`

한능검 심화(1·2·3급) 출제 범위를 시대별 **주제 체크리스트**로 쓴다. 시대: 선사, 고조선·초기국가, 삼국, 통일신라·발해, 고려, 조선 전기, 조선 후기, 개항기, 일제강점기, 현대, 통시대(지역사·세시풍속·유네스코 세계유산·기록유산 등). 각 시대 안에서 소분류(왕별 업적 / 정치·제도 / 경제·사회 / 대외 관계·전쟁 / 사상·종교 / 문화재·기록물 / 인물 / 단체·운동 등)를 두고, 항목은 한 줄에 하나:

```markdown
- [x] 신문왕: 9서당 10정, 국학, 관료전 — c0001
- [ ] 신문왕: 녹읍 폐지 — tier 1
- [ ] 김흠돌의 난 — tier 2
```

규칙:
- 기존 584장을 모두 대조해, 이미 다루는 항목은 `[x]` + 카드 id. 빠진 항목은 `[ ]` + tier(1 = 기출 빈출, 2 = 심화·드문 출제).
- 항목 하나 = 카드 하나가 되도록 쪼갠다(정답이 10자 이내 단어로 떨어지는 단위).
- 각 시대 제목 옆에 `(기존 N · 추가 예정 M)`.
- 문서 맨 위에 총계 표: 시대 | 기존 | 추가 예정 tier1 | tier2.
- 추가 예정 총합은 900장 안팎을 목표로 하되, 출제 범위가 기준이다(억지로 채우거나 자르지 않는다).
- 사실이 불확실한 항목은 넣지 않는다.

- [ ] **Step 4: 커밋**

```bash
git add test/cards.test.mjs docs/content/card-coverage.md
git commit -m "test: stricter card checks; docs: exam coverage map"
```

---

### Tasks 4–8: 시대 묶음별 카드 작성

각 Task는 같은 절차, 다른 시대 묶음:

| Task | 시대 |
|---|---|
| 4 | 선사, 고조선·초기국가, 삼국 |
| 5 | 통일신라·발해, 고려 |
| 6 | 조선 전기, 조선 후기 |
| 7 | 개항기, 일제강점기 |
| 8 | 현대, 통시대 |

**Files:**
- Modify: `cards.json` (파일 끝에 추가)
- Modify: `docs/content/card-coverage.md` (작성한 항목 `[ ]` → `[x]` + 새 id)

**카드 작성 규칙 (모든 Task 공통):**
- 커버리지 맵에서 해당 시대의 `[ ]` 항목만 카드로 만든다. 항목의 tier를 카드 `tier`로.
- 형식: `{ "id": "c####", "front": "...", "back": "...", "era": "...", "type": "...", "tier": 1 }`. id는 현재 파일의 최대 id 다음 번호부터 연속.
- `front`: 기출식 단서 키워드 2~3개. 단서만으로 정답이 하나로 정해져야 한다 — 같은 시대·유형의 다른 카드 정답(객관식 보기로 나옴)도 맞을 수 있으면 단서를 추가. 정답이나 그 일부를 문제에 넣지 않는다.
- `back`: 공백 포함 10자 이내 표준 명칭. 기존 카드에 같은 대상이 있으면 **기존 표기를 그대로** 쓴다(예: 기존이 `광개토대왕`이면 같게).
- **중복 금지:** 작성 전 `cards.json`에서 같은 `back`을 가진 카드를 모두 읽고, 그 카드들이 이미 묻는 사실을 다시 묻지 않는다. 같은 정답이라도 다른 업적·사실을 묻는 카드는 허용.
- 사실관계는 고교 한국사·한능검 기출 수준의 확립된 내용만. 불확실하면 쓰지 않는다.
- JSON은 기존과 같이 카드 하나당 한 줄.

- [ ] **Step 1:** 해당 시대 `[ ]` 항목 목록 확인, 같은 `back` 기존 카드 대조.
- [ ] **Step 2:** 시대 하나씩 카드 추가 → `node --test` 전부 PASS 확인 → 커버리지 맵 체크 → 커밋 `content: <시대> cards (+N)`.
- [ ] **Step 3:** 자체 점검: 추가한 카드를 전부 다시 읽고 사실·단일 정답·중복을 확인, 고친 내용을 보고서에 기록.
- [ ] **Step 4:** 최종 `node --test` PASS 확인.

---

### Task 9: 출제 순서 정렬 + 캐시 버전

**Files:**
- Modify: `cards.json`, `test/cards.test.mjs`, `sw.js`

- [ ] **Step 1: 실패하는 순서 테스트 추가** — `test/cards.test.mjs` 끝에:

```js
test('new cards ordered: tier 1 before tier 2, eras chronological within a tier', () => {
  const added = cards.slice(584);
  const key = c => [c.tier, ERAS.indexOf(c.era)];
  for (let i = 1; i < added.length; i++) {
    const [ta, ea] = key(added[i - 1]), [tb, eb] = key(added[i]);
    assert.ok(ta < tb || (ta === tb && ea <= eb), `order: ${added[i - 1].id} before ${added[i].id}`);
  }
});
```

Run: `node --test test/cards.test.mjs` → Expected: FAIL(시대 묶음 순서대로 추가되어 tier가 섞여 있음).

- [ ] **Step 2: 정렬** — 일회성 node 명령으로 `cards.json`의 584번째 이후를 `(tier, ERAS 순서, 기존 순서)`로 안정 정렬해서 저장(카드 하나당 한 줄 형식 유지, 앞 584장 불변, id는 바꾸지 않음):

```bash
node -e '
const fs=require("fs");
const { ERAS } = { ERAS: ["선사","고조선·초기국가","삼국","통일신라·발해","고려","조선 전기","조선 후기","개항기","일제강점기","현대","통시대","기타"] };
const cs=JSON.parse(fs.readFileSync("cards.json","utf8"));
const head=cs.slice(0,584), tail=cs.slice(584).map((c,i)=>[c,i]);
tail.sort((a,b)=>a[0].tier-b[0].tier||ERAS.indexOf(a[0].era)-ERAS.indexOf(b[0].era)||a[1]-b[1]);
const all=[...head,...tail.map(x=>x[0])];
fs.writeFileSync("cards.json","[\n"+all.map(c=>"  "+JSON.stringify(c)).join(",\n")+"\n]\n");
'
```

(정렬 전 `head -3 cards.json`으로 기존 형식이 `[` + 줄마다 `  {...},`인지 확인하고, 다르면 같은 형식으로 맞춘다.)

- [ ] **Step 3:** `sw.js`의 `const CACHE = 'v1';` → `const CACHE = 'v2';`

- [ ] **Step 4:** `node --test` → 전부 PASS. `git diff --stat`으로 `cards.json`의 앞 584줄이 변하지 않았는지 확인(`git diff cards.json | grep '^-  {"id":"c0[0-5]'` 결과에 c0001–c0584가 없어야 함).

- [ ] **Step 5: 커밋**

```bash
git add cards.json test/cards.test.mjs sw.js
git commit -m "content: order new cards by tier; bump cache to v2"
```

---

### Task 10: 배포 (사용자 확인 후)

- [ ] `main`에 fast-forward 병합 → `git push` → `gh api repos/spaceman8888/hanneung-quiz/pages --jq .status`가 `built` → `curl -s https://spaceman8888.github.io/hanneung-quiz/sw.js | head -1`에 `v2` 확인.
- [ ] 사용자 안내: 폰에서 앱을 완전히 닫았다가 두 번 열면 v2 반영.
