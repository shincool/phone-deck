'use strict';

const $ = id => document.getElementById(id);
const deckEl = $('deck'), tabsEl = $('tabs'), statusEl = $('status'), titleEl = $('pageTitle');

// ---------- 접속 코드: URL(?t=) → 저장소 순서로 찾음 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
let token = new URLSearchParams(location.search).get('t') || store.get('deckToken') || '';
if (token) store.set('deckToken', token);

// ---------- 조작할 컴퓨터 (이 앱을 연 컴퓨터 + 직접 추가한 다른 컴퓨터) ----------
// 다른 컴퓨터: [{ name, base: 'http://phonedeck-mac.local:8765', token }]
let others = [];
try { others = JSON.parse(store.get('deckComputers') || '[]'); } catch {}
let current = Math.min(Number(store.get('deckCurrent')) || 0, others.length);   // 0 = 이 앱을 연 컴퓨터
let homeName = store.get('deckHomeName') || '이 컴퓨터';
const comp = () => (current === 0 ? { name: homeName, base: '', token } : others[current - 1]);
const abs = u => (u && u[0] === '/' ? comp().base + u : u);   // 다른 컴퓨터의 아이콘 주소
window.DECK_BASE = comp().base;

let config = null;
let pageIdx = Number(store.get('deckPage:' + current)) || 0;
let events = null;

// ---------- 서버 통신 ----------
async function api(path, opts = {}) {
  const c = comp();
  const res = await fetch(c.base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Deck-Token': c.token, ...(opts.headers || {}) },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    if (current === 0) showLogin(); else openComputers();
    throw new Error(body.error || '접속 코드 오류');
  }
  if (!res.ok) throw new Error(body.error || `오류 ${res.status}`);
  return body;
}

async function loadConfig() {
  const data = await api('/api/config');
  config = data.config;
  if (data.error) toast(data.error, true);
  render();
  readLumetriForPage();
}

function connectEvents() {
  if (events) events.close();
  const c = comp();
  events = new EventSource(`${c.base}/api/events?t=${encodeURIComponent(c.token)}`);
  events.addEventListener('hello', e => {
    setStatus(true);
    const host = (JSON.parse(e.data || '{}').host) || '';
    if (current === 0 && host && host !== homeName) { homeName = host; store.set('deckHomeName', host); drawBrand(); }
    loadConfig().catch(err => toast(err.message, true));
  });
  events.addEventListener('config', () => loadConfig().catch(e => toast(e.message, true)));
  events.addEventListener('volume', e => { volume = JSON.parse(e.data); refreshVolumeDials(); });
  events.addEventListener('app', e => onForegroundApp(JSON.parse(e.data)));
  events.addEventListener('lumetri', e => onLumetri(JSON.parse(e.data)));
  events.onerror = () => setStatus(false);   // EventSource 가 자동으로 재연결함
}

function setStatus(on) {
  statusEl.className = 'dot ' + (on ? 'on' : 'off');
  statusEl.title = on ? 'PC와 연결됨' : '연결 끊김 — 재연결 중';
}

// ---------- 컴퓨터 바꾸기 ----------
function drawBrand() {
  const b = $('brandBtn');
  b.textContent = others.length ? comp().name : 'phonedeck';
  b.classList.toggle('multi', others.length > 0);
}

function switchTo(i) {
  current = i;
  store.set('deckCurrent', i);
  window.DECK_BASE = comp().base;
  if (events) { events.close(); events = null; }
  config = null;
  volume = null;
  lastApp = '';
  pageIdx = Number(store.get('deckPage:' + i)) || 0;
  deckEl.replaceChildren();
  tabsEl.replaceChildren();
  titleEl.textContent = '';
  setStatus(false);
  drawBrand();
  connectEvents();
}

