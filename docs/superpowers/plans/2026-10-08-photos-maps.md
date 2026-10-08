# 사진·지도 (2단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사진 카드·지도 카드·사진 고르기 모드·노트 사진을 추가하고 v10으로 배포한다.

**Architecture:** 사진·지도는 `cards.json`의 새 유형(`사진`, `지도`)으로 넣어 FSRS·노트 연결을 그대로 쓴다. 보기 선택·사진 고르기 문제 생성·지도 투영은 `logic.js`, 지도 바탕은 `map.json`(빌드 스크립트 `tools/build-map.mjs`), 사진은 `img/<id>.jpg`. 화면은 `app.js`/`index.html`, 사진 캐시는 `sw.js`.

**Tech Stack:** 바닐라 JS ES 모듈, `node:test`, macOS `sips`(사진 축소), Natural Earth 10m land GeoJSON(퍼블릭 도메인), 국가유산청 Open API.

**Spec:** `docs/superpowers/specs/2026-10-08-photos-maps-design.md`

## Global Constraints

- 사진 카드: `type: "사진"`, `img: "img/<id>.jpg"`(파일 존재), `credit`, `kind` ∈ 탑·불상·건축·도자기·그림·고분·유물·비석·기타, `period`(시험식 시대 이름), `note` ≤ 60자, `of`(기존 카드, 같은 era), `back` ≤ 10자, `tier` 1|2.
- 지도 카드: `type: "지도"`, `geo: [lat, lon]`(32.5~44, 119~133), `note` ≤ 60자, `of`, `back` ≤ 10자, `tier`.
- 사진 이용 허락: 국가유산청 `imageNuri`에 A(공공누리 제1유형) 포함, 또는 위키미디어 공용 PD·CC BY·CC BY-SA. 출처는 화면에 표시.
- 사진: 긴 변 480px JPEG 품질 70.
- 모든 카드는 노트 항목에 연결(기존 테스트).
- 배포: `version.js` → `v10`, `sw.js` FILES에 `map.json`, 사진은 런타임 캐시 `img`(버전 교체 시 삭제하지 않음).

## Review Focus

- 사진을 못 불러올 때(오프라인·404) 카드가 막히지 않고 문구가 보여야 함(Task 4 화면 확인).
- "신라의 문화유산은?"에 통일 신라 사진이 오답으로 나오면 정답이 둘 → period가 서로 포함 관계면 오답에서 제외(Task 1 테스트).
- 사진 카드의 보기 이름이 같은 사진이 둘이면 정답 둘 → 보기는 back 중복 없음(Task 1 테스트).
- 새 버전 배포 때 사진 캐시가 지워지지 않아야 함(Task 4 sw.js, 화면 확인).
- 지도 점이 바다·엉뚱한 곳에 찍히지 않아야 함(Task 3 지도 전체 점 화면 확인).

---

### Task 1: 로직 (logic.js)

**Files:** Modify `logic.js` · Test `test/logic.test.mjs`

**Interfaces — Produces:**
- `TYPES`에 `'사진', '지도'`(기타 앞), `choiceClass(c)` → 사진·지도도 자기 유형끼리.
- `pickChoices`: 사진 = 같은 `kind` 우선, 지도 = 같은 era 우선.
- `makePhotoQuestion(cards, { era = null, rng })` → `{ prompt, options: card[5], answer: card } | null`.
- `MAP = { lon0: 119, lon1: 133, lat0: 32.5, lat1: 44, k: 100 }`, `project(lat, lon)` → `[x, y]`(소수 1자리), `MAP_VIEW` = `'0 0 W H'`.

