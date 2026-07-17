@echo off
REM ============================================================
REM  Card Reader Bridge - one-time setup + auto-start on boot
REM  Run this ONCE on any PC that has the ACR122U reader.
REM ============================================================
cd /d "%~dp0"
echo.
echo [1/3] Installing the reader library (pyscard)...
py -m pip install --quiet pyscard
if errorlevel 1 (
  echo.
  echo   Python not found. Install Python 3 from https://python.org
  echo   During install, TICK "Add python.exe to PATH". Then run this again.
  pause
  exit /b 1
)

echo [2/3] Adding the bridge to Windows startup...
set "VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CardBridge.vbs"
> "%VBS%" echo Set s = CreateObject("WScript.Shell")
>> "%VBS%" echo s.CurrentDirectory = "%~dp0"
>> "%VBS%" echo s.Run "py ""%~dp0pcsc_bridge.py""", 0, False

echo [3/3] Starting the bridge now...
start "" /min py "%~dp0pcsc_bridge.py"

echo.
echo   DONE. The reader bridge is running and will auto-start every boot.
echo   To stop it: open Task Manager, end the "py"/"python" task.
echo   To remove auto-start: delete this file -
echo   %VBS%
echo.
pause