function openComputers() {
  const list = $('compList');
  const all = [{ name: homeName, base: '', sub: location.host }, ...others.map(o => ({ ...o, sub: o.base.replace(/^https?:\/\//, '') }))];
  list.replaceChildren(...all.map((c, i) => {
    const row = document.createElement('div');
    row.className = 'comp-row' + (i === current ? ' on' : '');
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'comp-pick';
    pick.innerHTML = '<b></b><span></span>';
    pick.querySelector('b').textContent = c.name;
    pick.querySelector('span').textContent = c.sub + (i === 0 ? ' · 이 앱을 연 컴퓨터' : '');
    pick.onclick = () => { $('compSheet').hidden = true; if (i !== current) switchTo(i); };
    row.append(pick);
    if (i > 0) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'comp-del';
      del.textContent = '삭제';
      del.onclick = () => {
        if (!confirm(`"${c.name}"을(를) 목록에서 지울까요?`)) return;
        others.splice(i - 1, 1);
        store.set('deckComputers', JSON.stringify(others));
        if (current === i) switchTo(0); else if (current > i) { current--; store.set('deckCurrent', current); }
        drawBrand();
        openComputers();
      };
      row.append(del);
    }
    return row;
  }));
  $('compMsg').textContent = '';
  $('compSheet').hidden = false;
}

// "phonedeck-mac.local", "192.168.0.5:8765", QR 주소 전체(http://…/?t=코드) 모두 받음
function parseAddress(text) {
  let s = text.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  return { base: `${u.protocol}//${u.hostname}:${u.port || 8765}`, token: u.searchParams.get('t') || '' };
}

$('compForm').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('compMsg');
  const addr = parseAddress($('compAddr').value);
  const code = $('compCode').value.trim() || (addr && addr.token);
  if (!addr) { msg.textContent = '주소를 확인해 주세요 (예: phonedeck-mac.local)'; return; }
  if (!code) { msg.textContent = '그 컴퓨터의 접속 코드를 입력해 주세요'; return; }
  msg.textContent = '연결 확인 중…';
  try {
    const res = await fetch(`${addr.base}/api/config`, { headers: { 'X-Deck-Token': code }, cache: 'no-store' });
    if (res.status === 401) { msg.textContent = '접속 코드가 맞지 않습니다'; return; }
    if (!res.ok) throw new Error();
  } catch {
    msg.textContent = '연결할 수 없습니다. 그 컴퓨터에서 Phone Deck 이 켜져 있고 같은 Wi-Fi 인지 확인하세요.';
    return;
  }
  const name = $('compName').value.trim() || new URL(addr.base).hostname.replace(/\.local$/, '');
  others.push({ name, base: addr.base, token: code });
  store.set('deckComputers', JSON.stringify(others));
  $('compForm').reset();
  $('compSheet').hidden = true;
  switchTo(others.length);
  toast(`${name} 에 연결했습니다`);
});
$('brandBtn').addEventListener('click', openComputers);
$('compClose').addEventListener('click', () => { $('compSheet').hidden = true; });
$('compSheet').addEventListener('click', e => { if (e.target === $('compSheet')) $('compSheet').hidden = true; });

// ---------- 화면 그리기 ----------
function columns() {
  const base = Number(config.columns) || 4;
  const landscape = window.innerWidth > window.innerHeight;
  return landscape ? (Number(config.landscapeColumns) || Math.ceil(base * 1.5)) : base;
}

function render() {
  if (!config) return;
  const pages = config.pages || [];
  if (pageIdx >= pages.length) pageIdx = 0;
  const page = pages[pageIdx] || { name: '빈 페이지', buttons: [] };
  const buttons = page.buttons || [];
  const cols = columns();
  const spanOf = b => (b && b.dial ? Math.min(Number(b.span) || 2, cols) : 1);
  const used = buttons.reduce((n, b) => n + spanOf(b) ** 2, 0);
  const rows = Math.max(Number(config.rows) || 0, Math.ceil(used / cols), 1);

  titleEl.textContent = page.name || `페이지 ${pageIdx + 1}`;
  deckEl.style.setProperty('--cols', cols);
  deckEl.replaceChildren();

  const total = buttons.length + Math.max(0, rows * cols - used);
  for (let i = 0; i < total; i++) {
    const b = buttons[i];
    if (b && b.dial) {
      deckEl.append(makeDial(b, i, spanOf(b)));
      continue;
    }
    const el = document.createElement('button');
    el.className = 'key';
    if (!b || !b.action) {
      el.classList.add('empty');
      el.dataset.index = i;   // 편집 모드에서 빈칸으로 옮길 때 필요
      if (b && b.label) el.append(label(b));
    } else {
      el.dataset.index = i;
      if (b.color) el.style.setProperty('--key-color', b.color);
      if (b.imageUrl) {
        const img = document.createElement('img');
        img.className = 'img';
        img.alt = '';
        img.draggable = false;
        img.src = abs(b.imageUrl);
        // 이미지를 못 불러오면 icon 으로 대체
        img.onerror = () => { img.replaceWith(iconEl(b.icon || 'circle-help')); drawIcons(); };
        el.append(img);
      } else if (b.icon) {
        el.append(iconEl(b.icon));
      }
      if (b.label) el.append(label(b));
    }
    deckEl.append(el);
  }

  // 페이지 버튼: 동그란 번호 + 이름, 현재 페이지는 초록 링
  tabsEl.replaceChildren();
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const t = document.createElement('button');
      t.className = 'pg' + (i === pageIdx ? ' active' : '');
      t.innerHTML = '<span class="btn"></span><span></span>';
      t.firstChild.textContent = i + 1;
      t.lastChild.textContent = p.name || `페이지 ${i + 1}`;
      t.onclick = () => goPage(i);
      tabsEl.append(t);
    });
  }
  drawIcons();
}

