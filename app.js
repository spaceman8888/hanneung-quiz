import * as L from './logic.js';

const $ = id => document.getElementById(id);
const warn = msg => { $('warn').textContent = msg; };
const storage = (() => { try { return localStorage; } catch { return null; } })();

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const shapes = { progress: isObj, customCards: Array.isArray, stats: L.isStats, exam: v => typeof v === 'string' };

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
let session = null, mode = 'normal', practiced = new Set();
let doneCount = 0, busy = false, timer = null;
const cancelTimer = () => { clearTimeout(timer); timer = null; busy = false; };

const MODE_LABEL = { normal: '학습', weak: '자주 틀린 카드', period: '시기 맞히기', judge: '보기 판별', order: '순서 문제' };
const MODE_TYPE = { period: '시기', judge: '판별' };
const EMPTY_MSG = { normal: '카드가 없어요.', period: '시기 카드가 없어요.', judge: '보기 판별 카드가 없어요.', weak: '자주 틀린 카드가 없어요.' };

const allCards = () => [...baseCards, ...custom];
const show = id => {
  ['home', 'study', 'manage'].forEach(s => { $(s).hidden = s !== id; });
  if (id !== 'home' && !history.state) history.pushState(1, '');
};
const goHome = () => (history.state ? history.back() : renderHome());
const todayCount = () => (stats.date === L.today() ? stats.count : 0);
const todayFresh = () => (stats.date === L.today() ? stats.fresh ?? 0 : 0);
const examDay = () => (exam ? L.dayOf(new Date(exam + 'T00:00')) : null);

function fillEras(sel, withAll) {
  sel.replaceChildren(...(withAll ? [new Option('전체 시대', '')] : []), ...L.ERAS.map(e => new Option(e, e)));
}

function renderHome() {
  cancelTimer();
  const era = $('eraSelect').value;
  const day = L.dayOf();
  const inEra = allCards().filter(c => !era || c.era === era);
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
    const b = btn('', () => { $('eraSelect').value = e; enterMode('normal'); }, 'eraRow');
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
  practiced = new Set();
  $('homeMsg').textContent = '';
  doneCount = 0;
  startBatch();
}

function startBatch() {
  cancelTimer();
  if (mode === 'order') return renderOrder();
  const era = $('eraSelect').value || null;
  const day = L.dayOf();
  const batch = mode === 'weak'
    ? L.weakBatch(allCards(), progress, { day, skip: practiced, era })
    : L.buildBatch(allCards(), progress, { day, era, type: MODE_TYPE[mode] ?? null });
  if (!batch.length) {
    $('homeMsg').textContent = mode === 'weak' && practiced.size ? `${MODE_LABEL[mode]}: 이번 라운드를 모두 마쳤어요.` : EMPTY_MSG[mode];
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
  const era = $('eraSelect').value;
  $('progressText').textContent = `${MODE_LABEL[mode]}${era ? ' · ' + era : ''} · ${doneCount}장 풀이`;
  const item = session.queue[0];
  if (!item) return startBatch();
  const { card } = item;
  $('qTag').textContent = `${card.era} · ${card.type}`;
  $('qFront').textContent = card.type === '판별' ? `${card.front}에 대한 설명으로 옳은 것은?` : card.front;
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
  if (correct) { const s = session; timer = setTimeout(() => { timer = null; if (s === session) commit(true); }, 500); return; }
  $('feedback').append(btn('다음', () => commit(false), 'primary'));
}

function grade(card, g) {
  const isNew = !L.entry(progress[card.id]).s;
  progress[card.id] = L.review(progress[card.id], g, L.dayOf());
  save('progress', progress);
  if (isNew) { stats = { ...stats, date: L.today(), count: todayCount(), fresh: todayFresh() + 1 }; save('stats', stats); }
}

// What a wrong option actually belongs to, so every miss teaches the distinction.
function ownerOf(card, choice) {
  if (card.type === '시기') return null;
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

function commit(correct) {
  if (!busy) return;
  L.submit(session, correct);
  renderQuestion();
}

$('dunno').onclick = () => (mode === 'order' ? onOrderAnswer(null) : onAnswer(false));

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

fillEras($('eraSelect'), true);
fillEras($('importEra'), false);
$('importEra').value = '기타';
$('eraSelect').onchange = () => { $('homeMsg').textContent = ''; renderHome(); };
$('periodBtn').onclick = () => enterMode('period');
$('judgeBtn').onclick = () => enterMode('judge');
$('orderBtn').onclick = () => enterMode('order');
$('start').onclick = () => enterMode('normal');
$('weakBtn').onclick = () => enterMode('weak');
$('examDate').onchange = e => { exam = e.target.value; save('exam', exam); };
$('quit').onclick = goHome;
$('toManage').onclick = renderManage;
$('back').onclick = goHome;
window.onpopstate = renderHome;
$('version').textContent = self.APP_VERSION ?? '';

try {
  const res = await fetch('cards.json');
  const data = res.ok ? await res.json() : null;
  if (!Array.isArray(data)) throw 0;
  baseCards = data;
} catch { warn('기본 카드를 불러오지 못했습니다.'); }
renderHome();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
navigator.storage?.persist?.().then(ok => {
  $('persistMsg').textContent = ok ? '기록 보호: 켜짐 — 브라우저가 학습 기록을 자동으로 지우지 않습니다.'
    : '기록 보호: 브라우저가 허용하지 않았습니다. 가끔 기록 백업을 해 두세요.';
}).catch(() => {});
