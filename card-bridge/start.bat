@echo off
title Card Reader Bridge - keep this open during a session
cd /d "%~dp0"
echo Starting the card reader bridge...
echo Keep this window open. Click your /scan page in the browser, then tap cards.
echo.
py card_bridge.py
echo.
echo Bridge stopped. Press any key to close.
pause >nul