- [ ] **Step 1: 실패하는 테스트**
```js
const ph = (id, back, period, kind = '탑', era = '고려') => ({ id, front: '사진 속 문화유산은?', back, era, type: '사진', period, kind, img: `img/${id}.jpg` });

test('pickChoices 사진: only photo answers, same kind first', () => {
  const pool = [ph('a', '석가탑', '통일 신라'), ph('b', '다보탑', '통일 신라'), ph('c', '월정사 탑', '고려'), ph('d', '정림사 탑', '백제'),
    ph('e', '미륵사 탑', '백제'), ph('f', '반가사유상', '삼국', '불상'), { id: 'x', front: 'x', back: '세종', era: '고려', type: '인물' }];
  for (let s = 1; s <= 20; s++) {
    const ch = pickChoices(pool[0], pool, seeded(s));
    assert.equal(ch.length, 5);
    assert.ok(['석가탑', '다보탑', '월정사 탑', '정림사 탑', '미륵사 탑'].every(x => ch.includes(x)), ch.join());
  }
});

test('makePhotoQuestion: one answer of the period, 4 others from unrelated periods, distinct names', () => {
  const pool = [ph('a', '석가탑', '통일 신라'), ph('b', '분황사 탑', '신라'), ph('c', '월정사 탑', '고려'), ph('d', '정림사 탑', '백제'),
    ph('e', '미륵사 탑', '백제'), ph('f', '경천사 탑', '고려'), ph('g', '원각사 탑', '조선 전기'), ph('h', '감은사 탑', '통일 신라')];
  for (let s = 1; s <= 40; s++) {
    const q = makePhotoQuestion(pool, { rng: seeded(s) });
    assert.ok(q);
    assert.equal(q.options.length, 5);
    assert.ok(q.options.includes(q.answer));
    const p = q.answer.period;
    assert.equal(q.prompt, `다음 중 ${p}의 문화유산은?`);
    for (const o of q.options) if (o !== q.answer) assert.ok(!o.period.includes(p) && !p.includes(o.period), `${p} vs ${o.period}`);
    assert.equal(new Set(q.options.map(o => o.back)).size, 5);
  }
  assert.equal(makePhotoQuestion(pool.slice(0, 2)), null);
});

test('project: corners and Seoul land inside the map', () => {
  const [w, h] = MAP_VIEW.split(' ').slice(2).map(Number);
  assert.deepEqual(project(MAP.lat1, MAP.lon0), [0, 0]);
  const [x, y] = project(37.57, 126.98);
  assert.ok(x > 0 && x < w && y > 0 && y < h);
  assert.deepEqual(project(MAP.lat0, MAP.lon1), [w, h]);
});
```
(import `makePhotoQuestion, project, MAP, MAP_VIEW` 추가)

- [ ] **Step 2: 실패 확인** — `node --test test/*.mjs` · Expected: FAIL (export 없음).
- [ ] **Step 3: 구현**
```js
export const TYPES = ['인물', '사건', '제도', '문화재', '단체', '세시풍속', '시기', '판별', '사진', '지도', '기타'];
export const choiceClass = c => (['시기', '판별', '사진', '지도'].includes(c.type) ? c.type : '');
// pickChoices 안, 시기/판별 분기 뒤:
} else if (card.type === '사진') {
  tiers = [others.filter(c => c.kind === card.kind), others];
} else if (card.type === '지도') {
  tiers = [sameEra, others];
}

const related = (a, b) => a.includes(b) || b.includes(a);   // 신라 ↔ 통일 신라

export function makePhotoQuestion(cards, { era = null, rng = Math.random } = {}) {
  const photos = cards.filter(c => c.type === '사진');
  const candidates = photos.filter(c => !era || c.era === era);
  for (const period of shuffle([...new Set(candidates.map(c => c.period))], rng)) {
    const answer = shuffle(candidates.filter(c => c.period === period), rng)[0];
    const pool = photos.filter(c => !related(c.period, period));
    const ranked = [...shuffle(pool.filter(c => c.kind === answer.kind), rng), ...shuffle(pool.filter(c => c.kind !== answer.kind), rng)];
    const wrong = [];
    for (const c of ranked) if (wrong.length < CHOICES - 1 && c.back !== answer.back && !wrong.some(w => w.back === c.back)) wrong.push(c);
    if (wrong.length === CHOICES - 1) return { prompt: `다음 중 ${period}의 문화유산은?`, options: shuffle([answer, ...wrong], rng), answer };
  }
  return null;
}

export const MAP = { lon0: 119, lon1: 133, lat0: 32.5, lat1: 44, k: 100 };
const COS = Math.cos(38 * Math.PI / 180);
const r1 = v => Math.round(v * 10) / 10;
export function project(lat, lon) {
  return [r1((lon - MAP.lon0) * COS * MAP.k), r1((MAP.lat1 - lat) * MAP.k)];
}
export const MAP_VIEW = `0 0 ${project(MAP.lat0, MAP.lon1).join(' ')}`;
```
- [ ] **Step 4: 통과 확인** — `node --test test/*.mjs` · Expected: all pass.
- [ ] **Step 5: Commit** — `feat: photo/map card types, photo question, map projection`

### Task 2: 사진·지도 내용 (에이전트) + 카드 테스트 + 노트 연결

