// Phone Deck — iPhone을 스트림덱처럼 쓰는 Wi-Fi 리모컨 (PC 에이전트)
// 의존성 없음: Node 18+ 만 있으면 됩니다.  실행: node server.js
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn, execFile, execFileSync } = require('child_process');
const mdns = require('./mdns');
let localName = null;   // 예: phonedeck.local

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8765;
const IS_MAC = process.platform === 'darwin';
// 내 버튼 설정: Windows 는 config.json, 맥은 config.mac.json (Cmd 단축키, 맥 앱 이름)
const CONFIG_NAME = IS_MAC ? 'config.mac.json' : 'config.json';
const CONFIG_PATH = path.join(ROOT, CONFIG_NAME);
// 처음 실행하면 기본 설정(config.default.json)을 복사해서 내 설정 파일을 만듦 — 기본 설정 파일은 업데이트해도 내 설정은 그대로
if (!fs.existsSync(CONFIG_PATH)) {
  const def = path.join(ROOT, IS_MAC ? 'config.mac.default.json' : 'config.default.json');
  if (fs.existsSync(def)) {
    fs.copyFileSync(def, CONFIG_PATH);
    console.log(`  ✓ 기본 설정으로 ${CONFIG_NAME} 을 만들었습니다`);
  }
}
const MAC_HELPER_SRC = path.join(ROOT, 'mac', 'helper.swift');
const MAC_HELPER_BIN = path.join(ROOT, 'mac', 'helper');
const TOKEN_PATH = path.join(ROOT, '.token');
const PUBLIC_DIR = path.join(ROOT, 'public');
const ICON_DIR = path.join(ROOT, 'icons');
const ICON_CACHE = path.join(ICON_DIR, '.cache');

// ---------- 접속 토큰 (같은 Wi-Fi의 다른 사람이 PC를 조작하지 못하게) ----------
function loadToken() {
  try {
    const t = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
    if (t) return t;
  } catch {}
  const t = crypto.randomBytes(9).toString('base64url');
  fs.writeFileSync(TOKEN_PATH, t);
  return t;
}
const TOKEN = loadToken();

function tokenOk(req, url) {
  const given = req.headers['x-deck-token'] || url.searchParams.get('t') || '';
  const a = Buffer.from(String(given));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// "이 PC에서 직접 연 화면"인지 확인
//  - 접속한 곳이 이 PC 자신이어야 하고
//  - 주소창 주소(Host)도 localhost 여야 함 (다른 웹사이트가 이름만 바꿔 127.0.0.1 로 접근하는 DNS rebinding 차단)
function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  if (!(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) return false;
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

// 다른 웹사이트가 몰래 보낸 요청이 아닌지 (브라우저는 다른 사이트에서 보낸 요청에 Origin 을 붙임)
function sameOriginOrNone(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return o.host === req.headers.host;
  } catch { return false; }
}

// ---------- 설정 파일 (저장하면 아이폰 화면이 자동 갱신) ----------
let config = { columns: 4, pages: [] };
let clientConfig = config;   // 폰으로 보내는 사본 (image → imageUrl 로 변환됨)
let configVersion = 0;
let configError = null;

// ---------- 버튼 이미지 ----------
//  "image": "auto"        → 액션이 여는 프로그램의 아이콘을 자동 추출
//  "image": "logo.png"    → icons 폴더 안의 파일
//  "image": "https://…"   → 인터넷 이미지
const autoIcons = new Map();   // 캐시 파일명 → 아이콘을 뽑을 원본 경로

function iconSource(action) {
  if (!action || action.type !== 'open') return null;
  if (IS_MAC) {   // 맥: 앱 이름("Google Chrome") 또는 경로("/Applications/Blender.app")
    const t = action.target || '';
    return t && !t.includes('://') ? t : null;
  }
  if (/^shell:/i.test(action.args || '')) return action.args;
  if (/^shell:/i.test(action.target || '')) return action.target;
  if (/^[a-z]:\\/i.test(action.target || '')) return action.target;
  return null;
}

function resolveImage(btn) {
  const img = btn.image;
  if (!img || typeof img !== 'string') return null;
  if (img === 'auto') {
    const src = iconSource(btn.action);
    if (!src) return null;
    const file = crypto.createHash('sha1').update(src.toLowerCase()).digest('hex').slice(0, 16) + '.png';
    autoIcons.set(file, src);
    return `/icons/auto/${file}`;
  }
  if (/^https?:\/\//i.test(img)) return img;
  return `/icons/${encodeURIComponent(path.basename(img))}`;
}

function buildClientConfig() {
  autoIcons.clear();
  clientConfig = {
    ...config,
    pages: (config.pages || []).map(p => ({
      ...p,
      buttons: (p.buttons || []).map(b => {
        if (!b || !b.image) return b;
        return { ...b, imageUrl: resolveImage(b) };
      }),
    })),
  };
}

const extracting = new Map();
function extractIcon(file) {
  const out = path.join(ICON_CACHE, file);
  if (fs.existsSync(out)) return Promise.resolve(out);
  if (extracting.has(file)) return extracting.get(file);
  const src = autoIcons.get(file);
  if (!src) return Promise.reject(new Error('unknown icon'));
  fs.mkdirSync(ICON_CACHE, { recursive: true });
  const [cmd, args] = IS_MAC
    ? [MAC_HELPER_BIN, ['--icon', src, out]]
    : ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(ROOT, 'extract-icon.ps1'), '-Source', src, '-Out', out]];
  const job = new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20000 }, err => {
        extracting.delete(file);
        if (err || !fs.existsSync(out)) {
          console.error(`  ⚠ 아이콘 추출 실패: ${src}`);
          return reject(err || new Error('extract failed'));
        }
        resolve(out);
      });
  });
  extracting.set(file, job);
  return job;
}

