// 아이폰 '공유' → PC 로 보내기
//  - 영상 주소(유튜브·인스타·틱톡)는 통합 다운로더로 받아서 다운로드 폴더에 저장
//  - 그 밖의 웹페이지는 웹 캡처로 PDF·마크다운 저장
//  - 두 프로그램이 꺼져 있으면 알아서 켠다
// 위치는 config.json 의 "share" 로 바꿀 수 있다:
//   "share": { "downloaderDir": "...\\yt-web", "captureDir": "...\\web-capture", "saveDir": "...\\Downloads", "login": "none",
//              "organizerDir": "...\\download-organizer", "autoSort": true }   ← autoSort: 받은 파일을 바로 제자리 폴더로
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const TOOLS = path.dirname(__dirname);   // 내 프로그램들을 모아 둔 폴더 (phone-deck 의 부모)
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com)$/i;
const DL = { host: '127.0.0.1', port: 5000, name: '통합 다운로더' };
const CAP = { host: '127.0.0.1', port: 8780, name: '웹 캡처' };
const jobs = [];          // 최근 보낸 것 (최대 30개)
const sleep = ms => new Promise(r => setTimeout(r, ms));

function settings(config) {
  const s = (config && config.share) || {};
  const home = os.homedir();
  return {
    // 기본값: 폰덱과 같은 '내프로그램' 폴더 안의 옆 폴더들 (폴더째 옮겨도 그대로 찾음)
    downloaderDir: s.downloaderDir || path.join(TOOLS, 'yt-web'),
    captureDir: s.captureDir || path.join(TOOLS, 'web-capture'),
    saveDir: s.saveDir || path.join(home, 'Downloads'),
    python: s.python || 'python',
    login: s.login || 'none',
    organizerDir: s.organizerDir || path.join(TOOLS, 'download-organizer'),
    autoSort: s.autoSort !== false,
  };
}

// 공유 시트는 "제목 https://..." 처럼 글과 주소를 섞어 보내기도 한다
function findUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[).,]+$/, '') : '';
}

function request(svc, method, p, body, { raw = false, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: svc.host, port: svc.port, path: p, method, timeout,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, res => {
      if (raw) return resolve(res);
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        let j = {};
        try { j = buf ? JSON.parse(buf) : {}; } catch { j = { error: buf.slice(0, 200) }; }
        if (res.statusCode >= 400) reject(new Error(j.error || `${svc.name} 오류 (${res.statusCode})`));
        else resolve(j);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${svc.name} 응답이 없어요`)));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function isUp(svc) {
  return new Promise(resolve => {
    const req = http.get({ host: svc.host, port: svc.port, path: '/', timeout: 1500 }, res => { res.resume(); resolve(true); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// 꺼져 있으면 창 없이 켜고, 응답할 때까지 최대 40초 기다린다
async function ensureUp(svc, s) {
  if (await isUp(svc)) return;
  let child;
  if (svc === DL) {
    if (!fs.existsSync(path.join(s.downloaderDir, 'app.py'))) throw new Error(`통합 다운로더를 찾지 못했어요 (${s.downloaderDir})`);
    child = spawn(s.python, ['app.py'], { cwd: s.downloaderDir, detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, NO_BROWSER: '1', PYTHONIOENCODING: 'utf-8' } });
  } else {
    const py = path.join(s.captureDir, '.venv', 'Scripts', 'pythonw.exe');
    if (!fs.existsSync(py)) throw new Error(`웹 캡처를 찾지 못했어요 (${s.captureDir})`);
    child = spawn(py, ['server.py', '--no-browser'], { cwd: s.captureDir, detached: true, stdio: 'ignore', windowsHide: true });
  }
  child.on('error', () => {});
  child.unref();
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    if (await isUp(svc)) return;
  }
  throw new Error(`${svc.name}가 켜지지 않았어요`);
}

function freePath(dir, name) {
  const ext = path.extname(name), stem = path.basename(name, ext);
  let target = path.join(dir, name);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${stem} (${i})${ext}`);
  return target;
}

async function runDownload(job, s, update) {
  await ensureUp(DL, s);
  update({ status: 'running', step: '영상 정보 확인 중' });
  const info = await request(DL, 'POST', '/api/info', { url: job.url, login: s.login }, { timeout: 120000 });
  if (info.title) update({ title: info.title });
  const body = { url: job.url, login: s.login, quality: 'best', mode: job.mode === 'audio' ? 'audio' : 'video',
    kind: info.kind || 'video', count: info.count || 0 };
  const { job_id: id } = await request(DL, 'POST', '/api/download', body);
  const started = Date.now();
  for (;;) {
    await sleep(1500);
    const p = await request(DL, 'GET', `/api/progress/${id}`);
    if (p.status === 'error') throw new Error(p.error || '다운로드 실패');
    if (p.status === 'done') break;
    update({ step: p.status === 'processing' ? '마무리 중' : `받는 중 ${Math.round(p.percent || 0)}%` });
    if (Date.now() - started > 60 * 60 * 1000) throw new Error('너무 오래 걸려서 멈췄어요');
  }
  // 브라우저로 받을 때와 똑같이 파일을 다운로드 폴더에 저장 → 다운로드 정리가 제자리로 옮겨 준다
  const res = await request(DL, 'GET', `/api/file/${id}`, undefined, { raw: true, timeout: 600000 });
  if (res.statusCode !== 200) { res.resume(); throw new Error('받은 파일을 가져오지 못했어요'); }
  const cd = res.headers['content-disposition'] || '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i), plain = cd.match(/filename="?([^";]+)"?/i);
  let name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : `download-${job.id}`;
  name = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  fs.mkdirSync(s.saveDir, { recursive: true });
  const target = freePath(s.saveDir, name);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(target);
    res.pipe(out);
    out.on('finish', resolve);
    res.on('error', reject);
    out.on('error', reject);
  });
  const sorted = await sortSaved(path.basename(target), s);
  update({ status: 'done', step: '완료', file: path.basename(sorted.moved || target), folder: sorted.to || '', note: sorted.error || '' });
}

