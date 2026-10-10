import * as L from './logic.js';

const $ = id => document.getElementById(id);
const warn = msg => { $('warn').textContent = msg; };
const storage = (() => { try { return localStorage; } catch { return null; } })();

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const shapes = { progress: isObj, customCards: Array.isArray, stats: L.isStats, exam: v => typeof v === 'string', hideKeys: v => typeof v === 'boolean' };

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
let progress = L.migrate(load('progress', {}), L.dayOf());
let stats = load('stats', { date: '', count: 0, fresh: 0 });
let exam = load('exam', '');
let hideKeys = load('hideKeys', false);
let notes = [], noteIdx = new Map(), noteIds = null, noteFrom = false;
let mapData = null, cardById = new Map();   // map.json { view, d }; id -> card
let session = null, mode = 'normal', practiced = new Set();
let doneCount = 0, busy = false, timer = null;
const cancelTimer = () => { clearTimeout(timer); timer = null; busy = false; };

const MODE_LABEL = { normal: '학습', weak: '자주 틀린 카드', period: '시기 맞히기', judge: '보기 판별', order: '순서 문제', note: '노트 카드', photo: '사진 고르기' };
const MODE_TYPE = { period: '시기', judge: '판별' };
const EMPTY_MSG = { normal: '카드가 없어요.', period: '시기 카드가 없어요.', judge: '보기 판별 카드가 없어요.', weak: '자주 틀린 카드가 없어요.', note: '이 항목의 카드가 없어요.' };

const allCards = () => [...baseCards, ...custom];
const show = id => {
  ['home', 'study', 'manage', 'notes'].forEach(s => { $(s).hidden = s !== id; });
  if (id !== 'home' && !history.state) history.pushState(1, '');
};
const goHome = () => (history.state ? history.back() : renderHome());
const todayCount = () => (stats.date === L.today() ? stats.count : 0);
const todayFresh = () => (stats.date === L.today() ? stats.fresh ?? 0 : 0);
const examDay = () => (exam ? L.dayOf(new Date(exam + 'T00:00')) : null);

// Home era filter: checkboxes, '' = 전체 (checked when no era is).
const eraBoxes = () => [...$('eraBoxes').querySelectorAll('input')];
const selEras = () => eraBoxes().filter(b => b.checked && b.value).map(b => b.value);
const setEras = list => eraBoxes().forEach(b => { b.checked = b.value ? list.includes(b.value) : !list.length; });
const eraNote = () => { const e = selEras(); return !e.length ? '' : ' · ' + (e.length > 2 ? `시대 ${e.length}개` : e.join(', ')); };

function renderHome() {
  cancelTimer();
  const eras = selEras();
  $('eraSum').textContent = '시대: ' + (eras.join(', ') || '전체');
  const day = L.dayOf();
  const inEra = allCards().filter(c => L.inEras(c, eras));
  const n = L.counts(inEra, progress, day);
  const pn = L.counts(inEra.filter(c => c.type === '시기'), progress, day);
  $('periodBtn').textContent = `시기 맞히기 (${pn.due + pn.fresh})`;
  const jn = L.counts(inEra.filter(c => c.type === '판별'), progress, day);
  $('judgeBtn').textContent = `보기 판별 (${jn.due + jn.fresh})`;
  $('dueCount').textContent = n.due;
  $('newCount').textContent = n.fresh;
  $('doneCount').textContent = n.done;
  $('todayCount').textContent = todayCount();
  $('weakBtn').textContent = `자주 틀린 카드 (${n.weak})`;
  $('recall').textContent = `지금 기억하는 카드: 약 ${Math.round(100 * n.recall / Math.max(1, inEra.length))}%`;
  const ex = examDay();
  $('plan').textContent = ex === null ? '관리에서 시험일을 정하면 하루 목표를 알려 드려요.'
    : ex <= day ? '시험일이 지났어요. 관리에서 다음 시험일을 정해 주세요.'
    : `시험까지 D-${ex - day} · 오늘 새 카드 ${todayFresh()} / 목표 ${L.dailyNew(L.counts(allCards(), progress, day).fresh, day, ex)}장 · 오늘 복습은 매일 모두`;
  $('eraTable').replaceChildren(...L.ERAS.map(e => {
    const inEra = allCards().filter(c => c.era === e);
    if (!inEra.length) return null;
    const k = L.counts(inEra, progress, day);
    const b = btn('', () => { setEras([e]); enterMode('normal'); }, 'eraRow');
    const name = document.createElement('span'), count = document.createElement('span');
    name.textContent = e;
    count.textContent = `${k.done} / ${k.learning} / ${inEra.length}`;
    b.append(name, count);
    return b;
  }).filter(Boolean));
  show('home');
}

