# 시기 맞히기 + 추측 불가능한 객관식 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "어느 왕/시기 때?" 카드(type `시기`)를 추가하고, 객관식 보기를 같은 종류끼리 내며, 정답을 흘리는 문제 문장을 고친다.

**Architecture:** 기존 정적 PWA. `logic.js`의 `pickChoices`를 종류(정답 끝 글자) 우선으로 바꾸고 `시기` 카드는 시기끼리만 보기를 만든다. `buildBatch`에 `type` 필터를 추가해 홈의 "시기 맞히기" 버튼이 쓴다. 측정 도구 `tools/audit.mjs`로 추측 가능한 문제 수를 잰다. 카드는 시대 묶음별로 작성·사실검토.

**Tech Stack:** 바닐라 JS ES modules, Node 24 `node:test`, GitHub Pages. 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-07-period-quiz-design.md`

## Global Constraints

- 의존성 0개. 테스트: `node --test`(현재 43 통과).
- 앱은 객관식만 출제. 카드 텍스트는 `textContent`로만 렌더링.
- `시기` 정답: 선사 = `구석기 시대`/`신석기 시대`/`청동기 시대`/`철기 시대`; 고조선·초기국가 = `고조선`/`부여`/`고구려`/`옥저`/`동예`/`삼한`; 삼국~조선 후기 = 왕(기존 카드 표기); 일제강점기 = `무단 통치기`/`문화 통치기`/`민족 말살 통치기`; 현대 = `○○○ 정부` 또는 `장면 내각`. 개항기·통시대 없음.
- `시기` 문제 끝: 선사 `— 어느 시대?`, 고조선·초기국가 `— 어느 나라?`, 일제강점기 `— 어느 통치 시기?`, 현대 `— 어느 정부 때?`, 나머지 `— 어느 왕 때?`.
- 정답(`back`) 10자 이내. 문제에 정답이 들어가면 안 됨. 새 카드 `tier` 필수(원래 카드 출신이면 그 tier, 원래 584장 출신은 1).
- 카드 id 불변. 새 id는 현재 최대 id 다음부터 연속. 파일 끝(585번째 이후) 정렬 규칙: tier → ERAS 순서(테스트 있음).
- 기존 카드의 문제 문장(front)은 고칠 수 있음(정답·id·era·type·tier 불변).
- 커밋 메시지 끝: 빈 줄 + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Review Focus

1. 시기 카드 보기가 3개뿐인 시대(일제강점기) → 보기 3개로 정상 표시, 엉뚱한 보기 없음 (Task 1 테스트).
2. 같은 종류 후보가 부족한 카드(유일한 종류의 정답) → 기존 우선순위로 보기 4개 유지 (Task 1 기존 테스트 유지).
3. 시기 카드 문제가 정답을 흘림(예: "광개토대왕릉비 — 어느 왕 때?"에 정답 포함) → cards 테스트가 막음 (Task 1 cards 규칙 테스트).
4. "시기 맞히기" 모드에서 모든 시기 카드 완료 → 무한 반복 없이 안내 (Task 2 브라우저 확인).
5. 문제 문장 수정이 사실을 바꾸거나 다른 카드와 중복 → 시대별 검토 (Task 3 리뷰).

---

### Task 1: 같은 종류 보기 + 시기 유형 로직 + 측정 도구

**Files:**
- Modify: `logic.js`, `test/logic.test.mjs`, `test/cards.test.mjs`
- Create: `tools/audit.mjs`

**Interfaces:**
- Produces: `TYPES`에 `'시기'`(`'기타'` 앞), `pickChoices(card, pool, rng?)` 새 우선순위, `buildBatch(cards, progress, { tick, era?, type?, size? })`.

- [ ] **Step 1: 실패하는 테스트 추가** — `test/logic.test.mjs` 끝에:

```js
test('pickChoices: same kind first (sites with sites)', () => {
  const s = (id, back) => ({ id, front: 'f' + id, back, era: '선사', type: '문화재' });
  const pool = [s(1, '송국리 유적'), s(2, '붉은 간토기'), s(3, '세형 동검'), s(4, '거친무늬 거울'),
    s(5, '암사동 유적'), s(6, '흔암리 유적'), s(7, '전곡리 유적')];
  for (let i = 0; i < 20; i++) {
    assert.deepEqual([...pickChoices(pool[0], pool)].sort(), ['송국리 유적', '암사동 유적', '전곡리 유적', '흔암리 유적']);
  }
});

test('pickChoices: kings with kings (same last character)', () => {
  const k = (id, back) => ({ id, front: 'f' + id, back, era: '통일신라·발해', type: '인물' });
  const pool = [k(1, '신문왕'), k(2, '김대성'), k(3, '성덕왕'), k(4, '최치원'), k(5, '경덕왕'), k(6, '장보고'), k(7, '원성왕')];
  for (let i = 0; i < 20; i++) {
    assert.deepEqual([...pickChoices(pool[0], pool)].sort(), ['경덕왕', '성덕왕', '신문왕', '원성왕']);
  }
});

