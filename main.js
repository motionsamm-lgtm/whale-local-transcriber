const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

// Give Chromium its own writable session/cache folder, and avoid multiple app
// instances competing for the same persistent cache files on Windows.
const sessionRoot = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'WhaleLocal', 'SessionData');
try {
  fs.mkdirSync(sessionRoot, { recursive: true });
  app.setPath('sessionData', sessionRoot);
  app.setPath('cache', path.join(sessionRoot, 'Cache'));
  app.commandLine.appendSwitch('disk-cache-dir', path.join(sessionRoot, 'Cache'));
} catch (error) {
  console.warn('Could not configure the optional Chromium cache directory:', error.message);
}

// This app's UI is lightweight. Its transcription GPU is a separate Python
// process, so using software rendering here does not disable CUDA transcription.
app.disableHardwareAcceleration();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let win;
let activeTranscriptions = 0;
let updateDownloaded = false;
let updateRestartScheduled = false;

function sendUpdateStatus(state, extra = {}) {
  if (win && !win.isDestroyed()) win.webContents.send('app-update-status', { state, ...extra });
}

function restartToInstallUpdateWhenIdle() {
  if (!updateDownloaded || activeTranscriptions > 0 || updateRestartScheduled) return;
  updateRestartScheduled = true;
  sendUpdateStatus('installing');
  setTimeout(() => {
    if (activeTranscriptions > 0) {
      updateRestartScheduled = false;
      return;
    }
    autoUpdater.quitAndInstall(false, true);
  }, 2500);
}

function startAutomaticUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('update-available', info => sendUpdateStatus('available', { version: info.version }));
  autoUpdater.on('download-progress', progress => sendUpdateStatus('downloading', { percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', info => {
    updateDownloaded = true;
    sendUpdateStatus('downloaded', { version: info.version });
    restartToInstallUpdateWhenIdle();
  });
  autoUpdater.on('error', error => {
    console.warn('Automatic update check failed:', error.message);
    sendUpdateStatus('error');
  });

  const checkForUpdates = () => autoUpdater.checkForUpdates().catch(error => {
    console.warn('Automatic update check failed:', error.message);
  });
  // Delay the first check so the window and session are ready, then keep checking
  // while the app remains open. Updates download quietly and install automatically.
  setTimeout(checkForUpdates, 12000);
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 780, minWidth: 820, minHeight: 620,
    backgroundColor: '#111214', title: 'Whale — Local Transcriber',
    icon: path.join(__dirname, 'assets', 'app-icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile('index.html');
}
if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    createWindow();
    startAutomaticUpdates();
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('pick-audio', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio and video', extensions: ['mp3','wav','m4a','aac','flac','ogg','opus','mp4','mov','mkv','webm','avi'] }] });
  return result.canceled ? [] : result.filePaths.map(p => ({ path: p, name: path.basename(p) }));
});
ipcMain.handle('transcribe', async (event, { file, mode, language }) => {
  const root = app.getPath('userData');
  const packaged = app.isPackaged;
  const engine = packaged
    ? path.join(process.resourcesPath, 'engine', 'whale-engine.exe')
    : path.join(__dirname, 'engine', '.venv', 'Scripts', 'python.exe');
  const script = path.join(__dirname, 'engine', 'transcribe.py');
  if (!fs.existsSync(engine)) {
    throw new Error(packaged
      ? 'The bundled transcription engine is missing. Reinstall Whale Local.'
      : 'The transcription engine is not installed yet. Run setup_windows.bat first.');
  }
  activeTranscriptions += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      activeTranscriptions = Math.max(0, activeTranscriptions - 1);
      callback(value);
      restartToInstallUpdateWhenIdle();
    };
    const args = packaged ? [] : [script];
    args.push('--file', file, '--mode', mode, '--language', language || 'auto', '--outdir', path.join(root, 'transcripts'));
    let child;
    try {
      child = spawn(engine, args, { windowsHide: true, cwd: root });
    } catch (error) {
      finish(reject)(error);
      return;
    }
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); for (const line of d.toString().split(/\r?\n/)) { try { event.sender.send('engine-progress', JSON.parse(line)); } catch {} } });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', error => finish(reject)(error));
    child.on('close', code => {
      if (code !== 0) return finish(reject)(new Error(stderr.trim() || stdout.trim() || 'Transcription failed.'));
      try { finish(resolve)(JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1))); }
      catch { finish(reject)(new Error('Could not read the transcript result.')); }
    });
  });
});
ipcMain.handle('open-file', async (_, p) => shell.openPath(p));