// "icon": "play" 처럼 영문 소문자 이름이면 흰 선 아이콘(Lucide), 그 외에는 이모지/글자로 표시
function iconEl(name) {
  if (/^[a-z][a-z0-9-]*$/.test(name)) {
    // 아이콘 파일을 못 불러왔으면 영어 이름 대신 빈칸으로 둠
    if (!window.lucide) return document.createElement('span');
    const i = document.createElement('i');
    i.dataset.lucide = name;
    return i;
  }
  const ic = document.createElement('span');
  ic.className = 'ic';
  ic.textContent = name;
  return ic;
}

function drawIcons() {
  if (!window.lucide) return;
  lucide.createIcons({ icons: lucide.icons });
  // 이름이 틀린 아이콘은 물음표로 표시
  document.querySelectorAll('i[data-lucide]').forEach(i => { i.dataset.lucide = 'circle-help'; });
  lucide.createIcons({ icons: lucide.icons });
}

function label(b) {
  const lb = document.createElement('span');
  lb.className = 'lb';
  lb.textContent = b.label;
  return lb;
}

function goPage(i) {
  const n = (config.pages || []).length;
  if (!n) return;
  pageIdx = (i + n) % n;
  store.set('deckPage:' + current, pageIdx);
  render();
  readLumetriForPage();
}

// ---------- 버튼 누르기: 손가락이 닿는 순간 전송 (실제 스트림덱처럼) ----------
let swipe = null;

deckEl.addEventListener('pointerdown', e => {
  if (editing) return editPointerDown(e);
  swipe = { x: e.clientX, y: e.clientY, t: Date.now() };
  const el = e.target.closest('.key:not(.empty)');
  if (!el) return;
  el.classList.add('down');
  press(el);
  keepAwake();
});

const release = () => deckEl.querySelectorAll('.key.down').forEach(k => k.classList.remove('down'));
deckEl.addEventListener('pointerup', e => {
  if (editing) return;
  release();
  // 빈 공간에서 좌우로 밀면 페이지 넘김 (다이얼 돌리기는 제외)
  if (swipe && !e.target.closest('.key:not(.empty), .dial')) {
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - swipe.t < 600) goPage(pageIdx + (dx < 0 ? 1 : -1));
  }
  swipe = null;
});
deckEl.addEventListener('pointercancel', release);
deckEl.addEventListener('contextmenu', e => e.preventDefault());