let configHash = '';
const hashOf = text => crypto.createHash('sha1').update(text).digest('hex');
const readConfigText = () => fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^[\s﻿]+/, '');

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
    configHash = hashOf(raw);
    config = JSON.parse(raw);
    buildClientConfig();
    configError = null;
  } catch (e) {
    configError = `${CONFIG_NAME} 오류: ${e.message}`;
    console.error('  ⚠ ' + configError);
  }
  configVersion++;
  broadcast('config', { version: configVersion });
}

let reloadTimer = null;
fs.watch(ROOT, (_evt, file) => {
  if (file !== CONFIG_NAME) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    // 편집 화면이 방금 저장한 내용이면 다시 읽지 않음 (버전이 두 번 오르는 것 방지)
    try { if (hashOf(readConfigText()) === configHash) return; } catch {}
    loadConfig();
    if (!configError) console.log(`  ↻ ${CONFIG_NAME} 다시 불러옴`);
  }, 150);
});

// ---------- 설정 저장 (편집 화면용) ----------
// 사람이 읽고 고치기 쉽게: 버튼 하나당 한 줄
function formatConfig(cfg) {
  const one = v => v === null || typeof v !== 'object' ? JSON.stringify(v)
    : Array.isArray(v) ? '[' + v.map(one).join(', ') + ']'
    : Object.keys(v).length === 0 ? '{}'
    : '{ ' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + one(x)).join(', ') + ' }';
  const top = Object.entries(cfg).filter(([k]) => k !== 'pages').map(([k, v]) => '  ' + JSON.stringify(k) + ': ' + one(v));
  const pages = (cfg.pages || []).map(p => {
    const { name, buttons, ...rest } = p;
    const extra = Object.entries(rest).map(([k, v]) => '      ' + JSON.stringify(k) + ': ' + one(v) + ',\n').join('');
    return '    {\n      "name": ' + JSON.stringify(name || '') + ',\n' + extra + '      "buttons": [\n'
      + (buttons || []).map(b => '        ' + one(b || {})).join(',\n') + '\n      ]\n    }';
  });
  return '{\n' + top.map(l => l + ',\n').join('') + '  "pages": [\n' + pages.join(',\n') + '\n  ]\n}\n';
}

function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.pages)) throw new Error('pages 가 없습니다');
  for (const p of cfg.pages) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.buttons)) throw new Error('페이지에 buttons 가 없습니다');
  }
}

// 버튼 속성 순서를 항상 같게: 이름 → 아이콘 → 이미지 → 색 → 크기 → 동작/다이얼
const KEY_ORDER = ['label', 'icon', 'image', 'color', 'span', 'action', 'dial'];
function tidyButton(b) {
  if (!b || typeof b !== 'object') return {};
  const out = {};
  for (const k of KEY_ORDER) if (k in b) out[k] = b[k];
  for (const k of Object.keys(b)) if (!(k in out)) out[k] = b[k];
  delete out.imageUrl;   // 화면용으로만 쓰는 값은 저장하지 않음
  return out;
}

function saveConfig(cfg) {
  validateConfig(cfg);
  cfg.pages = cfg.pages.map(p => ({ ...p, buttons: p.buttons.map(tidyButton) }));
  const text = formatConfig(cfg);
  // 저장 직전 상태를 한 단계 백업 (config.backup.json)
  try { fs.copyFileSync(CONFIG_PATH, CONFIG_PATH.replace(/\.json$/, '.backup.json')); } catch {}
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, CONFIG_PATH);
  loadConfig();
}

