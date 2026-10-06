# 한능검 암기 PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 안드로이드 폰 홈 화면에 설치해 오프라인으로 쓰는 한능검 심화 암기 앱(Quizlet "학습하기" + 간격 반복).

**Architecture:** 빌드 없는 정적 PWA. 순수 로직은 `logic.js`(ES module, DOM 없음)에 모아 Node 내장 테스트로 검증하고, `app.js`가 DOM/localStorage를 다룬다. 서비스 워커가 전체 파일을 캐시해 오프라인 동작. GitHub Pages로 배포.

**Tech Stack:** HTML/CSS/바닐라 JS(ES modules), Node 24 `node:test`(개발용 테스트만), GitHub Pages. 외부 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-06-history-quiz-pwa-design.md`

## Global Constraints

- 의존성 0개. `package.json`은 `{"type":"module"}` 용도로만 존재.
- 복습 간격(일): `[1, 3, 7, 14, 30]`.
- 묶음 크기 7장. 하루 새 카드 기본 20장(설정 가능, 1~200).
- 주관식 정답은 단어 수준: 공백 포함 10자 이내. 10자 초과 정답 카드는 객관식만.
- 시대(`era`): 선사, 고조선·초기국가, 삼국, 통일신라·발해, 고려, 조선 전기, 조선 후기, 개항기, 일제강점기, 현대, 기타(가져온 카드 기본값).
- 유형(`type`): 인물, 사건, 제도, 문화재, 단체, 기타.
- 날짜는 기기 로컬 날짜 `YYYY-MM-DD` 문자열.
- 카드 텍스트는 항상 `textContent`로 렌더링(가져온 카드에 HTML이 섞여도 실행되지 않게).
- UI 문구는 한국어.
- 스펙과의 차이: 스펙의 `test.html` 대신 `node --test`로 같은 로직을 검증한다(로직을 `logic.js`로 분리했기 때문).

## Review Focus

1. localStorage가 손상되었거나 접근이 차단됨 → 앱이 멈추지 않고 경고와 함께 빈 상태로 시작 (Task 4 `loadJSON` 테스트).
2. 주관식 입력이 띄어쓰기·문장부호·대소문자만 다름("귀주 대첩") → 정답 처리 (Task 1 `isCorrect` 테스트).
3. 묶음의 마지막 남은 카드를 틀림 → 카드가 사라지지 않고 다시 출제, 맞히면 묶음 종료 (Task 3 `submit` 테스트).
4. 카드 풀이 작거나 같은 정답이 여러 장 → 보기에 중복 없음, 정답 포함 (Task 2 `pickChoices` 테스트).
5. 같은 Quizlet 세트를 두 번 붙여넣기 / CRLF 줄바꿈 / 탭 없는 줄 → 중복 추가 없음, 건너뛴 줄 수 보고 (Task 2 `parseQuizlet`·`mergeCards` 테스트).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `package.json` | `"type":"module"` (Node가 `.js`를 ESM으로 읽도록) |
| `logic.js` | 날짜, 채점, 스케줄, 파싱, 보기 생성, 묶음/세션, 저장 헬퍼 — 순수 함수 |
| `app.js` | 화면 렌더링, 이벤트, localStorage 읽기/쓰기 |
| `index.html` | 화면 3개 마크업 + 스타일 |
| `cards.json` | 기본 카드 |
| `sw.js` | 오프라인 캐시 |
| `manifest.json` | 홈 화면 설치 정보 |
| `make-icons.mjs` | 아이콘 PNG 생성 스크립트(1회 실행) |
| `icon-192.png`, `icon-512.png` | 앱 아이콘 |
| `test/logic.test.mjs` | `logic.js` 테스트 |
| `test/cards.test.mjs` | `cards.json` 형식 검증 |

테스트 실행: 프로젝트 루트에서 `node --test`.

---

### Task 1: 날짜·채점·스케줄 로직

**Files:**
- Create: `package.json`, `logic.js`, `test/logic.test.mjs`

**Interfaces:**
- Produces:
  - `INTERVALS: number[]`, `SHORT_MAX = 10`, `BATCH_SIZE = 7`, `ERAS: string[]`, `TYPES: string[]`
  - `today(d?: Date): string`
  - `addDays(dateStr: string, n: number): string`
  - `normalize(s: string): string`
  - `isCorrect(input: string, answer: string): boolean`
  - `isShort(answer: string): boolean`
  - `schedule(prev: Progress|undefined, { wrong: boolean }, todayStr: string): Progress`
  - `Progress = { stage: number, due: string, seen: boolean, flagged: boolean }`

- [ ] **Step 1: package.json 생성**

```json
{ "type": "module" }
```

- [ ] **Step 2: 실패하는 테스트 작성** — `test/logic.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { today, addDays, normalize, isCorrect, isShort, schedule } from '../logic.js';

test('today formats local date', () => {
  assert.equal(today(new Date(2026, 0, 5)), '2026-01-05');
});