async function press(el) {
  const i = Number(el.dataset.index);
  const btn = config.pages[pageIdx].buttons[i];
  if (btn.action.type === 'page') {   // 페이지 이동은 폰에서 바로 처리
    const target = btn.action.page;
    const idx = typeof target === 'number' ? target : config.pages.findIndex(p => p.name === target);
    if (idx >= 0) goPage(idx); else toast(`페이지를 찾을 수 없음: ${target}`, true);
    return;
  }
  try {
    await api('/api/press', { method: 'POST', body: JSON.stringify({ page: pageIdx, button: i }) });
    flash(el, 'ok');
  } catch (err) {
    flash(el, 'err');
    toast(err.message, true);
  }
}

// ---------- 프로그램별 자동 페이지 전환 ----------
// 페이지 설정의 "apps": ["Adobe Premiere Pro", "AfterFX"] 중 하나가 PC 앞에 오면 그 페이지로 이동
let lastApp = '';
function pageMatches(p, app) {
  const a = app.toLowerCase();
  return (p.apps || []).some(x => x && a.includes(String(x).toLowerCase()));
}
function onForegroundApp({ name, initial }) {
  if (!config || !name || config.autoSwitch === false) return;
  const changedApp = name !== lastApp;
  lastApp = name;
  if (!changedApp || editing || !$('sheet').hidden) return;
  const pages = config.pages || [];
  if (pages[pageIdx] && pageMatches(pages[pageIdx], name)) return;   // 이미 그 프로그램용 페이지에 있으면 그대로
  const idx = pages.findIndex(p => pageMatches(p, name));
  if (idx < 0) return;
  goPage(idx);
  if (!initial) toast(`${name} → ${pages[idx].name || `페이지 ${idx + 1}`}`);
}

// ---------- 편집 모드: 탭하면 꾸미기, 끌면 자리 바꾸기 ----------
// 아이폰에서는 겉모습(이름·아이콘·색)과 위치만 바꿀 수 있음. 동작은 PC 편집 화면(/edit)에서.
let editing = false;
let drag = null;
const COLORS = ['', '#2bd46a', '#4a7dff', '#9b7bff', '#ff5c8a', '#ff9f43', '#ffd43b', '#3dd6d0', '#ff5c5c'];

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  $('editBar').hidden = !on;
  release();
}
$('editBtn').addEventListener('click', () => setEditing(!editing));
$('editDone').addEventListener('click', () => setEditing(false));

function editPointerDown(e) {
  const cell = e.target.closest('.key, .dial');
  if (!cell || cell.dataset.index === undefined) return;
  drag = { cell, from: Number(cell.dataset.index), x: e.clientX, y: e.clientY, moving: false, over: null };
  try { deckEl.setPointerCapture(e.pointerId); } catch {}
}

deckEl.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moving && Math.hypot(dx, dy) > 10) {
    drag.moving = true;
    drag.cell.classList.add('dragging');
  }
  if (!drag.moving) return;
  drag.cell.style.transform = `translate(${dx}px, ${dy}px) scale(1.05)`;
  const over = cellAt(e.clientX, e.clientY);
  if (over !== drag.over) {
    if (drag.over) drag.over.classList.remove('drop');
    drag.over = over && over !== drag.cell ? over : null;
    if (drag.over) drag.over.classList.add('drop');
  }
});

function cellAt(x, y) {
  const hit = document.elementFromPoint(x, y);   // 끌고 있는 칸은 pointer-events:none 이라 그 아래 칸이 잡힘
  return hit && hit.closest('#deck .key, #deck .dial');
}