const clone = v => JSON.parse(JSON.stringify(v));
const isEmptyButton = b => !b || (!b.action && !b.dial && !b.label);

// ---------- 키 입력 도우미 (상주 PowerShell 1개로 지연 최소화) ----------
let helper = null;
let volume = null;   // 마지막으로 확인한 PC 볼륨 { level, mute }
// 맥: Swift 도우미를 처음 한 번(또는 소스가 바뀌었을 때) 빌드
function buildMacHelper() {
  const fresh = fs.existsSync(MAC_HELPER_BIN)
    && fs.statSync(MAC_HELPER_BIN).mtimeMs >= fs.statSync(MAC_HELPER_SRC).mtimeMs;
  if (fresh) return;
  console.log('  ⚙ 맥용 도우미를 빌드합니다 (처음 한 번, 1~2분 걸릴 수 있음)...');
  try {
    execFileSync('swiftc', ['-O', MAC_HELPER_SRC, '-o', MAC_HELPER_BIN], { stdio: 'inherit', timeout: 300000 });
  } catch (e) {
    console.error('\n  ✖ 맥용 도우미 빌드 실패. 터미널에서 아래 명령으로 개발 도구를 설치한 뒤 다시 실행하세요:');
    console.error('      xcode-select --install\n');
    process.exit(1);
  }
}

function startHelper() {
  helper = IS_MAC
    ? spawn(MAC_HELPER_BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(ROOT, 'helper.ps1'),
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', d => {
    for (const raw of d.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const fg = /^FG (.*)$/.exec(line);
      if (fg) { onForeground(fg[1].trim()); continue; }
      const m = /^VOL (\d+) ([01])$/.exec(line);
      if (m) {   // 볼륨이 바뀔 때마다 폰 화면의 숫자를 갱신
        volume = { level: Number(m[1]), mute: m[2] === '1' };
        broadcast('volume', volume);
        continue;
      }
      console.log('  [helper] ' + line);
    }
  });
  helper.stderr.setEncoding('utf8');
  helper.stderr.on('data', d => console.error('  [helper 오류] ' + d.trim()));
  helper.on('exit', code => {
    console.error(`  [helper] 종료됨 (code ${code}) — 1초 후 재시작`);
    helper = null;
    setTimeout(startHelper, 1000);
  });
}

function sendHelper(cmd) {
  if (!helper) throw new Error('키 입력 도우미가 아직 준비되지 않았습니다');
  // 한 줄 JSON. 비ASCII(한글 등)는 \u 이스케이프로 보내 인코딩 문제를 피함
  const line = JSON.stringify(cmd).replace(/[\u007f-\uffff]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  helper.stdin.write(line + '\n');
}

// ---------- 앞에 떠 있는 프로그램 감시 (프로그램별 자동 페이지 전환) ----------
let foreground = '';
const recentApps = [];   // PC 편집 화면에서 고를 수 있게 최근 앞에 있던 프로그램 기록
function onForeground(name) {
  if (!name || name === foreground) return;
  foreground = name;
  const i = recentApps.indexOf(name);
  if (i >= 0) recentApps.splice(i, 1);
  recentApps.unshift(name);
  recentApps.length = Math.min(recentApps.length, 15);
  broadcast('app', { name });
}
setInterval(() => {   // 폰이 연결돼 있을 때만 0.7초마다 확인
  if (helper && clients.size) { try { sendHelper({ op: 'fg' }); } catch {} }
}, 700);

// ---------- 프리미어 브리지 (Lumetri 색보정 다이얼) ----------
// 프리미어 안의 Phone Deck Bridge 확장이 /api/pc/premiere/next 로 할 일을 가져가 실행하고 결과를 돌려줌
const LUMETRI_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'saturation'];
const premiere = { queue: [], waiter: null, lastSeen: 0, version: '', last: null };
const premiereConnected = () => !!premiere.waiter || Date.now() - premiere.lastSeen < 40000;

function premiereSend(cmd, { quiet = false } = {}) {
  if (!premiereConnected()) {
    if (quiet) return;
    throw new Error('프리미어와 연결되지 않았습니다. Phone Deck Bridge 를 설치하고 프리미어를 다시 실행하세요');
  }
  // 같은 항목을 연달아 돌리면 하나로 합쳐 보냄
  const same = cmd.op === 'lumetri' && !cmd.reset && premiere.queue.find(c => c.op === 'lumetri' && c.key === cmd.key && !c.reset);
  if (same) same.delta = Math.round((same.delta + cmd.delta) * 1000) / 1000;
  else if (!(cmd.op === 'lumetri-read' && premiere.queue.some(c => c.op === cmd.op && c.key === cmd.key))) premiere.queue.push(cmd);
  flushPremiere();
}

