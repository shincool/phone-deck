#!/bin/bash
# Phone Deck 실행 (맥). 이미 실행 중이면 접속 안내 페이지만 엽니다.
cd "$(dirname "$0")"

if lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  Phone Deck 이 이미 실행 중입니다. 접속 안내 페이지를 엽니다."
  open "http://localhost:8765/setup"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js 가 없습니다. https://nodejs.org 에서 설치한 뒤 다시 실행하세요."
  read -r -p "  엔터를 누르면 닫힙니다..."
  exit 1
fi

(sleep 3 && open "http://localhost:8765/setup") &
node server.js
