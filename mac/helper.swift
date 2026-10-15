// Phone Deck 맥용 도우미 — server.js 가 실행하는 상주 프로세스 (Windows 의 helper.ps1 과 같은 역할).
// 표준입력으로 한 줄짜리 JSON 명령을 받아 키 입력 / 볼륨 / 앱 실행을 합니다.
//   빌드: swiftc -O mac/helper.swift -o mac/helper   (server.js 가 처음 실행할 때 자동으로 빌드)
//   아이콘 추출 모드: mac/helper --icon "<앱 이름 또는 경로>" "<저장할 png>"
import AppKit
import ApplicationServices
import AudioToolbox
import CoreAudio
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)   // 파이프로 연결돼도 한 줄씩 바로 내보냄

func say(_ s: String) { print(s) }

// ---------- 키 이름 → macOS 가상 키 코드 ----------
let keyCodes: [String: CGKeyCode] = [
    "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05, "z": 0x06, "x": 0x07, "c": 0x08, "v": 0x09,
    "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10, "t": 0x11, "1": 0x12, "2": 0x13, "3": 0x14,
    "4": 0x15, "6": 0x16, "5": 0x17, "9": 0x19, "7": 0x1A, "8": 0x1C, "0": 0x1D, "o": 0x1F, "u": 0x20, "i": 0x22,
    "p": 0x23, "l": 0x25, "j": 0x26, "k": 0x28, "n": 0x2D, "m": 0x2E,
    "equal": 0x18, "=": 0x18, "plus": 0x18, "minus": 0x1B, "-": 0x1B, "]": 0x1E, "[": 0x21,
    "quote": 0x27, "'": 0x27, "semicolon": 0x29, ";": 0x29, "backslash": 0x2A, "\\": 0x2A,
    "comma": 0x2B, ",": 0x2B, "slash": 0x2C, "/": 0x2C, "period": 0x2F, ".": 0x2F, "backtick": 0x32, "`": 0x32,
    "enter": 0x24, "return": 0x24, "tab": 0x30, "space": 0x31, "backspace": 0x33, "esc": 0x35, "escape": 0x35,
    "delete": 0x75, "del": 0x75, "home": 0x73, "end": 0x77, "pageup": 0x74, "pgup": 0x74, "pagedown": 0x79, "pgdn": 0x79,
    "left": 0x7B, "right": 0x7C, "down": 0x7D, "up": 0x7E, "capslock": 0x39,
    "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76, "f5": 0x60, "f6": 0x61, "f7": 0x62, "f8": 0x64,
    "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F, "f13": 0x69, "f14": 0x6B, "f15": 0x71, "f16": 0x6A,
    "f17": 0x40, "f18": 0x4F, "f19": 0x50, "f20": 0x5A,
    "num0": 0x52, "num1": 0x53, "num2": 0x54, "num3": 0x55, "num4": 0x56, "num5": 0x57, "num6": 0x58,
    "num7": 0x59, "num8": 0x5B, "num9": 0x5C, "decimal": 0x41, "multiply": 0x43, "add": 0x45,
    "divide": 0x4B, "subtract": 0x4E,
]

let modifierFlags: [String: CGEventFlags] = [
    "cmd": .maskCommand, "command": .maskCommand, "meta": .maskCommand, "win": .maskCommand,
    "shift": .maskShift,
    "ctrl": .maskControl, "control": .maskControl,
    "alt": .maskAlternate, "option": .maskAlternate, "opt": .maskAlternate,
    "fn": .maskSecondaryFn,
]

// 미디어 키 (NX_KEYTYPE_*) — 키보드의 재생/음량 키와 똑같이 동작
let mediaKeys: [String: Int32] = [
    "playpause": 16, "play": 16, "media_play": 16,
    "next": 17, "media_next": 17, "prev": 18, "media_prev": 18,
    "volup": 0, "volume_up": 0, "voldown": 1, "volume_down": 1, "mute": 7, "volume_mute": 7,
]

let source = CGEventSource(stateID: .hidSystemState)

func postKey(_ code: CGKeyCode, flags: CGEventFlags) {
    for down in [true, false] {
        guard let ev = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { continue }
        ev.flags = flags
        ev.post(tap: .cghidEventTap)
    }
}

