// 아주 작은 mDNS 응답기 — "phonedeck.local" 같은 고정 이름으로 이 PC를 찾을 수 있게 합니다.
// Wi-Fi나 핫스팟을 바꿔 PC의 IP 주소가 달라져도, 아이폰은 항상 같은 주소(http://phonedeck.local:8765)로 접속할 수 있습니다.
// 의존성 없음 (Node 기본 dgram 만 사용).
'use strict';

const dgram = require('dgram');
const os = require('os');

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const TYPE_A = 1;
const TYPE_ANY = 255;

function lanInterfaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V/i.test(name)) continue;
      out.push({ address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

const ipToInt = ip => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;

// 질문을 보낸 기기와 같은 네트워크에 있는 이 PC의 주소를 고름
function addressFor(remote) {
  const ifs = lanInterfaces();
  const r = ipToInt(remote);
  const same = ifs.find(i => ((ipToInt(i.address) & ipToInt(i.netmask)) >>> 0) === ((r & ipToInt(i.netmask)) >>> 0));
  return (same || ifs[0] || {}).address;
}

// DNS 이름 읽기 (압축 포인터 지원). [이름, 다음 위치] 반환
function readName(buf, off) {
  const labels = [];
  let jumped = false, end = off, guard = 0;
  while (off < buf.length && guard++ < 64) {
    const len = buf[off];
    if (len === 0) { off++; break; }
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) end = off + 2;
      off = ((len & 0x3f) << 8) | buf[off + 1];
      jumped = true;
      continue;
    }
    labels.push(buf.toString('utf8', off + 1, off + 1 + len));
    off += 1 + len;
  }
  return [labels.join('.'), jumped ? end : off];
}

function encodeName(name) {
  const parts = name.split('.').filter(Boolean).map(l => {
    const b = Buffer.from(l, 'utf8');
    return Buffer.concat([Buffer.from([b.length]), b]);
  });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

function answerRecord(name, ip, ttl = 120) {
  const rec = Buffer.alloc(10);
  rec.writeUInt16BE(TYPE_A, 0);
  rec.writeUInt16BE(0x8001, 2);          // IN 클래스 + cache-flush
  rec.writeUInt32BE(ttl, 4);
  rec.writeUInt16BE(4, 8);
  return Buffer.concat([encodeName(name), rec, Buffer.from(ip.split('.').map(Number))]);
}

function buildResponse({ id = 0, name, ip, question = null }) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x8400, 2);        // 응답 + 권한 있는 응답
  header.writeUInt16BE(question ? 1 : 0, 4);
  header.writeUInt16BE(1, 6);
  const parts = [header];
  if (question) {
    const q = Buffer.alloc(4);
    q.writeUInt16BE(TYPE_A, 0);
    q.writeUInt16BE(1, 2);
    parts.push(encodeName(name), q);
  }
  parts.push(answerRecord(name, ip));
  return Buffer.concat(parts);
}

function start(hostName, log = console.log) {
  const fqdn = `${hostName}.local`.toLowerCase();
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  sock.on('error', err => {
    log(`  ⚠ ${fqdn} 이름 알림을 시작하지 못했습니다 (${err.code || err.message}) — IP 주소로는 계속 접속할 수 있습니다`);
    try { sock.close(); } catch {}
  });

  sock.on('message', (msg, rinfo) => {
    if (msg.length < 12) return;
    const flags = msg.readUInt16BE(2);
    if (flags & 0x8000) return;           // 다른 기기의 응답은 무시
    const qd = msg.readUInt16BE(4);
    let off = 12;
    for (let i = 0; i < qd && off < msg.length; i++) {
      let name;
      [name, off] = readName(msg, off);
      if (off + 4 > msg.length) return;
      const qtype = msg.readUInt16BE(off);
      const qclass = msg.readUInt16BE(off + 2);
      off += 4;
      if (name.toLowerCase() !== fqdn || (qtype !== TYPE_A && qtype !== TYPE_ANY)) continue;
      const ip = addressFor(rinfo.address);
      if (!ip) return;
      const legacy = rinfo.port !== MDNS_PORT;          // 일반 DNS 방식으로 물어본 경우
      const unicast = legacy || (qclass & 0x8000);       // "답을 나에게 직접 보내 달라"는 요청
      const reply = buildResponse({ id: legacy ? msg.readUInt16BE(0) : 0, name: fqdn, ip, question: legacy });
      if (unicast) sock.send(reply, rinfo.port, rinfo.address);
      if (!legacy) sock.send(buildResponse({ name: fqdn, ip }), MDNS_PORT, MDNS_ADDR);
      return;
    }
  });

  const joined = new Set();
  function joinAll() {   // 새로 연결된 네트워크에도 참여 (핫스팟 ↔ Wi-Fi 전환 대비)
    for (const i of lanInterfaces()) {
      if (joined.has(i.address)) continue;
      try { sock.addMembership(MDNS_ADDR, i.address); joined.add(i.address); } catch {}
    }
  }

  function announce() {  // 켜질 때와 네트워크가 바뀔 때 "내가 phonedeck.local 이다" 알림
    for (const i of lanInterfaces()) {
      try {
        sock.setMulticastInterface(i.address);
        sock.send(buildResponse({ name: fqdn, ip: i.address }), MDNS_PORT, MDNS_ADDR);
      } catch {}
    }
  }

  sock.bind(MDNS_PORT, () => {
    try { sock.setMulticastTTL(255); sock.setMulticastLoopback(true); } catch {}
    joinAll();
    announce();
    setTimeout(announce, 1000);
    let lastKey = '';
    setInterval(() => {
      const key = lanInterfaces().map(i => i.address).join(',');
      if (key === lastKey) return;
      lastKey = key;
      joinAll();
      announce();
    }, 5000);
  });

  return fqdn;
}

module.exports = { start, lanInterfaces };
