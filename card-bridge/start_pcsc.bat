@echo off
REM Start the card-reader bridge (needs only Python 3 — no other libraries).
cd /d "%~dp0"
echo Starting the ACR122U reader bridge...
py pcsc_bridge.py
pause
