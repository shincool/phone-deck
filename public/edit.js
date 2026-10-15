// Phone Deck PC 편집 화면 — 페이지·버튼·다이얼·동작을 마우스로 편집하고 config.json 에 저장합니다.
'use strict';

const $ = id => document.getElementById(id);
let cfg = null;          // 편집 중인 설정 (저장 전까지는 이 화면에만 있음)
let version = 0;         // 서버 설정 버전 — 다른 곳에서 바뀌었는지 확인용
let platform = 'windows';
let token = '';
let dirty = false;
let pageIdx = 0;
let sel = null;          // 선택한 버튼 번호
const COLORS = ['', '#2bd46a', '#4a7dff', '#9b7bff', '#ff5c8a', '#ff9f43', '#ffd43b', '#3dd6d0', '#ff5c5c'];

// ---------- 서버 ----------
async function call(path, opts = {}) {
  const res = await fetch(path, { cache: 'no-store', ...opts, headers: { 'Content-Type': 'application/json', 'X-Deck-Token': token, ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body.error || `오류 ${res.status}`); e.status = res.status; throw e; }
  return body;
}

async function load() {
  token = (await call('/api/setup')).token;
  const data = await call('/api/pc/config');
  cfg = data.config;
  version = data.version;
  platform = data.platform;
  $('sub').textContent = `${data.configName} · ${platform === 'mac' ? '맥' : 'Windows'}`;
  if (data.error) toast(data.error, true);
  if (pageIdx >= cfg.pages.length) pageIdx = 0;
  sel = null;
  setDirty(false);
  renderAll();
}

async function save() {
  const btn = $('saveBtn');
  btn.disabled = true;
  try {
    const r = await call('/api/pc/config', { method: 'PUT', body: JSON.stringify({ version, config: cfg }) });
    version = r.version;
    setDirty(false);
    toast('저장했습니다. 아이폰 화면에 바로 반영됩니다.');
  } catch (e) {
    if (e.status === 409 && confirm(e.message + '\n\n지금 새로 불러올까요? (이 화면에서 고친 내용은 사라집니다)')) return load();
    toast(e.message, true);
    btn.disabled = false;
  }
}

function setDirty(d) {
  dirty = d;
  $('saveBtn').disabled = !d;
  const s = $('status');
  s.textContent = d ? '저장하지 않은 변경 사항이 있습니다' : '';
  s.className = d ? 'dirty' : '';
}
const changed = () => { setDirty(true); renderGrid(); };

$('saveBtn').onclick = save;
$('revertBtn').onclick = () => { if (!dirty || confirm('저장하지 않은 변경 사항을 버릴까요?')) load(); };
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !recording) { e.preventDefault(); if (dirty) save(); }
});

let toastTimer;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3000);
}

// ---------- 작은 도우미 ----------
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = v;
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
const icon = name => { const n = lucide.icons[name.replace(/(^|-)([a-z0-9])/g, (_, a, c) => c.toUpperCase())]; return n ? lucide.createElement(n) : ''; };
const page = () => cfg.pages[pageIdx];
const isEmpty = b => !b || (!b.action && !b.dial);

// ---------- 전체 그리기 ----------
function renderAll() {
  renderPages();
  renderPageApps();
  refreshRecent();
  renderSettings();
  renderGrid();
  renderInspector();
}

function renderSettings() {
  $('setCols').value = cfg.columns || 4;
  $('setLCols').value = cfg.landscapeColumns || '';
  $('setRows').value = cfg.rows || '';
  $('setSound').checked = cfg.sound !== false;
  $('setAuto').checked = cfg.autoSwitch !== false;
}
const numSetting = (id, key) => {
  $(id).oninput = e => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v) && v > 0) cfg[key] = v; else delete cfg[key];
    changed();
  };
};
numSetting('setCols', 'columns');
numSetting('setLCols', 'landscapeColumns');
numSetting('setRows', 'rows');
$('setSound').onchange = e => { if (e.target.checked) delete cfg.sound; else cfg.sound = false; setDirty(true); };
$('setAuto').onchange = e => { if (e.target.checked) delete cfg.autoSwitch; else cfg.autoSwitch = false; setDirty(true); };

