# 맥 Claude Code에게: Phone Deck 맥 버전 맞추기

이 문서는 **Windows PC의 Claude Code**가 작성했습니다. 맥에서 이 문서를 읽는 Claude Code가 지금까지의 변경 사항을 이해하고, 맥에서 같은 기능이 동작하도록 맞추는 것이 목적입니다.

## 1. 상황 요약

- **Phone Deck:** 아이폰 홈 화면 웹앱으로 PC를 조작하는 스트림덱 같은 도구입니다. PC에서 Node 서버가 돌고, 아이폰은 같은 Wi-Fi로 접속합니다.
- **정본 코드:** GitHub 비공개 저장소 `shincool/phone-deck`의 `main` 브랜치입니다. Windows에서 개발과 실사용 검증을 마쳤습니다.
- **맥의 상태:** 사용자가 예전에 이 프로젝트의 초기 복사본을 맥으로 옮겨서, 맥의 Claude Code로 따로 고쳐 가며 쓰고 있습니다. **그 맥 폴더에만 있는 수정이 있을 수 있습니다.** Windows 쪽에서는 그 내용을 모릅니다.
- **저장소의 맥 코드:** `mac/helper.swift`, `config.mac.default.json`, `*-mac.command`, 서버의 `IS_MAC` 분기는 **Windows에서 작성했고 맥에서는 빌드도 실행도 해 보지 않았습니다.** 컴파일 오류나 동작 차이가 있을 수 있습니다.

## 2. 해야 할 일

1. 저장소를 **새 폴더로** 받습니다. 기존 맥 폴더는 덮어쓰지 말고 비교와 백업용으로 남겨 둡니다.
   ```bash
   git clone https://github.com/shincool/phone-deck.git ~/phone-deck-new
   ```
2. 기존 맥 폴더의 **개인 파일 2개**를 새 폴더로 복사합니다. 둘 다 `.gitignore` 대상이라 저장소에는 없습니다.
   - `config.mac.json`: 사용자의 버튼 설정
   - `.token`: 접속 코드. 이 파일을 유지해야 아이폰 홈 화면 아이콘을 다시 만들 필요가 없습니다.
3. **기존 맥 폴더와 새 폴더의 코드를 비교**해서, 맥에서만 고친 부분을 찾아 새 폴더에 반영합니다. 개인 파일과 빌드 결과물은 비교에서 빼세요.
   ```bash
   diff -ru --exclude=.git --exclude=node_modules --exclude=icons --exclude=deck.log --exclude=helper "<기존 맥 폴더>" ~/phone-deck-new
   ```
   - 맥 전용 수정(앱 이름, 단축키, 권한 처리 등)은 새 코드 구조에 맞게 옮깁니다.
   - 기존 맥 폴더에만 있는 기능은 사용자에게 유지할지 물어봅니다.
4. 기존 맥 Phone Deck을 끄고 새 폴더에서 실행해 **아래 4장의 검증 목록**을 확인하고, 안 되는 부분을 고칩니다.
5. 고친 내용을 커밋하고 `main`에 푸시합니다. 그러면 Windows와 맥이 같은 코드 하나를 쓰게 됩니다. 단, **Windows 동작을 바꾸는 수정**이면 Windows 쪽에 영향이 없는지 꼭 확인하고 커밋 메시지에 적어 주세요.

## 3. 구조 (지금 버전)

