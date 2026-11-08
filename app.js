import * as L from './logic.js';

const $ = id => document.getElementById(id);
const warn = msg => { $('warn').textContent = msg; };
const storage = (() => { try { return localStorage; } catch { return null; } })();

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const shapes = { deep: v => typeof v === 'boolean', progress: isObj, customCards: Array.isArray, stats: L.isStats, exam: v => typeof v === 'string', hideKeys: v => typeof v === 'boolean', recallFirst: v => typeof v === 'boolean', myNotes: isObj,
  hours: L.isHours, mocks: v => Array.isArray(v) && v.every(L.isMock), streak: L.isStreak };

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
let recallFirst = load('recallFirst', false);
let deep = load('deep', false);   // study range: false = 기본 (cards past exams used) + my imported cards, true = 기본+심화
let myNotes = load('myNotes', {});   // card id -> the learner's own note
let hours = load('hours', { wd: 3, we: 6 });   // 시험 계획: study hours a weekday / a weekend day
let streak = load('streak', { last: '', n: 0 });   // 🔥 days in a row the day's goal was reached
let mocks = load('mocks', []);   // 실전 채점: { n: 회차, date, score (null = not given), wrong: question numbers }
let mergedIds = {};   // merged.json: merged duplicate card id -> the card kept
// Records of merged duplicate cards move to the kept card: the stronger memory wins, both notes are kept.
const mergeRecords = () => {
  progress = L.mergeIds(progress, mergedIds, (a, b) => (L.entry(b).s > L.entry(a).s ? b : a));
  myNotes = L.mergeIds(myNotes, mergedIds, (a, b) => a + '\n' + b);
};
let gichul = null, chainIdx = new Map();   // gichul.json { questions, sets }; 판별 card id -> 자료 lines
let sure = false, shownAt = null, chars = 0, reveal = null, asChain = false;   // current question: "이미 알아요" pressed, when options showed, asked 기출형
let notes = [], noteIdx = new Map(), noteIds = null, noteFrom = false;
let mapData = null, cardById = new Map();   // map.json { view, d }; id -> card
let session = null, mode = 'normal', practiced = new Set();
let lastStep = 0;   // 오늘 할 일 step the last batch was in (1 new · 2 missed reviews · 3 other reviews · 4 free)
let hits = new Map(), roundSel = null, lastRound = -1, roundNote = '';   // gichul hits per card; the round 풀기/오답만 is on; round 학습 시작 was in
let doneCount = 0, busy = false, timer = null;
const cancelTimer = () => { clearTimeout(timer); timer = null; busy = false; };

const MODE_LABEL = { normal: '학습', weak: '자주 틀린 카드', period: '시기 맞히기', judge: '보기 판별', order: '순서 문제', note: '노트 카드', photo: '사진 고르기', chain: '기출형', mock: '실전 오답' };
const MODE_TYPE = { period: '시기', judge: '판별' };
const EMPTY_MSG = { normal: '카드가 없어요.', period: '시기 카드가 없어요.', judge: '보기 판별 카드가 없어요.', weak: '자주 틀린 카드가 없어요.', note: '이 항목의 카드가 없어요.', chain: '기출형으로 낼 카드가 없어요.', round: '이 라운드에 지금 풀 카드가 없어요.', roundWeak: '이 라운드에 오답이 없어요.', mock: '이 실전의 오답 카드가 없어요.' };

