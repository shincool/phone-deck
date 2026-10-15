# Phone Deck 키 입력 도우미 — server.js 가 실행하는 상주 프로세스.
# 표준입력으로 한 줄짜리 JSON 명령을 받아 키 입력 / 프로그램 실행을 합니다.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class Deck {
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint n, INPUT[] inputs, int size);

    const uint EXTENDED = 0x1, KEYUP = 0x2, UNICODE = 0x4;

    static INPUT Key(ushort vk, ushort scan, uint flags) {
        INPUT i = new INPUT();
        i.type = 1;
        i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags;
        return i;
    }

    static bool IsExtended(ushort vk) {
        return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C
            || vk == 0x6F || (vk >= 0xA6 && vk <= 0xB7) || vk == 0xA3 || vk == 0xA5;
    }

    static void Send(List<INPUT> list) {
        INPUT[] arr = list.ToArray();
        SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Down(ushort vk) {
        List<INPUT> l = new List<INPUT>();
        l.Add(Key(vk, 0, IsExtended(vk) ? EXTENDED : 0));
        Send(l);
    }
    public static void Up(ushort vk) {
        List<INPUT> l = new List<INPUT>();
        l.Add(Key(vk, 0, (IsExtended(vk) ? EXTENDED : 0) | KEYUP));
        Send(l);
    }

    // 동시 입력: 순서대로 누르고 역순으로 뗌 (예: Ctrl, Shift, Esc)
    public static void Combo(ushort[] vks) {
        List<INPUT> list = new List<INPUT>();
        foreach (ushort vk in vks) list.Add(Key(vk, 0, IsExtended(vk) ? EXTENDED : 0));
        for (int k = vks.Length - 1; k >= 0; k--) list.Add(Key(vks[k], 0, (IsExtended(vks[k]) ? EXTENDED : 0) | KEYUP));
        Send(list);
    }

    // 유니코드 문자 직접 입력 — 한글/이모지도 IME 상태와 무관하게 입력됨
    public static void Type(string s) {
        foreach (char c in s) {
            if (c == '\r') continue;
            if (c == '\n') { Combo(new ushort[] { 0x0D }); continue; }
            List<INPUT> list = new List<INPUT>();
            list.Add(Key(0, c, UNICODE));
            list.Add(Key(0, c, UNICODE | KEYUP));
            Send(list);
        }
    }
}

// 마우스 드래그 흉내 — 프리미어/애프터 이펙트의 숫자 값 위에서 좌우로 끌면 값이 바뀌는 기능을 이용
// 지금 커서 자리에서 누르고 → dx 만큼 끌고 → 떼고 → 커서를 원래 자리로 돌려놓음
public static class Mouse {
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
    const uint LEFTDOWN = 0x2, LEFTUP = 0x4, MOVE = 0x1;

    const uint WHEEL = 0x0800, HWHEEL = 0x01000;
    const int DRAG_THRESHOLD = 5;   // 이보다 적게 움직이면 프로그램이 "클릭"으로 받아들임