| 파일 | 역할 |
|---|---|
| `server.js` | HTTP 서버(포트 8765, 외부 라이브러리 없음). 설정 로드, 도우미 관리, API, 프리미어 브리지 큐. `IS_MAC = process.platform === 'darwin'`으로 분기 |
| `mac/helper.swift` | 맥 도우미. 서버가 처음 실행할 때 `swiftc -O mac/helper.swift -o mac/helper`로 자동 빌드합니다(소스가 더 새로우면 다시 빌드). Xcode 개발 도구가 필요합니다 |
| `helper.ps1` | Windows 도우미 (참고용) |
| `mdns.js` | `phonedeck-mac.local`(Windows는 `phonedeck.local`) 이름을 직접 알리는 mDNS 응답기 |
| `config.mac.default.json` | 맥 기본 설정. `config.mac.json`이 없으면 첫 실행 때 복사됩니다 |
| `public/` | 아이폰 화면(`index.html`, `app.js`, `style.css`), PC 편집 화면(`edit.html`, `edit.js`), 아이콘 고르기(`icon-picker.js`), Lucide 아이콘(`lucide.min.js`), QR 페이지(`setup.html`) |
| `premiere-bridge/` | 프리미어 CEP 확장. Lumetri 다이얼용 |
| `start-mac.command` / `stop-mac.command` / `autostart-*-mac.command` | 맥 실행·종료·자동 실행(LaunchAgent) |

### 도우미 프로토콜 (서버 ↔ 도우미, 표준입출력으로 한 줄 JSON)
도우미는 시작하면 `ready`를 출력합니다. 서버가 보내는 명령은 다음과 같습니다.

| op | 필드 | 동작 / 출력 |
|---|---|---|
| `hotkey` | `keys` ("cmd+shift+4", 쉼표로 순차 입력) | 키 조합. 미디어 키(`playpause` 등)는 `NSEvent` systemDefined로 보냄 |
| `text` | `text` | 유니코드 문자 직접 입력 |
| `open` | `target`, `args` | URL, 경로(`~` 확장), 앱 이름(`open -a`) |
| `run` | `command` | `/bin/zsh -lc` |
| `vol` / `volget` / `volmute` | `delta` | CoreAudio로 볼륨 조절. 출력은 `VOL <0-100> <0|1>` |
| `scrub` | `dx`, `dy`, `hold` | 커서 자리에서 눌러서 끌고 원위치로. 1~4px은 5px까지 끌었다가 되돌아옴(클릭 오인 방지) |
| `wheel` | `n`, `horizontal`, `hold` | 스크롤 휠 (`CGEvent scrollWheelEvent2Source`, line 단위) |
| `fg` | — | 맨 앞 창의 주인 앱 이름. 출력은 `FG <이름>` (`CGWindowListCopyWindowInfo`, layer 0) |

오류는 `실패: <메시지>`로 출력합니다. 아이콘 추출은 별도 실행입니다: `mac/helper --icon "<앱 이름 또는 경로>" "<out.png>"`.

### 지켜야 할 보안 규칙 (바꾸지 마세요)
- 버튼·다이얼·편집 API는 모두 접속 코드(`X-Deck-Token` 또는 `?t=`)가 필요합니다.
- `/api/setup`, `/edit`, `/api/pc/*`, `/api/premiere-status`는 `isLocal()`일 때만 허용합니다. 접속 주소가 loopback이고, Host 헤더가 `localhost`/`127.0.0.1`이어야 합니다(DNS rebinding 방지). 또 `sameOriginOrNone()`이어야 하고, `/api/pc/*`는 접속 코드도 필요합니다. PC에서 연 악성 사이트가 명령을 실행하던 구멍을 이렇게 막았습니다.
- CORS(`*`)는 접속 코드가 필요한 API와 `/icons/`에만 허용합니다. `/api/pc/*`, `/api/setup`, `/api/premiere-status`에는 절대 열지 않습니다.

## 4. 맥에서 확인할 것 (Windows에서는 모두 검증 완료)

