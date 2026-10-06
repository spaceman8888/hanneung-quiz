import * as L from './logic.js';

const $ = id => document.getElementById(id);
const warn = msg => { $('warn').textContent = msg; };
const storage = (() => { try { return localStorage; } catch { return null; } })();

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const shapes = {
  progress: isObj,
  customCards: Array.isArray,
  settings: v => isObj(v) && Number.isInteger(v.newLimit) && v.newLimit >= 1 && v.newLimit <= 200,
  newToday: v => isObj(v) && typeof v.date === 'string' && Number.isFinite(v.count),
};

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
let settings = load('settings', { newLimit: 20 });
let newToday = load('newToday', { date: '', count: 0 });
let session = null, doneCount = 0, batchSize = 0, busy = false, timer = null;
const cancelTimer = () => { clearTimeout(timer); timer = null; busy = false; };

const allCards = () => [...baseCards, ...custom];
const show = id => ['home', 'study', 'manage'].forEach(s => { $(s).hidden = s !== id; });

function fillEras(sel, withAll) {
  sel.replaceChildren(...(withAll ? [new Option('전체 시대', '')] : []), ...L.ERAS.map(e => new Option(e, e)));
}

function renderHome() {
  cancelTimer();
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
  cancelTimer();
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
  if (correct) { const s = session; timer = setTimeout(() => { timer = null; if (s === session) commit(true); }, 500); return; }
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

try {
  const res = await fetch('cards.json');
  const data = res.ok ? await res.json() : null;
  if (!Array.isArray(data)) throw 0;
  baseCards = data;
} catch { warn('기본 카드를 불러오지 못했습니다.'); }
renderHome();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