// ---------- 프로그램별 자동 전환: 이 페이지에 연결된 프로그램 ----------
function renderPageApps() {
  const p = page();
  const box = $('pageApps');
  const apps = p.apps || [];
  box.replaceChildren(...(apps.length ? apps.map((a, i) => h('span', { class: 'chip' }, a,
    h('button', { class: 'x', type: 'button', title: '빼기', onclick: () => {
      apps.splice(i, 1);
      if (!apps.length) delete p.apps;
      setDirty(true);
      renderPageApps();
    } }, '×'))) : [h('span', { class: 'hint' }, '연결된 프로그램 없음')]));
}
function addPageApp(name) {
  name = (name || '').trim();
  if (!name) return;
  const p = page();
  p.apps = p.apps || [];
  if (!p.apps.some(a => a.toLowerCase() === name.toLowerCase())) p.apps.push(name);
  setDirty(true);
  renderPageApps();
}
$('pageAppAdd').onclick = () => { addPageApp($('pageAppInput').value); $('pageAppInput').value = ''; };
$('pageAppInput').onkeydown = e => { if (e.key === 'Enter') $('pageAppAdd').click(); };

async function refreshRecent() {
  try {
    const { foreground, recent } = await call('/api/pc/recent');
    const box = $('recentApps');
    // 이 편집 화면을 띄운 브라우저는 목록에서 뺄 수 없으니 그대로 보여 줌
    box.replaceChildren(...(recent.length ? recent.map(n => h('button', { class: 'chip add' + (n === foreground ? ' now' : ''), type: 'button', onclick: () => addPageApp(n) }, n))
      : [h('span', { class: 'hint' }, 'PC에서 프로그램을 바꿔 가며 쓰면 여기에 나타납니다')]));
  } catch {}
}
setInterval(refreshRecent, 3000);

// ---------- 페이지 목록 ----------
function renderPages() {
  const box = $('pages');
  box.replaceChildren(...cfg.pages.map((p, i) => {
    const name = h('input', { value: p.name || '', placeholder: `페이지 ${i + 1}` });
    name.oninput = () => {
      const old = p.name;
      p.name = name.value;
      // 다른 버튼의 "페이지 이동" 대상 이름도 함께 바꿈
      for (const pg of cfg.pages) for (const b of pg.buttons) {
        walkActions(b, a => { if (a.type === 'page' && a.page === old) a.page = name.value; });
      }
      setDirty(true);
    };
    name.onfocus = () => { if (pageIdx !== i) { pageIdx = i; sel = null; renderAll(); box.children[i].querySelector('input').focus(); } };
    const row = h('div', { class: 'page-row' + (i === pageIdx ? ' on' : ''), onclick: e => { if (e.target === row || e.target.classList.contains('num')) { pageIdx = i; sel = null; renderAll(); } } },
      h('span', { class: 'num' }, String(i + 1)),
      name,
      h('button', { class: 'icon-btn', type: 'button', title: '위로', onclick: () => movePage(i, -1) }, icon('chevron-up')),
      h('button', { class: 'icon-btn', type: 'button', title: '아래로', onclick: () => movePage(i, 1) }, icon('chevron-down')),
      h('button', { class: 'icon-btn', type: 'button', title: '삭제', onclick: () => deletePage(i) }, icon('trash-2')));
    return row;
  }));
}

function movePage(i, d) {
  const j = i + d;
  if (j < 0 || j >= cfg.pages.length) return;
  [cfg.pages[i], cfg.pages[j]] = [cfg.pages[j], cfg.pages[i]];
  // 번호로 지정한 "페이지 이동"이 엉뚱한 곳으로 가지 않게 이름으로 바꿔 둠
  pinPageTargetsByName();
  if (pageIdx === i) pageIdx = j; else if (pageIdx === j) pageIdx = i;
  setDirty(true);
  renderAll();
}

function deletePage(i) {
  if (cfg.pages.length <= 1) return toast('페이지는 최소 1개 있어야 합니다', true);
  const p = cfg.pages[i];
  const n = p.buttons.filter(b => !isEmpty(b)).length;
  if (!confirm(`"${p.name || `페이지 ${i + 1}`}" 페이지를 삭제할까요?${n ? ` (버튼 ${n}개 포함)` : ''}`)) return;
  pinPageTargetsByName();
  cfg.pages.splice(i, 1);
  pageIdx = Math.min(pageIdx, cfg.pages.length - 1);
  sel = null;
  setDirty(true);
  renderAll();
}

$('addPage').onclick = () => {
  pinPageTargetsByName();
  let n = cfg.pages.length + 1;
  while (cfg.pages.some(p => p.name === `새 페이지 ${n}`)) n++;
  cfg.pages.push({ name: `새 페이지 ${n}`, buttons: [] });
  pageIdx = cfg.pages.length - 1;
  sel = null;
  setDirty(true);
  renderAll();
};

function walkActions(b, fn) {
  const visit = a => { if (!a || typeof a !== 'object') return; fn(a); if (a.type === 'multi') (a.steps || []).forEach(visit); };
  if (!b) return;
  visit(b.action);
  if (b.dial) visit(b.dial.press);
}
function pinPageTargetsByName() {
  for (const pg of cfg.pages) for (const b of pg.buttons) {
    walkActions(b, a => { if (a.type === 'page' && typeof a.page === 'number' && cfg.pages[a.page]) a.page = cfg.pages[a.page].name; });
  }
}