async function editPointerUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.cell.classList.remove('dragging');
  d.cell.style.transform = '';
  if (d.over) d.over.classList.remove('drop');
  if (d.moving) {
    const to = d.over ? Number(d.over.dataset.index) : NaN;
    if (Number.isInteger(to) && to !== d.from) {
      try {
        await api('/api/edit/move', { method: 'POST', body: JSON.stringify({ page: pageIdx, from: d.from, to }) });
        await loadConfig();
      } catch (err) { toast(err.message, true); }
    }
    return;
  }
  const btn = (config.pages[pageIdx].buttons || [])[d.from];
  if (!btn || (!btn.action && !btn.dial)) {
    toast('빈 칸입니다. 새 버튼은 PC의 편집 화면(localhost:8765/edit)에서 추가할 수 있어요.');
    return;
  }
  openSheet(d.from, btn);
}
deckEl.addEventListener('pointerup', editPointerUp);
deckEl.addEventListener('pointercancel', () => { if (drag) { drag.moving = false; drag.over = null; editPointerUp(); } });

// 꾸미기 창
let sheetState = null;
function openSheet(index, btn) {
  sheetState = { index, label: btn.label || '', icon: btn.icon || '', image: btn.image || '', color: btn.color || '', imageUrl: btn.imageUrl };
  $('sheetLabel').value = sheetState.label;
  const colors = $('sheetColors');
  colors.replaceChildren(...COLORS.map(c => {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'swatch' + (c ? '' : ' none') + (c === sheetState.color ? ' on' : '');
    if (c) s.style.background = c;
    s.title = c || '색 없음';
    s.onclick = () => { sheetState.color = c; colors.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === s)); drawPreview(); };
    return s;
  }));
  IconPicker.mount($('sheetPicker'), {
    value: { icon: sheetState.icon, image: sheetState.image },
    canAuto: !!(btn.action && btn.action.type === 'open'),
    request: (path, opts = {}) => api(path, opts),
    onChange: v => {
      sheetState.icon = v.icon;
      if (v.image !== sheetState.image) sheetState.imageUrl = null;   // 이미지가 바뀌면 미리보기 주소를 새로 계산
      sheetState.image = v.image;
      drawPreview();
    },
  });
  drawPreview();
  $('sheet').hidden = false;
}

function drawPreview() {
  const s = sheetState;
  const pv = $('sheetPreview');
  pv.style.setProperty('--key-color', s.color || 'var(--tile-edge)');
  // 앱 아이콘(auto)은 저장 전에는 주소를 모르므로 기존 이미지나 아이콘으로 보여줌
  IconPicker.render(pv.querySelector('.pv-icon'), {
    icon: s.icon, image: s.image === 'auto' ? '' : s.image, imageUrl: s.image === 'auto' ? s.imageUrl : null,
  });
  pv.querySelector('.lb').textContent = $('sheetLabel').value;
}
$('sheetLabel').addEventListener('input', drawPreview);
$('sheetCancel').addEventListener('click', () => { $('sheet').hidden = true; sheetState = null; });
$('sheet').addEventListener('click', e => { if (e.target === $('sheet')) $('sheetCancel').click(); });

$('sheetSave').addEventListener('click', async () => {
  const s = sheetState;
  if (!s) return;
  const save = $('sheetSave');
  save.disabled = true;
  try {
    await api('/api/edit/look', {
      method: 'POST',
      body: JSON.stringify({ page: pageIdx, button: s.index, label: $('sheetLabel').value.trim(), icon: s.icon, image: s.image, color: s.color }),
    });
    $('sheet').hidden = true;
    sheetState = null;
    await loadConfig();
    toast('저장했습니다');
  } catch (err) {
    toast(err.message, true);
  }
  save.disabled = false;
});

// ---------- 다이얼: 손가락으로 원을 그리며 돌리기 ----------
let volume = null;
const fastMode = {};   // "페이지:버튼" → 빠르게 모드 여부

