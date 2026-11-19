@echo off
setlocal
cd /d "%~dp0"
echo Setting up the local transcription engine...
set "NPM_CMD="
set "NODE_EXE="
where node.exe >nul 2>nul
if not errorlevel 1 for /f "delims=" %%N in ('where node.exe') do if not defined NODE_EXE set "NODE_EXE=%%N"
where npm.cmd >nul 2>nul
if not errorlevel 1 for /f "delims=" %%N in ('where npm.cmd') do if not defined NPM_CMD set "NPM_CMD=%%N"
if not defined NPM_CMD if exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"
if not defined NPM_CMD if exist "%LocalAppData%\Programs\nodejs\npm.cmd" set "NPM_CMD=%LocalAppData%\Programs\nodejs\npm.cmd"
if not defined NPM_CMD if exist "%AppData%\npm\npm.cmd" set "NPM_CMD=%AppData%\npm\npm.cmd"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
if defined NODE_EXE for %%N in ("%NODE_EXE%") do set "PATH=%%~dpN;%PATH%"
if exist "engine\.venv\Scripts\python.exe" goto :venv_ready
set "PYTHON_EXE="
where python >nul 2>nul
if not errorlevel 1 (
  python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
  if not errorlevel 1 set "PYTHON_EXE=python"
)
if not defined PYTHON_EXE (
  echo.
  echo Python 3.10 or newer was not found. Install 64-bit Python from https://www.python.org/downloads/windows/
  echo During setup, enable "Add python.exe to PATH", then close and reopen this window and run setup_windows.bat again.
  pause
  exit /b 1
)
%PYTHON_EXE% -m venv engine\.venv
if errorlevel 1 (echo Could not create the Python environment.& pause & exit /b 1)
:venv_ready
engine\.venv\Scripts\python.exe -m pip install --upgrade pip
if errorlevel 1 (echo Pip update failed. Check your internet connection and run setup_windows.bat again.& pause & exit /b 1)
engine\.venv\Scripts\python.exe -m pip install -r engine\requirements.txt
if errorlevel 1 (echo Engine setup failed. Check your internet connection and run setup_windows.bat again.& pause & exit /b 1)
if not defined NPM_CMD (
  echo.
  echo The Python transcription engine is installed, but npm.cmd could not be found.
  echo Install the Windows LTS version from https://nodejs.org/en/download
  echo Then open a new Command Prompt, check where npm.cmd, and run setup_windows.bat again.
  pause
  exit /b 1
)
if not defined NODE_EXE (
  echo Node.js was not found even though npm.cmd was found. Install Node.js LTS from https://nodejs.org/en/download
  pause
  exit /b 1
)
engine\.venv\Scripts\python.exe -c "import av, requests, faster_whisper; assert int(av.__version__.split('.')[0]) < 19; print('Transcription engine check passed; PyAV ' + av.__version__)"
if errorlevel 1 (echo Transcription engine dependency check failed. Run fix_transcription.bat.& pause & exit /b 1)
echo Installing the desktop runtime in a separate user folder...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0repair_all.ps1"
if errorlevel 1 (echo Desktop runtime setup failed.& pause & exit /b 1)
echo Setup complete. Start the app with start_windows.bat
pause