function enterMode(m) {
  mode = m;
  noteFrom = false;   // a new session replaces the one a note was opened from
  practiced = new Set();
  $('homeMsg').textContent = '';
  doneCount = 0;
  startBatch();
}

function startBatch() {
  cancelTimer();
  if (mode === 'order') return renderOrder();
  if (mode === 'photo') return renderPhoto();
  const eras = selEras();
  const day = L.dayOf();
  const batch = mode === 'weak' ? L.weakBatch(allCards(), progress, { day, skip: practiced, eras })
    : mode === 'note' ? L.buildBatch(allCards(), progress, { day, ids: noteIds, skip: practiced })
    : L.buildBatch(allCards(), progress, { day, eras, type: MODE_TYPE[mode] ?? null });
  if (!batch.length) {
    $('homeMsg').textContent = (mode === 'weak' || mode === 'note') && practiced.size ? `${MODE_LABEL[mode]}: 이번 라운드를 모두 마쳤어요.` : EMPTY_MSG[mode];
    return goHome();
  }
  batch.forEach(c => practiced.add(c.id));
  session = L.createSession(batch);
  session.saved = new Set();
  show('study');
  renderQuestion();
}

function renderQuestion() {
  busy = false;
  $('feedback').replaceChildren();
  $('progressText').textContent = `${MODE_LABEL[mode]}${mode !== 'note' ? eraNote() : ''} · ${doneCount}장 풀이`;
  const item = session.queue[0];
  if (!item) return startBatch();
  const { card } = item;
  $('qTag').textContent = `${card.era} · ${card.type}`;
  $('qFront').textContent = card.type === '판별' ? `${card.front}에 대한 설명으로 옳은 것은?` : card.front;
  showMedia(card);
  $('choices').className = 'choices';
  $('flag').hidden = false;
  $('known').hidden = false;
  $('dunno').hidden = false;
  $('flag').textContent = progress[card.id]?.flagged ? '신고 취소' : '신고';
  $('choices').replaceChildren(...L.pickChoices(card, allCards()).map(choice => {
    const b = btn(choice, () => onAnswer(choice === card.back, b));
    b.dataset.choice = choice;
    return b;
  }));
}

function onAnswer(correct, button) {
  if (busy || !session?.queue[0]) return;
  busy = true;
  const { card } = session.queue[0];
  const id = card.id;
  if (!session.saved.has(id)) {
    grade(card, correct ? 3 : 1);
    session.saved.add(id);
  }
  if (correct) { bumpStats(); doneCount++; }
  button?.classList.add(correct ? 'ok' : 'bad');
  for (const b of $('choices').children) {
    if (b.dataset.choice === card.back) { b.classList.add('ok'); continue; }
    const who = ownerOf(card, b.dataset.choice);
    if (who) { const s = document.createElement('small'); s.textContent = who; b.append(s); }
  }
  const p = document.createElement('p');
  p.className = correct ? 'ok' : 'bad';
  p.textContent = correct ? '정답!' : `정답: ${card.back}`;
  $('feedback').replaceChildren(p);
  if (!correct && card.tip) $('feedback').append(el('p', '💡 ' + card.tip, 'tip'));
  if (card.note) $('feedback').append(el('p', card.note, 'muted'));
  if (correct && !card.note) { const s = session; timer = setTimeout(() => { timer = null; if (s === session) commit(true); }, 500); return; }
  $('feedback').append(btn('다음', () => commit(correct), 'primary'));
  if (correct) return;
  const item = noteIdx.get(card.id);
  if (item) $('feedback').append(btn('노트 보기', () => { noteFrom = true; history.pushState(2, ''); renderNotes(card.era, item.id); }));
}

const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