// ---------- 버튼 그리드 (아이폰과 같은 배치) ----------
let dragFrom = null;
function renderGrid() {
  const grid = $('grid');
  const cols = Math.max(2, Number(cfg.columns) || 4);
  const buttons = page().buttons;
  const spanOf = b => (b && b.dial ? Math.min(Number(b.span) || 2, cols) : 1);
  const used = buttons.reduce((n, b) => n + spanOf(b) ** 2, 0);
  const rows = Math.max(Number(cfg.rows) || 0, Math.ceil(used / cols) + 1, 1);   // 아래에 빈 줄 하나 더: 새 버튼 추가용
  const total = buttons.length + Math.max(0, rows * cols - used);
  grid.style.setProperty('--cols', cols);
  grid.replaceChildren();
  for (let i = 0; i < total; i++) {
    const b = buttons[i];
    const cell = h('button', { class: 'cell', type: 'button', draggable: 'true' });
    cell.dataset.index = i;
    if (isEmpty(b)) {
      cell.classList.add('empty');
      cell.append('＋');
      cell.title = '새 버튼 추가';
    } else {
      if (b.color) cell.style.setProperty('--key-color', b.color);
      const pv = h('span');
      IconPicker.render(pv, { icon: b.icon, image: b.image === 'auto' ? '' : b.image, imageUrl: b.image === 'auto' ? autoIconUrl(i) : null });
      if (b.dial) {
        cell.classList.add('dial');
        const s = spanOf(b);
        cell.style.gridColumn = cell.style.gridRow = `span ${s}`;
        const knob = h('span', { class: 'knob' });
        knob.append(b.dial.type === 'volume' ? h('span', { class: 'ic', style: 'font-size:18px;font-weight:700' }, '32') : pv);
        cell.append(h('span', { class: 'tag' }, '다이얼'), knob);
      } else {
        cell.append(...pv.childNodes);
      }
      if (b.label) cell.append(h('span', { class: 'lb' }, b.label));
    }
    if (i === sel) cell.classList.add('sel');
    cell.onclick = () => {
      if (isEmpty(b)) {
        // 빈칸 → 새 버튼 만들기
        while (buttons.length <= i) buttons.push({});
        buttons[i] = { label: '새 버튼', icon: 'circle', action: { type: 'hotkey', keys: '' } };
        setDirty(true);
      }
      sel = i;
      renderGrid();
      renderInspector();
    };
    cell.ondragstart = e => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; };
    cell.ondragover = e => { e.preventDefault(); cell.classList.add('over'); };
    cell.ondragleave = () => cell.classList.remove('over');
    cell.ondrop = e => {
      e.preventDefault();
      cell.classList.remove('over');
      if (dragFrom === null || dragFrom === i) return;
      while (buttons.length <= Math.max(dragFrom, i)) buttons.push({});
      [buttons[dragFrom], buttons[i]] = [buttons[i], buttons[dragFrom]];
      if (sel === dragFrom) sel = i; else if (sel === i) sel = dragFrom;
      trimEnd(buttons);
      dragFrom = null;
      changed();
      renderInspector();
    };
    grid.append(cell);
  }
}
function trimEnd(arr) { while (arr.length && isEmpty(arr[arr.length - 1]) && !(arr[arr.length - 1] || {}).label) arr.pop(); }

// 저장된 버튼의 자동 앱 아이콘은 서버가 만든 주소로 보여줌 (새로 고른 경우는 저장 후에 나타남)
let clientCfg = null;
function autoIconUrl(i) {
  const b = clientCfg && clientCfg.pages[pageIdx] && clientCfg.pages[pageIdx].buttons[i];
  return b && b.imageUrl ? b.imageUrl : null;
}
async function loadClientCfg() { try { clientCfg = (await call('/api/config')).config; renderGrid(); } catch {} }