**Files:** Modify `cards.json`, `notes.json`, `test/cards.test.mjs` · Create `img/*.jpg` · 작업용 scratchpad `photo/`, `map/`

**Interfaces — Consumes:** Task 1 `TYPES`. **Produces:** 사진·지도 카드(Global Constraints 필드).

- [ ] **Step 1: 카드 테스트 추가** (`test/cards.test.mjs`)
```js
import { existsSync } from 'node:fs';
const KINDS = ['탑', '불상', '건축', '도자기', '그림', '고분·유물', '비석·기타'];
const byIdAll = new Map(cards.map(c => [c.id, c]));

test('사진 cards: image file, credit, kind, period, note, of', () => {
  for (const c of cards.filter(c => c.type === '사진')) {
    const w = JSON.stringify(c);
    assert.equal(c.img, `img/${c.id}.jpg`, w);
    assert.ok(existsSync(new URL('../' + c.img, import.meta.url)), `missing ${c.img}`);
    assert.ok(c.credit?.trim() && KINDS.includes(c.kind) && c.period?.trim(), w);
    assert.ok(c.note?.trim() && c.note.length <= 60, w);
    assert.equal(byIdAll.get(c.of)?.era, c.era, w);
  }
});

test('지도 cards: geo inside the map, note, of', () => {
  for (const c of cards.filter(c => c.type === '지도')) {
    const w = JSON.stringify(c);
    const [lat, lon] = c.geo ?? [];
    assert.ok(lat >= 32.5 && lat <= 44 && lon >= 119 && lon <= 133, w);
    assert.ok(c.note?.trim() && c.note.length <= 60, w);
    assert.equal(byIdAll.get(c.of)?.era, c.era, w);
  }
});
```
  - 두 front 중복 테스트의 필터를 `c.type !== '판별' && c.type !== '사진' && c.type !== '지도'`로.
- [ ] **Step 2: 작업 지침·검증기** — scratchpad `photo/PROMPT.md`(사진 수집 규칙: API 사용법, imageNuri A만, 위키미디어 대체 규칙, sips 축소, 사진 직접 보고 확인, 출력 형식), `map/PROMPT.md`(지도 카드 규칙·좌표), `photo/check.mjs`(출력 형식·길이·파일 존재·of 검증).
- [ ] **Step 3: 병렬 수집** — 사진 에이전트 4개(선사~삼국 / 통일신라·발해~고려 / 조선 전기~조선 후기 / 개항기~통시대), 지도 에이전트 1개. 출력: `[{ slug, src, source, credit, front, back, era, kind, period, note, of, tier }]` / `[{ front, back, era, geo, note, of, tier }]`.
- [ ] **Step 4: 병합** — `merge.mjs`로 카드 추가(id 부여) → 사진 파일을 `img/<id>.jpg`로 복사·`img` 필드 기록 → 각 새 카드를 `of` 카드가 처음 들어 있는 노트 항목 `cards`에 추가.
- [ ] **Step 5: 통과 확인** — `node --test test/*.mjs` · Expected: all pass.
- [ ] **Step 6: Commit** — `content: photo and map cards`

### Task 3: 지도 바탕 (tools/build-map.mjs → map.json)

**Files:** Create `tools/build-map.mjs`, `map.json` · Test `test/logic.test.mjs`

- [ ] **Step 1: 테스트** — `map.json`이 `{ view, d }`이고 `view === MAP_VIEW`, `d`가 `M`으로 시작, 크기 < 150 KB.
- [ ] **Step 2: 실패 확인** — ENOENT.
- [ ] **Step 3: 빌드 스크립트** — GeoJSON(Polygon·MultiPolygon) 각 링을 `project`로 변환, 바깥 여유 범위(±1°)로 좌표를 잘라(clamp) 채움 유지, 이전 점과 1.5 이하로 가까운 점 생략, `M…L…Z` path 하나로 저장.
```js
// usage: node tools/build-map.mjs <ne_10m_land.geojson>   → map.json
import { readFileSync, writeFileSync } from 'node:fs';
import { project, MAP, MAP_VIEW } from '../logic.js';
const geo = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rings = geo.features.flatMap(f => f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : []);
let d = '';
for (const ring of rings) {
  if (!ring.some(([lon, lat]) => lon > MAP.lon0 - 1 && lon < MAP.lon1 + 1 && lat > MAP.lat0 - 1 && lat < MAP.lat1 + 1)) continue;
  const pts = [];
  for (const [lon, lat] of ring) {
    const p = project(clamp(lat, MAP.lat0 - 1, MAP.lat1 + 1), clamp(lon, MAP.lon0 - 1, MAP.lon1 + 1));
    const q = pts.at(-1);
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= 1.5) pts.push(p);
  }
  if (pts.length >= 3) d += 'M' + pts.map(p => p.join(' ')).join('L') + 'Z';
}
writeFileSync('map.json', JSON.stringify({ view: MAP_VIEW, d }) + '\n');
```
- [ ] **Step 4: 통과 확인** + 화면: 지도 카드 전체 점을 한 지도에 찍어 스크린샷으로 위치 확인.
- [ ] **Step 5: Commit** — `feat: map base from Natural Earth`