// No cancelTimer(): opening a note from a wrong answer must keep the study session intact.
function renderNotes(era = null, focusId = null) {
  const day = L.dayOf();
  const body = $('notesBody');
  body.classList.toggle('hide', hideKeys);
  $('hideKeys').checked = hideKeys;
  $('notesBack').textContent = noteFrom ? '← 문제로' : '← 홈';
  if (!era) {
    $('notesTitle').textContent = '핵심 노트';
    body.replaceChildren(el('p', '시대를 고르세요. 오른쪽 %는 그 시대 카드를 지금 기억하는 정도예요.', 'muted'), ...notes.map(n => {
      const its = n.topics.flatMap(t => t.items);
      const inEra = allCards().filter(c => c.era === n.era);
      const pct = Math.round(100 * L.counts(inEra, progress, day).recall / Math.max(1, inEra.length));
      const b = btn('', () => { history.pushState('era', ''); renderNotes(n.era); }, 'eraRow');
      b.append(el('span', n.era), el('span', `${its.length}개 항목 · ${pct}%`));
      return b;
    }));
    return show('notes');
  }
  const n = notes.find(x => x.era === era);
  $('notesTitle').textContent = `${era} 노트`;
  const parts = [btn('← 시대 목록', () => (history.state === 'era' ? history.back() : renderNotes())), el('p', n.flow.join(' → '), 'flow')];
  for (const t of n.topics) {
    parts.push(el('h2', t.title));
    for (const it of t.items) parts.push(noteItem(it, day, it.id === focusId));
  }
  body.replaceChildren(...parts);
  show('notes');
  if (focusId) document.getElementById('n-' + focusId)?.scrollIntoView({ block: 'start' });
  else scrollTo(0, 0);
}

function noteItem(it, day, open) {
  const d = el('details');
  d.id = 'n-' + it.id;
  d.open = open;
  const key = el('span', it.key, 'key');
  key.onclick = e => { if (hideKeys && !key.classList.contains('shown')) { e.preventDefault(); key.classList.add('shown'); } };
  const s = el('summary');
  s.append(el('b', it.head), key, el('span', `${Math.round(100 * L.itemRecall(it, progress, day))}%`, 'pct'));
  d.append(s, el('p', it.why));
  const pics = it.cards.map(id => cardById.get(id)).filter(c => c?.img).slice(0, 4);
  if (pics.length) d.append(thumbs(pics));
  const spot = it.cards.map(id => cardById.get(id)).find(c => c?.geo);
  if (spot && mapData) { const m = el('div', null, 'noteMap'); m.append(mapSvg(spot.geo)); d.append(m); }
  if (it.confuse) d.append(el('p', '⚠ ' + it.confuse));
  if (it.memo) d.append(el('p', '🔑 ' + it.memo));
  if (it.table) {
    const tb = el('table');
    it.table.forEach((row, i) => { const tr = el('tr'); row.forEach(x => tr.append(el(i ? 'td' : 'th', x))); tb.append(tr); });
    d.append(tb);
  }
  d.append(btn(`이 항목 카드 ${it.cards.length}장 풀기`, () => { noteIds = new Set(it.cards); enterMode('note'); }, 'primary'));
  return d;
}

function grade(card, g) {
  const isNew = !L.entry(progress[card.id]).s;
  progress[card.id] = L.review(progress[card.id], g, L.dayOf());
  save('progress', progress);
  if (isNew) { stats = { ...stats, date: L.today(), count: todayCount(), fresh: todayFresh() + 1 }; save('stats', stats); }
}

// What a wrong option actually belongs to, so every miss teaches the distinction.
function ownerOf(card, choice) {
  if (card.type === '시기' || card.type === '지도') return null;
  if (card.type === '사진') return allCards().find(c => c.type === '사진' && c.back === choice)?.period;
  const same = allCards().filter(c => c.back === choice && L.choiceClass(c) === L.choiceClass(card));
  return (same.find(c => c.era === card.era) ?? same[0])?.front;
}

function bumpStats() {
  stats = { ...stats, date: L.today(), count: todayCount() + 1, fresh: todayFresh() };
  save('stats', stats);
}

let orderQ = null;
const fmtYear = y => (y < 0 ? `기원전 ${-y}년` : `${y}년`);