// ---------- 오른쪽: 선택한 버튼 편집 ----------
function renderInspector() {
  const box = $('insp');
  const b = sel === null ? null : page().buttons[sel];
  if (isEmpty(b)) {
    box.replaceChildren(h('div', { class: 'insp-empty' }, '가운데에서 버튼을 클릭하면 여기서 편집할 수 있습니다.', h('br'), '빈칸(＋)을 클릭하면 새 버튼이 만들어집니다.'));
    return;
  }
  const kind = b.dial ? 'dial' : 'button';
  const seg = h('div', { class: 'seg' },
    h('button', { type: 'button', class: kind === 'button' ? 'on' : '', onclick: () => { if (b.dial) { b.action = b.dial.press || { type: 'hotkey', keys: '' }; delete b.dial; delete b.span; changed(); renderInspector(); } } }, '버튼'),
    h('button', { type: 'button', class: kind === 'dial' ? 'on' : '', onclick: () => { if (!b.dial) { b.dial = { type: 'volume', step: 1, fastStep: 5 }; delete b.action; delete b.image; changed(); renderInspector(); } } }, '다이얼 (2×2칸)'));

  const label = h('input', { value: b.label || '', placeholder: '버튼 이름', maxlength: 40 });
  label.oninput = () => { if (label.value) b.label = label.value; else delete b.label; changed(); };

  const colors = h('div', { class: 'swatches' }, ...COLORS.map(c => {
    const s = h('button', { type: 'button', class: 'swatch' + (c ? '' : ' none') + ((b.color || '') === c ? ' on' : ''), title: c || '색 없음' });
    if (c) s.style.background = c;
    s.onclick = () => { if (c) b.color = c; else delete b.color; changed(); renderInspector(); };
    return s;
  }));

  const pickerBox = h('div');
  IconPicker.mount(pickerBox, {
    value: { icon: b.icon || '', image: b.image || '' },
    canAuto: !!(b.action && b.action.type === 'open'),
    request: (path, opts = {}) => call(path, opts),
    onChange: v => {
      if (v.icon) b.icon = v.icon; else delete b.icon;
      if (v.image) b.image = v.image; else delete b.image;
      changed();
    },
  });

  const parts = [
    seg,
    field('이름', label),
    field('테두리 색', colors),
    field('아이콘', pickerBox),
  ];

  if (b.dial) {
    parts.push(dialEditor(b));
  } else {
    parts.push(field('누르면', actionEditor(b.action, a => { b.action = a; changed(); }, { allowMulti: true })));
  }

  const test = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const a = b.dial ? b.dial.press : b.action;
    if (!a || !a.type) return toast('시험할 동작이 없습니다', true);
    if (a.type === 'page') return toast('페이지 이동은 아이폰에서만 동작합니다');
    try { await call('/api/pc/test', { method: 'POST', body: JSON.stringify({ action: a }) }); toast('실행했습니다'); }
    catch (e) { toast(e.message, true); }
  } }, '▶ 시험 실행');
  const dup = h('button', { class: 'btn', type: 'button', onclick: () => {
    const btns = page().buttons;
    let j = btns.findIndex((x, k) => k > sel && isEmpty(x));
    if (j < 0) j = btns.length;
    while (btns.length <= j) btns.push({});
    btns[j] = JSON.parse(JSON.stringify(b));
    sel = j;
    changed();
    renderInspector();
  } }, '복제');
  const del = h('button', { class: 'btn danger', type: 'button', onclick: () => {
    if (!confirm(`"${b.label || '이 버튼'}"을(를) 삭제할까요?`)) return;
    page().buttons[sel] = {};
    trimEnd(page().buttons);
    sel = null;
    changed();
    renderInspector();
  } }, '삭제');
  parts.push(h('div', { class: 'actions-bar' }, test, dup, del));
  box.replaceChildren(...parts);
}

// <label> 을 쓰면 빈 곳을 눌러도 안쪽 첫 버튼이 눌리므로 div 사용
function field(name, ...content) { return h('div', { class: 'field' }, h('span', {}, name), ...content); }

