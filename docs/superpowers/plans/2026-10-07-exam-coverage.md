# 기출 대조 + 순서 문제 + 보기 판별 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 최근 심화 기출(57~79회)을 분석해 빠진 내용을 카드로 채우고, 순서·시기 사이 문제 모드와 보기 판별 카드 유형을 추가한다.

**Architecture:** 기존 정적 PWA. `logic.js`에 순서 문제 생성기와 판별 보기 규칙 추가, `app.js`에 두 모드 추가. 카드 데이터에 `year`, 판별 카드(`type:"판별"`, `group`) 추가. 기출 분석은 작업 폴더의 렌더링 이미지를 에이전트가 읽어 사실만 정리.

**Spec:** `docs/superpowers/specs/2026-10-07-exam-coverage-design.md`

## Global Constraints

- 의존성 0개(앱). 테스트 `node --test`(현재 49 통과).
- 기출 문제지 PDF·이미지·문항 문장은 저장소에 넣지 않는다. 저장소에는 사실을 우리 말로 정리한 것만.
- 카드 id 불변, 새 id는 최대 id 다음부터 연속. 585번째 이후 카드는 `tier` 필수, 파일 끝 정렬(tier → ERAS 순서)은 마지막 Task에서.
- 기존 규칙: 판별 외 정답 10자 이내, 문제에 정답 금지, 같은 시대 다른 카드 정답이 맞지 않게, 기존 카드 사실 역질문 금지, 사실 확립된 것만.
- 판별 카드: `{"id","front":대상,"back":사실(40자 이내),"era","type":"판별","group","tier"}`. group 예: `고려 왕`, `고려 인물`, `조선 후기 인물`, `개항기 단체`. 같은 group 안에서 사실이 그 대상에게만 맞아야 한다.
- `year`: 정수(기원전 음수), 한 해로 확립된 사건·제도·단체·시기·문화재만.
- 커밋 메시지 끝: 빈 줄 + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Review Focus

1. 판별 오답 보기(다른 대상의 사실)가 실제로는 그 대상에게도 맞음 → 시대별 판별 리뷰에서 같은 group 교차 확인.
2. 순서 문제에서 연도가 틀리거나 학설이 갈리는 사건 → 연도 리뷰.
3. 연도 카드가 적은 시대 필터로 순서 문제 → 생성 실패 시 안내 문구(무한 루프 없음) (Task 2 테스트·브라우저).
4. 판별 카드가 문제 중복 테스트·정답 길이 테스트에 걸려 기존 테스트가 깨짐 → cards 테스트 갱신(Task 2).
5. 기출 문항 문장이 분석 파일에 그대로 들어감 → 분석 리뷰에서 확인.

---

### Task 1: 기출 분석 (회차별, 병렬)

입력(작업 폴더, 저장소 밖): `<SCRATCH>/pages/<회차>_pNN.png`(문제지 페이지 이미지), `<SCRATCH>/exams/<회차>_a.pdf`(정답표, 텍스트 PDF — `<SCRATCH>/venv/bin/python -c "from pypdf import PdfReader; print(PdfReader('<SCRATCH>/exams/<회차>_a.pdf').pages[0].extract_text())"`로 읽음).

출력: `docs/content/gichul/<회차>.json` — 50개 객체 배열:
```json
{ "q": 7, "era": "통일신라·발해", "kind": "판별", "subject": "발해", "subjectType": "국가",
  "answerFact": "인안·대흥 등 독자 연호 사용", "clues": ["5경 15부", "신당서"], "cards": ["c0186"] }
```
- `era`: ERAS 값(통시대 주제면 `통시대`). `kind`: 판별/시기/순서/사이/사진/기타. `subjectType`: 왕·인물·국가·단체·사건·제도·문화재·기타.
- `answerFact`: 정답 선지를 40자 이내로 **다시 쓴** 사실(문장 그대로 복사 금지). 순서 문제면 정답 순서를 이루는 사건들을 연도와 함께 짧게.
- `cards`: `cards.json`에서 그 대상 또는 그 사실을 이미 묻는 카드 id(grep). 없으면 빈 배열.
- 각 회차 = 에이전트 하나. 커밋은 하지 않는다(컨트롤러가 모아서 커밋).