func postMedia(_ key: Int32) {
    for down in [true, false] {
        let flags = NSEvent.ModifierFlags(rawValue: down ? 0xA00 : 0xB00)
        let data1 = Int((key << 16) | ((down ? 0xA : 0xB) << 8))
        let ev = NSEvent.otherEvent(with: .systemDefined, location: .zero, modifierFlags: flags,
                                    timestamp: 0, windowNumber: 0, context: nil,
                                    subtype: 8, data1: data1, data2: -1)
        ev?.cgEvent?.post(tap: .cghidEventTap)
    }
}

// "cmd+shift+4" 또는 "cmd+a, cmd+c" (쉼표로 순차 입력)
func hotkey(_ spec: String) throws {
    for combo in spec.split(separator: ",") {
        var parts = combo.trimmingCharacters(in: .whitespaces).lowercased()
            .split(separator: "+", omittingEmptySubsequences: true).map(String.init)
        if combo.hasSuffix("++") { parts.append("plus") }
        guard let last = parts.last else { continue }
        var flags = CGEventFlags()
        for p in parts.dropLast() {
            guard let f = modifierFlags[p] else { throw HelperError("알 수 없는 수정키: '\(p)'") }
            flags.insert(f)
        }
        if parts.count == 1, let media = mediaKeys[last] {
            postMedia(media)
        } else if let code = keyCodes[last] {
            postKey(code, flags: flags)
        } else if let f = modifierFlags[last], parts.count == 1 {
            postKey(f == .maskCommand ? 0x37 : f == .maskShift ? 0x38 : f == .maskAlternate ? 0x3A : 0x3B, flags: [])
        } else {
            throw HelperError("알 수 없는 키 이름: '\(last)'")
        }
        usleep(30_000)
    }
}

// 유니코드 문자 직접 입력 — 한글/이모지도 입력기 상태와 무관하게 입력됨
func typeText(_ text: String) {
    for ch in text {
        if ch == "\n" { postKey(0x24, flags: []); continue }
        let units = Array(String(ch).utf16)
        for down in [true, false] {
            guard let ev = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down) else { continue }
            units.withUnsafeBufferPointer { ev.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress) }
            ev.post(tap: .cghidEventTap)
        }
        usleep(4_000)
    }
}

// ---------- 마우스 드래그 흉내 (색보정 등 숫자 값 미세 조절) ----------
// 지금 커서 자리에서 누르고 → dx 만큼 끌고 → 떼고 → 커서를 원래 자리로
func scrub(dx: Int, dy: Int, hold: String) throws {
    var flags = CGEventFlags()
    for p in hold.lowercased().split(separator: "+").map(String.init) where !p.isEmpty {
        guard let f = modifierFlags[p] else { throw HelperError("알 수 없는 수정키: '\(p)'") }
        flags.insert(f)
    }
    let start = CGEvent(source: nil)?.location ?? .zero
    func mouse(_ type: CGEventType, _ pt: CGPoint) {
        guard let ev = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: pt, mouseButton: .left) else { return }
        ev.flags = flags
        ev.post(tap: .cghidEventTap)
    }
    mouse(.leftMouseDown, start)
    usleep(15_000)
    let dist = max(abs(dx), abs(dy))
    let threshold = 5   // 이보다 적게 움직이면 클릭으로 오해받음 → 5픽셀까지 끌었다가 목표 위치로 되돌아옴
    func drag(_ x: Int, _ y: Int) {
        mouse(.leftMouseDragged, CGPoint(x: start.x + CGFloat(x), y: start.y + CGFloat(y)))
        usleep(4_000)
    }
    if dist > 0 && dist < threshold {
        let ox = dx == 0 ? 0 : (dx > 0 ? threshold : -threshold), oy = dy == 0 ? 0 : (dy > 0 ? threshold : -threshold)
        for i in 1...3 { drag(ox * i / 3, oy * i / 3) }
        drag(dx, dy)
    } else {
        let steps = max(2, dist / 3)
        for i in 1...steps { drag(dx * i / steps, dy * i / steps) }
    }
    let end = CGPoint(x: start.x + CGFloat(dx), y: start.y + CGFloat(dy))
    mouse(.leftMouseUp, end)
    usleep(10_000)
    CGWarpMouseCursorPosition(start)
    CGAssociateMouseAndMouseCursorPosition(1)
}