// ---------- 다이얼 편집 ----------
function dialEditor(b) {
  const d = b.dial;
  const box = h('div', { class: 'box' });
  const draw = () => {
    const type = h('select', {},
      h('option', { value: 'volume' }, 'PC 볼륨 (1% 단위)'),
      h('option', { value: 'keys' }, '돌릴 때마다 단축키 누르기'),
      h('option', { value: 'mouse' }, '마우스로 값 끌기 (색보정 등 미세 조절)'),
      h('option', { value: 'wheel' }, '마우스 휠 굴리기'),
      h('option', { value: 'lumetri' }, '프리미어 Lumetri 색보정 값'));
    type.value = d.type;
    type.onchange = () => {
      for (const k of Object.keys(d)) if (k !== 'press') delete d[k];
      d.type = type.value;
      if (d.type === 'volume') { d.step = 1; d.fastStep = 5; }
      else if (d.type === 'mouse') { d.step = 1; d.fastStep = 5; }
      else if (d.type === 'wheel') { d.step = 1; d.fastStep = 3; }
      else if (d.type === 'lumetri') { d.param = 'exposure'; d.step = 0.1; d.fastStep = 1; }
      else { d.left = 'left'; d.right = 'right'; d.fastLeft = 'shift+left'; d.fastRight = 'shift+right'; }
      changed();
      draw();
    };
    const size = h('select', {}, h('option', { value: '2' }, '크게 (2×2칸)'), h('option', { value: '1' }, '작게 (1칸)'));
    size.value = String(b.span === 1 ? 1 : 2);
    size.onchange = () => { if (size.value === '1') b.span = 1; else delete b.span; changed(); };
    const kids = [h('div', { class: 'row' }, h('div', { class: 'grow' }, field('다이얼 종류', type)), field('크기', size))];
    if (d.type === 'lumetri') {
      const LUMETRI = [['exposure', '노출 (Exposure)'], ['contrast', '대비 (Contrast)'], ['highlights', '밝은 영역 (Highlights)'], ['shadows', '어두운 영역 (Shadows)'],
        ['whites', '흰색 (Whites)'], ['blacks', '검정 (Blacks)'], ['temperature', '색온도 (Temperature)'], ['saturation', '채도 (Saturation)']];
      const param = h('select', {}, ...LUMETRI.map(([v, n]) => h('option', { value: v }, n)));
      param.value = d.param || 'exposure';
      param.onchange = () => { d.param = param.value; changed(); };
      const num = (key, def) => {
        const n = h('input', { type: 'number', min: 0.01, max: 50, step: 0.01, value: d[key] || def });
        n.oninput = () => { const v = parseFloat(n.value); d[key] = v > 0 ? Math.round(v * 1000) / 1000 : def; changed(); };
        return n;
      };
      kids.push(
        h('div', { class: 'hint', style: 'text-align:left;line-height:1.6' },
          '프리미어에서 ', h('b', {}, '선택한 클립'), '(없으면 재생 헤드 아래 클립)의 Lumetri Color 값을 직접 바꿉니다. 가운데를 탭하면 기본값으로 돌아갑니다. ',
          'Phone Deck Bridge 확장이 설치되어 있어야 합니다.'),
        field('조절할 항목', param),
        h('div', { class: 'row' }, field('정밀: 1칸당', num('step', 0.1)), field('빠르게: 1칸당', num('fastStep', 1))));
    } else if (d.type === 'wheel') {
      const num = (key, def) => {
        const n = h('input', { type: 'number', min: 1, max: 20, value: d[key] || def });
        n.oninput = () => { d[key] = Math.max(1, parseInt(n.value, 10) || def); changed(); };
        return n;
      };
      const axis = h('select', {}, h('option', { value: 'y' }, '세로 휠 (일반 스크롤)'), h('option', { value: 'x' }, '가로 휠'));
      axis.value = d.axis === 'x' ? 'x' : 'y';
      axis.onchange = () => { if (axis.value === 'x') d.axis = 'x'; else delete d.axis; changed(); };
      kids.push(
        h('div', { class: 'hint', style: 'text-align:left;line-height:1.6' },
          '마우스 커서가 있는 곳에서 휠을 굴립니다. 시계 방향 = 휠 위로. 클릭하지 않기 때문에 값을 잘못 건드릴 걱정이 적습니다.'),
        h('div', { class: 'row' }, field('정밀: 1칸당 휠', num('step', 1)), field('빠르게: 1칸당 휠', num('fastStep', 3))),
        field('휠 방향', axis),
        field('굴리는 동안 누르고 있을 키 (선택, 예: ctrl, alt)', keyRecorder(d.hold || '', v => { if (v) d.hold = v; else delete d.hold; changed(); })));
    } else if (d.type === 'mouse') {
      const num = (key, def) => {
        const n = h('input', { type: 'number', min: 1, max: 100, value: d[key] || def });
        n.oninput = () => { d[key] = Math.max(1, parseInt(n.value, 10) || def); changed(); };
        return n;
      };
      const axis = h('select', {}, h('option', { value: 'x' }, '좌우로 끌기 (대부분)'), h('option', { value: 'y' }, '위아래로 끌기'));
      axis.value = d.axis || 'x';
      axis.onchange = () => { if (axis.value === 'y') d.axis = 'y'; else delete d.axis; changed(); };
      kids.push(
        h('div', { class: 'hint', style: 'text-align:left;line-height:1.6' },
          '마우스 커서를 프리미어·애프터 이펙트의 ', h('b', {}, '숫자 값 위'), '에 올려 두고 다이얼을 돌리면, 그 값을 마우스로 끄는 것처럼 조절합니다. ',
          '슬라이더 막대보다 숫자 위에서 가장 잘 동작합니다.'),
        h('div', { class: 'row' }, field('정밀: 1칸당 픽셀', num('step', 1)), field('빠르게: 1칸당 픽셀', num('fastStep', 5))),
        field('끄는 방향', axis),
        field('끄는 동안 누르고 있을 키 (선택, 예: ctrl)', keyRecorder(d.hold || '', v => { if (v) d.hold = v; else delete d.hold; changed(); })));
    } else if (d.type === 'volume') {
      const num = (key, def) => {
        const n = h('input', { type: 'number', min: 1, max: 20, value: d[key] || def });
        n.oninput = () => { d[key] = Math.max(1, parseInt(n.value, 10) || def); changed(); };
        return n;
      };
      kids.push(h('div', { class: 'row' }, field('정밀: 1칸당 %', num('step', 1)), field('빠르게: 1칸당 %', num('fastStep', 5))));
    } else {
      const rk = (key, name) => field(name, keyRecorder(d[key] || '', v => { if (v) d[key] = v; else delete d[key]; changed(); }));
      kids.push(rk('left', '왼쪽으로 돌릴 때'), rk('right', '오른쪽으로 돌릴 때'),
        rk('fastLeft', '빠르게 모드 · 왼쪽 (비우면 위와 같음)'), rk('fastRight', '빠르게 모드 · 오른쪽 (비우면 위와 같음)'));
    }
    const pressNote = d.type === 'volume' ? '비워 두면 음소거 전환'
      : d.type === 'lumetri' ? '비워 두면 기본값으로 되돌리기' : '비워 두면 아무 동작 안 함';
    kids.push(field(`가운데를 탭하면 (${pressNote})`,
      actionEditor(d.press || null, a => { if (a) d.press = a; else delete d.press; changed(); }, { allowNone: true, allowMulti: true })));
    box.replaceChildren(...kids);
  };
  draw();
  return box;
}