function makeDial(b, i, span) {
  const el = document.createElement('div');
  el.className = 'dial';
  el.dataset.index = i;
  el.dataset.type = b.dial.type;
  el.style.gridColumn = el.style.gridRow = `span ${span}`;
  if (span === 1) el.classList.add('small');   // 1칸짜리 작은 다이얼
  if (b.color) el.style.setProperty('--key-color', b.color);
  el.innerHTML = `
    <div class="knob">
      <div class="arc"></div>
      <div class="ticks"></div>
      <div class="face"><span class="pip"></span></div>
      <div class="value"></div>
    </div>
    <div class="dial-label"></div>
    <button class="dial-mode" type="button"></button>`;
  el.querySelector('.dial-label').textContent = b.label || '';
  const key = `${pageIdx}:${i}`;
  const modeBtn = el.querySelector('.dial-mode');
  const showMode = () => {
    // 페이지 설정 "lang": "en" 이면 영어로 (예: 색보정 페이지)
    const en = (config.pages[pageIdx] || {}).lang === 'en';
    modeBtn.textContent = en ? (fastMode[key] ? 'Fast' : 'Fine')
      : span === 1 ? (fastMode[key] ? '빠' : '정') : (fastMode[key] ? '빠르게' : '정밀');
    modeBtn.classList.toggle('fast', !!fastMode[key]);
  };
  modeBtn.addEventListener('pointerdown', e => e.stopPropagation());
  modeBtn.addEventListener('click', () => { fastMode[key] = !fastMode[key]; showMode(); });
  showMode();
  attachRotation(el, b, i, key);
  updateDialValue(el, b);
  return el;
}

function updateDialValue(el, b) {
  const v = el.querySelector('.value');
  if (b.dial.type === 'volume') {
    if (!volume) { v.textContent = '…'; return; }
    if (volume.mute) {
      v.replaceChildren(iconEl('volume-x'));
      drawIcons();
    } else {
      v.textContent = `${volume.level}`;
    }
    el.style.setProperty('--level', volume.mute ? 0 : volume.level);
    el.classList.toggle('muted', volume.mute);
  } else if (b.dial.type === 'lumetri' && lumetri[b.dial.param] !== undefined) {
    // 프리미어에서 받은 현재 값 (노출은 소수 둘째 자리, 나머지는 첫째 자리)
    const val = Number(lumetri[b.dial.param]);
    v.textContent = val.toFixed(b.dial.param === 'exposure' ? 2 : 1);
  } else {
    v.replaceChildren(b.icon ? iconEl(b.icon) : '');
  }
}

function refreshVolumeDials() {
  const page = config && config.pages[pageIdx];
  if (!page) return;
  deckEl.querySelectorAll('.dial[data-type="volume"]').forEach(el => updateDialValue(el, page.buttons[el.dataset.index]));
}

// ---------- 프리미어 Lumetri 다이얼: 현재 값 표시 ----------
const lumetri = {};          // 항목 → 프리미어에서 마지막으로 받은 값
let lumetriErrAt = 0;
function onLumetri(r) {
  if (r.ok) {
    lumetri[r.key] = r.value;
    const page = config && config.pages[pageIdx];
    if (!page) return;
    deckEl.querySelectorAll('.dial[data-type="lumetri"]').forEach(el => {
      const b = page.buttons[el.dataset.index];
      if (b && b.dial.param === r.key) { updateDialValue(el, b); drawIcons(); }
    });
  } else if (Date.now() - lumetriErrAt > 2500) {   // 같은 오류가 연달아 뜨지 않게
    lumetriErrAt = Date.now();
    toast(r.error || '프리미어 오류', true);
  }
}
// 색보정 페이지를 열 때 각 다이얼의 현재 값을 프리미어에서 읽어 옴
function readLumetriForPage() {
  const page = config && config.pages[pageIdx];
  const keys = page ? page.buttons.filter(b => b && b.dial && b.dial.type === 'lumetri').map(b => b.dial.param) : [];
  if (keys.length) api('/api/lumetri/read', { method: 'POST', body: JSON.stringify({ keys }) }).catch(() => {});
}