### Task 4: 화면 (index.html, app.js, sw.js)

**Files:** Modify `index.html`, `app.js`, `sw.js`, `version.js`

**Interfaces — Consumes:** `L.makePhotoQuestion`, `L.project`, `map.json`, 사진·지도 카드 필드.

- [ ] **Step 1: index.html** — 문제 카드 안 `qFront` 위에 `<img id="qImg" hidden alt="">`, `<p id="qImgMsg" class="muted" hidden></p>`, `<div id="qMap" hidden></div>`, 아래 `<p id="qCredit" class="tag" hidden></p>`. 홈 버튼 `<button id="photoBtn">사진 고르기</button>`(순서 문제 줄). 관리: `<h2>사진</h2><button id="dlPhotos">사진 모두 내려받기</button><p id="dlMsg" class="muted"></p>`. CSS:
```css
#qImg { width:100%; max-height:46vh; object-fit:contain; border-radius:8px; background:var(--line); }
#qMap svg, .noteMap svg { width:100%; height:auto; display:block; }
.map-land { fill:var(--line); stroke:var(--muted); stroke-width:1; } .map-dot { fill:var(--bad); stroke:#fff; stroke-width:3; }
.photoGrid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.photoGrid button { padding:4px; text-align:center; } .photoGrid img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:6px; display:block; }
.thumbs { display:flex; gap:6px; flex-wrap:wrap; } .thumbs img { width:72px; height:72px; object-fit:cover; border-radius:6px; }
```
- [ ] **Step 2: app.js — 사진·지도 카드 표시**
```js
let mapData = null;   // { view, d } from map.json
const svgNS = 'http://www.w3.org/2000/svg';
function mapSvg(geo) {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', mapData.view);
  const land = document.createElementNS(svgNS, 'path');
  land.setAttribute('d', mapData.d); land.setAttribute('class', 'map-land');
  const [x, y] = L.project(...geo);
  const dot = document.createElementNS(svgNS, 'circle');
  dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 16); dot.setAttribute('class', 'map-dot');
  svg.append(land, dot);
  return svg;
}
function showMedia(card) {
  const img = $('qImg');
  img.hidden = !card.img; $('qImgMsg').hidden = true;
  if (card.img) { img.onerror = () => { img.hidden = true; $('qImgMsg').hidden = false; $('qImgMsg').textContent = '사진을 불러오지 못했어요(오프라인). 연결되면 다시 보여요.'; }; img.src = card.img; }
  $('qMap').hidden = !(card.geo && mapData);
  $('qMap').replaceChildren(...(card.geo && mapData ? [mapSvg(card.geo)] : []));
  $('qCredit').hidden = !card.credit; $('qCredit').textContent = card.credit ? '사진: ' + card.credit : '';
}
```
  - `renderQuestion`에서 `qFront` 설정 뒤 `showMedia(card)`; `renderOrder`·사진 고르기에서는 `showMedia({})`.
  - `onAnswer`: 피드백 `p` 다음에 `if (card.note) $('feedback').append(el('p', card.note, 'muted'));`
  - `ownerOf`: 맨 앞에 `if (card.type === '지도') return null; if (card.type === '사진') return allCards().find(c => c.type === '사진' && c.back === choice)?.period;`