    static void MoveTo(int x, int y) {
        SetCursorPos(x, y);
        mouse_event(MOVE, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(4);
    }

    public static void Scrub(int dx, int dy) {
        POINT start;
        GetCursorPos(out start);
        mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(15);
        // 1~4픽셀처럼 아주 조금 끌 때는 클릭으로 오해받지 않도록
        // 같은 방향으로 5픽셀까지 끌었다가 목표 위치로 되돌아옴 (값은 마지막 위치 기준으로 정해짐)
        int dist = Math.Max(Math.Abs(dx), Math.Abs(dy));
        if (dist > 0 && dist < DRAG_THRESHOLD) {
            int ox = dx == 0 ? 0 : Math.Sign(dx) * DRAG_THRESHOLD, oy = dy == 0 ? 0 : Math.Sign(dy) * DRAG_THRESHOLD;
            for (int i = 1; i <= 3; i++) MoveTo(start.X + ox * i / 3, start.Y + oy * i / 3);
            MoveTo(start.X + dx, start.Y + dy);
        } else {
            // 프로그램이 "끌기"로 알아보도록 여러 번에 나눠 움직임
            int steps = Math.Max(2, dist / 3);
            for (int i = 1; i <= steps; i++) MoveTo(start.X + dx * i / steps, start.Y + dy * i / steps);
        }
        mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(10);
        SetCursorPos(start.X, start.Y);
    }

    // 마우스 휠: 지금 커서가 있는 곳에서 notches 칸 굴림 (양수 = 위/오른쪽)
    public static void Wheel(int notches, bool horizontal) {
        mouse_event(horizontal ? HWHEEL : WHEEL, 0, 0, (uint)(notches * 120), UIntPtr.Zero);
    }
}

// 지금 앞에 떠 있는 프로그램 이름 (프로그램별 자동 페이지 전환용)
public static class Foreground {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public static string Name() {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        if (pid == 0) return "";
        try { return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
    }
}

// Windows 기본 출력 장치의 볼륨을 1% 단위로 직접 조절 (Core Audio)
public static class Audio {
    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        int _0(); int _1(); int _2(); int _3();
        int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
        int _5();
        int GetMasterVolumeLevelScalar(out float level);
        int _7(); int _8(); int _9(); int _10();
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice { int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator { int _0(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev); }
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

    static IAudioEndpointVolume Endpoint() {   // 매번 조회: 이어폰 연결 등으로 기본 장치가 바뀔 수 있음
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        IMMDevice dev;
        Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 0, out dev));
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object o;
        Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
        return (IAudioEndpointVolume)o;
    }

    static string Report(IAudioEndpointVolume ep) {
        float lv; bool mute;
        ep.GetMasterVolumeLevelScalar(out lv);
        ep.GetMute(out mute);
        return "VOL " + (int)Math.Round(lv * 100) + " " + (mute ? 1 : 0);
    }

    public static string Get() { return Report(Endpoint()); }

    public static string Change(int deltaPercent) {
        IAudioEndpointVolume ep = Endpoint();
        Guid ctx = Guid.Empty;
        float lv; ep.GetMasterVolumeLevelScalar(out lv);
        double next = Math.Max(0, Math.Min(100, Math.Round(lv * 100) + deltaPercent));
        ep.SetMasterVolumeLevelScalar((float)(next / 100.0), ref ctx);
        bool mute; ep.GetMute(out mute);
        if (mute && deltaPercent > 0) ep.SetMute(false, ref ctx);   // 실제 다이얼처럼: 올리면 음소거 해제
        return Report(ep);
    }

