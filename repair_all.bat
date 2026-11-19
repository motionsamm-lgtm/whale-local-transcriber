@echo off
setlocal
cd /d "%~dp0"
title Repair Whale Local (complete)
echo This will repair the Electron runtime and keep the Python engine as installed.
echo It leaves the locked Electron files in the project folder untouched.
echo A fresh matching runtime will be installed in your Windows user folder.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0repair_all.ps1" -Launch
if errorlevel 1 (
  echo.
  echo Repair failed. This window is staying open so the error remains visible.
  pause
)