// ---------- 동작 편집 ----------
const ACTION_TYPES = [
  ['hotkey', '단축키 누르기'],
  ['text', '글자 입력하기'],
  ['open', '프로그램 · 웹사이트 · 폴더 열기'],
  ['volume', '볼륨 올리기/내리기'],
  ['volmute', '음소거 켜기/끄기'],
  ['page', '다른 페이지로 이동'],
  ['run', '명령어 실행 (고급)'],
  ['multi', '여러 동작 차례로 실행'],
];
const DEFAULTS = {
  hotkey: () => ({ type: 'hotkey', keys: '' }),
  text: () => ({ type: 'text', text: '' }),
  open: () => ({ type: 'open', target: '' }),
  volume: () => ({ type: 'volume', delta: 5 }),
  volmute: () => ({ type: 'volmute' }),
  page: () => ({ type: 'page', page: (cfg.pages[0] || {}).name || 0 }),
  run: () => ({ type: 'run', command: '' }),
  multi: () => ({ type: 'multi', steps: [{ type: 'hotkey', keys: '' }] }),
  delay: () => ({ type: 'delay', ms: 300 }),
};

function actionEditor(action, onChange, opts = {}) {
  const box = h('div', { class: 'box' });
  let a = action ? JSON.parse(JSON.stringify(action)) : null;
  const emit = () => onChange(a ? JSON.parse(JSON.stringify(a)) : null);

  const draw = () => {
    const types = ACTION_TYPES.filter(([t]) => t !== 'multi' || opts.allowMulti);
    if (opts.inMulti) types.push(['delay', '잠시 기다리기']);
    const typeSel = h('select', {},
      opts.allowNone ? h('option', { value: '' }, '(없음)') : null,
      ...types.map(([t, n]) => h('option', { value: t }, n)));
    typeSel.value = a ? a.type : '';
    typeSel.onchange = () => { a = typeSel.value ? DEFAULTS[typeSel.value]() : null; emit(); draw(); };
    const kids = [typeSel];
    if (a) kids.push(...actionFields(a, () => emit(), draw));
    box.replaceChildren(...kids);
  };
  draw();
  return box;
}

