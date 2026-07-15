@echo off
cd /d "%~dp0"
echo Installing pyscard (first run only)...
py -m pip install pyscard --quiet
echo Starting the ACS multi-reader bridge...
py pcsc_bridge.py
pause