function attachRotation(el, b, i, key) {
  const knob = el.querySelector('.knob');
  const face = el.querySelector('.face');
  const degPerTick = 360 / (Number(b.dial.ticksPerTurn) || 24);
  let rot = 0, last = null, acc = 0, moved = 0, downAt = 0;
  let pending = 0, sending = false;

  const angle = e => {
    const r = knob.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    return { a: Math.atan2(y, x) * 180 / Math.PI, near: Math.hypot(x, y) < r.width * 0.12 };
  };

  async function flush() {   // 모인 틱을 한 번에 보냄 — 빠르게 돌려도 틱이 사라지지 않음
    if (sending || !pending) return;
    sending = true;
    const ticks = pending; pending = 0;
    try {
      await api('/api/dial', { method: 'POST', body: JSON.stringify({ page: pageIdx, button: i, ticks, fast: !!fastMode[key] }) });
    } catch (err) {
      toast(err.message, true);
    }
    sending = false;
    if (pending) flush();
  }

  knob.addEventListener('pointerdown', e => {
    if (editing) return;   // 편집 모드에서는 돌리지 않고 편집 동작으로 넘김
    e.stopPropagation();
    try { knob.setPointerCapture(e.pointerId); } catch {}
    last = angle(e).a; acc = 0; moved = 0; downAt = Date.now();
    el.classList.add('active');
    unlockSound();
    keepAwake();
  });

  knob.addEventListener('pointermove', e => {
    if (last === null) return;
    const { a, near } = angle(e);
    let d = a - last;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    last = a;
    if (near) return;   // 가운데 근처는 각도가 튀므로 무시
    rot += d; acc += d; moved += Math.abs(d);
    face.style.transform = `rotate(${rot}deg)`;
    while (acc >= degPerTick) { acc -= degPerTick; pending++; tick(); }
    while (acc <= -degPerTick) { acc += degPerTick; pending--; tick(); }
    flush();
  });

  const end = () => {
    if (last === null) return;
    last = null;
    el.classList.remove('active');
    // 거의 안 돌리고 짧게 탭하면 "다이얼 누르기"
    if (moved < 8 && Date.now() - downAt < 400) {
      el.classList.add('pressed');
      setTimeout(() => el.classList.remove('pressed'), 150);
      api('/api/press', { method: 'POST', body: JSON.stringify({ page: pageIdx, button: i }) }).catch(err => toast(err.message, true));
    }
  };
  knob.addEventListener('pointerup', end);
  knob.addEventListener('pointercancel', end);
}

// 틱마다 "딸깍" 소리 (config.json 의 "sound": false 로 끌 수 있음)
let audioCtx = null;
function unlockSound() {
  if (audioCtx || config.sound === false) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
}
function tick() {
  if (!audioCtx || config.sound === false) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.frequency.value = 1800;
  gain.gain.setValueAtTime(0.08, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 0.03);
}

function flash(el, cls) {
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 350);
}

let toastTimer;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

// ---------- 화면 꺼짐 방지 (지원되는 iOS 버전에서) ----------
let wakeLock = null;
async function keepAwake() {
  if (wakeLock || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {}
}

// ---------- 로그인 ----------
function showLogin() {
  $('login').hidden = false;
  if (events) { events.close(); events = null; }
}

$('loginForm').addEventListener('submit', e => {
  e.preventDefault();
  token = $('tokenInput').value.trim();
  if (!token) return;
  store.set('deckToken', token);
  $('login').hidden = true;
  start();
});

$('reloadBtn').addEventListener('click', () => location.reload());
window.addEventListener('resize', () => render());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && token) {
    if (!events || events.readyState === EventSource.CLOSED) connectEvents();
    loadConfig().catch(() => {});
  }
});

async function start() {
  drawBrand();
  if (current > 0) return connectEvents();   // 마지막에 다른 컴퓨터를 쓰고 있었으면 그대로 이어서
  if (!token) {
    // PC 자신에서 열었으면 접속 코드를 자동으로 가져옴 (/api/setup 은 PC에서만 응답)
    try {
      const res = await fetch('/api/setup', { cache: 'no-store' });
      if (res.ok) {
        token = (await res.json()).token;
        store.set('deckToken', token);
      }
    } catch {}
  }
  if (!token) return showLogin();
  connectEvents();
}
start();