const allCards = () => [...baseCards, ...custom];
const studyCards = () => (deep || !hits.size ? allCards() : [...baseCards.filter(c => hits.has(c.id)), ...custom]);
const show = id => {
  ['home', 'study', 'manage', 'notes', 'guide', 'rounds', 'planView', 'mock', 'cheer'].forEach(s => { $(s).hidden = s !== id; });
  if (id !== 'home' && !history.state) history.pushState(1, '');
};
const goHome = () => (history.state ? history.back() : renderHome());
// Today's counts: count (right answers), ans (all answers), fresh (new cards graded), rev (reviews graded), weakRev (of them,
// cards I had missed), cheered (goal reached). A new day starts from zero.
const st = () => (stats.date === L.today() ? stats : { date: L.today(), count: 0, fresh: 0 });
const bump = (...keys) => { const s = { ...st() }; for (const k of keys) s[k] = (s[k] ?? 0) + 1; stats = s; save('stats', stats); };
const todayCount = () => st().count;
const todayFresh = () => st().fresh ?? 0;
const yesterday = () => L.today(new Date(Date.now() - 864e5));
const examDay = () => (exam ? L.dayOf(new Date(exam + 'T00:00')) : null);
const byIds = () => mode === 'note' || mode === 'mock';   // a fixed set of cards (note item, 실전 misses): no era filter
const inFinal = (day = L.dayOf()) => { const ex = examDay(); return ex !== null && day >= ex - 7 && day < ex; };   // 마무리 주간
const pastExams = () => [...new Set((gichul?.questions ?? []).map(q => q.n))];
const byDate = list => [...list].sort((a, b) => b.date.localeCompare(a.date));
const fmtDay = d => { const t = new Date(d * 864e5); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}(${'일월화수목금토'[L.weekDay(d)]})`; };
const fmtHours = min => `${+(min / 60).toFixed(1)}시간`;
const fmtDate = date => date.slice(5).split('-').map(Number).join('/');   // '2026-11-08' -> '11/8'

// The plan from today. New cards are counted as at the start of today, so today's target holds while I study.
function planNow() {
  const ex = examDay(), day = L.dayOf();
  if (ex === null || ex < day) return null;
  const cs = studyCards(), fresh = L.counts(cs, progress, day).fresh;
  const left = cs.filter(c => hits.has(c.id) && !L.entry(progress[c.id]).s).length;   // 기본 first; 심화 after
  const start = (left || fresh) + todayFresh();
  const p = L.studyPlan({ day, exam: ex, hours, fresh: start });
  L.assignMocks(p.days, new Set(mocks.filter(m => m.date !== L.today()).map(m => m.n)), pastExams());
  return { ...p, start, basic: !!left };
}

// The round the k-th new card (most-tested first) falls in.
function roundAt(k) {
  const rs = L.rounds(studyCards(), hits);
  let n = todayFresh();
  for (let i = 0; i < rs.length; i++) if ((n += rs[i].cards.filter(c => !L.entry(progress[c.id]).s).length) >= k) return i + 1;
  return rs.length;
}

function shortNote(p) {
  if (p.fit >= p.start) return '';
  const all = p.weHours === null ? '' : p.weHours <= 14 ? ` 모두 배우려면 주말 하루 약 ${Math.ceil(p.weHours * 2) / 2}시간이 필요해요.` : ' 모두 배우려면 평일 시간도 늘려야 해요.';
  return `⚠ 이 시간이면 시험 8일 전까지 새 카드 ${p.start}장 중 약 ${p.fit}장(${roundAt(p.fit)}라운드까지)을 배울 수 있어요. 기출에 자주 나온 카드부터라 그만큼이 우선이에요.${all}`;
}

const STEP = ['', '1. 새 카드', '2. 틀린 카드 복습', '3. 나머지 복습', '자유 학습'];

// Today on home: the plan's day, what is left in each step, the step the big button is on, the day's progress.
function todayState() {
  const p = planNow();
  if (!p) return null;
  const day = L.dayOf(), t = p.days[0], s = st(), e = c => L.entry(progress[c.id]);
  const cs = studyCards(), due = cs.filter(c => e(c).s && e(c).due <= day);
  const weakDue = due.filter(c => e(c).miss > 0 && e(c).s < L.MATURE).length, restDue = due.length - weakDue;
  const newDone = s.fresh ?? 0, newLeft = t.phase === 'learn' ? Math.max(0, t.fresh - newDone) : 0;
  const g = L.dayGoal({ phase: t.phase, target: t.fresh, newDone, weakDue, weakDone: s.weakRev ?? 0, revDone: s.rev ?? 0,
    min: t.min, seen: cs.filter(c => e(c).s).length });
  const step = t.phase !== 'learn' ? 0 : newLeft ? 1 : weakDue ? 2 : restDue ? 3 : 4;
  return { p, t, newDone, newLeft, weakDue, restDue, step, ...g, pct: g.goal ? Math.min(100, Math.floor(100 * g.done / g.goal)) : 100 };
}

// The day's goal reached for the first time (after answering something today): 🔥 +1. True only then.
function reachGoal(ts) {
  if (!ts || ts.t.phase === 'exam' || ts.pct < 100 || !st().ans || st().cheered) return false;
  stats = { ...st(), cheered: true };
  save('stats', stats);
  streak = L.bumpStreak(streak, L.today(), yesterday());
  save('streak', streak);
  return true;
}

const newCount = ts => (ts.newDone > ts.t.fresh ? `${ts.t.fresh} / ${ts.t.fresh} +${ts.newDone - ts.t.fresh}` : `${ts.newDone} / ${ts.t.fresh}`);
const stepText = ts => (ts.step === 1 ? `1. 새 카드 ${newCount(ts)}장` : ts.step === 2 ? `2. 틀린 카드 복습 ${ts.weakDue}장 남음`
  : ts.step === 3 ? `3. 나머지 복습 ${ts.restDue}장 · 여유 되면` : '오늘 할 일 끝! 더 풀면 내일이 가벼워져요');

function renderToday(ts) {
  const list = $('todayList');
  $('todayWarn').hidden = true;
  if (!ts) {
    const li = el('li', null);
    li.append(el('b', examDay() === null ? '시험일과 하루 공부 시간을 정하면 오늘 할 일을 짜 드려요.' : '시험일이 지났어요. 다음 시험일을 정해 주세요.'), btn('시험 계획', renderPlan));
    return list.replaceChildren(li);
  }
  const { t } = ts, m = mocks.find(x => x.date === L.today()), items = [];   // [label, right side, class, button]
  if (t.phase === 'exam') items.push(['오늘 시험! 10:00 시작', '신분증 · 수험표 · 사인펜']);
  if (t.phase === 'learn') items.push(
    ['1. 새 카드', newCount(ts), ts.newLeft ? '' : 'done'],
    ['2. 틀린 카드 복습', ts.weakDue ? `${ts.weakDue}장` : '끝', ts.weakDue ? '' : 'done'],
    ['3. 나머지 복습', ts.restDue ? `${ts.restDue}장 · 여유 되면` : '끝', ts.restDue ? 'opt' : 'done']);
  if (t.phase === 'final' || t.phase === 'eve') items.push([t.phase === 'eve' ? '가볍게 1시간 복습' : '마무리 학습', `${ts.done} / ${ts.goal}`, ts.done >= ts.goal ? 'done' : '']);
  if (t.phase === 'eve') items.push(['수험표 · 신분증 · 사인펜 챙기고 일찍 자기', '', 'opt']);
  if (m) items.push([`실전 ${m.n}회`, `${m.score ?? '-'}점`, 'done']);
  else if (t.mock) items.push([`실전 기출 ${t.n ?? ''}회`, '책이 있으면', 'opt', btn('채점하기', renderMock)]);
  list.replaceChildren(...items.map(([label, right, cls, b]) => {
    const li = el('li', null, cls || null), name = el('b', (cls === 'done' ? '✓ ' : '') + label);
    if (label.startsWith('실전') && !m) name.append(el('span', '선택', 'tag'));
    li.append(name, el('span', right));
    if (b) li.append(b);
    return li;
  }));
  const warnText = t.phase === 'learn' ? shortNote(ts.p) : '';
  $('todayWarn').hidden = !warnText;
  $('todayWarn').textContent = warnText;
}

function renderCheer() {
  const s = st();
  $('cheerStreak').textContent = `🔥 ${L.streakNow(streak, L.today(), yesterday())}일 연속 목표 달성`;
  $('cheerStats').textContent = `오늘 ${s.ans ?? 0}문제 · 정답률 ${Math.round(100 * s.count / Math.max(1, s.ans ?? 0))}% · 새 카드 ${s.fresh ?? 0}장 · 복습 ${s.rev ?? 0}장`;
  show('cheer');
}

function renderPlan() {
  $('examDate').value = exam;
  $('examPreset').hidden = exam === L.NEXT_EXAM.date;
  $('examPreset').textContent = `제${L.NEXT_EXAM.n}회 ${fmtDay(L.dayOf(new Date(L.NEXT_EXAM.date + 'T00:00')))}로 정하기`;
  $('hoursWd').value = hours.wd;
  $('hoursWe').value = hours.we;
  const p = planNow();
  $('planTable').replaceChildren();
  if (!p) { $('planSum').textContent = exam ? '시험일이 지났어요. 다음 시험일을 정해 주세요.' : '시험일을 정하면 날마다 할 일을 나눠 드려요.'; return show('planView'); }
  const lastLearn = p.days.filter(x => x.phase === 'learn').at(-1);
  $('planSum').textContent = (!p.start ? '새 카드를 모두 배웠어요. 복습과 실전으로 굳혀요.'
    : !lastLearn ? '마무리 주간이에요. 새 카드는 더 배우지 않아요.'
    : shortNote(p) || `${p.basic ? '기본 ' : ''}새 카드 ${p.start}장을 ${fmtDay(lastLearn.day)}까지 모두 배워요.`) + ` 실전 ${p.days.filter(x => x.mock).length}회.`;
  const head = el('tr');
  head.append(el('th', '날짜'), el('th', '시간'), el('th', '할 일'));
  const what = x => (x.phase === 'exam' ? '시험 10:00' : x.phase === 'eve' ? '가볍게 1시간 · 준비물 · 일찍 자기'
    : [x.phase === 'learn' ? `새 카드 ${x.fresh}장` : '마무리 복습', x.mock && `실전 ${x.n ?? ''}회`].filter(Boolean).join(' · '));
  $('planTable').replaceChildren(head, ...p.days.map((x, i) => {
    const tr = el('tr', null, [i ? '' : 'cur', x.phase === 'learn' ? '' : 'final'].join(' ').trim() || null);
    tr.append(el('td', fmtDay(x.day)), el('td', x.phase === 'exam' ? '' : x.phase === 'eve' ? '1시간' : fmtHours(x.min)), el('td', what(x)));
    return tr;
  }));
  show('planView');
}

function renderMock() {
  $('mockN').value = planNow()?.days.find(x => x.mock && x.n)?.n ?? L.NEXT_EXAM.n - 1;
  $('mockScore').value = '';
  $('mockMsg').textContent = '';
  $('mockGrid').replaceChildren(...Array.from({ length: 50 }, (_, i) => {
    const b = btn(String(i + 1), () => b.setAttribute('aria-pressed', String(b.classList.toggle('on'))));
    b.setAttribute('aria-pressed', 'false');
    return b;
  }));
  renderMockList();
  show('mock');
}

function renderMockList(open = null) {
  $('mockList').replaceChildren(...(mocks.length ? byDate(mocks).map(m => {
    const { qs, ids } = L.mockMisses(gichul?.questions ?? [], m.n, m.wrong);
    const d = el('div', null, 'roundRow');
    d.append(el('b', `${m.n}회 · ${m.score ?? '-'}점`), el('span', ` ${fmtDate(m.date)} · 틀린 ${m.wrong.length}문항`, 'muted'));
    if (qs.length) {
      const det = el('details');
      det.open = m === open;
      det.append(el('summary', '틀린 문항이 물은 것'), el('p', qs.map(q => `${q.q}번 ${q.s}`).join(' · ')));
      d.append(det);
    }
    const row = el('div', null, 'row'), go = btn(`오답 카드 ${ids.size}장 풀기`, () => { noteIds = ids; enterMode('mock'); });
    go.disabled = !ids.size;
    row.append(go, btn('삭제', () => {
      if (!confirm(`${m.n}회 기록을 지울까요?`)) return;
      mocks = mocks.filter(x => x !== m);
      save('mocks', mocks);
      renderMockList();
    }, 'small'));
    d.append(row);
    return d;
  }) : [el('p', '아직 없어요.', 'muted')]));
}

$('mockSave').onclick = () => {
  const n = Number($('mockN').value), raw = $('mockScore').value.trim(), score = raw === '' ? null : Number(raw);
  const msg = t => { $('mockMsg').textContent = t; };
  if (!Number.isInteger(n) || n < 1 || n > 200) return msg('회차를 숫자로 적어 주세요.');
  if (score !== null && !(Number.isInteger(score) && score >= 0 && score <= 100)) return msg('점수는 0~100 사이 정수로 적어 주세요.');
  const wrong = [...$('mockGrid').children].filter(b => b.classList.contains('on')).map(b => Number(b.textContent));
  const rec = { n, date: L.today(), score, wrong };
  mocks = [rec, ...mocks.filter(m => !(m.n === n && m.date === rec.date))];   // the same exam twice in a day: the later entry wins
  save('mocks', mocks);
  renderMock();
  renderMockList(rec);
  const { ids } = L.mockMisses(gichul?.questions ?? [], n, wrong);
  msg('저장했어요. ' + (ids.size ? `틀린 문항이 물은 것을 확인하고, 그 카드 ${ids.size}장을 풀어 보세요.`
    : !wrong.length ? '' : pastExams().includes(n) ? '' : `${n}회는 앱에 문항 자료가 없어 점수만 기록했어요. 틀린 문항의 (가)를 핵심 노트에서 찾아 ✏️ 메모로 남겨 두세요.`)
    + (score !== null && score < 80 ? ' 1급(80점)까지 ' + (80 - score) + '점 남았어요.' : score !== null ? ' 1급 점수예요!' : ''));
};

// Home era filter: checkboxes, '' = 전체 (checked when no era is).
const eraBoxes = () => [...$('eraBoxes').querySelectorAll('input')];
const selEras = () => eraBoxes().filter(b => b.checked && b.value).map(b => b.value);
const setEras = list => eraBoxes().forEach(b => { b.checked = b.value ? list.includes(b.value) : !list.length; });
const modeLabel = () => (mode === 'round' ? roundSel.name : mode === 'roundWeak' ? roundSel.name + ' 오답' : MODE_LABEL[mode]);
// Rounds of the selected eras (전체 = all eras mixed): most-tested 100 cards each.
const eraRounds = () => L.rounds(studyCards().filter(c => L.inEras(c, selEras())), hits);
const roundName = (rs, i) => `${rs[i].gichul ? '기본' : '심화'} 라운드 ${i + 1}`;
const eraNote = () => { const e = selEras(); return !e.length ? '' : ' · ' + (e.length > 2 ? `시대 ${e.length}개` : e.join(', ')); };

function renderHome() {
  cancelTimer();
  const ts = todayState(), ex = examDay();
  reachGoal(ts);
  const final = ts && (ts.t.phase === 'final' || ts.t.phase === 'eve'), started = (st().ans ?? 0) > 0;
  $('dday').textContent = !ts ? '한능검 암기' : ts.t.phase === 'exam' ? 'D-DAY' : `D-${ex - L.dayOf()}`;
  $('dayInfo').textContent = ts ? `${fmtDay(L.dayOf())} · ${ts.t.phase === 'exam' ? '시험 날' : `오늘 ${fmtHours(ts.t.phase === 'eve' ? 60 : ts.t.min)}`}` : '';
  $('pctBar').hidden = !ts || ts.t.phase === 'exam';
  $('pctBar').value = ts?.pct ?? 0;
  $('startLabel').textContent = !ts || ts.t.phase === 'exam' ? '학습 시작' : started ? '이어서 하기' : final ? '마무리 학습 시작' : '오늘 공부 시작';
  $('startSub').textContent = !ts ? '' : ts.t.phase === 'learn' ? stepText(ts) : final ? `시험날 잊기 쉬운 카드부터 · ${ts.done} / ${ts.goal}장` : '';
  renderToday(ts);
  const sn = L.streakNow(streak, L.today(), yesterday());
  $('streak').textContent = !ts ? '' : st().cheered ? `🔥 ${sn}일 연속 목표 달성` : sn ? `🔥 ${sn}일 연속 · 오늘 채우면 ${sn + 1}일` : '🔥 오늘 목표를 채우면 연속 기록이 시작돼요';
  const eras = selEras();
  $('eraSum').textContent = '시대: ' + (eras.join(', ') || '전체');
  const day = L.dayOf();
  $('scopeRow').hidden = !hits.size;
  for (const [id, on, label, k] of [['scopeBasic', !deep, '기본', `기출에 나온 ${(baseCards.filter(c => hits.has(c.id)).length + custom.length).toLocaleString()}장`], ['scopeAll', deep, '기본+심화', `${allCards().length.toLocaleString()}장`]]) {
    $(id).replaceChildren(el('b', label), el('small', k));
    $(id).classList.toggle('on', on);
    $(id).setAttribute('aria-pressed', String(on));
  }
  const inEra = studyCards().filter(c => L.inEras(c, eras));
  const n = L.counts(inEra, progress, day);
  const pn = L.counts(inEra.filter(c => c.type === '시기'), progress, day);
  $('periodBtn').textContent = `시기 맞히기 (${pn.due + pn.fresh})`;
  const jn = L.counts(inEra.filter(c => c.type === '판별'), progress, day);
  $('judgeBtn').textContent = `보기 판별 (${jn.due + jn.fresh})`;
  const cn = L.counts(inEra.filter(c => chainIdx.has(c.id)), progress, day);
  $('chainBtn').textContent = `기출형 문제 (${cn.due + cn.fresh})`;
  $('chainBtn').hidden = !chainIdx.size;
  $('score').hidden = !gichul;
  const e = gichul ? L.examScore(gichul.questions, progress, day) : null;
  if (e) {
    const m = byDate(mocks).find(x => x.score !== null);
    $('score').textContent = `기출 기준 예상 점수 약 ${Math.round(e.score)}점 (추정 · 1급 80점)`
      + (m ? `\n실전 최근: ${m.n}회 ${m.score}점 (${fmtDate(m.date)})` : '')
      + (e.pts >= 0.5 ? `\n점수 올리기 좋은 시대: ${e.era} +${Math.round(e.pts)}점` : '');
  }
  $('pctText').textContent = [!ts || ts.t.phase === 'exam' ? '' : st().cheered ? '🎉 오늘 목표 달성!' : `오늘 ${ts.pct}% 완료`,
    e ? `예상 점수 약 ${Math.round(e.score)}점` : ''].filter(Boolean).join(' · ');
  $('dueCount').textContent = n.due;
  $('newCount').textContent = n.fresh;
  $('doneCount').textContent = n.done;
  $('todayCount').textContent = todayCount();
  $('weakBtn').textContent = `자주 틀린 카드 (${n.weak})`;
  const rs = eraRounds(), cur = L.currentRound(rs, progress);
  const rb = $('roundBtn'), bar = el('progress');
  if (cur < 0) rb.replaceChildren(el('span', `라운드 ${rs.length}개를 모두 풀었어요`), el('span', `오답 ${n.weak} ›`));
  else {
    const r = rs[cur], k = L.counts(r.cards, progress, day);
    bar.max = r.cards.length;
    bar.value = r.cards.length - k.fresh;
    rb.replaceChildren(el('span', `${roundName(rs, cur)} / ${r.gichul ? rs.filter(x => x.gichul).length : rs.length}`),
      el('span', `${bar.value}/${bar.max} · 오답 ${k.weak} ›`), bar);
  }
  $('recall').textContent = `지금 기억하는 카드: 약 ${Math.round(100 * n.recall / Math.max(1, inEra.length))}%`;
  $('eraTable').replaceChildren(...L.ERAS.map(e => {
    const inEra = studyCards().filter(c => c.era === e);
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

function renderRounds() {
  const day = L.dayOf(), rs = eraRounds(), cur = L.currentRound(rs, progress);
  $('roundsNote').textContent = `시대: ${selEras().join(', ') || '전체'} · 기출에 자주 나온 카드부터 ${L.ROUND_SIZE}장 안팎씩 묶었어요. 틀린 카드는 다음 날부터 복습으로 따라와요.`;
  const rows = rs.map((r, i) => {
    const k = L.counts(r.cards, progress, day), d = el('div', null, i === cur ? 'roundRow cur' : 'roundRow');
    const bar = el('progress');
    bar.max = r.cards.length;
    bar.value = r.cards.length - k.fresh;
    const go = (m, label, n) => {
      const b = btn(`${label} (${n})`, () => { roundSel = { name: roundName(rs, i), cards: r.cards }; enterMode(m); });
      b.disabled = !n;
      return b;
    };
    const btns = el('div', null, 'row');
    btns.append(go('round', '풀기', k.due + k.fresh), go('roundWeak', '오답만', k.weak));
    d.append(el('b', roundName(rs, i)), el('span', ` ${bar.value}/${bar.max} 풀이 · 완료 ${k.done} · 오답 ${k.weak}`, 'muted'), bar, btns);
    return d;
  });
  const deep = el('details');
  deep.open = cur >= 0 && !rs[cur].gichul;
  deep.append(el('summary', '심화 라운드 — 기출(57~79회)에 안 나온 카드'), ...rows.filter((_, i) => !rs[i].gichul));
  $('roundsBody').replaceChildren(...rows.filter((_, i) => rs[i].gichul), ...(deep.children.length > 1 ? [deep] : []));
  show('rounds');
  (rows[cur] ?? $('rounds')).scrollIntoView({ block: 'center' });
}

function enterMode(m) {
  mode = m;
  noteFrom = false;   // a new session replaces the one a note was opened from
  practiced = new Set();
  lastRound = -1;
  lastStep = 0;
  $('homeMsg').textContent = '';
  doneCount = 0;
  session = null;   // misses waiting from another mode don't follow into this one
  startBatch();
}

function startBatch() {
  cancelTimer();
  if (mode === 'order') return renderOrder();
  if (mode === 'photo') return renderPhoto();
  const eras = selEras();
  const day = L.dayOf();
  let round = null;
  $('roundMsg').textContent = roundNote = '';
  const final = mode === 'normal' && inFinal(day), ts = mode === 'normal' ? todayState() : null;
  if (session && reachGoal(ts)) return renderCheer();   // the goal just reached: celebrate between batches
  const msgs = [];
  if (final) roundNote = ' · 마무리';
  else if (mode === 'normal') {
    const rs = eraRounds(), cur = L.currentRound(rs, progress);
    if (lastRound >= 0 && cur !== lastRound) msgs.push(`🎉 ${roundName(rs, lastRound)} 완료!`);
    lastRound = cur;
    if (cur >= 0) { round = new Set(rs[cur].cards.map(c => c.id)); roundNote = ` · ${roundName(rs, cur)}`; }
    if (ts?.step) {
      if (lastStep && ts.step > lastStep) msgs.push(`✓ ${STEP[lastStep]} 끝! 이제 ${STEP[ts.step]}`);
      lastStep = ts.step;
      roundNote = ` · ${STEP[ts.step]}`;
    }
  }
  $('roundMsg').textContent = msgs.join(' ');
  const hold = new Set(session?.later.map(x => x.card.id) ?? []);   // misses waiting their 20 questions
  const skip = new Set([...practiced, ...hold]);
  const newFirst = final ? 0 : ts?.newLeft ?? 0;   // today's new cards before reviews
  const batch = final ? L.finalBatch(studyCards(), progress, { day, exam: examDay(), hits, eras, skip })
    : mode === 'round' ? L.buildBatch(roundSel.cards.filter(c => L.entry(progress[c.id]).due <= day), progress, { day, eras, skip: hold })   // due + new only
    : mode === 'roundWeak' ? L.weakBatch(roundSel.cards, progress, { day, skip })
    : mode === 'weak' ? L.weakBatch(studyCards(), progress, { day, skip, eras })
    : byIds() ? L.buildBatch(allCards(), progress, { day, ids: noteIds, skip })
    : mode === 'chain' ? L.buildBatch(studyCards(), progress, { day, eras, ids: chainIdx, skip: hold })   // a Map has .has()
    : L.buildBatch(studyCards(), progress, { day, eras, type: MODE_TYPE[mode] ?? null, round, newFirst, skip: hold });
  if (!batch.length && !hold.size) {
    $('homeMsg').textContent = final ? (practiced.size ? '마무리: 오늘 볼 카드를 모두 풀었어요. 자주 틀린 카드나 기출형 문제를 해 보세요.' : '마무리할 카드가 없어요. 오늘 푼 카드는 내일 다시 나와요.')
      : ['weak', 'note', 'round', 'roundWeak', 'mock'].includes(mode) && practiced.size ? `${modeLabel()}: 한 바퀴 모두 풀었어요.` : EMPTY_MSG[mode];
    return goHome();
  }
  batch.forEach(c => practiced.add(c.id));
  session = L.createSession(batch, session);
  if (!batch.length) session.queue.push(session.later.shift());   // nothing else left: the waiting misses now, 20 or not
  show('study');
  renderQuestion();
}

function renderQuestion() {
  busy = false;
  $('feedback').replaceChildren();
  $('progressText').textContent = `${modeLabel()}${byIds() ? '' : eraNote()}${roundNote} · ${doneCount}장 풀이`;
  const item = L.current(session);
  if (!item) return startBatch();
  const { card } = item;
  progress[card.id] = L.logShown(progress[card.id]);
  save('progress', progress);
  showMedia(card);
  asChain = mode === 'chain' || (!byIds() && L.chainStyle(progress[card.id], chainIdx.has(card.id)));
  const lines = asChain ? chainIdx.get(card.id) : null;
  $('qTag').textContent = `${card.era} · ${lines ? '기출형' : card.type}`;
  $('qClues').hidden = !lines;
  $('qClues').textContent = lines ? '(가) ' + lines[Math.floor(Math.random() * lines.length)] : '';
  $('qFront').textContent = lines ? '(가)에 대한 설명으로 옳은 것은?' : card.type === '판별' ? `${card.front}에 대한 설명으로 옳은 것은?` : card.front;
  $('choices').className = 'choices';
  $('flag').hidden = false;
  $('known').hidden = session.saved.has(card.id);   // a re-asked card is already graded
  $('dunno').hidden = false;
  $('flag').textContent = progress[card.id]?.flagged ? '신고 취소' : '신고';
  sure = false;
  $('known').classList.remove('on');
  $('known').setAttribute('aria-pressed', 'false');
  const opts = L.pickChoices(card, allCards());
  const buttons = opts.map(choice => {
    const b = btn(choice, () => onAnswer(choice === card.back, b));
    b.dataset.choice = choice;
    return b;
  });
  chars = ($('qClues').textContent + $('qFront').textContent + opts.join('')).length;
  shownAt = null;
  reveal = () => { reveal = null; $('choices').replaceChildren(...buttons); shownAt = document.hidden ? null : Date.now(); };
  if (recallFirst) $('choices').replaceChildren(btn('떠올렸으면 보기 열기', () => { reveal?.(); $('choices').firstChild?.focus(); }, 'primary'));
  else reveal();
}

function onAnswer(correct, button) {
  if (busy || !session?.queue[0]) return;
  busy = true;
  const { card } = session.queue[0];
  const id = card.id;
  let g = null;
  progress[id] = L.logAnswer(progress[id], correct);   // every answer, retries too; grade() below takes the first only
  if (!session.saved.has(id)) {
    g = L.answerGrade(correct, { sure, ms: shownAt ? Date.now() - shownAt : 0, chars });
    grade(card, g);
    session.saved.add(id);
  } else save('progress', progress);
  reveal?.();   // 모르겠어요 before opening the options: still show them, marked
  bump('ans', ...(correct ? ['count'] : []));
  if (correct) doneCount++;
  button?.classList.add(correct ? 'ok' : 'bad');
  for (const b of $('choices').children) {
    if (b.dataset.choice === card.back) { b.classList.add('ok'); continue; }
    const who = ownerOf(card, b.dataset.choice);
    if (who) { const s = document.createElement('small'); s.textContent = who; b.append(s); }
  }
  const p = document.createElement('p');
  p.className = correct ? 'ok' : 'bad';
  p.textContent = !correct ? `정답: ${card.back}` : g === 2 ? '정답! · 고민한 카드라 조금 일찍 다시 나와요' : '정답!';
  const log = progress[id];
  $('feedback').replaceChildren(p, el('p', `이 카드: ${log.shown ?? 1}번 나옴 · 맞힘 ${log.right ?? 0} · 틀림 ${log.wrong ?? 0}`
    + (correct ? '' : ` · 다른 문제 ${L.RETRY_GAP}개 뒤에 다시 나와요`), 'muted'));
  if (asChain) $('feedback').append(el('p', `(가) ${card.front}`));
  if (!correct && sure && button) $('feedback').append(el('p', '확실하다고 했는데 틀렸어요. 이런 오답은 지금 바로잡으면 오래 기억돼요.', 'muted'));
  const help = el('div');
  let assocOpen = false;
  const drawHelp = () => help.replaceChildren(...[
    ...(correct ? [myNotes[id] && { k: 'mine', text: '✏️ ' + myNotes[id] }]
      : L.missLines(card, { chose: button?.dataset.choice, cards: allCards(), item: noteIdx.get(id), lapses: L.entry(progress[id]).lapses, mine: myNotes[id] })),
    assocOpen && { k: 'assoc', text: '🧠 ' + card.assoc },
  ].filter(Boolean).map(l => el('p', l.text, 'tip ' + l.k)));
  drawHelp();
  $('feedback').append(help);
  if (card.note) $('feedback').append(el('p', card.note, 'muted'));
  if (correct && !card.note && !myNotes[id] && !asChain) { const s = session; timer = setTimeout(() => { timer = null; if (s === session) commit(true); }, g === 2 ? 1500 : 500); return; }
  $('feedback').append(btn('다음', () => commit(correct), 'primary'));
  if (!correct && card.assoc) { const b = btn('🧠 연상으로 외우기', () => { assocOpen = true; drawHelp(); b.remove(); }); $('feedback').append(b); }
  const editor = el('div', null, 'myNote');
  const memoBtn = btn(myNotes[id] ? '✏️ 메모 고치기' : '✏️ 메모', () => {
    const ta = el('textarea');
    ta.value = myNotes[id] ?? '';
    ta.maxLength = 300;
    ta.placeholder = '나만의 연상, 헷갈린 이유, 외울 말…';
    ta.setAttribute('aria-label', '이 문제에 대한 내 메모');
    editor.replaceChildren(ta, btn('저장', () => {
      myNotes = L.setMyNote(myNotes, id, ta.value);
      save('myNotes', myNotes);
      memoBtn.textContent = myNotes[id] ? '✏️ 메모 고치기' : '✏️ 메모';
      editor.replaceChildren();
      drawHelp();
    }), btn('취소', () => editor.replaceChildren()));
    ta.focus();
  });
  $('feedback').append(memoBtn);
  const item = noteIdx.get(id);
  if (!correct && item) $('feedback').append(btn('노트 보기', () => { noteFrom = true; history.pushState(2, ''); renderNotes(card.era, item.id); }));
  $('feedback').append(editor);
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
  const p = L.entry(progress[card.id]);
  progress[card.id] = L.review(progress[card.id], g, L.dayOf());
  save('progress', progress);
  bump(...(!p.s ? ['fresh'] : p.miss > 0 && p.s < L.MATURE ? ['rev', 'weakRev'] : ['rev']));
}

// What a wrong option actually belongs to, so every miss teaches the distinction.
function ownerOf(card, choice) {
  const o = L.ownerCard(card, choice, allCards());
  return card.type === '사진' ? o?.period : o?.front;
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
  $('qClues').hidden = true;   // only 기출형 shows 자료; renderQuestion sets it after this
  $('qClues').textContent = '';
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

// "이미 알아요" counts only when the answer then proves it: right = Easy, wrong = Again.
$('known').onclick = () => {
  if (busy || !session.queue[0]) return;
  sure = !sure;
  $('known').classList.toggle('on', sure);
  $('known').setAttribute('aria-pressed', String(sure));
  if (sure) reveal?.();
  $('feedback').replaceChildren(...(sure ? [el('p', '답을 골라 확인해요. 맞히면 오래 뒤에, 틀리면 곧 다시 나와요.', 'muted')] : []));
};
document.addEventListener('visibilitychange', () => { if (document.hidden) shownAt = null; });   // time away isn't thinking time

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
  const logged = allCards().filter(c => progress[c.id]?.shown);
  const sum = k => logged.reduce((n, c) => n + (progress[c.id][k] ?? 0), 0), right = sum('right'), wrong = sum('wrong');
  $('logSum').textContent = logged.length ? `${logged.length}장이 ${sum('shown')}번 나왔어요 · 맞힘 ${right} · 틀림 ${wrong} · 정답률 ${Math.round(100 * right / Math.max(1, right + wrong))}%` : '아직 기록이 없어요.';
  $('logList').replaceChildren(...logged.filter(c => progress[c.id].wrong).sort((a, b) => progress[b.id].wrong - progress[a.id].wrong || progress[b.id].shown - progress[a.id].shown)
    .slice(0, 100).map(c => { const x = progress[c.id]; return el('li', `${c.front} → ${c.back} · ${x.shown}번 나옴 · 맞힘 ${x.right ?? 0} · 틀림 ${x.wrong}`); }));
  const done = allCards().filter(c => L.entry(progress[c.id]).s >= L.MATURE);
  $('doneSummary').textContent = `완료 카드 (${done.length})`;
  const q = $('doneFilter').value;
  const shown = done.filter(c => c.front.includes(q) || c.back.includes(q));
  $('doneList').replaceChildren(...cardList(shown, '처음부터', c => { progress[c.id] = { flagged: !!progress[c.id]?.flagged }; }));
  $('recallFirst').checked = recallFirst;
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
  const data = { version: 5, progress, customCards: custom, stats, exam, myNotes, hours, mocks, streak };
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
  myNotes = data.myNotes ?? myNotes;
  hours = data.hours ?? hours;
  mocks = data.mocks ?? mocks;
  streak = data.streak ?? streak;
  mergeRecords();
  save('progress', progress); save('customCards', custom); save('stats', stats); save('exam', exam); save('myNotes', myNotes);
  save('hours', hours); save('mocks', mocks); save('streak', streak);
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
$('start').onclick = () => { setEras([]); enterMode('normal'); };   // the big button: today's plan, all eras
$('cheerMore').onclick = () => startBatch();
$('cheerHome').onclick = goHome;
$('roundBtn').onclick = renderRounds;
$('scopeBasic').onclick = () => { deep = false; save('deep', deep); renderHome(); };
$('scopeAll').onclick = () => { deep = true; save('deep', deep); renderHome(); };
$('roundsBack').onclick = goHome;
$('weakBtn').onclick = () => enterMode('weak');
$('chainBtn').onclick = () => enterMode('chain');
$('recallFirst').onchange = e => { recallFirst = e.target.checked; save('recallFirst', recallFirst); };
$('examDate').onchange = e => { exam = e.target.value; save('exam', exam); renderPlan(); };
$('examPreset').onclick = () => { exam = L.NEXT_EXAM.date; save('exam', exam); renderPlan(); };
$('hoursWd').onchange = $('hoursWe').onchange = () => {
  const h = id => Math.min(16, Math.max(0, Number($(id).value) || 0));
  hours = { wd: h('hoursWd'), we: h('hoursWe') };
  save('hours', hours);
  renderPlan();
};
$('toPlan').onclick = renderPlan;
$('planBack').onclick = goHome;
$('mockBtn').onclick = renderMock;
$('mockBack').onclick = goHome;
$('quit').onclick = goHome;
$('toManage').onclick = renderManage;
$('toGuide').onclick = () => { show('guide'); scrollTo(0, 0); };
$('guideBack').onclick = goHome;
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
try {
  const res = await fetch('gichul.json');
  const data = res.ok ? await res.json() : null;
  if (!Array.isArray(data?.questions) || !Array.isArray(data.sets)) throw 0;
  hits = L.gichulHits(data.questions);
  baseCards = L.byHits(baseCards, hits);   // new cards: most-tested first
  chainIdx = L.chainIndex(allCards(), data.sets);
  if (data.questions.length) gichul = data;
} catch { chainIdx = L.chainIndex(allCards()); }
try {
  const res = await fetch('merged.json');
  const data = res.ok ? await res.json() : null;
  if (!isObj(data)) throw 0;
  mergedIds = data;
  if (Object.keys(mergedIds).some(id => id in progress || id in myNotes)) { mergeRecords(); save('progress', progress); save('myNotes', myNotes); }
} catch {}
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