### Task 2: 순서 문제 + 판별 유형 (코드)

**Files:** `logic.js`, `app.js`, `index.html`, `test/logic.test.mjs`, `test/cards.test.mjs`, `tools/audit.mjs`, `version.js`

1. `logic.js`
   - `TYPES`에 `'판별'`을 `'기타'` 앞에 추가.
   - `pickChoices` 교체:
```js
export function pickChoices(card, pool, rng = Math.random) {
  const cls = c => (c.type === '시기' || c.type === '판별' ? c.type : '');
  const others = pool.filter(c => c.back !== card.back && cls(c) === cls(card)
    && !(card.type === '판별' && c.front === card.front));
  const sameEra = others.filter(c => c.era === card.era);
  let tiers;
  if (card.type === '시기') {
    const nat = nationOf(card.front);
    tiers = [sameEra.filter(c => nationOf(c.front) === nat), sameEra];
  } else if (card.type === '판별') {
    tiers = [sameEra.filter(c => c.group === card.group), sameEra];
  } else {
    const k2 = kind2(card.back), k1 = kind1(card.back);
    tiers = [
      sameEra.filter(c => kind2(c.back) === k2),
      sameEra.filter(c => c.type === card.type && kind1(c.back) === k1),
      others.filter(c => c.type === card.type && kind2(c.back) === k2),
      sameEra.filter(c => c.type === card.type),
      sameEra,
      others,
    ];
  }
  const wrong = [...new Set(tiers.flatMap(t => shuffle(t.map(c => c.back), rng)))].slice(0, 3);
  return shuffle([card.back, ...wrong], rng);
}
```
   - 파일 끝에 순서 문제:
