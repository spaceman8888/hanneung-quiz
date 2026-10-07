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
let doneCount = 0, busy = false, timer = null;
const cancelTimer = () => { clearTimeout(timer); timer = null; busy = false; };

const MODE_LABEL = { normal: '학습', weak: '자주 틀린 카드', check: '완료 카드 점검', period: '시기 맞히기' };
const SCHEDULED = new Set(['normal', 'period']);
const EMPTY_MSG = {
  period: '시기 문제를 모두 완료했어요!',
  normal: '모든 카드를 완료했어요! 완료 카드 점검으로 확인해 보세요.',
  weak: '자주 틀린 카드가 없어요.',
  check: '완료 카드가 없어요.',
};

const allCards = () => [...baseCards, ...custom];
const show = id => {
  ['home', 'study', 'manage'].forEach(s => { $(s).hidden = s !== id; });
  if (id !== 'home' && !history.state) history.pushState(1, '');
};
const goHome = () => (history.state ? history.back() : renderHome());
const todayCount = () => (stats.date === L.today() ? stats.count : 0);

function fillEras(sel, withAll) {
  sel.replaceChildren(...(withAll ? [new Option('전체 시대', '')] : []), ...L.ERAS.map(e => new Option(e, e)));
}

function renderHome() {
  cancelTimer();
  const era = $('eraSelect').value;
  const n = L.counts(allCards().filter(c => !era || c.era === era), progress, stats.tick);
  const pn = L.counts(allCards().filter(c => c.type === '시기' && (!era || c.era === era)), progress, stats.tick);
  $('periodBtn').textContent = `시기 맞히기 (${pn.fresh + pn.learning})`;
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
  const era = $('eraSelect').value || null;
  const batch = SCHEDULED.has(mode)
    ? L.buildBatch(allCards(), progress, { tick: stats.tick, era, type: mode === 'period' ? '시기' : null })
    : L.practiceBatch(allCards(), progress, { mode, skip: practiced, era });
  if (!batch.length) {
    $('homeMsg').textContent = !SCHEDULED.has(mode) && practiced.size ? `${MODE_LABEL[mode]}: 이번 라운드를 모두 마쳤어요.` : EMPTY_MSG[mode];
    return goHome();
  }
  batch.forEach(c => practiced.add(c.id));
  session = L.createSession(batch);
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
  $('qFront').textContent = card.front;
  $('flag').hidden = false;
  $('known').hidden = mode === 'check';
  $('flag').textContent = progress[card.id]?.flagged ? '신고 취소' : '신고';
  $('choices').replaceChildren(...L.pickChoices(card, allCards()).map(choice => {
    const b = btn(choice, () => onAnswer(choice === card.back, b));
    return b;
  }));
}

function onAnswer(correct, button) {
  if (busy) return;
  busy = true;
  const { card } = session.queue[0];
  button?.classList.add(correct ? 'ok' : 'bad');
  const p = document.createElement('p');
  p.className = correct ? 'ok' : 'bad';
  p.textContent = correct ? '정답!' : `정답: ${card.back}`;
  $('feedback').replaceChildren(p);
  if (correct) { const s = session; timer = setTimeout(() => { timer = null; if (s === session) commit(true); }, 500); return; }
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
    if (SCHEDULED.has(mode)) progress[id] = L.schedule(progress[id], { wrong }, stats.tick);
    else if (wrong) progress[id] = L.relapse(progress[id], stats.tick);
    save('progress', progress);
    bumpStats();
    doneCount++;
  }
  renderQuestion();
}

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
  const q = $('doneFilter').value;
  const shown = done.filter(c => c.front.includes(q) || c.back.includes(q));
  $('doneList').replaceChildren(...cardList(shown, '완료 취소', c => { progress[c.id] = L.reopen(progress[c.id], stats.tick); }));
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
$('eraSelect').onchange = () => { $('homeMsg').textContent = ''; renderHome(); };
$('periodBtn').onclick = () => enterMode('period');
$('start').onclick = () => enterMode('normal');
$('weakBtn').onclick = () => enterMode('weak');
$('checkBtn').onclick = () => enterMode('check');
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