test('pickChoices: 시기 cards use only same-era 시기 answers (fewer if needed); others never get 시기 answers', () => {
  const p = (id, back, era = '일제강점기') => ({ id, front: 'f' + id, back, era, type: '시기' });
  const other = { id: 9, front: 'x', back: '신간회', era: '일제강점기', type: '단체' };
  const pool = [p(1, '무단 통치기'), p(2, '문화 통치기'), p(3, '민족 말살 통치기'), p(4, '문화 통치기'), other, p(5, '박정희 정부', '현대')];
  for (let i = 0; i < 20; i++) {
    assert.deepEqual([...pickChoices(pool[0], pool)].sort(), ['무단 통치기', '문화 통치기', '민족 말살 통치기']);
  }
  assert.deepEqual(pickChoices(other, pool), ['신간회']);
});

test('buildBatch: type filter', () => {
  const cs = [mk('a', 'x'), { ...mk('b', '세종'), type: '시기' }];
  assert.deepEqual(buildBatch(cs, {}, { tick: 0, type: '시기' }).map(c => c.id), ['b']);
});
```

`test/cards.test.mjs` 끝에:

```js
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
```

- [ ] **Step 2: 실패 확인** — `node --test` → 새 logic 테스트 4개 중 3개 이상 FAIL(pickChoices/buildBatch), cards 규칙 테스트는 시기 카드가 아직 없어 PASS.

- [ ] **Step 3: 구현** — `logic.js`:

1. `TYPES`를 `['인물', '사건', '제도', '문화재', '단체', '세시풍속', '시기', '기타']`로(기존 순서 유지, `'시기'`를 `'기타'` 앞에 추가).
2. `pickChoices` 전체를 다음으로 교체:

```js
const kind2 = s => normalize(s).slice(-2);
const kind1 = s => normalize(s).slice(-1);

export function pickChoices(card, pool, rng = Math.random) {
  const isPeriod = card.type === '시기';
  const others = pool.filter(c => c.back !== card.back && (c.type === '시기') === isPeriod);
  const sameEra = others.filter(c => c.era === card.era);
  const k2 = kind2(card.back), k1 = kind1(card.back);
  const tiers = isPeriod ? [sameEra] : [
    sameEra.filter(c => kind2(c.back) === k2),
    sameEra.filter(c => c.type === card.type && kind1(c.back) === k1),
    others.filter(c => c.type === card.type && kind2(c.back) === k2),
    sameEra.filter(c => c.type === card.type),
    sameEra,
    others,
  ];
  const wrong = [...new Set(tiers.flatMap(t => shuffle(t.map(c => c.back), rng)))].slice(0, 3);
  return shuffle([card.back, ...wrong], rng);
}
```

3. `buildBatch`의 옵션에 `type = null`을 추가하고 pool 필터를 `(!era || c.era === era) && (!type || c.type === type) && !p(c.id).done`로.

- [ ] **Step 4: 측정 도구** — `tools/audit.mjs`:

```js
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
```

- [ ] **Step 5:** `node --test` 전부 PASS(43 + 5 = 48). `node tools/audit.mjs` 실행해 수치를 보고서에 기록(변경 전 기준: odd-one-out 402).

- [ ] **Step 6: 커밋** — `git add logic.js test tools && git commit -m "feat: same-kind distractors, 시기 type, audit tool"`

---

### Task 2: 시기 맞히기 버튼 + v4

**Files:** Modify `index.html`, `app.js`, `version.js`

- [ ] **Step 1: `index.html`** — 홈의 `<p><button class="primary" id="start">학습 시작</button></p>` 바로 아래에 추가:

```html
    <div class="row"><button id="periodBtn">시기 맞히기</button></div>
```

- [ ] **Step 2: `app.js`**

1. `MODE_LABEL`에 `period: '시기 맞히기'`, `EMPTY_MSG`에 `period: '시기 문제를 모두 완료했어요!'` 추가.
2. `const SCHEDULED = new Set(['normal', 'period']);` 추가(모드 상수 옆).
3. `startBatch`의 배치 생성을 다음으로:

```js
  const batch = SCHEDULED.has(mode)
    ? L.buildBatch(allCards(), progress, { tick: stats.tick, era, type: mode === 'period' ? '시기' : null })
    : L.practiceBatch(allCards(), progress, { mode, skip: practiced, era });
```

   빈 배치 안내 조건 `mode !== 'normal' && practiced.size`를 `!SCHEDULED.has(mode) && practiced.size`로.
4. `commit`의 `if (mode === 'normal')`를 `if (SCHEDULED.has(mode))`로.
5. `renderHome`에서 `n` 계산 다음 줄에:

```js
  const pn = L.counts(allCards().filter(c => c.type === '시기' && (!era || c.era === era)), progress, stats.tick);
  $('periodBtn').textContent = `시기 맞히기 (${pn.fresh + pn.learning})`;