function flushPremiere() {
  if (!premiere.waiter || !premiere.queue.length) return;
  const res = premiere.waiter;
  premiere.waiter = null;
  clearTimeout(res.premiereTimer);
  premiere.inflight = premiere.queue.splice(0);   // 결과가 같은 순서로 돌아오므로 어떤 명령의 결과인지 알 수 있음
  json(res, 200, { commands: premiere.inflight });
}

// "%USERPROFILE%\Videos" 처럼 Windows 환경 변수를 쓴 경로를 실제 경로로 바꿈 (PC마다 다른 사용자 폴더 대응)
function expandEnv(s) {
  return String(s || '').replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, name) => {
    const key = Object.keys(process.env).find(k => k.toLowerCase() === name.toLowerCase());
    return key ? process.env[key] : m;
  });
}

// ---------- 액션 실행 ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runAction(action) {
  if (!action || typeof action !== 'object') throw new Error('액션이 비어 있습니다');
  switch (action.type) {
    case 'hotkey':   // { "type":"hotkey", "keys":"ctrl+shift+esc" }
      sendHelper({ op: 'hotkey', keys: String(action.keys || '') });
      break;
    case 'text':     // { "type":"text", "text":"안녕하세요", "enter":true }
      sendHelper({ op: 'text', text: String(action.text || '') });
      if (action.enter) sendHelper({ op: 'hotkey', keys: 'enter' });
      break;
    case 'open':     // { "type":"open", "target":"https://youtube.com" | "notepad" | "C:\\path\\app.exe", "args":"" }
      sendHelper({ op: 'open', target: expandEnv(action.target), args: expandEnv(action.args) });
      break;
    case 'run':      // { "type":"run", "command":"PowerShell 명령" }
      sendHelper({ op: 'run', command: String(action.command || '') });
      break;
    case 'volume':   // { "type":"volume", "delta": 5 }  — 볼륨을 % 단위로 올리고 내림
      sendHelper({ op: 'vol', delta: Math.trunc(Number(action.delta) || 0) });
      break;
    case 'volmute':  // { "type":"volmute" }  — 음소거 전환
      sendHelper({ op: 'volmute' });
      break;
    case 'lumetri':  // { "type":"lumetri", "key":"exposure", "delta":0.1 } 또는 { ..., "reset": true }
      if (!LUMETRI_KEYS.includes(action.key)) throw new Error(`알 수 없는 Lumetri 항목: ${action.key}`);
      premiereSend({ op: 'lumetri', key: action.key, delta: Number(action.delta) || 0, reset: !!action.reset });
      break;
    case 'delay':    // { "type":"delay", "ms":300 }
      await sleep(Math.min(Number(action.ms) || 0, 10000));
      break;
    case 'multi':    // { "type":"multi", "steps":[ ...액션들 ] }
      for (const step of action.steps || []) {
        await runAction(step);
        if (step.type !== 'delay') await sleep(Number(action.gap) || 60);
      }
      break;
    default:
      throw new Error(`알 수 없는 액션 종류: ${action.type}`);
  }
}

