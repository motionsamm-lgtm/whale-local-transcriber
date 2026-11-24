# Whale Local

A Windows desktop prototype for local audio/video transcription with three modes. It uses `faster-whisper` and downloads the selected model the first time it runs. Files are not uploaded by the app.

## Setup

1. Install 64-bit Python 3.12 and Node.js on Windows.
2. Double-click `setup_windows.bat`.
3. Double-click `start_windows.bat`.
4. First transcription downloads model weights; leave the app online until the initial model download finishes.

## Installable Windows app

The GitHub Actions workflow at `.github/workflows/windows-installer.yml` builds an x64 NSIS installer. The installer bundles Electron, a PyInstaller-built transcription engine, and CUDA 12/cuDNN 9 runtime libraries, so the installed app does not need Node.js or Python installed separately. It can use a supported NVIDIA GPU and falls back to CPU if CUDA cannot initialize. Whisper downloads model weights the first time each model is selected; the models are several GB in total and remain local afterward. Bundling the GPU runtime makes the installer large.

The source code is in the root of the `motionsamm-lgtm/whale-local-transcriber` repository. Every push to `main` builds a new installer, increments the patch version, and publishes the installer plus updater metadata as the latest GitHub Release. You can also run **Actions → Build Whale Local for Windows → Run workflow** manually. The workflow smoke-checks the frozen Python engine before packaging.

Packaged installs check for releases 12 seconds after launch and then every four hours, download updates automatically, and restart to install one when it is ready. If a batch is running, installation waits for every recording in that batch. Running the project from source with `npm start` does not use the updater. Because this prototype is not Authenticode-signed, Windows may show a SmartScreen warning on installation and updates do not carry a publisher signature. The engine keeps the same large-v3 Whale model and decoding settings. The first install and first model download both need an internet connection; transcription itself stays on the PC.

Electron's runtime is installed separately under your Windows user folder, so the app does not need to replace or delete Electron files inside the downloaded project. If the runtime is missing or broken, run `repair_all.bat` to install a fresh copy and launch the app. It does not remove the Python environment or transcripts.

Chromium's session and disk cache are stored under `%LOCALAPPDATA%\WhaleLocal\SessionData`. The app enforces one running instance to prevent Windows cache-file collisions. Electron's lightweight UI uses software rendering; Whisper's Python process can still use CUDA for transcription.

## Workspace

- **Queue**: add or drop multiple recordings, then choose **Options** to set the mode, language, and speaker detection for the next batch. Files are processed one at a time. Each has its own progress, result, or error.
- **Transcripts**: find completed recordings, toggle timestamps, copy text, and review or edit speaker labels. Results and labels are saved locally. Existing TXT and SRT outputs are imported from the app's transcript storage.
- **Export**: TXT is selected by default. Its timestamps are optional. SRT always includes timing. If both formats are selected, Whale Local saves them together in a new folder in the chosen location.
- **Settings**: choose Dark, Light, or Follow Windows.

Speaker detection is optional. It downloads and caches the Sherpa-ONNX speaker models on first use. If automatic detection splits one voice into multiple labels, set the expected speaker count and run the recording again, or edit the labels in the transcript.

## Modes

- Cheetah: `large-v3-turbo`, beam 1.
- Dolphin: `large-v3`, beam 3.
- Whale: `large-v3`, beam 5, default.

Whale is deliberately configured as the most careful local option. This is a first prototype, not yet validated against TurboScribe Whale. Accuracy needs to be measured on the user's own recordings and transcripts before claiming parity.

Whale also uses Whisper's long-form repetition-loop mitigation, fallback decoding temperatures for unstable segments, and a safety check that stops after a decoder repeats the same segment three times in a row. If that safety check triggers, the transcript is marked as incomplete and the app tells you where it stopped instead of silently filling the rest with repeated text.

GPU mode uses CUDA FP16 when the CUDA 12/cuDNN 9 runtime is available. If those libraries are missing or the GPU cannot initialize, it retries on CPU INT8 instead of failing. To install the optional NVIDIA runtime for RTX acceleration, double-click `enable_gpu.bat` (large one-time download). The local engine writes TXT and SRT files under the app's user-data folder.