test('addDays crosses month and year', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('normalize strips spaces and punctuation', () => {
  assert.equal(normalize(' 귀주 대첩. '), '귀주대첩');
});

test('isCorrect ignores spacing/punctuation/case, rejects empty and partial', () => {
  assert.ok(isCorrect('귀주 대첩', '귀주대첩'));
  assert.ok(isCorrect('ABC', 'abc'));
  assert.ok(!isCorrect('', '신문왕'));
  assert.ok(!isCorrect('  ', '신문왕'));
  assert.ok(!isCorrect('신문', '신문왕'));
});

test('isShort: 10 chars ok, 11 not', () => {
  assert.ok(isShort('1234567890'));
  assert.ok(!isShort('12345678901'));
});

test('schedule: new card -> stage 0, tomorrow', () => {
  assert.deepEqual(schedule(undefined, { wrong: false }, '2026-10-06'),
    { stage: 0, due: '2026-10-07', seen: true, flagged: false });
});

test('schedule: correct review -> next stage', () => {
  const prev = { stage: 0, due: '2026-10-06', seen: true, flagged: false };
  assert.deepEqual(schedule(prev, { wrong: false }, '2026-10-06'),
    { stage: 1, due: '2026-10-09', seen: true, flagged: false });
});

test('schedule: caps at last stage (30 days)', () => {
  const prev = { stage: 4, due: '2026-10-06', seen: true, flagged: false };
  assert.deepEqual(schedule(prev, { wrong: false }, '2026-10-06'),
    { stage: 4, due: '2026-11-05', seen: true, flagged: false });
});

test('schedule: wrong resets to stage 0', () => {
  const prev = { stage: 3, due: '2026-10-06', seen: true, flagged: false };
  assert.deepEqual(schedule(prev, { wrong: true }, '2026-10-06'),
    { stage: 0, due: '2026-10-07', seen: true, flagged: false });
});

test('schedule: keeps flagged, treats flag-only entry as new', () => {
  assert.deepEqual(schedule({ flagged: true }, { wrong: false }, '2026-10-06'),
    { stage: 0, due: '2026-10-07', seen: true, flagged: true });
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --test`
Expected: FAIL — `Cannot find module '.../logic.js'`

- [ ] **Step 4: 구현** — `logic.js`

```js
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
```

- [ ] **Step 5: 통과 확인**

Run: `node --test`
Expected: PASS (10 tests)

- [ ] **Step 6: 커밋**

```bash
git add package.json logic.js test/logic.test.mjs
git commit -m "feat: date, grading and spaced-repetition schedule logic"
```

---

### Task 2: Quizlet 가져오기·보기 생성

**Files:**
- Modify: `logic.js` (아래 함수 추가)
- Modify: `test/logic.test.mjs` (테스트 추가, import 줄 확장)

**Interfaces:**
- Consumes: 없음(Task 1 파일에 추가만)
- Produces:
  - `Card = { id: string, front: string, back: string, era: string, type: string }`
  - `hashId(front: string, back: string): string` — `'q' + 16진수`
  - `parseQuizlet(text: string, era?: string): { cards: Card[], skipped: number }`
  - `mergeCards(existing: Card[], incoming: Card[]): { merged: Card[], added: number, dup: number }`
  - `shuffle<T>(arr: T[], rng?: () => number): T[]`
  - `pickChoices(card: Card, pool: Card[], rng?: () => number): string[]` — 정답 포함 최대 4개, 중복 없음

- [ ] **Step 1: 실패하는 테스트 추가** — `test/logic.test.mjs`

import 줄을 다음으로 교체:

```js
import { today, addDays, normalize, isCorrect, isShort, schedule,
  hashId, parseQuizlet, mergeCards, pickChoices } from '../logic.js';
```

파일 끝에 추가:

```js
test('parseQuizlet: tab-separated, CRLF, skips bad lines', () => {
  const { cards, skipped } = parseQuizlet('9서당 10정\t신문왕\r\n\n탭없는줄\n\t뒤만있음\n 귀주대첩 \t 강감찬 ', '고려');
  assert.equal(cards.length, 2);
  assert.equal(skipped, 2);
  assert.deepEqual(cards[1], { id: hashId('귀주대첩', '강감찬'), front: '귀주대첩', back: '강감찬', era: '고려', type: '기타' });
});

test('parseQuizlet: default era is 기타', () => {
  assert.equal(parseQuizlet('a\tb').cards[0].era, '기타');
});

test('hashId is stable and content-based', () => {
  assert.equal(hashId('a', 'b'), hashId('a', 'b'));
  assert.notEqual(hashId('a', 'b'), hashId('a', 'c'));
  assert.match(hashId('a', 'b'), /^q[0-9a-f]+$/);
});

test('mergeCards: importing same set twice adds nothing', () => {
  const { cards } = parseQuizlet('a\tb\nc\td');
  const first = mergeCards([], cards);
  assert.equal(first.added, 2);
  const second = mergeCards(first.merged, cards);
  assert.deepEqual([second.added, second.dup, second.merged.length], [0, 2, 2]);
});

const mk = (id, back, era = '고려', type = '인물') => ({ id, front: 'f' + id, back, era, type });

test('pickChoices: 4 unique choices including answer', () => {
  const pool = [mk(1, '왕건'), mk(2, '광종'), mk(3, '성종'), mk(4, '현종'), mk(5, '숙종')];
  const ch = pickChoices(pool[0], pool);
  assert.equal(ch.length, 4);
  assert.ok(ch.includes('왕건'));
  assert.equal(new Set(ch).size, 4);
});

test('pickChoices: tiny pool and duplicate answers give no duplicates', () => {
  const pool = [mk(1, '왕건'), mk(2, '왕건'), mk(3, '광종')];
  const ch = pickChoices(pool[0], pool);
  assert.deepEqual([...ch].sort(), ['광종', '왕건']);
});

test('pickChoices: prefers same era and type', () => {
  const pool = [mk(1, '왕건'), mk(2, '광종'), mk(3, '성종'), mk(4, '현종'),
    mk(5, '세종', '조선 전기'), mk(6, '태조', '조선 전기'), mk(7, '별무반', '고려', '단체')];
  for (let i = 0; i < 20; i++) {
    assert.deepEqual([...pickChoices(pool[0], pool)].sort(), ['광종', '성종', '왕건', '현종']);
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test`
Expected: FAIL — `does not provide an export named 'hashId'`

- [ ] **Step 3: 구현** — `logic.js` 끝에 추가

```js
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
  const near = shuffle(others.filter(c => c.era === card.era && c.type === card.type).map(c => c.back), rng);
  const far = shuffle(others.map(c => c.back), rng);
  const wrong = [...new Set([...near, ...far])].slice(0, 3);
  return shuffle([card.back, ...wrong], rng);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test`
Expected: PASS (17 tests)

- [ ] **Step 5: 커밋**

```bash
git add logic.js test/logic.test.mjs
git commit -m "feat: Quizlet import parsing and multiple-choice generation"
```

---

### Task 3: 묶음 구성·학습 세션

**Files:**
- Modify: `logic.js`, `test/logic.test.mjs`

**Interfaces:**
- Consumes: `isShort`, `BATCH_SIZE` (Task 1)
- Produces:
  - `newLeft(limit: number, newToday: { date: string, count: number }, todayStr: string): number`
  - `buildBatch(cards: Card[], progress: Record<string, Progress>, { todayStr: string, newLeft: number, era?: string|null, size?: number }): Card[]` — 복습(마감 빠른 순) 먼저, 남는 자리에 새 카드
  - `Session = { queue: { card: Card, mode: 'mc'|'sa' }[], wrong: Set<string> }`
  - `createSession(batch: Card[], progress): Session` — 처음 보는 카드는 `'mc'`, 복습 카드는 정답이 짧으면 `'sa'` 아니면 `'mc'`
  - `submit(session: Session, correct: boolean): Card|null` — 큐 맨 앞 카드 처리. 이 세션에서 끝난 카드면 반환, 아니면 null
    - 오답: `wrong`에 기록, 같은 모드로 2문제 뒤(큐가 짧으면 맨 뒤)에 재삽입
    - 객관식 정답 + 짧은 정답: 주관식으로 맨 뒤에 재삽입
    - 그 외 정답: 완료

- [ ] **Step 1: 실패하는 테스트 추가**

import 줄을 다음으로 교체:

```js
import { today, addDays, normalize, isCorrect, isShort, schedule,
  hashId, parseQuizlet, mergeCards, pickChoices,
  newLeft, buildBatch, createSession, submit } from '../logic.js';
```

파일 끝에 추가:

```js
test('newLeft: counts today only, never negative', () => {
  assert.equal(newLeft(20, { date: '2026-10-06', count: 5 }, '2026-10-06'), 15);
  assert.equal(newLeft(20, { date: '2026-10-05', count: 20 }, '2026-10-06'), 20);
  assert.equal(newLeft(20, { date: '2026-10-06', count: 25 }, '2026-10-06'), 0);
});

const T = '2026-10-06';
const cardsN = n => Array.from({ length: n }, (_, i) => mk('k' + i, 'ans' + i));

test('buildBatch: due reviews first (earliest due), then new up to limit', () => {
  const cs = cardsN(10);
  const progress = {
    k0: { stage: 1, due: '2026-10-06', seen: true },
    k1: { stage: 1, due: '2026-10-01', seen: true },
    k2: { stage: 1, due: '2026-10-07', seen: true }, // not due yet
  };
  const b = buildBatch(cs, progress, { todayStr: T, newLeft: 2 });
  assert.deepEqual(b.map(c => c.id), ['k1', 'k0', 'k3', 'k4']);
});

test('buildBatch: size cap and era filter', () => {
  const cs = [...cardsN(10), mk('j1', 'x', '조선 전기')];
  assert.equal(buildBatch(cs, {}, { todayStr: T, newLeft: 99 }).length, 7);
  assert.deepEqual(buildBatch(cs, {}, { todayStr: T, newLeft: 99, era: '조선 전기' }).map(c => c.id), ['j1']);
});

test('buildBatch: flag-only progress entry counts as new', () => {
  const b = buildBatch(cardsN(1), { k0: { flagged: true } }, { todayStr: T, newLeft: 5 });
  assert.equal(b.length, 1);
});

test('createSession: modes', () => {
  const long = mk('L', '열한글자가넘는긴정답입니다');
  const s = createSession([mk('a', '왕건'), mk('b', '광종'), long],
    { b: { seen: true, stage: 0, due: T }, L: { seen: true, stage: 0, due: T } });
  assert.deepEqual(s.queue.map(q => q.mode), ['mc', 'sa', 'mc']);
});

test('submit: mc correct -> sa later, sa correct -> done', () => {
  const s = createSession([mk('a', '왕건'), mk('b', '광종')], {});
  assert.equal(submit(s, true), null);           // a mc ok -> a sa at end
  assert.deepEqual(s.queue.map(q => q.card.id + q.mode), ['bmc', 'asa']);
  assert.equal(submit(s, true), null);           // b mc ok
  assert.equal(submit(s, true).id, 'a');         // a sa ok -> done
  assert.equal(submit(s, true).id, 'b');
  assert.equal(s.queue.length, 0);
  assert.equal(s.wrong.size, 0);
});

test('submit: wrong reinserts 2 behind and records wrong', () => {
  const s = createSession(cardsN(4), {});
  submit(s, false);
  assert.deepEqual(s.queue.map(q => q.card.id), ['k1', 'k2', 'k0', 'k3']);
  assert.ok(s.wrong.has('k0'));
});

test('submit: wrong on last remaining card keeps it until answered', () => {
  const s = createSession([mk('a', '왕건')], { a: { seen: true, stage: 2, due: T } });
  assert.equal(submit(s, false), null);
  assert.equal(s.queue.length, 1);
  assert.equal(submit(s, true).id, 'a');
  assert.ok(s.wrong.has('a'));
});

test('submit: long-answer card finishes on mc', () => {
  const s = createSession([mk('L', '열한글자가넘는긴정답입니다')], {});
  assert.equal(submit(s, true).id, 'L');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test`
Expected: FAIL — `does not provide an export named 'newLeft'`

- [ ] **Step 3: 구현** — `logic.js` 끝에 추가

```js
export function newLeft(limit, newToday, todayStr) {
  return Math.max(0, limit - (newToday.date === todayStr ? newToday.count : 0));
}

export function buildBatch(cards, progress, { todayStr, newLeft, era = null, size = BATCH_SIZE }) {
  const inEra = cards.filter(c => !era || c.era === era);
  const due = inEra
    .filter(c => progress[c.id]?.seen && progress[c.id].due <= todayStr)
    .sort((a, b) => progress[a.id].due.localeCompare(progress[b.id].due));
  const reviews = due.slice(0, size);
  const fresh = inEra.filter(c => !progress[c.id]?.seen)
    .slice(0, Math.max(0, Math.min(size - reviews.length, newLeft)));
  return [...reviews, ...fresh];
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
```

- [ ] **Step 4: 통과 확인**

Run: `node --test`
Expected: PASS (26 tests)

- [ ] **Step 5: 커밋**

```bash
git add logic.js test/logic.test.mjs
git commit -m "feat: batch building and Learn-style study session"
```

---

### Task 4: 저장 헬퍼(안전한 읽기·백업 검증)

**Files:**
- Modify: `logic.js`, `test/logic.test.mjs`

**Interfaces:**
- Produces:
  - `loadJSON(storage: {getItem(k): string|null}|null, key: string, fallback: T): { value: T, ok: boolean }` — 키 없음은 `ok: true` + fallback, 손상/예외는 `ok: false` + fallback
  - `validateBackup(data: unknown): boolean` — `progress`가 배열이 아닌 객체, `customCards`는 없거나 배열, `settings`는 없거나 숫자 `newLimit`을 가진 객체

- [ ] **Step 1: 실패하는 테스트 추가**

import 줄을 다음으로 교체:

```js
import { today, addDays, normalize, isCorrect, isShort, schedule,
  hashId, parseQuizlet, mergeCards, pickChoices,
  newLeft, buildBatch, createSession, submit,
  loadJSON, validateBackup } from '../logic.js';
```

파일 끝에 추가:

```js
const fakeStorage = data => ({ getItem: k => (k in data ? data[k] : null) });

test('loadJSON: missing key -> fallback, ok', () => {
  assert.deepEqual(loadJSON(fakeStorage({}), 'p', {}), { value: {}, ok: true });
});

test('loadJSON: valid JSON', () => {
  assert.deepEqual(loadJSON(fakeStorage({ p: '{"a":1}' }), 'p', {}), { value: { a: 1 }, ok: true });
});

test('loadJSON: corrupted JSON -> fallback, not ok', () => {
  assert.deepEqual(loadJSON(fakeStorage({ p: '{oops' }), 'p', []), { value: [], ok: false });
});

test('loadJSON: storage throws or is null -> fallback, not ok', () => {
  const throwing = { getItem() { throw new Error('SecurityError'); } };
  assert.deepEqual(loadJSON(throwing, 'p', 1), { value: 1, ok: false });
  assert.deepEqual(loadJSON(null, 'p', 1), { value: 1, ok: false });
});

test('validateBackup', () => {
  assert.ok(validateBackup({ progress: {} }));
  assert.ok(validateBackup({ progress: {}, customCards: [], settings: { newLimit: 20 } }));
  assert.ok(!validateBackup(null));
  assert.ok(!validateBackup('x'));
  assert.ok(!validateBackup({}));
  assert.ok(!validateBackup({ progress: [] }));
  assert.ok(!validateBackup({ progress: {}, customCards: {} }));
  assert.ok(!validateBackup({ progress: {}, settings: { newLimit: '20' } }));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test`
Expected: FAIL — `does not provide an export named 'loadJSON'`

- [ ] **Step 3: 구현** — `logic.js` 끝에 추가

```js
export function loadJSON(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw == null ? { value: fallback, ok: true } : { value: JSON.parse(raw), ok: true };
  } catch {
    return { value: fallback, ok: false };
  }
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateBackup(data) {
  return isObj(data) && isObj(data.progress)
    && (data.customCards === undefined || Array.isArray(data.customCards))
    && (data.settings === undefined || (isObj(data.settings) && typeof data.settings.newLimit === 'number'));
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test`
Expected: PASS (31 tests)

- [ ] **Step 5: 커밋**

```bash
git add logic.js test/logic.test.mjs
git commit -m "feat: safe storage load and backup validation"
```

---

### Task 5: 화면(UI)

**Files:**
- Create: `index.html`, `app.js`, `cards.json`(임시 샘플 6장, Task 7에서 교체)

**Interfaces:**
- Consumes: `logic.js` 전체 export (Task 1~4)
- localStorage 키: `progress`, `customCards`, `settings`(`{ newLimit }`), `newToday`(`{ date, count }`)

- [ ] **Step 1: 샘플 `cards.json`**

```json
[
  { "id": "c0001", "front": "9서당 10정 정비, 국학 설립, 관료전 지급", "back": "신문왕", "era": "통일신라·발해", "type": "인물" },
  { "id": "c0002", "front": "노비안검법 실시, 과거제 도입", "back": "광종", "era": "고려", "type": "인물" },
  { "id": "c0003", "front": "최승로의 시무 28조 수용, 12목에 지방관 파견", "back": "성종", "era": "고려", "type": "인물" },
  { "id": "c0004", "front": "강감찬이 거란 소배압의 군대를 크게 격파한 전투", "back": "귀주대첩", "era": "고려", "type": "사건" },
  { "id": "c0005", "front": "윤관의 건의로 조직된 신기군·신보군·항마군의 특수 부대", "back": "별무반", "era": "고려", "type": "단체" },
  { "id": "c0006", "front": "군포를 1년에 1필로 줄이고 결작·선무군관포로 보충한 제도", "back": "균역법", "era": "조선 후기", "type": "제도" }
]
```

- [ ] **Step 2: `index.html`**

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#8b2e2e">
<link rel="manifest" href="manifest.json">
<link rel="icon" href="icon-192.png">
<title>한능검 암기</title>
<style>
  :root { --bg:#faf7f2; --fg:#222; --muted:#777; --accent:#8b2e2e; --ok:#2e7d32; --bad:#c62828; --card:#fff; --line:#e5e0d8; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1b1a18; --fg:#eee; --muted:#999; --card:#26241f; --line:#3a372f; --ok:#66bb6a; --bad:#ef5350; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:17px/1.5 system-ui, sans-serif; }
  main { max-width:480px; margin:0 auto; padding:16px; }
  header { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  h1 { font-size:20px; margin:8px 0; } h2 { font-size:17px; margin:24px 0 8px; }
  button, select, input, textarea { font:inherit; color:var(--fg); }
  button { padding:12px 16px; border:1px solid var(--line); border-radius:10px; background:var(--card); }
  .primary { background:var(--accent); color:#fff; border-color:var(--accent); width:100%; }
  .choices button { display:block; width:100%; margin:8px 0; text-align:left; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px; margin:12px 0; }
  .front { font-size:21px; font-weight:600; min-height:3em; word-break:keep-all; }
  .tag, .muted { color:var(--muted); font-size:14px; }
  .ok { color:var(--ok); border-color:var(--ok); } .bad { color:var(--bad); border-color:var(--bad); }
  #feedback p { font-size:19px; font-weight:600; }
  #feedback button { margin:4px 8px 4px 0; }
  .stats { display:flex; gap:12px; } .stats div { flex:1; text-align:center; } .stats b { display:block; font-size:28px; }
  table { width:100%; border-collapse:collapse; font-size:15px; } td { padding:6px 0; border-bottom:1px solid var(--line); } td + td { text-align:right; }
  input, textarea, select { width:100%; padding:10px; border:1px solid var(--line); border-radius:10px; background:var(--card); }
  textarea { height:140px; }
  .row { display:flex; gap:8px; margin:8px 0; } .row > * { flex:1; }
  ul { padding-left:20px; } li { margin:6px 0; }
  [hidden] { display:none !important; }
  #warn { color:var(--bad); margin:0; }
</style>
</head>
<body>
<main>
  <p id="warn"></p>

  <section id="home">
    <header><h1>한능검 암기</h1><button id="toManage">관리</button></header>
    <div class="card stats"><div><b id="dueCount">0</b>복습</div><div><b id="newCount">0</b>새 카드</div></div>
    <select id="eraSelect" aria-label="시대 선택"></select>
    <p><button class="primary" id="start">학습 시작</button></p>
    <p id="homeMsg" class="muted"></p>
    <table id="eraTable"></table>
  </section>

  <section id="study" hidden>
    <header><button id="quit">← 홈</button><span id="progressText" class="muted"></span></header>
    <div class="card">
      <div class="tag" id="qTag"></div>
      <div class="front" id="qFront"></div>
    </div>
    <div class="choices" id="choices"></div>
    <form id="saForm" hidden>
      <input id="saInput" autocomplete="off" placeholder="정답 입력" aria-label="정답 입력">
      <p><button class="primary">확인</button></p>
    </form>
    <div id="feedback"></div>
    <p><button id="flag">신고</button></p>
  </section>

  <section id="manage" hidden>
    <header><button id="back">← 홈</button><h1>관리</h1></header>
    <h2>Quizlet 가져오기</h2>
    <p class="muted">Quizlet 세트 → ⋯ → 내보내기 → "용어와 정의 사이: 탭", "카드 사이: 새 줄"로 복사한 뒤 붙여넣기</p>
    <textarea id="importText" aria-label="Quizlet 내보내기 텍스트"></textarea>
    <div class="row"><select id="importEra" aria-label="가져올 카드의 시대"></select><button id="importBtn">가져오기</button></div>
    <p id="importMsg" class="muted"></p>
    <h2>설정</h2>
    <label>하루 새 카드 수 <input type="number" min="1" max="200" id="newLimit"></label>
    <h2>기록 백업</h2>
    <div class="row"><button id="exportBtn">내보내기</button><button id="importBackupBtn">불러오기</button></div>
    <input type="file" id="backupFile" accept="application/json,.json" hidden>
    <p id="backupMsg" class="muted"></p>
    <h2>신고한 카드</h2>
    <ul id="flagList"></ul>
  </section>
</main>
<script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: `app.js`**

```js
import * as L from './logic.js';

const $ = id => document.getElementById(id);
const warn = msg => { $('warn').textContent = msg; };
const storage = (() => { try { return localStorage; } catch { return null; } })();

function load(key, fallback) {
  const r = L.loadJSON(storage, key, fallback);
  if (!r.ok) warn('저장된 기록 일부를 읽지 못해 초기 상태로 시작합니다.');
  return r.value;
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
let settings = load('settings', { newLimit: 20 });
let newToday = load('newToday', { date: '', count: 0 });
let session = null, doneCount = 0, batchSize = 0, busy = false;

const allCards = () => [...baseCards, ...custom];
const show = id => ['home', 'study', 'manage'].forEach(s => { $(s).hidden = s !== id; });

function fillEras(sel, withAll) {
  sel.replaceChildren(...(withAll ? [new Option('전체 시대', '')] : []), ...L.ERAS.map(e => new Option(e, e)));
}

function renderHome() {
  const t = L.today(), era = $('eraSelect').value;
  const cards = allCards().filter(c => !era || c.era === era);
  $('dueCount').textContent = cards.filter(c => progress[c.id]?.seen && progress[c.id].due <= t).length;
  $('newCount').textContent = Math.min(cards.filter(c => !progress[c.id]?.seen).length,
    L.newLeft(settings.newLimit, newToday, t));
  $('eraTable').replaceChildren(...L.ERAS.map(e => {
    const inEra = allCards().filter(c => c.era === e);
    if (!inEra.length) return null;
    const tr = document.createElement('tr');
    const name = document.createElement('td'), count = document.createElement('td');
    name.textContent = e;
    count.textContent = `${inEra.filter(c => progress[c.id]?.seen).length} / ${inEra.length}`;
    tr.append(name, count);
    return tr;
  }).filter(Boolean));
  show('home');
}

function startBatch() {
  const t = L.today();
  const batch = L.buildBatch(allCards(), progress,
    { todayStr: t, newLeft: L.newLeft(settings.newLimit, newToday, t), era: $('eraSelect').value || null });
  if (!batch.length) {
    $('homeMsg').textContent = '오늘 학습할 카드를 모두 끝냈어요!';
    return renderHome();
  }
  $('homeMsg').textContent = '';
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
  $('progressText').textContent = `${doneCount} / ${batchSize}`;
  const item = session.queue[0];
  if (!item) return renderBatchDone();
  const { card, mode } = item;
  $('qTag').textContent = `${card.era} · ${card.type} · ${mode === 'mc' ? '객관식' : '주관식'}`;
  $('qFront').textContent = card.front;
  $('flag').hidden = false;
  $('flag').textContent = progress[card.id]?.flagged ? '신고 취소' : '신고';
  if (mode === 'mc') {
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
  $('choices').replaceChildren(btn('다음 묶음', startBatch, 'primary'), btn('홈으로', renderHome));
}

function onAnswer(correct, button) {
  if (busy) return;
  busy = true;
  const { card, mode } = session.queue[0];
  button?.classList.add(correct ? 'ok' : 'bad');
  const p = document.createElement('p');
  p.className = correct ? 'ok' : 'bad';
  p.textContent = correct ? '정답!' : `정답: ${card.back}`;
  $('feedback').replaceChildren(p);
  if (correct) { setTimeout(() => commit(true), 500); return; }
  if (mode === 'sa') $('feedback').append(btn('맞은 걸로 처리', () => commit(true)));
  $('feedback').append(btn('다음', () => commit(false), 'primary'));
}

function commit(correct) {
  if (!busy) return;
  const id = session.queue[0].card.id;
  const wasSeen = progress[id]?.seen;
  const done = L.submit(session, correct);
  if (done) {
    const t = L.today();
    progress[id] = L.schedule(progress[id], { wrong: session.wrong.has(id) }, t);
    save('progress', progress);
    if (!wasSeen) {
      newToday = { date: t, count: (newToday.date === t ? newToday.count : 0) + 1 };
      save('newToday', newToday);
    }
    doneCount++;
  }
  renderQuestion();
}

$('saForm').onsubmit = e => {
  e.preventDefault();
  const v = $('saInput').value;
  if (!v.trim() || busy) return;
  onAnswer(L.isCorrect(v, session.queue[0].card.back));
};

$('flag').onclick = () => {
  const id = session.queue[0].card.id;
  progress[id] = { ...progress[id], flagged: !progress[id]?.flagged };
  save('progress', progress);
  $('flag').textContent = progress[id].flagged ? '신고 취소' : '신고';
};

function renderManage() {
  $('newLimit').value = settings.newLimit;
  const flagged = allCards().filter(c => progress[c.id]?.flagged);
  $('flagList').replaceChildren(...flagged.map(c => {
    const li = document.createElement('li');
    li.textContent = `${c.front} → ${c.back} `;
    li.append(btn('해제', () => { progress[c.id].flagged = false; save('progress', progress); renderManage(); }));
    return li;
  }));
  if (!flagged.length) $('flagList').textContent = '없음';
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

$('newLimit').onchange = () => {
  const n = parseInt($('newLimit').value, 10);
  if (n >= 1 && n <= 200) { settings = { ...settings, newLimit: n }; save('settings', settings); }
  else $('newLimit').value = settings.newLimit;
};

$('exportBtn').onclick = () => {
  const data = { version: 1, progress, customCards: custom, settings, newToday };
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
  settings = data.settings ?? settings;
  newToday = data.newToday ?? newToday;
  save('progress', progress); save('customCards', custom); save('settings', settings); save('newToday', newToday);
  $('backupMsg').textContent = '불러오기 완료';
};

fillEras($('eraSelect'), true);
fillEras($('importEra'), false);
$('importEra').value = '기타';
$('eraSelect').onchange = renderHome;
$('start').onclick = startBatch;
$('quit').onclick = renderHome;
$('toManage').onclick = renderManage;
$('back').onclick = renderHome;

try { baseCards = await (await fetch('cards.json')).json(); }
catch { warn('기본 카드를 불러오지 못했습니다.'); }
renderHome();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
```

- [ ] **Step 4: 로직 테스트 회귀 확인**

Run: `node --test`
Expected: PASS (31 tests)

- [ ] **Step 5: 브라우저에서 직접 확인**

Run (백그라운드): `python3 -m http.server 8000`
Playwright로 `http://localhost:8000` 열고 창을 390×844로 맞춘 뒤 확인:
1. 홈: 복습 0, 새 카드 6, 시대별 표에 통일신라·발해 0/1, 고려 0/4, 조선 후기 0/1.
2. "학습 시작" → 객관식 4지선다 표시, 정답 클릭 → "정답!" 후 다음 문제.
3. 오답 클릭 → "정답: …" + "다음" 버튼, 2문제 뒤 같은 카드 재출제.
4. 객관식을 맞힌 카드가 주관식으로 다시 나옴, 띄어쓰기 넣은 정답("귀주 대첩") 정답 처리.
5. 주관식 오답 → "맞은 걸로 처리" 버튼 동작.
6. 6장 모두 끝나면 "묶음 완료! (6장)" → "홈으로" → 새 카드 0, 시대별 표 6장 모두 학습됨.
7. 관리: `가\t나` 붙여넣고 가져오기 → "1장 추가 · 중복 0장 · 건너뛴 줄 0개", 한 번 더 → "0장 추가 · 중복 1장".
8. 신고 버튼 → 관리의 신고 목록에 표시, 해제 동작.
9. DevTools 콘솔 에러 없음(이 단계에서는 manifest/sw 404 무시 — Task 6에서 추가).

- [ ] **Step 6: 커밋**

```bash
git add index.html app.js cards.json
git commit -m "feat: home, study and manage screens"
```

---

### Task 6: PWA(오프라인·홈 화면 설치)

**Files:**
- Create: `sw.js`, `manifest.json`, `make-icons.mjs`, `icon-192.png`, `icon-512.png`

- [ ] **Step 1: `make-icons.mjs`** (단색 PNG 생성, 의존성 없음)

```js
// Run once: node make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}

function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.alloc(1 + size * 3);
  for (let i = 0; i < size; i++) rgb.forEach((v, j) => { row[1 + i * 3 + j] = v; });
  const raw = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [192, 512]) writeFileSync(`icon-${s}.png`, png(s, [0x8b, 0x2e, 0x2e]));
```

- [ ] **Step 2: 아이콘 생성 및 확인**

Run: `node make-icons.mjs && file icon-192.png icon-512.png`
Expected: `PNG image data, 192 x 192, 8-bit/color RGB` / `512 x 512`

- [ ] **Step 3: `manifest.json`**

```json
{
  "name": "한능검 암기",
  "short_name": "한능검",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#faf7f2",
  "theme_color": "#8b2e2e",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 4: `sw.js`** (배포 후 파일을 바꾸면 `CACHE` 값을 올린다)

```js
const CACHE = 'v1';
const FILES = ['./', 'index.html', 'app.js', 'logic.js', 'cards.json', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
```

- [ ] **Step 5: 브라우저에서 확인**

`python3 -m http.server 8000` 상태에서 Playwright로 `http://localhost:8000` 새로고침 후:
1. 콘솔 에러 없음.
2. `await navigator.serviceWorker.ready` 가 resolve되고 `(await caches.open('v1')).keys()` 길이 8.
3. 서버를 종료한 뒤 새로고침 → 앱이 그대로 뜨고 학습 시작 가능(오프라인 동작). 확인 후 서버 재시작.

- [ ] **Step 6: 커밋**

```bash
git add sw.js manifest.json make-icons.mjs icon-192.png icon-512.png
git commit -m "feat: offline service worker, manifest and icons"
```

---

### Task 7: 기본 카드 약 500장

**Files:**
- Create: `test/cards.test.mjs`
- Modify: `cards.json` (샘플 6장을 유지하며 확장)

**카드 작성 규칙:**
- `front`: 한능검 심화 기출에서 정답을 특정하는 단서 키워드 1~3개를 쉼표로 묶은 짧은 문구. 단서만 보고 정답이 하나로 정해져야 한다(애매하면 단서를 추가).
- `back`: 공백 포함 10자 이내 단어/고유명사(인물명, 사건명, 제도명, 문화재명, 단체명). 설명문 금지.
- `id`: `c0001`부터 연속 4자리. `era`·`type`은 Global Constraints 목록 중 하나(`era`에 "기타" 금지).
- 같은 `front` 중복 금지. 같은 `back`은 단서가 다르면 허용(예: 세종 업적 여러 장).
- 사실관계는 고교 한국사 교과 수준의 확립된 내용만. 불확실한 연도·수치는 넣지 않는다.

**시대별 분량:**

| 시대 | 장수 | 중점 |
|---|---|---|
| 선사 | 20 | 시대별 도구·유적(주먹도끼, 빗살무늬 토기, 고인돌, 반달 돌칼 등) |
| 고조선·초기국가 | 30 | 8조법, 위만, 부여·고구려·옥저·동예·삼한 풍습 |
| 삼국 | 70 | 왕별 업적, 전투, 불교 수용, 고분·탑·불상 |
| 통일신라·발해 | 50 | 왕별 업적, 6두품·승려, 발해 왕·제도 |
| 고려 | 80 | 왕별 업적, 무신정권, 대외 항쟁, 제도, 문화재·기록물 |
| 조선 전기 | 70 | 왕별 업적, 사화, 왜란·호란, 제도, 서적 |
| 조선 후기 | 70 | 붕당, 탕평, 수취제도, 실학자, 서민문화, 세도정치·농민봉기 |
| 개항기 | 50 | 조약, 개화 정책, 갑신·갑오·을미, 독립협회, 애국계몽, 의병 |
| 일제강점기 | 40 | 통치 시기 구분, 독립운동 단체·인물, 무장투쟁, 민족문화 수호 |
| 현대 | 20 | 광복~정부 수립, 6·25, 4·19 등 민주화, 정부별 정책 |

- [ ] **Step 1: 실패하는 검증 테스트** — `test/cards.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ERAS, TYPES, isShort } from '../logic.js';

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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test/cards.test.mjs`
Expected: FAIL — `선사: 0 < 18`

- [ ] **Step 3: 시대별로 카드 추가** — 한 시대씩 `cards.json`에 추가하고, 매번 `node --test test/cards.test.mjs` 의 형식 테스트 2개(well-formed, fronts unique)가 통과하는지 확인. 순서: 선사 → 고조선·초기국가 → 삼국 → 통일신라·발해 → 고려 → 조선 전기 → 조선 후기 → 개항기 → 일제강점기 → 현대. 각 시대 뒤 커밋:

```bash
git add cards.json
git commit -m "content: <시대> cards"
```

- [ ] **Step 4: 사실관계 자체 점검** — 시대별로 20장씩 무작위 표본을 다시 읽고, 단서가 정답을 하나로 특정하는지·사실이 맞는지 확인. 틀린 카드는 수정하거나 삭제(삭제 시 id 재번호 매기지 않음 — 빈 번호 허용).

- [ ] **Step 5: 전체 통과 확인**

Run: `node --test`
Expected: PASS (logic 31 + cards 3)

- [ ] **Step 6: 커밋**

```bash
git add test/cards.test.mjs cards.json
git commit -m "test: validate base card set"
```

---

### Task 8: GitHub Pages 배포

**외부 공개 작업 — 실행 전 사용자에게 저장소 이름과 공개 여부를 확인받는다.** (GitHub Pages 무료 플랜은 공개 저장소 필요. 로그인 계정: `spaceman8888`)

- [ ] **Step 1: 캐시 버전 확인** — 최초 배포는 `sw.js`의 `CACHE = 'v1'` 그대로.

- [ ] **Step 2: 저장소 생성·푸시** (사용자 확인 후)

```bash
gh repo create hanneung-quiz --public --source . --push
```

- [ ] **Step 3: Pages 활성화**

```bash
gh api repos/spaceman8888/hanneung-quiz/pages -X POST -f "source[branch]=main" -f "source[path]=/"
```

- [ ] **Step 4: 배포 확인**

Run: `gh api repos/spaceman8888/hanneung-quiz/pages --jq .status` 가 `built`가 될 때까지 확인 후
`curl -sI https://spaceman8888.github.io/hanneung-quiz/ | head -1` → `HTTP/2 200`
`curl -s https://spaceman8888.github.io/hanneung-quiz/cards.json | head -c 100` → 카드 JSON

- [ ] **Step 5: 폰 설치 안내를 사용자에게 전달**

1. 안드로이드 크롬에서 `https://spaceman8888.github.io/hanneung-quiz/` 접속
2. 메뉴(⋮) → "홈 화면에 추가" 또는 "앱 설치"
3. 홈 화면 아이콘으로 실행 → 이후 오프라인에서도 동작
4. 업데이트 반영: 앱을 완전히 닫았다 두 번 열기
