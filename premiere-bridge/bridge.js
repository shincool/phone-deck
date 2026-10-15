// Phone Deck Bridge — 프리미어 안에서 화면 없이 계속 돌면서
// Phone Deck 서버(이 PC의 localhost:8765)에 "할 일"을 물어보고, 받은 명령을 프리미어(host.jsx)에 전달합니다.
/* global require, window */
'use strict';

const http = require('http');
const path = require('path');
const PORT = 8765;
let token = '';

// Node 의 http 로 요청 (브라우저 fetch 와 달리 Origin 이 붙지 않아 PC 전용 API 를 쓸 수 있음)
function request(method, p, body, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, method, path: p, timeout,
      headers: { Host: `localhost:${PORT}`, 'X-Deck-Token': token, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}) },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', c => { text += c; });
      res.on('end', () => {
        let json = {};
        try { json = text ? JSON.parse(text) : {}; } catch {}
        if (res.statusCode >= 400) return reject(Object.assign(new Error(json.error || `HTTP ${res.statusCode}`), { status: res.statusCode }));
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ExtendScript 실행 (CEP 기본 함수 사용 — 별도 라이브러리 필요 없음)
function evalScript(code) {
  return new Promise(resolve => window.__adobe_cep__.evalScript(code, r => resolve(r)));
}

async function loadHost() {
  // ScriptPath 가 안 읽힌 경우를 대비해 직접 한 번 더 불러옴
  const dir = decodeURIComponent(window.location.pathname).replace(/^\/([A-Za-z]:)/, '$1');
  const jsx = path.join(path.dirname(dir), 'host.jsx').replace(/\\/g, '/');
  await evalScript(`try{ if (typeof PhoneDeck === 'undefined') $.evalFile(${JSON.stringify(jsx)}); 'ok' }catch(e){ e.toString() }`);
}

async function run(cmd) {
  let script;
  if (cmd.op === 'lumetri') script = `PhoneDeck.adjust(${JSON.stringify(cmd.key)}, ${Number(cmd.delta) || 0}, ${cmd.reset ? 'true' : 'false'})`;
  else if (cmd.op === 'lumetri-read') script = `PhoneDeck.read(${JSON.stringify(cmd.key)})`;
  else return { ok: false, error: `알 수 없는 명령: ${cmd.op}` };
  const raw = await evalScript(script);
  try { return { ...JSON.parse(raw), key: cmd.key }; }
  catch { return { ok: false, key: cmd.key, error: `프리미어 응답을 읽지 못했습니다: ${String(raw).slice(0, 200)}` }; }
}

async function main() {
  await loadHost();
  const ver = await evalScript('PhoneDeck.ping()');
  for (;;) {
    try {
      if (!token) token = (await request('GET', '/api/setup')).token;
      // 할 일이 생길 때까지 최대 25초 기다리는 요청 (롱 폴링)
      const { commands } = await request('GET', `/api/pc/premiere/next?premiere=${encodeURIComponent(ver)}`, null, 35000);
      if (commands && commands.length) {
        const results = [];
        for (const c of commands) results.push(await run(c));
        await request('POST', '/api/pc/premiere/result', { results });
      }
    } catch (e) {
      if (e.status === 401 || e.status === 403) token = '';   // 접속 코드가 바뀌었으면 다시 받음
      await new Promise(r => setTimeout(r, 3000));            // 서버가 꺼져 있으면 3초 뒤 다시 시도
    }
  }
}

main();
