@echo off
REM KantoForge render agent — double-click this file to start the agent.
REM Leave the window open while you want renders to be processed.
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo Python 3 was not found. Install it from https://www.python.org/downloads/
  echo and tick "Add Python to PATH" during setup, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo.
  echo No .env file found in this folder.
  echo Make a copy of ".env.example", rename the copy to ".env", and fill it in first.
  echo.
  pause
  exit /b 1
)

echo Starting KantoForge render agent - keep this window open...
echo (Close the window or press Ctrl+C to stop.)
echo.
python kf_render_agent.py
echo.
echo Agent stopped.
pause