function actionFields(a, emit, redraw) {
  const text = (key, ph, opts = {}) => {
    const el = opts.multiline ? h('textarea', { placeholder: ph }) : h('input', { placeholder: ph });
    el.value = a[key] || '';
    el.oninput = () => { a[key] = el.value; emit(); };
    return el;
  };
  switch (a.type) {
    case 'hotkey':
      return [keyRecorder(a.keys || '', v => { a.keys = v; emit(); }),
        h('div', { class: 'hint', style: 'text-align:left' }, '쉼표로 여러 번 누르기: ctrl+a, ctrl+c')];
    case 'text': {
      const enter = h('input', { type: 'checkbox', checked: !!a.enter });
      enter.onchange = () => { if (enter.checked) a.enter = true; else delete a.enter; emit(); };
      return [text('text', '입력할 글자 (한글, 이모지 가능)', { multiline: true }), h('label', { class: 'row' }, enter, '입력한 뒤 Enter 누르기')];
    }
    case 'open': {
      const pickBtn = h('button', { class: 'btn small', type: 'button', onclick: () => pickApp(app => {
        Object.keys(a).forEach(k => delete a[k]);
        Object.assign(a, app.action);
        emit();
        redraw();
        toast(`"${app.name}" 선택됨 — 아이콘에서 "앱 아이콘"을 고르면 실제 앱 아이콘이 표시됩니다`);
      }) }, '설치된 앱에서 고르기');
      return [
        field('열 대상', text('target', platform === 'mac' ? '앱 이름(Google Chrome), https://주소, ~/폴더' : 'https://주소, C:\\경로\\프로그램.exe, explorer.exe')),
        field('추가 인자 (선택)', text('args', platform === 'mac' ? '예: https://www.youtube.com' : '예: --new-window https://www.youtube.com')),
        h('div', { class: 'row' }, pickBtn),
      ];
    }
    case 'volume': {
      const n = h('input', { type: 'number', min: -100, max: 100, value: a.delta || 0 });
      n.oninput = () => { a.delta = parseInt(n.value, 10) || 0; emit(); };
      return [h('div', { class: 'row' }, n, h('span', { class: 'hint' }, '% (내리려면 -5 처럼 음수)'))];
    }
    case 'volmute':
      return [];
    case 'page': {
      const s = h('select', {}, ...cfg.pages.map((p, i) => h('option', { value: p.name || String(i) }, p.name || `페이지 ${i + 1}`)));
      s.value = typeof a.page === 'number' ? ((cfg.pages[a.page] || {}).name || '') : a.page;
      s.onchange = () => { a.page = s.value; emit(); };
      return [s];
    }
    case 'run':
      return [text('command', platform === 'mac' ? 'zsh 명령' : 'PowerShell 명령', { multiline: true }),
        h('div', { class: 'warn' }, '⚠ 입력한 명령이 이 PC에서 그대로 실행됩니다. 직접 이해하는 명령만 넣으세요.')];
    case 'delay': {
      const n = h('input', { type: 'number', min: 0, max: 10000, value: a.ms || 0 });
      n.oninput = () => { a.ms = Math.max(0, parseInt(n.value, 10) || 0); emit(); };
      return [h('div', { class: 'row' }, n, h('span', { class: 'hint' }, 'ms (1000 = 1초)'))];
    }
    case 'multi': {
      const list = h('div', { class: 'steps' });
      const drawSteps = () => {
        list.replaceChildren(...(a.steps || []).map((s, i) => {
          const head = h('div', { class: 'step-head' }, h('span', { class: 'grow' }, `${i + 1}단계`),
            h('button', { class: 'icon-btn', type: 'button', title: '위로', onclick: () => { if (i > 0) { [a.steps[i - 1], a.steps[i]] = [a.steps[i], a.steps[i - 1]]; emit(); drawSteps(); } } }, icon('chevron-up')),
            h('button', { class: 'icon-btn', type: 'button', title: '아래로', onclick: () => { if (i < a.steps.length - 1) { [a.steps[i + 1], a.steps[i]] = [a.steps[i], a.steps[i + 1]]; emit(); drawSteps(); } } }, icon('chevron-down')),
            h('button', { class: 'icon-btn', type: 'button', title: '삭제', onclick: () => { a.steps.splice(i, 1); emit(); drawSteps(); } }, icon('x')));
          return h('div', { class: 'step' }, head, actionEditor(s, v => { a.steps[i] = v || DEFAULTS.hotkey(); emit(); }, { inMulti: true }));
        }));
      };
      drawSteps();
      const add = h('button', { class: 'btn small', type: 'button', onclick: () => { (a.steps = a.steps || []).push(DEFAULTS.hotkey()); emit(); drawSteps(); } }, '＋ 단계 추가');
      return [list, add];
    }
    default:
      return [h('div', { class: 'hint' }, `알 수 없는 동작: ${a.type}`)];
  }
}

