@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage.ps1" stop
timeout /t 2 >nul
