@echo off
setlocal
cd /d "%~dp0"
title Enable RTX GPU transcription
echo Installing NVIDIA CUDA 12 cuBLAS and cuDNN 9 runtime files for the RTX GPU.
echo This is a large one-time download (roughly 1.2 GB). Keep this window open.
echo.
if not exist "engine\.venv\Scripts\python.exe" (
  echo Python engine not found. Run setup_windows.bat first.
  pause
  exit /b 1
)
"engine\.venv\Scripts\python.exe" -m pip install --no-cache-dir nvidia-cublas-cu12 "nvidia-cudnn-cu12>=9,<10"
if errorlevel 1 (
  echo.
  echo NVIDIA runtime install failed. The app can still transcribe using CPU fallback.
  pause
  exit /b 1
)
"engine\.venv\Scripts\python.exe" -c "import nvidia.cublas, nvidia.cudnn; print('NVIDIA CUDA runtime packages installed.')"
if errorlevel 1 (
  echo NVIDIA runtime verification failed. Send me a screenshot of this window.
  pause
  exit /b 1
)
echo.
echo GPU runtime installed. Close and reopen Whale Local, then transcribe again.
echo The app will add the bundled DLL folders automatically.
pause
