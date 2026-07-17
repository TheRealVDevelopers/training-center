@echo off
REM ============================================================
REM  Card Reader Bridge - one-time setup + auto-start on boot
REM  Needs ONLY Python 3 (no other libraries, no compiler).
REM  Run this ONCE on any PC that has the ACR122U reader.
REM ============================================================
cd /d "%~dp0"

py --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Python not found. Install Python 3 from https://python.org
  echo   During install, TICK "Add python.exe to PATH". Then run this again.
  pause
  exit /b 1
)

echo [1/2] Adding the bridge to Windows startup...
set "VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CardBridge.vbs"
> "%VBS%" echo Set s = CreateObject("WScript.Shell")
>> "%VBS%" echo s.CurrentDirectory = "%~dp0"
>> "%VBS%" echo s.Run "py ""%~dp0pcsc_bridge.py""", 0, False

echo [2/2] Starting the bridge now...
start "" /min py "%~dp0pcsc_bridge.py"

echo.
echo   DONE. The reader bridge is running and will auto-start every boot.
echo   Check it: open  http://127.0.0.1:47113/readers  in a browser.
echo   To stop:  Task Manager - end the python task.
echo   To remove auto-start: delete  %VBS%
echo.
pause