// ---------- 단축키 녹화 ----------
let recording = null;
const CODE_NAMES = {
  Space: 'space', Enter: 'enter', NumpadEnter: 'enter', Escape: 'esc', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', Insert: 'insert',
  Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  Minus: 'minus', Equal: 'equal', Comma: 'comma', Period: 'period', Slash: 'slash', Semicolon: 'semicolon', Quote: 'quote',
  BracketLeft: '[', BracketRight: ']', Backslash: 'backslash', Backquote: 'backtick', PrintScreen: 'printscreen', CapsLock: 'capslock',
  NumpadAdd: 'add', NumpadSubtract: 'subtract', NumpadMultiply: 'multiply', NumpadDivide: 'divide', NumpadDecimal: 'decimal',
  Lang1: 'hangul', Lang2: 'hanja', HangulMode: 'hangul', ContextMenu: 'menu',
  MediaPlayPause: 'playpause', MediaTrackNext: 'next', MediaTrackPrevious: 'prev', AudioVolumeMute: 'mute', AudioVolumeUp: 'volup', AudioVolumeDown: 'voldown',
};
function keyName(e) {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  if (/^Numpad[0-9]$/.test(c)) return 'num' + c.slice(6);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c.toLowerCase();
  return CODE_NAMES[c] || null;
}
const SPECIAL = [['', '특수 키 넣기…'], ['playpause', '재생/일시정지'], ['next', '다음 곡'], ['prev', '이전 곡'], ['mute', '음소거 키'],
  ['volup', '볼륨 + 키'], ['voldown', '볼륨 - 키'], ['hangul', '한/영'], ['printscreen', 'Print Screen'], ['f13', 'F13'], ['f14', 'F14'], ['f15', 'F15']];

function keyRecorder(value, onChange) {
  const input = h('input', { value, placeholder: platform === 'mac' ? '예: cmd+shift+4' : '예: ctrl+shift+s', spellcheck: 'false' });
  input.oninput = () => onChange(input.value.trim());
  const rec = h('button', { class: 'btn small', type: 'button' }, '⏺ 녹화');
  const stop = () => {
    recording = null;
    input.classList.remove('recording');
    rec.textContent = '⏺ 녹화';
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = e => {
    e.preventDefault();
    e.stopPropagation();
    if (['Control', 'Shift', 'Alt', 'Meta', 'OS'].includes(e.key)) return;   // 수정키만 누른 상태는 기다림
    const k = keyName(e);
    if (!k) { toast('이 키는 녹화할 수 없습니다. 직접 입력해 주세요.', true); return; }
    const mods = [];
    if (e.ctrlKey) mods.push('ctrl');
    if (e.metaKey) mods.push(platform === 'mac' ? 'cmd' : 'win');
    if (e.altKey) mods.push(platform === 'mac' ? 'option' : 'alt');
    if (e.shiftKey) mods.push('shift');
    input.value = [...mods, k].join('+');
    onChange(input.value);
    stop();
  };
  rec.onclick = () => {
    if (recording === stop) return stop();   // 같은 버튼을 다시 누르면 취소
    if (recording) recording();               // 다른 칸에서 녹화 중이면 그것부터 끝냄
    recording = stop;
    input.classList.add('recording');
    input.value = '';
    rec.textContent = '키를 누르세요… (취소)';
    window.addEventListener('keydown', onKey, true);
  };
  const special = h('select', {}, ...SPECIAL.map(([v, n]) => h('option', { value: v }, n)));
  special.onchange = () => {
    if (!special.value) return;
    input.value = input.value.trim() ? `${input.value.trim()}, ${special.value}` : special.value;
    special.value = '';
    onChange(input.value);
  };
  return h('div', { class: 'field' }, h('div', { class: 'rec' }, input, rec), special,
    h('div', { class: 'hint', style: 'text-align:left' }, 'Ctrl+W, Ctrl+T 처럼 브라우저가 가로채는 키는 직접 입력하세요.'));
}

// ---------- 설치된 앱 고르기 ----------
let apps = null;
async function pickApp(onPick) {
  const modal = $('appModal'), list = $('appList'), q = $('appSearch');
  modal.hidden = false;
  q.value = '';
  list.replaceChildren(h('div', { class: 'hint' }, '앱 목록을 불러오는 중…'));
  try { if (!apps) apps = (await call('/api/pc/apps')).apps; }
  catch (e) { list.replaceChildren(h('div', { class: 'hint' }, '앱 목록을 불러오지 못했습니다: ' + e.message)); return; }
  const draw = () => {
    const s = q.value.trim().toLowerCase();
    const hits = apps.filter(a => a.name.toLowerCase().includes(s)).slice(0, 300);
    list.replaceChildren(...hits.map(a => h('button', { type: 'button', onclick: () => { modal.hidden = true; onPick(a); } }, a.name)));
    if (!hits.length) list.append(h('div', { class: 'hint' }, '검색 결과가 없습니다'));
  };
  q.oninput = draw;
  draw();
  q.focus();
}
$('appClose').onclick = () => { $('appModal').hidden = true; };
$('appModal').onclick = e => { if (e.target === $('appModal')) $('appModal').hidden = true; };

// ---------- 시작 ----------
load().then(loadClientCfg).catch(e => toast('불러오기 실패: ' + e.message, true));
