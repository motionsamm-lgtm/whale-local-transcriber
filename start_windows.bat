@echo off
setlocal
cd /d "%~dp0"
title Start Whale Local
echo Starting Whale Local...
echo.
if not exist "runtime_path.txt" (
  echo The clean Electron runtime has not been set up yet. Run setup_windows.bat first.
  goto :failed
)
set /p RUNTIME_DIR=<"runtime_path.txt"
set "ELECTRON_EXE=%RUNTIME_DIR%\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON_EXE%" (
  echo The saved Electron runtime is missing. Run repair_all.bat to create a fresh one.
  goto :failed
)
echo Opening Whale Local...
"%ELECTRON_EXE%" .
set "APP_EXIT=%ERRORLEVEL%"
echo.
echo Whale Local closed with exit code %APP_EXIT%.
pause
exit /b %APP_EXIT%
:failed
echo.
pause
exit /b 1