```js
export const ORDER_GAP = 3;

export function orderLabel(card) {
  return card.type === '시기' ? card.front.replace(/\s*— 어느 [^?]*\?$/, '') : card.back;
}

function pickApart(pool, n, gap, rng, taken = []) {
  const out = [];
  for (const c of shuffle(pool, rng)) {
    if ([...taken, ...out].every(o => Math.abs(o.year - c.year) >= gap && orderLabel(o) !== orderLabel(c))) out.push(c);
    if (out.length === n) return out;
  }
  return null;
}

export function makeOrderQuestion(cards, { era = null, kind = null, rng = Math.random } = {}) {
  const i = ERAS.indexOf(era);
  const pool = cards.filter(c => Number.isInteger(c.year) && c.type !== '판별'
    && (!era || Math.abs(ERAS.indexOf(c.era) - i) <= 1));
  const k = kind ?? (rng() < 0.5 ? 'first' : 'between');
  if (k === 'first') {
    const options = pickApart(pool, 4, ORDER_GAP, rng);
    if (!options) return null;
    return { kind: k, prompt: '다음 중 가장 먼저 일어난 것은?', options, answer: options.reduce((a, b) => (b.year < a.year ? b : a)) };
  }
  for (let t = 0; t < 50; t++) {
    const ends = pickApart(pool, 2, 2 * ORDER_GAP, rng);
    if (!ends) return null;
    const [a, b] = ends.sort((x, y) => x.year - y.year);
    const inside = pool.filter(c => c.year >= a.year + ORDER_GAP && c.year <= b.year - ORDER_GAP);
    const outside = pool.filter(c => c.year <= a.year - ORDER_GAP || c.year >= b.year + ORDER_GAP);
    const answer = pickApart(inside, 1, 0, rng, [a, b])?.[0];
    const wrong = answer && pickApart(outside, 3, 0, rng, [a, b, answer]);
    if (wrong) return { kind: k, prompt: `(가) ${orderLabel(a)} 와(과) (나) ${orderLabel(b)} 사이에 있었던 일은?`, options: shuffle([answer, ...wrong], rng), answer, ends: [a, b] };
  }
  return null;
}
```
2. `test/logic.test.mjs` 끝에 추가:
```js
const seeded = s => () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
const ev = (id, back, year, era = '고려', type = '사건') => ({ id, front: 'f' + id, back, era, type, year });
const YEARS = [918, 936, 956, 993, 1010, 1019, 1107, 1126, 1135, 1170, 1198, 1231];
const dated = YEARS.map((y, i) => ev('y' + i, '사건' + i, y));

test('orderLabel: 시기 strips the question ending, others use back', () => {
  assert.equal(orderLabel({ type: '시기', front: '노비안검법 실시 — 어느 왕 때?', back: '광종' }), '노비안검법 실시');
  assert.equal(orderLabel({ type: '사건', front: 'x', back: '귀주 대첩' }), '귀주 대첩');
});

test('makeOrderQuestion first: 4 options ≥ gap apart, distinct labels, answer is earliest', () => {
  for (let s = 1; s <= 40; s++) {
    const q = makeOrderQuestion(dated, { kind: 'first', rng: seeded(s) });
    assert.ok(q);
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options.map(orderLabel)).size, 4);
    for (const a of q.options) for (const b of q.options) if (a !== b) assert.ok(Math.abs(a.year - b.year) >= 3);
    assert.equal(q.answer.year, Math.min(...q.options.map(o => o.year)));
  }
});

test('makeOrderQuestion between: answer inside, wrong outside, ends not among options', () => {
  let made = 0;
  for (let s = 1; s <= 40; s++) {
    const q = makeOrderQuestion(dated, { kind: 'between', rng: seeded(s) });
    if (!q) continue;
    made++;
    const [a, b] = q.ends;
    assert.equal(q.options.length, 4);
    assert.ok(q.options.includes(q.answer));
    assert.ok(q.answer.year >= a.year + 3 && q.answer.year <= b.year - 3);
    for (const o of q.options) if (o !== q.answer) assert.ok(o.year <= a.year - 3 || o.year >= b.year + 3);
    assert.ok(!q.options.includes(a) && !q.options.includes(b));
  }
  assert.ok(made > 0);
});

test('makeOrderQuestion: null when not enough dated cards; era filter uses adjacent eras only', () => {
  assert.equal(makeOrderQuestion(dated.slice(0, 2), { kind: 'first' }), null);
  assert.equal(makeOrderQuestion(dated.slice(0, 2), { kind: 'between' }), null);
  const mixed = [...dated, ev('s1', '삼국사건', 500, '삼국'), ev('j1', '조선후기사건', 1750, '조선 후기')];
  for (let s = 1; s <= 20; s++) {
    const q = makeOrderQuestion(mixed, { era: '고려', kind: 'first', rng: seeded(s) });
    assert.ok(q.options.every(o => o.era === '고려'));
  }
});

test('pickChoices 판별: never another fact of the same subject; same group first; isolated from other types', () => {
  const j = (id, front, back, group = '고려 왕') => ({ id, front, back, era: '고려', type: '판별', group });
  const pool = [
    j(1, '광종', '노비안검법 실시'), j(2, '광종', '과거제 시행'),
    j(3, '성종', '12목 설치'), j(4, '현종', '5도 양계 정비'), j(5, '문종', '경정 전시과'),
    j(6, '최승로', '시무 28조 건의', '고려 인물'), { id: 7, front: 'x', back: '귀주 대첩', era: '고려', type: '사건' },
  ];
  for (let i = 0; i < 30; i++) {
    const ch = pickChoices(pool[0], pool);
    assert.deepEqual([...ch].sort(), ['12목 설치', '5도 양계 정비', '경정 전시과', '노비안검법 실시'].sort());
  }
  assert.ok(!pickChoices(pool[6], pool).some(b => ['12목 설치', '과거제 시행'].includes(b)));
});
```
   import 줄에 `orderLabel, makeOrderQuestion` 추가.