- [ ] **Step 3: app.js — 사진 고르기 모드**
```js
let photoQ = null;
function renderPhoto() {
  busy = false;
  $('feedback').replaceChildren();
  const era = $('eraSelect').value || null;
  photoQ = L.makePhotoQuestion(allCards(), { era }) ?? L.makePhotoQuestion(allCards());
  if (!photoQ) { $('homeMsg').textContent = '사진 카드가 부족해요.'; return goHome(); }
  show('study');
  showMedia({});
  $('progressText').textContent = `${MODE_LABEL.photo} · ${doneCount}문제 풀이`;
  $('qTag').textContent = '사진 고르기';
  $('qFront').textContent = photoQ.prompt;
  $('known').hidden = true; $('flag').hidden = true; $('dunno').hidden = false;
  $('choices').className = 'choices photoGrid';
  $('choices').replaceChildren(...photoQ.options.map(c => {
    const b = btn('', () => onPhotoAnswer(c, b));
    const im = el('img'); im.src = c.img; im.alt = '';
    b.append(im);
    return b;
  }));
}
function onPhotoAnswer(choice, button) {
  if (busy || !photoQ) return;
  busy = true;
  const ok = choice === photoQ.answer;
  button?.classList.add(ok ? 'ok' : 'bad');
  [...$('choices').children].forEach((b, i) => {
    const c = photoQ.options[i];
    b.append(el('small', `${c.back} · ${c.period}`));
    if (c === photoQ.answer) b.classList.add('ok');
  });
  $('feedback').replaceChildren(el('p', ok ? '정답!' : '오답', ok ? 'ok' : 'bad'), btn('다음', () => { doneCount++; renderPhoto(); }, 'primary'));
}
```
  - `MODE_LABEL.photo = '사진 고르기'`; `startBatch`: `if (mode === 'photo') return renderPhoto();`; `renderQuestion`·`renderOrder` 시작에서 `$('choices').className = 'choices';`; `dunno`: `mode === 'order' ? onOrderAnswer(null) : mode === 'photo' ? onPhotoAnswer(null) : onAnswer(false)`; `$('photoBtn').onclick = () => enterMode('photo');`, 사진 카드가 없으면 버튼 숨김.
- [ ] **Step 4: app.js — 노트 사진·지도, 내려받기, map.json 로드**
  - `noteItem`: `why` 앞에 `const pics = it.cards.map(id => cardById.get(id)).filter(c => c?.img).slice(0, 4); if (pics.length) d.append(Object.assign(el('div', null, 'thumbs'), {}), ...)` → 썸네일 `img`(loading="lazy", alt=이름); 지도 카드가 있으면 첫 지도 카드 `mapSvg(geo)`를 `.noteMap`로.
  - `cardById` = `new Map(allCards().map(c => [c.id, c]))`(카드 로드 뒤 생성).
  - 관리 `dlPhotos`: 사진 카드 `img`를 4개씩 `fetch`, `dlMsg` = `N / 전체장 받음`, 끝나면 "완료 — 오프라인에서도 사진이 보여요".
  - 시작 시 `notes.json` 다음에 `map.json` 로드(실패 시 `mapData = null`, 지도 카드는 지도 없이 문구만).
- [ ] **Step 5: sw.js** — FILES에 `'map.json'`; activate는 `k !== CACHE && k !== 'img'`만 삭제; fetch:
```js
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).pathname.includes('/img/')) {
    e.respondWith(caches.open('img').then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
```
  - `version.js` → `v10`.
- [ ] **Step 6: 화면 확인(390×844)** — 사진 카드 풀기·오답 시 period 표시·note 표시·출처 표시 · 지도 카드 · 사진 고르기(격자, 답 뒤 이름·시대) · 노트 썸네일·지도 · `img` 하나 이름 바꿔 오프라인 문구 확인(원복) · 관리 내려받기 진행률 · 콘솔 오류 0.
- [ ] **Step 7: Commit** — `feat: photo/map cards on screen, 사진 고르기, note photos, photo cache; v10`

### Task 5: 사진 검증

- [ ] **Step 1:** 검증 에이전트 2개(사진 절반씩): 각 사진을 직접 보고 카드 이름·period·kind·note와 맞는지, 전경으로 알아볼 수 있는지 판정 → 틀린 것은 수정안(다른 사진 URL 또는 삭제).
- [ ] **Step 2:** 전체 사진 한 화면(사진 + 이름 격자 HTML, scratchpad) 스크린샷으로 직접 훑기.
- [ ] **Step 3:** 수정 반영, `node --test test/*.mjs` 통과, Commit `content: photo verification fixes`.

### Task 6: 최종 검토·배포

- [ ] **Step 1:** 전체 브랜치 코드 검토(별도 검토자) → Important 이상 수정.
- [ ] **Step 2:** `main` 병합, push, `version.js` v10·`map.json`·`img/` 하나가 200인지 확인.