```

6. 버튼 연결(다른 `onclick` 옆): `$('periodBtn').onclick = () => enterMode('period');`

- [ ] **Step 3:** `version.js`를 `self.APP_VERSION = 'v4';`로.

- [ ] **Step 4:** `node --test` PASS. 브라우저 확인(390×844, SW·캐시·localStorage 초기화 후): 홈에 "시기 맞히기 (0)"(시기 카드 아직 없음), 버튼 누르면 "시기 문제를 모두 완료했어요!" 안내, 제목 옆 v4, 학습 시작 정상, 콘솔 에러 없음. 테스트용으로 `cards.json`을 고치지 말 것 — 필요하면 `localStorage.customCards`에 `type: '시기'` 카드 4장을 넣어 버튼·보기(같은 시기끼리)를 확인하고 지운다.

- [ ] **Step 5: 커밋** — `git commit -am "feat: 시기 맞히기 mode; v4"`

---

### Task 3: 정답을 흘리는 문제 문장 고치기

**Files:** Modify `cards.json` (front만), 필요하면 `docs/content/card-coverage.md`는 손대지 않음

- [ ] **Step 1:** `node tools/audit.mjs --list` → 정답 일부가 문제에 있고 오답에는 없는 카드 목록.
- [ ] **Step 2:** 목록의 각 카드를 판단: 그 공통 글자가 실제로 정답을 알려 주면(예: "비파 모양" → 비파형 동검, "강우량" → 측우기) 문제를 다시 쓴다. 단순 공통어(나라 이름 등)로 보기에서도 구분이 안 되는 경우면 그대로 둔다. 다시 쓸 때: 사실 정확, 단서 2~3개, 같은 시대 다른 카드 정답이 맞지 않게, 기존 카드 사실을 거꾸로 다시 묻지 않게, 정규화 중복 금지.
- [ ] **Step 3:** `node --test` PASS, `node tools/audit.mjs` 수치 기록 → 커밋 `content: rewrite fronts that leak the answer`(시대 2~3개씩 나눠 커밋해도 됨).

---

### Tasks 4–7: 시기 카드 작성

| Task | 시대 |
|---|---|
| 4 | 선사, 고조선·초기국가, 삼국 |
| 5 | 통일신라·발해, 고려 |
| 6 | 조선 전기, 조선 후기 |
| 7 | 일제강점기, 현대 |

**규칙(공통):**
- 후보 = 해당 시대의 기존 카드 중 type이 사건·제도·문화재·단체·기타·세시풍속인 것. 각 후보에 대해: 정답 단위(Global Constraints 표)로 **한 시기에 확실히 속하면** 시기 카드 하나를 만든다. 여러 왕에 걸치거나, 시기가 학설상 갈리거나, 기존 카드가 이미 "그 사실 하나 → 그 왕/시기"를 묻고 있으면 만들지 않는다.
- 기존 카드에 없는 빈출 시기 사실(예: 왕별 대표 업적 중 아직 사건·제도 카드가 없는 것)도 추가할 수 있다. 단 확립된 사실만.
- 형식: `{"id","front","back","era","type":"시기","tier"}`. front = 사건·제도·유물 이름(+삼국·통일신라·발해는 나라, 필요하면 짧은 중립 설명) + 시대별 끝맺음(Global Constraints). 예: `녹읍 폐지·관료전 지급 (신라) — 어느 왕 때?` → `신문왕`.
- front에 정답이나 정답 이름 일부를 넣지 않는다(예: "광개토대왕릉비 — 어느 왕 때?" 금지). 정답이 드러나는 설명어도 금지.
- back은 기존 카드의 같은 왕 표기를 그대로(예: `광개토대왕`, `세종`). 같은 시대 시기 정답 종류가 3개 이상 되게 고르게(보기가 4개 나오도록).
- tier = 원래 카드의 tier(원래 584장 출신 = 1), 새 사실이면 빈출 1 / 심화 2.
- id는 현재 최대 id 다음부터 연속, 파일 끝에 추가. 시대 하나마다 `node --test` PASS 후 커밋 `content: <시대> 시기 cards (+N)`. (Task 8에서 정렬하므로 이 단계에서는 정렬 테스트가 실패해도 됨 — 실패하면 정렬 테스트만 실패하는지 확인하고 보고.)

---

### Task 8: 정렬 + 측정 보고

- [ ] `cards.json` 585번째 이후를 (tier, ERAS 순서, 기존 순서)로 안정 정렬(v2 Task 9와 같은 node 명령, 카드 하나당 한 줄, 앞 584장 불변).
- [ ] `node --test` 전부 PASS, `node tools/audit.mjs` 수치를 기록(odd-one-out·answer-leaked, 변경 전 402 / 237 후보와 비교).
- [ ] 커밋 `content: order cards by tier`.

### Task 9: 배포 (사용자 승인됨)

- [ ] `main`에 fast-forward 병합 → `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin main` → Pages `built` 확인 → 배포된 `version.js`가 `v4`인지 확인.
