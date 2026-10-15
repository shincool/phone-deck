# Phone Deck 관리: 자동 실행 켜기/끄기, 종료, 실행 여부 확인
# 사용: powershell -File manage.ps1 <on|off|stop|running>
param([Parameter(Mandatory)] [ValidateSet('on', 'off', 'stop', 'running', 'premiere')] [string]$Command)

$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Phone Deck.lnk'
$port = 8765
function Get-Listener { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue }

switch ($Command) {
    'on' {
        $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
        $s.TargetPath = 'wscript.exe'
        $s.Arguments = '"' + (Join-Path $PSScriptRoot 'run-hidden.vbs') + '"'
        $s.WorkingDirectory = $PSScriptRoot
        $s.Description = 'Phone Deck (iPhone remote)'
        $s.Save()
        Write-Host ''
        Write-Host '  자동 실행이 켜졌습니다. PC에 로그인하면 Phone Deck 이 창 없이 실행됩니다.'
        Write-Host '  끄려면 autostart-off.bat 을 실행하세요.'
        Write-Host ''
    }
    'off' {
        Remove-Item -LiteralPath $lnk -ErrorAction SilentlyContinue
        Write-Host ''
        Write-Host '  자동 실행이 꺼졌습니다. 지금 실행 중인 Phone Deck 은 stop.bat 으로 끌 수 있습니다.'
        Write-Host ''
    }
    'stop' {
        $c = Get-Listener
        if ($c) {
            $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
            Write-Host '  Phone Deck 을 종료했습니다.'
        } else {
            Write-Host '  Phone Deck 이 실행 중이 아닙니다.'
        }
    }
    'premiere' {
        # 프리미어용 Phone Deck Bridge 확장 설치 (색보정 Lumetri 다이얼에 필요)
        $dst = Join-Path $env:APPDATA 'Adobe\CEP\extensions\PhoneDeckBridge'
        if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'premiere-bridge') -Destination $dst -Recurse
        Write-Host ''
        Write-Host "  Phone Deck Bridge 를 설치했습니다: $dst"
        # 서명 없는 확장을 불러오려면 Adobe CEP 개발자 설정(PlayerDebugMode)이 켜져 있어야 함 — 확인만 하고 바꾸지는 않음
        $on = @(11..13 | Where-Object { (Get-ItemProperty "HKCU:\Software\Adobe\CSXS.$_" -ErrorAction SilentlyContinue).PlayerDebugMode -eq '1' })
        if (-not $on.Count) {
            Write-Host '  ⚠ 프리미어가 서명 없는 확장을 불러오도록 허용되어 있지 않습니다.'
            Write-Host '    README 의 "프리미어 확장 허용" 안내를 따라 직접 켜 주세요.'
        }
        Write-Host '  프리미어를 껐다가 다시 켜면 자동으로 연결됩니다. (창 > 확장 > Phone Deck 에서 상태 확인)'
        Write-Host ''
    }
    'running' {
        if (Get-Listener) {
            Write-Host '  Phone Deck 이 이미 실행 중입니다. 접속 안내 페이지를 엽니다.'
            exit 1
        }
        exit 0
    }
}