// ---------- 마우스 휠 (양수 = 위/오른쪽) ----------
func wheel(_ notches: Int, horizontal: Bool, hold: String) throws {
    var flags = CGEventFlags()
    for p in hold.lowercased().split(separator: "+").map(String.init) where !p.isEmpty {
        guard let f = modifierFlags[p] else { throw HelperError("알 수 없는 수정키: '\(p)'") }
        flags.insert(f)
    }
    let n = Int32(notches)
    guard let ev = CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2,
                           wheel1: horizontal ? 0 : n, wheel2: horizontal ? n : 0, wheel3: 0) else { return }
    ev.flags = flags
    ev.post(tap: .cghidEventTap)
}

// ---------- 지금 앞에 떠 있는 프로그램 이름 ----------
// (도우미는 이벤트 루프가 없어서 NSWorkspace 대신 화면의 맨 앞 창 주인을 직접 확인)
func foregroundName() -> String {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return "" }
    for w in list where (w[kCGWindowLayer as String] as? Int) == 0 {
        if let name = w[kCGWindowOwnerName as String] as? String { return name }
    }
    return ""
}

// ---------- 볼륨 (Core Audio, 1% 단위) ----------
func defaultOutputDevice() -> AudioDeviceID {
    var id = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice,
                                          mScope: kAudioObjectPropertyScopeGlobal,
                                          mElement: kAudioObjectPropertyElementMain)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
    return id
}

var volumeAddr = AudioObjectPropertyAddress(mSelector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume,
                                            mScope: kAudioDevicePropertyScopeOutput,
                                            mElement: kAudioObjectPropertyElementMain)
var muteAddr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyMute,
                                          mScope: kAudioDevicePropertyScopeOutput,
                                          mElement: kAudioObjectPropertyElementMain)

func getVolume() -> Int? {
    let dev = defaultOutputDevice()
    guard AudioObjectHasProperty(dev, &volumeAddr) else { return nil }
    var v = Float32(0)
    var size = UInt32(MemoryLayout<Float32>.size)
    guard AudioObjectGetPropertyData(dev, &volumeAddr, 0, nil, &size, &v) == noErr else { return nil }
    return Int((v * 100).rounded())
}

func setVolume(_ percent: Int) -> Bool {
    let dev = defaultOutputDevice()
    guard AudioObjectHasProperty(dev, &volumeAddr) else { return false }
    var v = Float32(max(0, min(100, percent))) / 100
    return AudioObjectSetPropertyData(dev, &volumeAddr, 0, nil, UInt32(MemoryLayout<Float32>.size), &v) == noErr
}

func getMute() -> Bool {
    let dev = defaultOutputDevice()
    guard AudioObjectHasProperty(dev, &muteAddr) else { return false }
    var m = UInt32(0)
    var size = UInt32(MemoryLayout<UInt32>.size)
    AudioObjectGetPropertyData(dev, &muteAddr, 0, nil, &size, &m)
    return m != 0
}

func setMute(_ on: Bool) {
    let dev = defaultOutputDevice()
    guard AudioObjectHasProperty(dev, &muteAddr) else { return }
    var m = UInt32(on ? 1 : 0)
    AudioObjectSetPropertyData(dev, &muteAddr, 0, nil, UInt32(MemoryLayout<UInt32>.size), &m)
}

func volumeReport() -> String { "VOL \(getVolume() ?? 0) \(getMute() ? 1 : 0)" }

func changeVolume(_ delta: Int) throws -> String {
    guard let cur = getVolume() else {
        // HDMI 등 볼륨 조절을 지원하지 않는 출력 장치
        throw HelperError("현재 출력 장치는 볼륨 조절을 지원하지 않습니다")
    }
    _ = setVolume(cur + delta)
    if delta > 0 && getMute() { setMute(false) }   // 실제 다이얼처럼: 올리면 음소거 해제
    return volumeReport()
}