// 다운로드 정리(download-organizer)가 있으면 받은 파일을 바로 제자리 폴더로 옮긴다
function sortSaved(name, s) {
  const script = path.join(s.organizerDir, 'organizer.py');
  if (!s.autoSort || !fs.existsSync(script)) return Promise.resolve({});
  return new Promise(resolve => {
    execFile(s.python, ['-X', 'utf8', script, '--one', name], { cwd: s.organizerDir, windowsHide: true, timeout: 120000 },
      (err, stdout) => {
        if (err) return resolve({ error: '다운로드 정리를 실행하지 못했어요' });
        try { resolve(JSON.parse(stdout.trim().split('\n').pop())); } catch { resolve({}); }
      });
  });
}

async function runCapture(job, s, update) {
  await ensureUp(CAP, s);
  await request(CAP, 'POST', '/api/capture', { text: job.url, opts: {} });
  update({ status: 'done', step: '웹 캡처에 넣었어요' });
}

function create({ getConfig, broadcast, log }) {
  function start(text, mode) {
    const url = findUrl(text);
    if (!url) return { ok: false, message: '공유한 내용에서 주소(https://…)를 찾지 못했어요' };
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    const video = mode === 'audio' || mode === 'video' || (mode !== 'page' && VIDEO_HOSTS.test(host));
    const job = { id: crypto.randomBytes(4).toString('hex'), url, mode: mode || 'auto', target: video ? DL.name : CAP.name,
      status: 'queued', step: '보내는 중', title: '', file: '', error: '', time: Date.now() };
    jobs.unshift(job);
    jobs.length = Math.min(jobs.length, 30);
    const update = fields => { Object.assign(job, fields); broadcast('share', job); };
    const s = settings(getConfig());
    log(`  ⇪ 공유 받음 → ${job.target}: ${url}`);
    // 인스타 사진 게시물은 다운로더가 로그인을 요구해서 실패한다 → 웹 캡처로 다시 시도 (좌우로 넘기는 사진 전부 받음)
    const insta = /(^|\.)instagram\.com$/i.test(host) && mode !== 'video' && mode !== 'audio';
    const work = !video ? runCapture(job, s, update)
      : runDownload(job, s, update).catch(e => {
        if (!insta) throw e;
        log(`  ↻ 인스타 사진 게시물로 보고 웹 캡처로 다시: ${e.message.slice(0, 80)}`);
        update({ target: CAP.name, step: '사진 게시물이라 웹 캡처로 받는 중', error: '' });
        return runCapture(job, s, update);
      });
    work.then(
      () => log(`  ✔ 공유 완료: ${job.file || url}`),
      e => {
        let error = e.message.replace(/\x1b\[[0-9;]*m/g, '').replace(/ERROR:\s*/g, '');
        if (/confirm you.re not a bot|sign in to confirm/i.test(error)) {
          error = '유튜브가 이 영상은 로그인을 요구해요. config.json 의 share.login 을 "chrome" 등으로 바꾸면 받을 수 있어요';
        }
        update({ status: 'error', step: '실패', error });
        log(`  ✖ 공유 실패: ${error}`);
      });
    broadcast('share', job);
    const what = video ? (mode === 'audio' ? '음악(mp3)으로 받을게요' : '영상을 받을게요') : '웹페이지를 저장할게요';
    return { ok: true, job, message: `PC로 보냈어요 — ${what}` };
  }
  return { start, recent: () => jobs };
}

module.exports = { create, findUrl };