- [ ] `swiftc` 빌드 성공 (`mac/helper` 생성)
- [ ] **손쉬운 사용 권한:** 터미널(자동 실행이면 node)에 허용 → 단축키·글자 입력 동작
- [ ] QR 페이지(`http://localhost:8765/setup`)에 `phonedeck-mac.local` 주소가 뜨고, 아이폰에서 그 주소로 접속됨
- [ ] 앱 페이지: `open -a` 앱 실행과 `"image": "auto"` 앱 아이콘 표시 (`--icon` 모드)
- [ ] 다이얼: 볼륨(1% 단위, 탭하면 음소거, 현재 값 표시), 타임라인 조그(←/→)
- [ ] 마우스 휠 다이얼, 마우스 끌기 다이얼 (`scrub`)
- [ ] 미디어 키: 재생/일시정지, 다음/이전 곡
- [ ] 프로그램별 자동 전환: `fg`가 프리미어를 "Adobe Premiere Pro 2026" 같은 이름으로 돌려주는지 확인. 페이지 `apps`는 부분 일치("Adobe Premiere Pro")입니다
- [ ] 아이폰 편집 모드(이름·아이콘·색·끌어서 옮기기, 사진 업로드)와 PC 편집 화면(`http://localhost:8765/edit`) 저장
- [ ] `autostart-on-mac.command` → 재로그인 후 자동 실행
- [ ] **프리미어 Lumetri 다이얼:** 아래 5장 참고

## 5. 프리미어 Lumetri 브리지 (맥)

- 동작 방식: 확장(`premiere-bridge/bridge.js`)이 Node `http`로 `127.0.0.1:8765`에 `Host: localhost:8765` 헤더를 붙여 `/api/pc/premiere/next`를 롱 폴링합니다. 받은 명령은 `host.jsx`의 `PhoneDeck.adjust(key, delta, reset)` / `PhoneDeck.read(key)`로 실행하고, 결과를 `/api/pc/premiere/result`로 보냅니다. 접속 코드는 `/api/setup`에서 받습니다.
- 설치:
  ```bash
  defaults write com.adobe.CSXS.12 PlayerDebugMode 1
  ```
  그다음 `premiere-bridge` 폴더를 `~/Library/Application Support/Adobe/CEP/extensions/PhoneDeckBridge`로 복사하고, 프리미어를 재시작합니다. Windows용 `install-premiere-bridge.bat`에 해당하는 맥 스크립트는 아직 없습니다. 필요하면 만들어 주세요.
- Windows의 프리미어 2026(26.5.2)에서 8개 다이얼(exposure, contrast, highlights, shadows, whites, blacks, temperature, saturation)이 모두 동작했습니다. 항목 이름은 `host.jsx`의 `NAMES` 표(영어·한국어)로 찾고, 못 찾으면 실제 이름 목록을 결과의 `names`로 돌려줍니다(서버 로그에 기록).

## 6. Windows 작업 중 얻은 교훈

- **코드를 고친 뒤에는 서버를 완전히 끄고 다시 켜야 합니다.** 예전 서버가 계속 돌아서 "고쳤는데 그대로"인 일이 여러 번 있었습니다. `config.mac.json` 변경은 재시작 없이 반영됩니다.
- **Claude Code 세션에서 켠 서버는 세션이 끝나면 같이 꺼질 수 있습니다.** 사용자가 계속 쓸 서버는 `launchctl`(LaunchAgent)이나 `open`처럼 세션과 분리된 방법으로 켜고, 부모 프로세스가 세션이 아닌지 확인하세요.
- **문서 내용을 셸 명령 문자열에 직접 넣지 마세요.** 백틱(`) 부분이 명령으로 실행된 적이 있습니다. 파일은 파일 쓰기 도구로 만드세요.
- 줄바꿈은 `.gitattributes`가 관리합니다. `*.command`와 `*.swift`는 LF입니다. `open.vbs`는 UTF-16이라 binary로 지정되어 있습니다.
- 개인 정보(이메일, 사용자 폴더 경로, 접속 코드)가 들어간 파일은 커밋하지 않습니다. `config.mac.json`, `.token`, `deck.log`, `icons/upload-*`, `icons/.cache`는 이미 `.gitignore` 대상입니다.

## 7. 끝낼 때 사용자에게 알려 줄 것

- 기존 맥 폴더에서 새 코드로 옮긴 맥 전용 수정 목록
- 4장 검증 목록의 결과 (된 것 / 안 된 것)
- 커밋하고 푸시한 내용 (Windows에 영향이 있는 변경이면 따로 표시)