// ---------- 다이얼 ----------
//  "dial": { "type": "volume", "step": 1, "fastStep": 5 }                       → PC 볼륨 (1% 단위)
//  "dial": { "type": "keys", "left": "left", "right": "right",
//            "fastLeft": "shift+left", "fastRight": "shift+right" }            → 1틱마다 단축키 1번
//  "press": { ...액션 }   → 다이얼 가운데를 탭했을 때 (volume 은 기본값이 음소거 전환)
async function turnDial(dial, ticks, fast) {
  ticks = Math.max(-60, Math.min(60, Math.trunc(Number(ticks) || 0)));
  if (!ticks) return;
  if (dial.type === 'volume') {
    const step = Number(fast ? (dial.fastStep || 5) : (dial.step || 1));
    sendHelper({ op: 'vol', delta: ticks * step });
    return;
  }
  if (dial.type === 'keys') {
    const keys = ticks > 0
      ? (fast && dial.fastRight) || dial.right
      : (fast && dial.fastLeft) || dial.left;
    if (!keys) throw new Error('다이얼에 left/right 키가 지정되지 않았습니다');
    const n = Math.abs(ticks);
    for (let i = 0; i < n; i++) sendHelper({ op: 'hotkey', keys });
    return;
  }
  if (dial.type === 'mouse') {
    // 마우스 드래그 흉내: 커서를 올려 둔 숫자 값(색보정 슬라이더 등)을 좌우로 끌어서 조절
    const px = Number(fast ? (dial.fastStep || 5) : (dial.step || 1)) * ticks;
    const vertical = dial.axis === 'y';
    sendHelper({ op: 'scrub', dx: vertical ? 0 : px, dy: vertical ? -px : 0, hold: String(dial.hold || '') });
    return;
  }
  if (dial.type === 'lumetri') {
    // 프리미어 Lumetri 값을 직접 조절 (1칸 = step, 빠르게 = fastStep)
    if (!LUMETRI_KEYS.includes(dial.param)) throw new Error(`알 수 없는 Lumetri 항목: ${dial.param}`);
    const step = Number(fast ? (dial.fastStep || 1) : (dial.step || 0.1));
    premiereSend({ op: 'lumetri', key: dial.param, delta: Math.round(step * ticks * 1000) / 1000 });
    return;
  }
  if (dial.type === 'wheel') {
    // 마우스 휠: 커서 아래 값/화면을 휠로 조절 (시계 방향 = 휠 위로)
    const n = Number(fast ? (dial.fastStep || 3) : (dial.step || 1)) * ticks;
    sendHelper({ op: 'wheel', n, horizontal: dial.axis === 'x', hold: String(dial.hold || '') });
    return;
  }
  throw new Error(`알 수 없는 다이얼 종류: ${dial.type}`);
}

function dialPressAction(btn) {
  if (btn.dial.press) return btn.dial.press;
  if (btn.dial.type === 'volume') return { type: 'volmute' };
  if (btn.dial.type === 'lumetri') return { type: 'lumetri', key: btn.dial.param, reset: true };   // 탭 = 기본값으로
  return null;
}

function findButton(pageIdx, btnIdx) {
  const page = (config.pages || [])[pageIdx];
  return page && (page.buttons || [])[btnIdx];
}

// ---------- 실시간 연결 (Server-Sent Events) ----------
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => broadcast('ping', { t: Date.now() }), 15000);

