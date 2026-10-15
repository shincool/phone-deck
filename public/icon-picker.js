// 아이콘 고르기 — 아이폰 편집 모드와 PC 편집 화면이 함께 씁니다.
//   IconPicker.mount(container, { value: { icon, image }, canAuto, request, onChange })
//   value.icon  : 흰 선 아이콘 이름("scissors") 또는 이모지("🎬")
//   value.image : "auto"(앱 아이콘) | icons 폴더의 파일 이름 | ""
//   request(path, opts) : 접속 코드가 붙은 fetch (이미지 목록/업로드용)
(function () {
  'use strict';

  // 한글로 검색해도 찾을 수 있게: 한글 단어 → 영문 아이콘 이름 일부
  const KO = {
    '볼륨': 'volume', '소리': 'volume', '음량': 'volume', '음소거': 'volume-x', '스피커': 'speaker',
    '재생': 'play', '일시정지': 'pause', '정지': 'pause', '멈춤': 'square', '다음': 'skip-forward', '이전': 'skip-back',
    '앞으로': 'fast-forward', '뒤로': 'rewind', '반복': 'repeat', '셔플': 'shuffle', '녹화': 'circle-dot', '녹음': 'mic',
    '마이크': 'mic', '카메라': 'camera', '사진': 'image', '이미지': 'image', '영상': 'video', '비디오': 'video',
    '필름': 'film', '음악': 'music', '헤드폰': 'headphones', '방송': 'radio', '라이브': 'radio',
    '가위': 'scissors', '자르기': 'scissors', '컷': 'scissors', '크롭': 'crop', '복사': 'copy', '붙여넣기': 'clipboard',
    '실행취소': 'undo', '되돌리기': 'undo', '다시실행': 'redo', '저장': 'save', '폴더': 'folder', '파일': 'file',
    '문서': 'file-text', '메모': 'notebook', '노트': 'notebook', '펜': 'pen', '연필': 'pencil', '편집': 'pencil',
    '키보드': 'keyboard', '마우스': 'mouse', '모니터': 'monitor', '화면': 'monitor', '노트북': 'laptop', '컴퓨터': 'computer',
    '휴대폰': 'smartphone', '폰': 'smartphone', '집': 'house', '홈': 'house', '설정': 'settings', '톱니': 'cog',
    '검색': 'search', '확대': 'zoom-in', '축소': 'zoom-out', '잠금': 'lock', '잠금해제': 'lock-open',
    '시계': 'clock', '시간': 'clock', '타이머': 'timer', '알람': 'alarm', '달력': 'calendar', '날짜': 'calendar',
    '메일': 'mail', '이메일': 'mail', '메시지': 'message', '채팅': 'message', '전화': 'phone', '사람': 'user',
    '사용자': 'user', '하트': 'heart', '좋아요': 'thumbs-up', '별': 'star', '전구': 'lightbulb', '아이디어': 'lightbulb',
    '번개': 'zap', '해': 'sun', '밝기': 'sun', '달': 'moon', '구름': 'cloud', '날씨': 'cloud', '지도': 'map',
    '위치': 'map-pin', '핀': 'pin', '마커': 'map-pin', '링크': 'link', '다운로드': 'download', '업로드': 'upload',
    '새로고침': 'refresh', '닫기': 'x', '추가': 'plus', '더하기': 'plus', '빼기': 'minus', '체크': 'check',
    '확인': 'check', '삭제': 'trash', '휴지통': 'trash', '공유': 'share', '책갈피': 'bookmark', '태그': 'tag',
    '쇼핑': 'shopping', '장바구니': 'shopping-cart', '돈': 'dollar', '차트': 'chart', '그래프': 'chart',
    '코드': 'code', '터미널': 'terminal', '게임': 'gamepad', '브러시': 'brush', '그림': 'brush', '팔레트': 'palette',
    '색': 'palette', '색보정': 'sliders', '조절': 'sliders', '슬라이더': 'sliders', '레이어': 'layers', '글자': 'type',
    '텍스트': 'type', '번역': 'languages', '언어': 'languages', '한영': 'languages', '손': 'hand', '인사': 'hand',
    '웃음': 'smile', '이모티콘': 'smile', '선물': 'gift', '로켓': 'rocket', '마법': 'wand', '효과': 'sparkles',
    '반짝': 'sparkles', '왼쪽': 'arrow-left', '오른쪽': 'arrow-right', '위': 'arrow-up', '아래': 'arrow-down',
    '처음': 'arrow-left-to-line', '끝': 'arrow-right-to-line', '창': 'app-window', '탭': 'panel-top', '전환': 'layout-grid',
    '유튜브': 'youtube', '인스타': 'instagram', '깃허브': 'github', '트위터': 'twitter', '페이스북': 'facebook',
    '크롬': 'chrome', '브라우저': 'globe', '인터넷': 'globe', '와이파이': 'wifi', '배터리': 'battery', '전원': 'power',
    '종료': 'power', '프린터': 'printer', '캡처': 'scan', '스크린샷': 'scan', '프레임': 'frame', '회전': 'rotate',
    '마커추가': 'map-pin', '책': 'book', '학교': 'school', '커피': 'coffee', '음식': 'utensils', '자동차': 'car',
  };
  const EMOJI = '🎬 🎥 📸 🎞️ 🎵 🎧 🎤 🔊 🔇 ⏯️ ⏭️ ⏮️ ✂️ 📋 📁 📂 📝 💾 🖥️ 💻 📱 ⌨️ 🖱️ 🔍 🔒 🔓 ⏰ 📅 ✉️ 💬 📞 ❤️ ⭐ 💡 ⚡ ☀️ 🌙 ☁️ 📍 🔗 ⬇️ ⬆️ 🔄 ✅ ❌ ➕ 🗑️ 🏠 ⚙️ 🎨 🖌️ 🌐 🚀 🎁 🔥 ✨ 👋 😀 👍 🎮 ☕ 🍔 🛒 💰 📊 🧊'.split(' ');

  const pascal = s => s.replace(/(^|-)([a-z0-9])/g, (_, a, c) => c.toUpperCase());
  const kebab = s => s.replace(/([a-z])([A-Z0-9])/g, '$1-$2').replace(/([0-9])([A-Z])/g, '$1-$2').toLowerCase();
  let NAMES = null;
  function names() {
    if (!NAMES) NAMES = window.lucide ? Object.keys(lucide.icons).map(kebab).filter(n => lucide.icons[pascal(n)]) : [];
    return NAMES;
  }
  const isLucideName = s => /^[a-z][a-z0-9-]*$/.test(s || '');
  // 다른 컴퓨터를 조작 중이면 그 컴퓨터의 아이콘 주소로
  const abs = u => (u && u[0] === '/' ? (window.DECK_BASE || '') + u : u);

  function svgFor(name) {
    const node = window.lucide && lucide.icons[pascal(name)];
    return node ? lucide.createElement(node) : null;
  }

  function search(q) {
    const all = names();
    q = (q || '').trim().toLowerCase();
    if (!q) return all.filter(n => FEATURED.includes(n)).concat(all.filter(n => !FEATURED.includes(n))).slice(0, 120);
    // 검색어와 얼마나 잘 맞는지에 따라 순위: 0 = 정확히 같은 한글 단어, 1 = 영문/입력 중인 단어, 2 = 검색어 안에 든 짧은 단어
    const terms = new Map([[q.replace(/\s+/g, '-'), 1]]);
    for (const [ko, en] of Object.entries(KO)) {
      const rank = ko === q ? 0 : ko.startsWith(q) ? 1 : (q.includes(ko) && ko.length >= 2) ? 2 : -1;
      if (rank >= 0 && (!terms.has(en) || terms.get(en) > rank)) terms.set(en, rank);
    }
    const score = n => {
      let best = 9;
      for (const [t, r] of terms) if (n.includes(t)) best = Math.min(best, r * 2 + (n.startsWith(t) ? 0 : 1));
      return best;
    };
    const hits = all.map(n => [n, score(n)]).filter(([, s]) => s < 9);
    hits.sort((a, b) => a[1] - b[1] || a[0].length - b[0].length);
    return hits.slice(0, 160).map(([n]) => n);
  }
  const FEATURED = ['play', 'pause', 'skip-back', 'skip-forward', 'volume-2', 'volume-x', 'mic', 'camera', 'video', 'film',
    'scissors', 'copy', 'clipboard-paste', 'undo-2', 'redo-2', 'save', 'folder', 'file-text', 'keyboard', 'monitor',
    'search', 'zoom-in', 'zoom-out', 'lock', 'clock', 'calendar-days', 'mail', 'message-circle', 'heart', 'star',
    'house', 'settings', 'map-pin', 'link', 'download', 'upload', 'refresh-cw', 'plus', 'x', 'check', 'trash-2',
    'sun', 'moon', 'sparkles', 'palette', 'sliders-horizontal', 'layers', 'type', 'languages', 'globe', 'youtube',
    'instagram', 'music', 'headphones', 'rocket', 'zap', 'power', 'scan-line', 'layout-grid'];

  // 사진을 256px PNG 로 줄여서 업로드 (아이폰 사진은 수 MB 라서)
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const size = 256, c = document.createElement('canvas');
      c.width = c.height = size;
      const s = Math.min(size / img.width, size / img.height);
      const w = img.width * s, h = img.height * s;
      c.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      return await new Promise(res => c.toBlob(res, 'image/png'));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function mount(root, opts) {
    const value = { icon: (opts.value && opts.value.icon) || '', image: (opts.value && opts.value.image) || '' };
    const emit = () => opts.onChange && opts.onChange({ ...value });
    root.replaceChildren();
    root.classList.add('ipk');

    const tabs = el('div', 'ipk-tabs');
    const body = el('div', 'ipk-body');
    root.append(tabs, body);
    const TABS = [['icon', '아이콘'], ['emoji', '이모지'], ['image', '이미지']];
    if (opts.canAuto) TABS.push(['auto', '앱 아이콘']);
    let current = value.image === 'auto' && opts.canAuto ? 'auto'
      : value.image ? 'image' : value.icon && !isLucideName(value.icon) ? 'emoji' : 'icon';

    function showTab(t) {
      current = t;
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
      body.replaceChildren();
      ({ icon: tabIcon, emoji: tabEmoji, image: tabImage, auto: tabAuto })[t]();
    }
    for (const [t, name] of TABS) {
      const b = el('button', '', name);
      b.type = 'button';
      b.dataset.t = t;
      b.onclick = () => showTab(t);
      tabs.append(b);
    }

    const pick = (icon, image) => { value.icon = icon; value.image = image; emit(); markSelected(); };
    function markSelected() {
      body.querySelectorAll('[data-v]').forEach(c => {
        const v = c.dataset.v;
        c.classList.toggle('on', value.image ? v === 'img:' + value.image : v === 'ic:' + value.icon);
      });
    }

    function tabIcon() {
      const input = el('input', 'ipk-search');
      input.placeholder = '검색 (예: 가위, volume, 폴더)';
      input.autocomplete = 'off';
      const grid = el('div', 'ipk-grid');
      const draw = () => {
        grid.replaceChildren();
        const list = search(input.value);
        if (!list.length) grid.append(el('div', 'ipk-empty', '검색 결과가 없습니다. 영어로도 검색해 보세요.'));
        for (const n of list) {
          const c = el('button', 'ipk-cell');
          c.type = 'button';
          c.title = n;
          c.dataset.v = 'ic:' + n;
          const svg = svgFor(n);
          if (svg) c.append(svg);
          c.onclick = () => pick(n, '');
          grid.append(c);
        }
        markSelected();
      };
      let t;
      input.oninput = () => { clearTimeout(t); t = setTimeout(draw, 120); };
      body.append(input, grid);
      draw();
    }

    function tabEmoji() {
      const row = el('div', 'ipk-row');
      const input = el('input', 'ipk-search');
      input.placeholder = '이모지나 글자 입력';
      input.maxLength = 8;
      if (value.icon && !isLucideName(value.icon)) input.value = value.icon;
      const ok = el('button', 'ipk-btn', '적용');
      ok.type = 'button';
      ok.onclick = () => { if (input.value.trim()) pick(input.value.trim(), ''); };
      row.append(input, ok);
      const grid = el('div', 'ipk-grid emoji');
      for (const e of EMOJI) {
        const c = el('button', 'ipk-cell', e);
        c.type = 'button';
        c.dataset.v = 'ic:' + e;
        c.onclick = () => { input.value = e; pick(e, ''); };
        grid.append(c);
      }
      body.append(row, grid);
      markSelected();
    }

    async function tabImage() {
      const row = el('div', 'ipk-row');
      const file = el('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.hidden = true;
      const up = el('button', 'ipk-btn wide', '＋ 사진/이미지 올리기');
      up.type = 'button';
      up.onclick = () => file.click();
      const msg = el('div', 'ipk-empty');
      file.onchange = async () => {
        const f = file.files && file.files[0];
        if (!f) return;
        up.disabled = true;
        msg.textContent = '올리는 중...';
        try {
          const blob = await shrink(f);
          const r = await opts.request('/api/upload-icon', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
          msg.textContent = '';
          pick(value.icon && !value.image ? value.icon : value.icon, r.image);
          await list();
        } catch (e) {
          msg.textContent = '업로드 실패: ' + e.message;
        }
        up.disabled = false;
        file.value = '';
      };
      row.append(up, file);
      const grid = el('div', 'ipk-grid images');
      body.append(row, msg, grid);
      async function list() {
        grid.replaceChildren();
        try {
          const { images } = await opts.request('/api/icons');
          if (!images.length) grid.append(el('div', 'ipk-empty', '아직 올린 이미지가 없습니다.'));
          for (const im of images) {
            const c = el('button', 'ipk-cell img');
            c.type = 'button';
            c.title = im.image;
            c.dataset.v = 'img:' + im.image;
            const i = el('img');
            i.src = abs(im.url);
            i.alt = '';
            c.append(i);
            c.onclick = () => pick(value.icon, im.image);
            grid.append(c);
          }
        } catch (e) {
          grid.append(el('div', 'ipk-empty', '이미지 목록을 불러오지 못했습니다.'));
        }
        markSelected();
      }
      list();
    }

    function tabAuto() {
      const b = el('button', 'ipk-btn wide' + (value.image === 'auto' ? ' on' : ''), value.image === 'auto' ? '✓ 앱의 실제 아이콘을 쓰는 중' : '이 버튼이 여는 앱의 실제 아이콘 쓰기');
      b.type = 'button';
      b.onclick = () => { pick(value.icon, 'auto'); showTab('auto'); };
      body.append(b, el('div', 'ipk-empty', '프로그램을 여는 버튼에서만 쓸 수 있습니다.'));
    }

    showTab(current);
  }

  // 미리보기용: 버튼과 같은 방식으로 아이콘을 그림
  function render(target, { icon, image, imageUrl }) {
    target.replaceChildren();
    const url = abs(imageUrl || (image && image !== 'auto' ? `/icons/${encodeURIComponent(image)}` : null));
    if (url) {
      const i = el('img', 'img');
      i.src = url;
      i.alt = '';
      target.append(i);
    } else if (isLucideName(icon)) {
      const svg = svgFor(icon);
      if (svg) target.append(svg);
    } else if (icon) {
      target.append(el('span', 'ic', icon));
    }
  }

  const css = `
  .ipk { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .ipk-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .ipk-tabs button { flex: 1; min-width: 64px; padding: 8px 10px; border: 0; border-radius: 10px; background: #1b1b20; color: #9a9aa6; font: inherit; font-size: 13px; font-weight: 600; }
  .ipk-tabs button.on { background: #2bd46a; color: #06210f; }
  .ipk-body { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .ipk-row { display: flex; gap: 8px; }
  .ipk-search { flex: 1; min-width: 0; padding: 10px 12px; border: 1px solid #2a2a30; border-radius: 10px; background: #0d0d10; color: #e9e9ee; font: inherit; font-size: 16px; -webkit-user-select: text; user-select: text; }
  .ipk-btn { padding: 10px 14px; border: 0; border-radius: 10px; background: #26262c; color: #e9e9ee; font: inherit; font-weight: 600; }
  .ipk-btn.wide { flex: 1; }
  .ipk-btn.on { box-shadow: inset 0 0 0 2px #2bd46a; }
  .ipk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(48px, 1fr)); gap: 6px; max-height: 230px; overflow-y: auto; padding: 2px; }
  .ipk-cell { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 10px; background: #141418; color: #f2f2f6; font-size: 24px; padding: 0; }
  .ipk-cell svg { width: 24px; height: 24px; stroke-width: 1.6; }
  .ipk-cell img { width: 80%; height: 80%; object-fit: contain; }
  .ipk-cell.on { box-shadow: inset 0 0 0 2px #2bd46a; background: #1c2a21; }
  .ipk-empty { color: #8b8b96; font-size: 13px; padding: 4px 2px; grid-column: 1 / -1; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);

  window.IconPicker = { mount, render, isLucideName };
})();