// ---------- 앱 / 파일 / 웹 열기 ----------
func run(_ path: String, _ args: [String]) throws {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: path)
    p.arguments = args
    try p.run()
}

func splitArgs(_ s: String) -> [String] {   // 큰따옴표로 묶은 인자 지원
    var out: [String] = [], cur = "", quoted = false
    for ch in s {
        if ch == "\"" { quoted.toggle(); continue }
        if ch == " " && !quoted { if !cur.isEmpty { out.append(cur); cur = "" }; continue }
        cur.append(ch)
    }
    if !cur.isEmpty { out.append(cur) }
    return out
}

// target: "https://…" | "~/Downloads" | "/Applications/Blender.app" | "Google Chrome"(앱 이름)
func openTarget(_ target: String, _ args: String) throws {
    let t = (target as NSString).expandingTildeInPath
    let extra = splitArgs(args)
    if target.contains("://") {
        try run("/usr/bin/open", [target])
    } else if FileManager.default.fileExists(atPath: t) {
        try run("/usr/bin/open", t.hasSuffix(".app") && !extra.isEmpty ? ["-a", t] + extra : [t] + extra)
    } else {
        try run("/usr/bin/open", ["-a", target] + extra)
    }
}

// ---------- 앱 아이콘 → PNG ----------
func saveIcon(_ src: String, _ out: String, size: Int = 256) throws {
    let expanded = (src as NSString).expandingTildeInPath
    var path = expanded
    if !FileManager.default.fileExists(atPath: path) {
        guard let p = NSWorkspace.shared.fullPath(forApplication: src) else { throw HelperError("앱을 찾을 수 없습니다: \(src)") }
        path = p
    }
    let icon = NSWorkspace.shared.icon(forFile: path)
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else {
        throw HelperError("이미지 버퍼를 만들 수 없습니다")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    icon.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { throw HelperError("PNG 변환 실패") }
    try png.write(to: URL(fileURLWithPath: out))
}

struct HelperError: Error, CustomStringConvertible {
    let description: String
    init(_ d: String) { description = d }
}

// ---------- 실행 ----------
let argv = CommandLine.arguments
if argv.count == 4 && argv[1] == "--icon" {
    do { try saveIcon(argv[2], argv[3]); say("saved \(argv[3])"); exit(0) }
    catch { FileHandle.standardError.write("\(error)\n".data(using: .utf8)!); exit(1) }
}

// 키 입력에는 "손쉬운 사용" 권한이 필요 — 없으면 시스템 설정 창을 띄워 안내
let trusted = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
if !trusted {
    say("손쉬운 사용 권한이 필요합니다: 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용 에서 터미널(또는 node)을 허용한 뒤 Phone Deck 을 다시 실행하세요")
}

say("ready")
while let line = readLine() {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty { continue }
    do {
        guard let data = trimmed.data(using: .utf8),
              let cmd = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let op = cmd["op"] as? String else { throw HelperError("명령을 읽을 수 없습니다") }
        switch op {
        case "hotkey": try hotkey(cmd["keys"] as? String ?? "")
        case "text": typeText(cmd["text"] as? String ?? "")
        case "open": try openTarget(cmd["target"] as? String ?? "", cmd["args"] as? String ?? "")
        case "run": try run("/bin/zsh", ["-lc", cmd["command"] as? String ?? ""])
        case "vol": say(try changeVolume((cmd["delta"] as? NSNumber)?.intValue ?? 0))
        case "volget": say(volumeReport())
        case "volmute": setMute(!getMute()); say(volumeReport())
        case "scrub": try scrub(dx: (cmd["dx"] as? NSNumber)?.intValue ?? 0, dy: (cmd["dy"] as? NSNumber)?.intValue ?? 0, hold: cmd["hold"] as? String ?? "")
        case "wheel": try wheel((cmd["n"] as? NSNumber)?.intValue ?? 0, horizontal: (cmd["horizontal"] as? Bool) ?? false, hold: cmd["hold"] as? String ?? "")
        case "fg": say("FG \(foregroundName())")
        default: throw HelperError("알 수 없는 명령: \(op)")
        }
    } catch {
        say("실패: \(error)")
    }
}
