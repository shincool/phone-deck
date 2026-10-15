#!/bin/bash
# Phone Deck 종료 (맥)
pids=$(lsof -nP -tiTCP:8765 -sTCP:LISTEN 2>/dev/null)
if [ -n "$pids" ]; then
  kill $pids
  echo "  Phone Deck 을 종료했습니다."
else
  echo "  Phone Deck 이 실행 중이 아닙니다."
fi
sleep 1
