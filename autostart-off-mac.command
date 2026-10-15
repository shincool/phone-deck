#!/bin/bash
# Phone Deck 자동 실행 해제 (맥)
PLIST="$HOME/Library/LaunchAgents/com.phonedeck.server.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null
rm -f "$PLIST"
echo ""
echo "  자동 실행이 꺼졌습니다. 지금 실행 중인 Phone Deck 은 stop-mac.command 로 끌 수 있습니다."
echo ""