function renderOrder() {
  busy = false;
  $('feedback').replaceChildren();
  const eras = selEras();
  orderQ = L.makeOrderQuestion(allCards(), { eras }) ?? L.makeOrderQuestion(allCards(), { eras, kind: 'first' });
  if (!orderQ) { $('homeMsg').textContent = '연도 정보가 있는 카드가 부족해요.'; return goHome(); }
  show('study');
  $('progressText').textContent = `${MODE_LABEL.order}${eraNote()} · ${doneCount}문제 풀이`;
  $('qTag').textContent = orderQ.kind === 'first' ? '순서' : '시기 사이';
  showMedia({});
  $('choices').className = 'choices';
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

function commit(correct) {
  if (!busy) return;
  L.submit(session, correct);
  renderQuestion();
}

$('dunno').onclick = () => (mode === 'order' ? onOrderAnswer(null) : mode === 'photo' ? onPhotoAnswer(null) : onAnswer(false));

const svgNS = 'http://www.w3.org/2000/svg';
function mapSvg(geo) {
  const svg = document.createElementNS(svgNS, 'svg');
  const [x, y] = L.project(...geo);
  // ponytail: fixed 600-unit (~6°) window around the dot — close enough to tell nearby sites apart, wide enough to orient
  const [w, h] = mapData.view.split(' ').slice(2).map(Number), S = 600;
  const x0 = Math.min(Math.max(x - S / 2, 0), w - S), y0 = Math.min(Math.max(y - S / 2, 0), h - S);
  svg.setAttribute('viewBox', `${x0} ${y0} ${S} ${S}`);
  const land = document.createElementNS(svgNS, 'path');
  land.setAttribute('d', mapData.d);
  land.setAttribute('class', 'map-land');
  const dot = document.createElementNS(svgNS, 'circle');
  dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 9);
  dot.setAttribute('class', 'map-dot');
  svg.append(land, dot);
  return svg;
}

function thumbs(cards) {
  const box = el('div', null, 'thumbs');
  for (const c of cards) { const im = el('img'); im.src = c.img; im.alt = c.back; im.loading = 'lazy'; box.append(im); }
  const wrap = el('div');
  wrap.append(box, el('p', '사진: ' + [...new Set(cards.map(c => c.credit))].join(' / '), 'tag'));
  return wrap;
}

// Photo / map for the current question; a photo that fails to load (offline) leaves the card answerable.
function showMedia(card) {
  const img = $('qImg');
  img.hidden = !card.img;
  $('qImgMsg').hidden = true;
  img.onerror = () => { img.hidden = true; $('qImgMsg').hidden = false; $('qImgMsg').textContent = '사진을 불러오지 못했어요(오프라인). 연결되면 다시 보여요.'; };
  img.removeAttribute('src');   // otherwise the previous photo stays painted until the next one loads
  if (card.img) img.src = card.img;
  $('qMap').hidden = !(card.geo && mapData);
  $('qMap').replaceChildren(...(card.geo && mapData ? [mapSvg(card.geo)] : []));
  $('qCredit').hidden = !card.credit;
  $('qCredit').textContent = card.credit ? '사진: ' + card.credit : '';
}

let photoQ = null;
function renderPhoto() {
  busy = false;
  $('feedback').replaceChildren();
  photoQ = L.makePhotoQuestion(allCards(), { eras: selEras() }) ?? L.makePhotoQuestion(allCards());
  if (!photoQ) { $('homeMsg').textContent = '사진 카드가 부족해요.'; return goHome(); }
  show('study');
  showMedia({});
  $('progressText').textContent = `${MODE_LABEL.photo} · ${doneCount}문제 풀이`;
  $('qTag').textContent = '사진 고르기';
  $('qFront').textContent = photoQ.prompt;
  $('known').hidden = true;
  $('flag').hidden = true;
  $('dunno').hidden = false;
  $('choices').className = 'choices photoGrid';
  $('choices').replaceChildren(...photoQ.options.map((c, i) => {
    const b = btn('', () => onPhotoAnswer(c, b));
    b.setAttribute('aria-label', `사진 ${i + 1}`);
    const im = el('img');
    im.alt = `사진 ${i + 1}`;
    im.onerror = () => { $('qImgMsg').hidden = false; $('qImgMsg').textContent = '사진을 불러오지 못했어요(오프라인). 관리 → 사진 모두 내려받기를 해 두면 오프라인에서도 보여요.'; };
    im.src = c.img;
    b.append(im);
    return b;
  }));
  scrollTo(0, 0);
}

function onPhotoAnswer(choice, button) {
  if (busy || !photoQ) return;
  busy = true;
  const ok = choice === photoQ.answer;
  button?.classList.add(ok ? 'ok' : 'bad');
  [...$('choices').children].forEach((b, i) => {
    const c = photoQ.options[i];
    b.append(el('small', `${c.back} · ${c.period}`), el('small', '사진: ' + c.credit, 'credit'));
    if (c === photoQ.answer) b.classList.add('ok');
  });
  $('feedback').replaceChildren(el('p', ok ? '정답!' : '오답', ok ? 'ok' : 'bad'), btn('다음', () => { doneCount++; renderPhoto(); }, 'primary'));
}

