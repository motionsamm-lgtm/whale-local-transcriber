@echo off
setlocal
cd /d "%~dp0"
title Fix Whale Local transcription
echo.
echo Fixing the audio decoder compatibility issue...
echo.
if not exist "engine\.venv\Scripts\python.exe" (
  echo I could not find the app's Python environment.
  echo Make sure this BAT file is inside the Whale-Local-Prototype folder.
  echo.
  pause
  exit /b 1
)
"engine\.venv\Scripts\python.exe" -m pip install "av>=11,<19" "requests>=2.31,<3"
if errorlevel 1 (
  echo.
  echo The fix did not finish. Check your internet connection and try again.
  echo.
  pause
  exit /b 1
)
"engine\.venv\Scripts\python.exe" -c "import av, requests, faster_whisper; print('Engine check passed. PyAV', av.__version__)"
if errorlevel 1 (
  echo.
  echo The package installed, but the engine check failed. Send me a screenshot of this window.
  echo.
  pause
  exit /b 1
)
echo.
echo Fixed. Close this window, reopen Whale Local, and transcribe the video again.
echo.
pause