3. `test/cards.test.mjs`
   - `'every card is well-formed'`의 back 길이 검사를 `c.type === '판별' ? c.back.length <= 40 : isShort(c.back)`로, 판별이면 `typeof c.group === 'string' && c.group` 검사 추가, `year`가 있으면 `Number.isInteger(c.year) && c.year >= -3000 && c.year <= 2026` 검사 추가.
   - `'fronts are unique after normalization'`과 기존 `'fronts are unique'`(있으면)에서 `type === '판별'` 카드는 제외하고, 새 테스트 `'판별 cards: (front, back) unique and back not in front'` 추가.
4. `tools/audit.mjs`: odd-one-out에서 `판별`도 제외(`c.type !== '시기' && c.type !== '판별'`).
5. `index.html` 홈: 기존 `<div class="row"><button id="periodBtn">시기 맞히기</button></div>`를
```html
    <div class="row"><button id="periodBtn">시기 맞히기</button><button id="judgeBtn">보기 판별</button></div>
    <div class="row"><button id="orderBtn">순서 문제</button></div>
```
6. `app.js`
   - `MODE_LABEL`에 `judge: '보기 판별', order: '순서 문제'`, `SCHEDULED`에 `'judge'`, `EMPTY_MSG`에 `judge: '보기 판별 문제를 모두 완료했어요!'`, 그리고 `const MODE_TYPE = { period: '시기', judge: '판별' };`
   - `startBatch`: `cancelTimer();` 다음 줄에 `if (mode === 'order') return renderOrder();`, buildBatch의 `type: mode === 'period' ? '시기' : null` → `type: MODE_TYPE[mode] ?? null`.
   - `renderHome`: periodBtn 줄 다음에
```js
  const jn = L.counts(allCards().filter(c => c.type === '판별' && (!era || c.era === era)), progress, stats.tick);
  $('judgeBtn').textContent = `보기 판별 (${jn.fresh + jn.learning})`;
```
   - `renderQuestion`: `$('qFront').textContent = card.front;` → `$('qFront').textContent = card.type === '판별' ? `${card.front}에 대한 설명으로 옳은 것은?` : card.front;`, 그리고 `$('known').hidden = mode === 'check';` 뒤에 `$('dunno').hidden = false;`
   - 순서 모드(파일의 `onAnswer` 정의 뒤에 추가):
```js
let orderQ = null;
const fmtYear = y => (y < 0 ? `기원전 ${-y}년` : `${y}년`);

function renderOrder() {
  busy = false;
  $('feedback').replaceChildren();
  const era = $('eraSelect').value || null;
  orderQ = L.makeOrderQuestion(allCards(), { era }) ?? L.makeOrderQuestion(allCards(), { era, kind: 'first' });
  if (!orderQ) { $('homeMsg').textContent = '연도 정보가 있는 카드가 부족해요.'; return goHome(); }
  show('study');
  $('progressText').textContent = `${MODE_LABEL.order}${era ? ' · ' + era : ''} · ${doneCount}문제 풀이`;
  $('qTag').textContent = orderQ.kind === 'first' ? '순서' : '시기 사이';
  $('qFront').textContent = orderQ.prompt;
  $('known').hidden = true;
  $('flag').hidden = true;
  $('dunno').hidden = false;
  $('choices').replaceChildren(...orderQ.options.map(c => {
    const b = btn(L.orderLabel(c), () => onOrderAnswer(c, b));
    return b;
  }));
}

function onOrderAnswer(choice, button) {
  if (busy || !orderQ) return;
  busy = true;
  const ok = choice === orderQ.answer;
  button?.classList.add(ok ? 'ok' : 'bad');
  [...$('choices').children].forEach((b, i) => {
    const c = orderQ.options[i];
    b.textContent = `${L.orderLabel(c)} (${fmtYear(c.year)})`;
    if (c === orderQ.answer) b.classList.add('ok');
  });
  const p = document.createElement('p');
  p.className = ok ? 'ok' : 'bad';
  p.textContent = (ok ? '정답!' : '오답') + (orderQ.ends ? ` — (가) ${fmtYear(orderQ.ends[0].year)} · (나) ${fmtYear(orderQ.ends[1].year)}` : '');
  $('feedback').replaceChildren(p, btn('다음', () => { doneCount++; renderOrder(); }, 'primary'));
}
```
   - `$('dunno').onclick = () => onAnswer(false);` → `$('dunno').onclick = () => (mode === 'order' ? onOrderAnswer(null) : onAnswer(false));`
   - 버튼 연결: `$('judgeBtn').onclick = () => enterMode('judge');`, `$('orderBtn').onclick = () => enterMode('order');`