$('known').onclick = () => {
  if (busy || !session.queue[0]) return;
  const { card } = session.queue.shift();
  grade(card, 4);
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
  const done = allCards().filter(c => L.entry(progress[c.id]).s >= L.MATURE);
  $('doneSummary').textContent = `완료 카드 (${done.length})`;
  const q = $('doneFilter').value;
  const shown = done.filter(c => c.front.includes(q) || c.back.includes(q));
  $('doneList').replaceChildren(...cardList(shown, '처음부터', c => { progress[c.id] = { flagged: !!progress[c.id]?.flagged }; }));
  $('examDate').value = exam;
  show('manage');
}

$('doneFilter').oninput = renderManage;

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
  const data = { version: 3, progress, customCards: custom, stats, exam };
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
  progress = L.migrate(data.progress, L.dayOf());
  custom = data.customCards ?? custom;
  stats = data.stats ?? stats;
  if (typeof data.exam === 'string') exam = data.exam;
  save('progress', progress); save('customCards', custom); save('stats', stats); save('exam', exam);
  $('backupMsg').textContent = '불러오기 완료';
};

$('eraBoxes').replaceChildren(...['', ...L.ERAS].map(e => {
  const b = el('input');
  b.type = 'checkbox';
  b.value = e;
  b.checked = !e;
  const l = el('label');
  l.append(b, e || '전체');
  return l;
}));
$('eraBoxes').onchange = e => { setEras(e.target.value ? selEras() : []); $('homeMsg').textContent = ''; renderHome(); };
$('importEra').replaceChildren(...L.ERAS.map(e => new Option(e, e)));
$('importEra').value = '기타';
$('periodBtn').onclick = () => enterMode('period');
$('judgeBtn').onclick = () => enterMode('judge');
$('orderBtn').onclick = () => enterMode('order');
$('photoBtn').onclick = () => enterMode('photo');
$('dlPhotos').onclick = async () => {
  const imgs = allCards().filter(c => c.img).map(c => c.img);
  let done = 0, failed = 0;
  const one = async src => { try { const r = await fetch(src); if (!r.ok) failed++; } catch { failed++; } $('dlMsg').textContent = `${++done} / ${imgs.length}장 받는 중…`; };
  for (let i = 0; i < imgs.length; i += 4) await Promise.all(imgs.slice(i, i + 4).map(one));
  $('dlMsg').textContent = failed ? `${imgs.length - failed}장 받음, ${failed}장 실패 — 연결을 확인하고 다시 눌러 주세요.` : `완료 — ${imgs.length}장, 오프라인에서도 사진이 보여요.`;
};
$('start').onclick = () => enterMode('normal');
$('weakBtn').onclick = () => enterMode('weak');
$('examDate').onchange = e => { exam = e.target.value; save('exam', exam); };
$('quit').onclick = goHome;
$('toManage').onclick = renderManage;
$('back').onclick = goHome;
window.onpopstate = () => {
  if (noteFrom) { noteFrom = false; show('study'); }
  else if (history.state === 1 && !$('notes').hidden) renderNotes();   // era note -> era list
  else renderHome();
};
$('notesBack').onclick = () => (!noteFrom && history.state === 'era' ? history.go(-2) : goHome());
$('notesBtn').onclick = () => renderNotes();
$('hideKeys').onchange = e => {
  hideKeys = e.target.checked;
  save('hideKeys', hideKeys);
  $('notesBody').classList.toggle('hide', hideKeys);
  $('notesBody').querySelectorAll('.key.shown').forEach(k => k.classList.remove('shown'));
};
$('version').textContent = self.APP_VERSION ?? '';

try {
  const res = await fetch('cards.json');
  const data = res.ok ? await res.json() : null;
  if (!Array.isArray(data)) throw 0;
  baseCards = data;
} catch { warn('기본 카드를 불러오지 못했습니다.'); }
cardById = new Map(allCards().map(c => [c.id, c]));
$('photoBtn').hidden = !allCards().some(c => c.type === '사진');
renderHome();
try {
  const res = await fetch('notes.json');
  const data = res.ok ? await res.json() : null;
  if (!Array.isArray(data)) throw 0;
  notes = data;
  noteIdx = L.noteIndex(notes);
  $('notesBtn').hidden = false;
} catch {}
try {
  const res = await fetch('map.json');
  const data = res.ok ? await res.json() : null;
  if (typeof data?.d !== 'string') throw 0;
  mapData = data;
} catch {}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
navigator.storage?.persist?.().then(ok => {
  $('persistMsg').textContent = ok ? '기록 보호: 켜짐 — 브라우저가 학습 기록을 자동으로 지우지 않습니다.'
    : '기록 보호: 브라우저가 허용하지 않았습니다. 가끔 기록 백업을 해 두세요.';
}).catch(() => {});