    public static string ToggleMute() {
        IAudioEndpointVolume ep = Endpoint();
        Guid ctx = Guid.Empty;
        bool mute; ep.GetMute(out mute);
        ep.SetMute(!mute, ref ctx);
        return Report(ep);
    }
}
'@

$vk = @{
    ctrl = 0x11; control = 0x11; shift = 0x10; alt = 0x12; win = 0x5B; windows = 0x5B
    enter = 0x0D; return = 0x0D; esc = 0x1B; escape = 0x1B; tab = 0x09; space = 0x20
    backspace = 0x08; delete = 0x2E; del = 0x2E; insert = 0x2D; ins = 0x2D
    home = 0x24; end = 0x23; pageup = 0x21; pgup = 0x21; pagedown = 0x22; pgdn = 0x22
    left = 0x25; up = 0x26; right = 0x27; down = 0x28
    printscreen = 0x2C; prtsc = 0x2C; pause = 0x13; capslock = 0x14; numlock = 0x90; scrolllock = 0x91
    hangul = 0x15; hanja = 0x19; menu = 0x5D; apps = 0x5D
    volume_mute = 0xAD; mute = 0xAD; volume_down = 0xAE; voldown = 0xAE; volume_up = 0xAF; volup = 0xAF
    media_next = 0xB0; next = 0xB0; media_prev = 0xB1; prev = 0xB1; media_stop = 0xB2; stop = 0xB2
    media_play = 0xB3; playpause = 0xB3; play = 0xB3
    minus = 0xBD; '-' = 0xBD; equal = 0xBB; plus = 0xBB; '=' = 0xBB; comma = 0xBC; ',' = 0xBC
    period = 0xBE; '.' = 0xBE; slash = 0xBF; '/' = 0xBF; backtick = 0xC0; '`' = 0xC0
    semicolon = 0xBA; ';' = 0xBA; quote = 0xDE; "'" = 0xDE
    '[' = 0xDB; ']' = 0xDD; backslash = 0xDC; '\' = 0xDC
    num0 = 0x60; num1 = 0x61; num2 = 0x62; num3 = 0x63; num4 = 0x64; num5 = 0x65; num6 = 0x66; num7 = 0x67; num8 = 0x68; num9 = 0x69
    multiply = 0x6A; add = 0x6B; subtract = 0x6D; decimal = 0x6E; divide = 0x6F
}
for ($i = 1; $i -le 24; $i++) { $vk["f$i"] = 0x6F + $i }

function Resolve-Key([string]$name) {
    $n = $name.Trim().ToLower()
    if ($vk.ContainsKey($n)) { return [uint16]$vk[$n] }
    if ($n -match '^[a-z0-9]$') { return [uint16][int][char]$n.ToUpper() }
    throw "알 수 없는 키 이름: '$name'"
}

function Invoke-Command-Line($cmd) {
    switch ($cmd.op) {
        'hotkey' {
            # "ctrl+shift+esc" 또는 "ctrl+c, ctrl+v" (쉼표로 순차 입력)
            foreach ($combo in ($cmd.keys -split '\s*,\s*')) {
                if (-not $combo) { continue }
                $parts = $combo -split '\+' | Where-Object { $_ -ne '' }
                if ($combo.EndsWith('++')) { $parts += 'plus' }
                [Deck]::Combo([uint16[]]@($parts | ForEach-Object { Resolve-Key $_ }))
                Start-Sleep -Milliseconds 30
            }
        }
        'text' { [Deck]::Type([string]$cmd.text) }
        'vol' { Write-Output ([Audio]::Change([int]$cmd.delta)) }
        'volget' { Write-Output ([Audio]::Get()) }
        'volmute' { Write-Output ([Audio]::ToggleMute()) }
        'scrub' {
            # 드래그하는 동안 누르고 있을 수정키 (예: 애프터 이펙트는 ctrl = 미세 조절)
            $mods = @()
            if ($cmd.hold) { $mods = @(($cmd.hold -split '\+') | Where-Object { $_ } | ForEach-Object { Resolve-Key $_ }) }
            foreach ($m in $mods) { [Deck]::Down($m) }
            try { [Mouse]::Scrub([int]$cmd.dx, [int]$cmd.dy) }
            finally { foreach ($m in $mods) { [Deck]::Up($m) } }
        }
        'wheel' {
            $mods = @()
            if ($cmd.hold) { $mods = @(($cmd.hold -split '\+') | Where-Object { $_ } | ForEach-Object { Resolve-Key $_ }) }
            foreach ($m in $mods) { [Deck]::Down($m) }
            try { [Mouse]::Wheel([int]$cmd.n, [bool]$cmd.horizontal) }
            finally { Start-Sleep -Milliseconds 15; foreach ($m in $mods) { [Deck]::Up($m) } }
        }
        'fg' { Write-Output ('FG ' + [Foreground]::Name()) }
        'open' {
            if ($cmd.args) { Start-Process -FilePath $cmd.target -ArgumentList $cmd.args }
            else { Start-Process -FilePath $cmd.target }
        }
        'run' {
            Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden `
                -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd.command)
        }
        default { throw "알 수 없는 명령: $($cmd.op)" }
    }
}

Write-Output 'ready'
while ($null -ne ($line = [Console]::In.ReadLine())) {
    if (-not $line.Trim()) { continue }
    try { Invoke-Command-Line ($line | ConvertFrom-Json) }
    catch { Write-Output "실패: $($_.Exception.Message)" }
}
