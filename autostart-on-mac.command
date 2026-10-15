#!/bin/bash
# 맥에 로그인하면 Phone Deck 이 창 없이 자동 실행되도록 등록 (LaunchAgent)
cd "$(dirname "$0")"
DIR="$(pwd)"
NODE="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/com.phonedeck.server.plist"

if [ -z "$NODE" ]; then
  echo "  Node.js 가 없습니다. https://nodejs.org 에서 설치한 뒤 다시 실행하세요."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.phonedeck.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DIR/deck.log</string>
  <key>StandardErrorPath</key><string>$DIR/deck.log</string>
</dict>
</plist>
EOF

echo ""
echo "  자동 실행이 켜졌습니다. 맥에 로그인하면 Phone Deck 이 창 없이 실행됩니다."
echo "  (자동 실행일 때는 '손쉬운 사용'에 node 를 허용해야 키 입력이 됩니다: $NODE)"
echo "  끄려면 autostart-off-mac.command 를 실행하세요."
echo ""