// ---------- 홈 화면 아이콘 (PNG를 코드로 생성) ----------
function makeIconPng(size) {
  const px = Buffer.alloc(size * size * 4);
  const grid = 3, pad = size * 0.16, gap = size * 0.06;
  const cell = (size - pad * 2 - gap * (grid - 1)) / grid;
  const r = cell * 0.22;
  const colors = [[255, 92, 92], [255, 179, 64], [92, 200, 120], [80, 160, 255], [170, 110, 255], [255, 110, 190], [70, 210, 210], [240, 220, 90], [140, 150, 170]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = y / size;
      let c = [Math.round(28 - 10 * t), Math.round(30 - 10 * t), Math.round(40 - 8 * t)];
      const gx = Math.floor((x - pad) / (cell + gap)), gy = Math.floor((y - pad) / (cell + gap));
      if (gx >= 0 && gx < grid && gy >= 0 && gy < grid) {
        const lx = x - pad - gx * (cell + gap), ly = y - pad - gy * (cell + gap);
        if (lx <= cell && ly <= cell) {
          const dx = Math.max(r - lx, 0, lx - (cell - r)), dy = Math.max(r - ly, 0, ly - (cell - r));
          if (dx * dx + dy * dy <= r * r) c = colors[gy * grid + gx];
        }
      }
      const i = (y * size + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  const crc = b => { let c = ~0; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (~c) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const ICON = makeIconPng(180);

// ---------- HTTP 서버 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function sendImage(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'max-age=3600' });
    res.end(data);
  });
}

function lanAddresses() {
  return mdns.lanInterfaces().map(i => i.address);
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('파일이 너무 큽니다')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// 이미지 종류는 파일 앞부분(매직 넘버)으로 판별
function imageExt(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return null;
}

let appsCache = null;
function listApps() {   // PC 편집 화면의 "앱 고르기" 목록
  if (appsCache) return Promise.resolve(appsCache);
  if (IS_MAC) {
    const apps = [];
    for (const dir of ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')]) {
      try {
        for (const f of fs.readdirSync(dir)) if (f.endsWith('.app')) apps.push({ name: f.slice(0, -4), action: { type: 'open', target: f.slice(0, -4) } });
      } catch {}
    }
    apps.sort((a, b) => a.name.localeCompare(b.name));
    return Promise.resolve(appsCache = apps);
  }
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'],
    { windowsHide: true, timeout: 20000, maxBuffer: 8e6 }, (err, out) => {
      if (err) return reject(err);
      let list = [];
      try { list = JSON.parse(out); } catch {}
      if (!Array.isArray(list)) list = [list];
      appsCache = list.filter(a => a && a.Name && a.AppID && !/^https?:/i.test(a.AppID))
        .map(a => ({ name: a.Name, action: { type: 'open', target: 'explorer.exe', args: `shell:AppsFolder\\${a.AppID}` } }))
        .sort((a, b) => a.name.localeCompare(b.name));
      resolve(appsCache);
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // 아이폰 앱이 다른 컴퓨터(예: 맥)의 Phone Deck 도 조작할 수 있게 교차 출처 요청 허용.
  // 접속 코드가 필요한 API 와 아이콘만 해당 — PC 전용 API(/api/pc, /api/setup)는 절대 열지 않음
  const shared = (p.startsWith('/api/') && !p.startsWith('/api/pc/') && p !== '/api/setup' && p !== '/api/premiere-status') || p.startsWith('/icons/');
  if (shared) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Deck-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
  }
  if (req.method === 'OPTIONS') { res.writeHead(shared ? 204 : 403); return res.end(); }

  try {
    // 공개 파일 (UI 자체는 토큰 없이 받아도 조작은 불가)
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(res, 'index.html');
    // public 폴더의 화면 파일 (setup.html 은 PC 전용이라 제외)
    if (req.method === 'GET' && /^\/[\w.-]+\.(js|css)$/.test(p)) return serveFile(res, p.slice(1));
    if (req.method === 'GET' && p.startsWith('/icons/auto/')) {
      const file = path.basename(p);
      return extractIcon(file).then(f => sendImage(res, f), () => json(res, 404, { error: 'icon unavailable' }));
    }
    if (req.method === 'GET' && p.startsWith('/icons/')) {
      return sendImage(res, path.join(ICON_DIR, path.basename(decodeURIComponent(p))));
    }
    if (req.method === 'GET' && (p === '/icon.png' || p === '/apple-touch-icon.png')) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
      return res.end(ICON);
    }

    // PC에서만 열 수 있는 접속 안내 페이지 (QR 코드)
    if (req.method === 'GET' && p === '/setup') {
      if (!isLocal(req)) return json(res, 403, { error: 'PC에서만 열 수 있습니다' });
      return serveFile(res, 'setup.html');
    }

    // ---------- PC 전용 편집 화면 (버튼 동작까지 바꿀 수 있으므로 이 PC에서만 열림) ----------
    if (p === '/edit' || p.startsWith('/api/pc/')) {
      if (!isLocal(req)) return json(res, 403, { error: 'PC 편집 화면은 이 PC에서만 열 수 있습니다 (주소: http://localhost:8765/edit)' });
      if (req.method === 'GET' && p === '/edit') return serveFile(res, 'edit.html');
      // 편집 API 는 접속 코드도 필요 — 이 PC에서 연 다른 웹사이트가 몰래 버튼 동작을 바꾸거나 명령을 실행하지 못하게
      if (!sameOriginOrNone(req) || !tokenOk(req, url)) return json(res, 403, { error: '허용되지 않은 요청입니다' });
      if (req.method === 'GET' && p === '/api/pc/config') {
        return json(res, 200, { version: configVersion, error: configError, configName: CONFIG_NAME, platform: IS_MAC ? 'mac' : 'windows', config });
      }
      if (req.method === 'PUT' && p === '/api/pc/config') {
        const { version, config: next } = await readBody(req);
        if (version !== configVersion) return json(res, 409, { error: '다른 곳(아이폰 등)에서 설정이 바뀌었습니다. 새로고침한 뒤 다시 저장하세요.' });
        saveConfig(next);
        console.log('  ✎ PC 편집 화면에서 저장함');
        return json(res, 200, { version: configVersion });
      }
      if (req.method === 'GET' && p === '/api/pc/apps') return json(res, 200, { apps: await listApps() });
      // 프리미어 브리지: 할 일이 생길 때까지 최대 25초 기다렸다가 응답 (롱 폴링)
      if (req.method === 'GET' && p === '/api/pc/premiere/next') {
        premiere.lastSeen = Date.now();
        const ver = url.searchParams.get('premiere') || '';
        try { premiere.version = JSON.parse(ver).version || premiere.version; } catch { premiere.version = ver || premiere.version; }
        if (premiere.waiter && premiere.waiter !== res) { clearTimeout(premiere.waiter.premiereTimer); json(premiere.waiter, 200, { commands: [] }); }
        premiere.waiter = res;
        res.premiereTimer = setTimeout(() => {
          if (premiere.waiter === res) { premiere.waiter = null; premiere.lastSeen = Date.now(); json(res, 200, { commands: [] }); }
        }, 25000);
        req.on('close', () => { if (premiere.waiter === res) { clearTimeout(res.premiereTimer); premiere.waiter = null; } });
        flushPremiere();
        return;
      }
      if (req.method === 'POST' && p === '/api/pc/premiere/result') {
        premiere.lastSeen = Date.now();
        const { results } = await readBody(req);
        const sent = premiere.inflight || [];
        premiere.inflight = null;
        (Array.isArray(results) ? results : []).forEach((r, i) => {
          // 값 읽기(페이지 열 때)의 실패는 조용히 넘김 — 다이얼을 실제로 돌렸을 때의 오류만 폰에 알림
          const isRead = sent[i] && sent[i].op === 'lumetri-read';
          if (isRead && !r.ok) return;
          premiere.last = r;
          broadcast('lumetri', r);   // 폰 다이얼에 현재 값 표시, 오류는 알림으로
          if (!r.ok) console.error(`  ⚠ 프리미어: ${r.error}${r.names ? ' — 항목 이름: ' + r.names.join(', ') : ''}`);
        });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && p === '/api/pc/recent') {
        try { sendHelper({ op: 'fg' }); } catch {}
        return json(res, 200, { foreground, recent: recentApps });
      }
      if (req.method === 'POST' && p === '/api/pc/test') {   // 저장 전에 동작 시험해 보기
        const { action } = await readBody(req);
        await runAction(action);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not found' });
    }
    // 프리미어 패널이 연결 상태를 보여줄 때 사용 (이 PC에서만, 민감한 정보 없음)
    if (req.method === 'GET' && p === '/api/premiere-status') {
      if (!isLocal(req) || !sameOriginOrNone(req)) return json(res, 403, { error: 'forbidden' });
      return json(res, 200, { connected: premiereConnected(), version: premiere.version, last: premiere.last });
    }
    if (req.method === 'GET' && p === '/api/setup') {
      if (!isLocal(req) || !sameOriginOrNone(req)) return json(res, 403, { error: 'forbidden' });
      return json(res, 200, { port: PORT, token: TOKEN, host: localName, addresses: lanAddresses() });
    }

    // 이하 API는 토큰 필요
    if (p.startsWith('/api/')) {
      if (!tokenOk(req, url)) return json(res, 401, { error: '접속 코드가 맞지 않습니다. PC의 QR 코드로 다시 접속하세요.' });

      if (req.method === 'GET' && p === '/api/config') {
        return json(res, 200, { version: configVersion, error: configError, config: clientConfig });
      }
      if (req.method === 'GET' && p === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`event: hello\ndata: ${JSON.stringify({ version: configVersion, host: os.hostname() })}\n\n`);
        if (volume) res.write(`event: volume\ndata: ${JSON.stringify(volume)}\n\n`);
        if (foreground) res.write(`event: app\ndata: ${JSON.stringify({ name: foreground, initial: true })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        try { sendHelper({ op: 'volget' }); } catch {}
        return;
      }
      if (req.method === 'POST' && p === '/api/press') {
        const { page, button } = await readBody(req);
        const btn = findButton(page, button);
        if (!btn) return json(res, 404, { error: '버튼을 찾을 수 없습니다 (설정이 바뀌었을 수 있음)' });
        const action = btn.dial ? dialPressAction(btn) : btn.action;
        if (!action) return json(res, 200, { ok: true });
        console.log(`  ▶ ${btn.label || '(이름 없음)'}`);
        await runAction(action);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/dial') {
        const { page, button, ticks, fast } = await readBody(req);
        const btn = findButton(page, button);
        if (!btn || !btn.dial) return json(res, 404, { error: '다이얼을 찾을 수 없습니다 (설정이 바뀌었을 수 있음)' });
        await turnDial(btn.dial, ticks, fast);
        return json(res, 200, { ok: true });
      }

      // ---------- 아이폰 편집: 겉모습(이름·아이콘·색상)과 위치만 바꿀 수 있음 ----------
      if (req.method === 'POST' && p === '/api/edit/look') {
        const { page, button, label, icon, image, color } = await readBody(req);
        const next = clone(config);
        const b = ((next.pages || [])[page] || { buttons: [] }).buttons[button];
        if (!b || (!b.action && !b.dial)) return json(res, 404, { error: '버튼을 찾을 수 없습니다 (설정이 바뀌었을 수 있음)' });
        const set = (key, val) => { if (val === '' || val === null) delete b[key]; else b[key] = val; };
        if (label !== undefined) set('label', String(label).slice(0, 40));
        if (icon !== undefined) set('icon', String(icon).slice(0, 40));
        if (image !== undefined) {
          if (image && image !== 'auto' && !/^https?:\/\//.test(image)
            && !fs.existsSync(path.join(ICON_DIR, path.basename(String(image))))) {
            return json(res, 400, { error: '이미지 파일을 찾을 수 없습니다' });
          }
          set('image', image ? String(image) : '');
        }
        if (color !== undefined) {
          if (color && !/^#[0-9a-f]{6}$/i.test(color)) return json(res, 400, { error: '색상 형식이 올바르지 않습니다' });
          set('color', color || '');
        }
        saveConfig(next);
        return json(res, 200, { ok: true, version: configVersion });
      }
      if (req.method === 'POST' && p === '/api/edit/move') {   // 두 칸의 위치를 서로 바꿈
        const { page, from, to } = await readBody(req);
        const next = clone(config);
        const pg = (next.pages || [])[page];
        const max = 200;
        if (!pg || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= max || to >= max) {
          return json(res, 400, { error: '잘못된 위치입니다' });
        }
        const arr = pg.buttons;
        while (arr.length <= Math.max(from, to)) arr.push({});
        [arr[from], arr[to]] = [arr[to], arr[from]];
        while (arr.length && isEmptyButton(arr[arr.length - 1])) arr.pop();   // 끝의 빈칸 정리
        saveConfig(next);
        return json(res, 200, { ok: true, version: configVersion });
      }
      // 폰이 색보정 페이지를 열면 각 다이얼의 현재 값을 프리미어에서 읽어 옴
      if (req.method === 'POST' && p === '/api/lumetri/read') {
        const { keys } = await readBody(req);
        for (const key of (Array.isArray(keys) ? keys : []).filter(k => LUMETRI_KEYS.includes(k))) premiereSend({ op: 'lumetri-read', key }, { quiet: true });
        return json(res, 200, { ok: true, connected: premiereConnected() });
      }
      if (req.method === 'POST' && p === '/api/upload-icon') {   // 아이폰 사진첩 등에서 올린 이미지
        const buf = await readRaw(req, 3 * 1024 * 1024);
        const ext = imageExt(buf);
        if (!ext) return json(res, 400, { error: 'PNG, JPG, WEBP, GIF 이미지만 올릴 수 있습니다' });
        fs.mkdirSync(ICON_DIR, { recursive: true });
        const name = `upload-${hashOf(buf).slice(0, 12)}.${ext}`;
        fs.writeFileSync(path.join(ICON_DIR, name), buf);
        return json(res, 200, { image: name, url: `/icons/${name}` });
      }
      if (req.method === 'GET' && p === '/api/icons') {   // icons 폴더의 이미지 목록
        let files = [];
        try { files = fs.readdirSync(ICON_DIR).filter(f => /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(f)); } catch {}
        return json(res, 200, { images: files.map(f => ({ image: f, url: `/icons/${encodeURIComponent(f)}` })) });
      }
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('  ✖ ' + e.message);
    json(res, 500, { error: e.message });
  }
});

function serveFile(res, name) {
  const file = path.join(PUBLIC_DIR, name);
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

loadConfig();
if (IS_MAC) buildMacHelper();
startHelper();
server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  // 고정 이름(phonedeck.local)으로 이 PC를 알림 — IP가 바뀌어도 아이폰이 자동으로 찾아옴
  localName = mdns.start(config.hostName || (IS_MAC ? 'phonedeck-mac' : 'phonedeck'));
  console.log('\n  ■ Phone Deck 실행 중\n');
  console.log(`  1) PC 브라우저에서 접속 안내 열기:  http://localhost:${PORT}/setup`);
  console.log('  2) 아이폰 카메라로 QR 코드를 찍거나, 사파리에 아래 주소 입력:');
  console.log(`       http://${localName}:${PORT}/?t=${TOKEN}   ← 추천 (Wi-Fi가 바뀌어도 그대로 접속)`);
  for (const a of addrs) console.log(`       http://${a}:${PORT}/?t=${TOKEN}`);
  if (!addrs.length) console.log('       (Wi-Fi 주소를 찾지 못했습니다 — 네트워크 연결을 확인하세요)');
  console.log(`\n  ${CONFIG_NAME} 을 저장하면 아이폰 화면이 자동으로 바뀝니다.  종료: Ctrl+C\n`);
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\n  ✖ 포트 ${PORT} 가 이미 사용 중입니다. 이미 실행 중인 창이 있는지 확인하세요.\n`);
  else console.error(e);
  process.exit(1);
});
process.on('exit', () => { try { helper && helper.kill(); } catch {} });
process.on('SIGINT', () => process.exit(0));
