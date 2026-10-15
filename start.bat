@echo off
title Phone Deck
cd /d "%~dp0"

rem If already running (e.g. autostart), just open the setup page.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage.ps1" running
if errorlevel 1 (
  start "" http://localhost:8765/setup
  timeout /t 3 >nul
  exit /b
)

chcp 65001 >nul
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8765/setup"
node server.js
pause
