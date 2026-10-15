// Phone Deck Bridge — 프리미어 ExtendScript 쪽.
// 선택한 클립(없으면 재생 헤드 아래 맨 위 클립)의 Lumetri Color 기본 보정 값을 조절합니다.
// 결과는 JSON 문자열로 돌려줌 (ExtendScript 에는 JSON 이 없을 수 있어 직접 만듦).
var PhoneDeck = (function () {
    // 프리미어 언어 설정에 따라 이름이 다르므로 영어/한국어 이름을 모두 확인
    var NAMES = {
        exposure: ['Exposure', '노출'],
        contrast: ['Contrast', '대비'],
        highlights: ['Highlights', '밝은 영역', '하이라이트', '밝은 톤'],
        shadows: ['Shadows', '어두운 영역', '그림자', '섀도', '어두운 톤'],
        whites: ['Whites', '흰색', '흰색 계열'],
        blacks: ['Blacks', '검정', '검은색', '검정 계열', '검은색 계열'],
        temperature: ['Temperature', '온도', '색온도'],
        saturation: ['Saturation', '채도']
    };
    var DEFAULTS = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, saturation: 100 };
    var RANGES = { exposure: [-4, 4], saturation: [0, 200] };   // 나머지는 -100 ~ 100

    function str(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"'; }
    function fail(msg, extra) { return '{"ok":false,"error":' + str(msg) + (extra || '') + '}'; }
    function norm(s) { return String(s).replace(/^\s+|\s+$/g, '').toLowerCase(); }

    function targetClips(seq) {
        var out = [], i;
        var sel = seq.getSelection();
        if (sel && sel.length) {
            for (i = 0; i < sel.length; i++) if (sel[i] && sel[i].mediaType === 'Video') out.push(sel[i]);
            if (out.length) return out;
        }
        // 선택한 클립이 없으면 재생 헤드 아래, 가장 위 트랙의 클립
        var t = seq.getPlayerPosition().seconds;
        for (var v = seq.videoTracks.numTracks - 1; v >= 0; v--) {
            var tr = seq.videoTracks[v];
            for (i = 0; i < tr.clips.numItems; i++) {
                var c = tr.clips[i];
                if (c.start.seconds <= t && t < c.end.seconds) return [c];
            }
        }
        return out;
    }

    function lumetriOf(clip) {
        for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.matchName === 'AE.ADBE Lumetri' || /lumetri/i.test(comp.displayName)) return comp;
        }
        return null;
    }

    function paramOf(comp, key) {
        var names = NAMES[key];
        for (var i = 0; i < comp.properties.numItems; i++) {
            var p = comp.properties[i], dn = norm(p.displayName);
            for (var j = 0; j < names.length; j++) if (dn === norm(names[j])) return p;   // 처음 나오는 것 = 기본 보정 항목
        }
        return null;
    }

    function paramNames(comp) {
        var list = [];
        for (var i = 0; i < comp.properties.numItems && i < 60; i++) list.push(str(comp.properties[i].displayName));
        return '[' + list.join(',') + ']';
    }

    // key: exposure 등, delta: 더할 값, reset: true 면 기본값으로
    function adjust(key, delta, reset) {
        try {
            if (!NAMES[key]) return fail('알 수 없는 항목: ' + key);
            var seq = app.project.activeSequence;
            if (!seq) return fail('열린 시퀀스가 없습니다');
            var clips = targetClips(seq);
            if (!clips.length) return fail('조절할 클립이 없습니다. 클립을 선택하거나 재생 헤드를 클립 위에 두세요');
            var range = RANGES[key] || [-100, 100], value = null, done = 0;
            for (var i = 0; i < clips.length; i++) {
                var comp = lumetriOf(clips[i]);
                if (!comp) continue;
                var p = paramOf(comp, key);
                if (!p) return fail('Lumetri 에서 "' + key + '" 항목을 찾지 못했습니다', ',"names":' + paramNames(comp));
                var cur = Number(p.getValue());
                var next = reset ? DEFAULTS[key] : Math.round((cur + delta) * 1000) / 1000;
                next = Math.max(range[0], Math.min(range[1], next));
                if (p.isTimeVarying && p.isTimeVarying()) {
                    // 키프레임이 있는 항목: 재생 헤드 위치에 키프레임을 만들어 값 설정
                    var c = clips[i], tm = new Time();
                    tm.seconds = c.inPoint.seconds + (seq.getPlayerPosition().seconds - c.start.seconds);
                    if (!p.keyExistsAtTime(tm)) p.addKey(tm);
                    p.setValueAtKey(tm, next, true);
                } else {
                    p.setValue(next, true);
                }
                if (value === null) value = next;
                done++;
            }
            if (!done) return fail('선택한 클립에 Lumetri Color 효과가 없습니다. 효과를 먼저 한 번 넣어 주세요');
            return '{"ok":true,"key":' + str(key) + ',"value":' + value + ',"clips":' + done + '}';
        } catch (e) {
            return fail('프리미어 오류: ' + e.toString());
        }
    }

    // 현재 값만 읽기 (폰 화면에 숫자 표시용)
    function read(key) {
        try {
            var seq = app.project.activeSequence;
            if (!seq) return fail('열린 시퀀스가 없습니다');
            var clips = targetClips(seq);
            if (!clips.length) return fail('클립 없음');
            var comp = lumetriOf(clips[0]);
            if (!comp) return fail('Lumetri 없음');
            var p = paramOf(comp, key);
            if (!p) return fail('항목 없음', ',"names":' + paramNames(comp));
            return '{"ok":true,"key":' + str(key) + ',"value":' + Number(p.getValue()) + ',"clips":1}';
        } catch (e) {
            return fail('프리미어 오류: ' + e.toString());
        }
    }

    function ping() { return '{"ok":true,"version":' + str(app.version) + '}'; }

    return { adjust: adjust, read: read, ping: ping };
})();