7. `version.js` → `'v6'`.
8. 검증: `node --test` 전부 통과. 브라우저(390×844, 초기화 후): `localStorage.customCards`에 연도 있는 사건 카드 8장(`year` 포함)과 판별 카드 6장(두 대상 이상, 같은 group)을 넣어 — 순서 문제 버튼 → 보기 4개, 답하면 연도 표시, 다음 문제 생성, "모르겠어요" 동작 / 보기 판별 버튼 → "○○에 대한 설명으로 옳은 것은?", 같은 대상의 다른 사실이 보기에 없음 / 연도 카드가 없는 상태에서 순서 문제 → "연도 정보가 있는 카드가 부족해요." / 콘솔 에러 없음. 확인 후 customCards 비우기.
9. 커밋 `feat: order questions mode and 판별 card type; v6`

### Task 3: 기출 종합

회차별 분석 23개를 합쳐 `docs/content/gichul-gaps.md` 작성: 유형 분포, 시대별 대상 빈도 상위, 그리고 시대별 (a) 카드에 없는 대상(→ 단서 카드), (b) 판별 카드로 만들 정답 사실(대상별), (c) 시기 카드로 만들 사실, (d) 순서 문제에 나온 사건(연도). 같은 사실 중복 제거, 우리 말로.

### Tasks 4–7: 시대 묶음별 콘텐츠 (연도 + 판별 + 누락 카드)

| Task | 시대 |
|---|---|
| 4 | 선사, 고조선·초기국가, 삼국, 통일신라·발해 |
| 5 | 고려, 조선 전기 |
| 6 | 조선 후기, 개항기 |
| 7 | 일제강점기, 현대, 통시대 |

각 Task(같은 작성자가 순서대로):
1. **연도:** 해당 시대 기존 카드 중 한 해로 확립된 사건·제도·단체·시기·문화재에 `year` 추가(다른 필드 불변). 학설이 갈리거나 기간이면 넣지 않는다. 선사는 연도 없음.
2. **판별 카드:** `gichul-gaps.md`(b)를 우선으로, 그 시대 주요 왕·인물·국가·단체마다 사실 3~6개. group은 `<시대> 왕` / `<시대> 인물` / `<시대> 국가` / `<시대> 단체` 등. 같은 group 안에서 사실이 그 대상에게만 맞게(다른 대상에게도 맞는 사실 금지 — 공통 업적은 쓰지 않는다). 기존 카드와 같은 사실이어도 판별 카드로는 허용(형식이 다름).
3. **누락 카드:** `gichul-gaps.md`(a)·(c)로 기존 유형 카드·시기 카드 추가(기존 규칙 전부 적용).
4. 시대마다 `node --test`(정렬 테스트만 실패 허용) 후 커밋.

### Task 8: 정렬 + 측정

585번째 이후 카드를 (tier, ERAS, 기존 순서)로 안정 정렬(이전 Task 8과 같은 방식). `node --test` 전부 통과, `node tools/audit.mjs` 기록, 카드 수(유형별·시대별, year 있는 카드 수) 기록. 커밋.

### Task 9: 최종 검토 후 배포(사용자 승인됨)

`main` 병합 → `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin main` → Pages built → 배포된 `version.js`가 `v6`인지 확인.
