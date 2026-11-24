const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createHash, randomUUID } = require('node:crypto');
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
let updateCheckInFlight = null;
let updateCheckIsManual = false;

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

function requestUpdateCheck(manual = false) {
  if (!app.isPackaged) {
    if (manual) sendUpdateStatus('error', { manual: true });
    return Promise.resolve(null);
  }
  if (manual) {
    updateCheckIsManual = true;
    sendUpdateStatus('checking');
  }
  if (updateCheckInFlight) return updateCheckInFlight;
  updateCheckInFlight = autoUpdater.checkForUpdates()
    .catch(error => {
      console.warn('Automatic update check failed:', error.message);
      if (updateCheckIsManual) sendUpdateStatus('error', { manual: true });
      return null;
    })
    .finally(() => {
      updateCheckInFlight = null;
      updateCheckIsManual = false;
    });
  return updateCheckInFlight;
}

function startAutomaticUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('update-available', info => sendUpdateStatus('available', { version: info.version }));
  autoUpdater.on('update-not-available', () => {
    if (updateCheckIsManual) sendUpdateStatus('up-to-date', { version: app.getVersion() });
  });
  autoUpdater.on('download-progress', progress => sendUpdateStatus('downloading', { percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', info => {
    updateDownloaded = true;
    sendUpdateStatus('downloaded', { version: info.version });
    restartToInstallUpdateWhenIdle();
  });
  autoUpdater.on('error', error => {
    console.warn('Automatic update check failed:', error.message);
    if (updateCheckIsManual) sendUpdateStatus('error', { manual: true });
  });

  // Start background checks after the UI is ready. Settings can also request
  // a check without overlapping an automatic check already in progress.
  setTimeout(() => requestUpdateCheck(false), 12000);
  setInterval(() => requestUpdateCheck(false), 4 * 60 * 60 * 1000);
}

ipcMain.handle('check-for-updates', () => requestUpdateCheck(true));
function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 780, minWidth: 560, minHeight: 460,
    backgroundColor: '#111214', title: 'Whale — Local Transcriber',
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: {
      color: '#181c1b', symbolColor: '#e8eeeb', height: 48
    } } : {}),
    icon: path.join(__dirname, 'assets', 'app-icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.removeMenu();
  win.on('close', event => {
    if (!activeTranscriptions) return;
    event.preventDefault();
    win.webContents.send('batch-close-blocked');
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
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
  const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio and video', extensions: [...mediaExtensions] }] });
  return result.canceled ? [] : result.filePaths.map(p => ({ path: p, name: path.basename(p) }));
});
const mediaExtensions = new Set(['mp3','wav','m4a','aac','flac','ogg','opus','mp4','mov','mkv','webm','avi']);
const modes = new Set(['cheetah', 'dolphin', 'whale']);

ipcMain.handle('set-window-theme', (_, light) => {
  if (process.platform === 'win32' && win && !win.isDestroyed()) {
    win.setTitleBarOverlay({ color: light ? '#f5f7f5' : '#181c1b',
      symbolColor: light ? '#24342d' : '#e8eeeb', height: 48 });
  }
});

function transcribeFile(file, options, progress) {
  const root = app.getPath('userData');
  const engine = app.isPackaged
    ? path.join(process.resourcesPath, 'engine', 'whale-engine.exe')
    : path.join(__dirname, 'engine', '.venv', 'Scripts', 'python.exe');
  const id = randomUUID();
  const outdir = transcriptDirectory(id);
  const args = app.isPackaged ? [] : [path.join(__dirname, 'engine', 'transcribe.py')];
  args.push('--file', file, '--mode', options.mode, '--language', options.language, '--outdir', outdir);
  if (options.speakers) args.push('--speakers', '--speaker-cache', path.join(root, 'speaker-models'),
    '--speaker-count', String(options.speakerCount));

  return new Promise((resolve, reject) => {
    const child = spawn(engine, args, {
      windowsHide: true, cwd: root,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });
    let pending = '', stderr = '', result;
    function consume(line) {
      if (!line.trim()) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message?.stage === 'done') result = message;
      else if (message?.stage) progress(message);
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => {
      const lines = (pending + data).split('\n');
      pending = lines.pop();
      for (const line of lines) consume(line);
    });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4096); });
    child.once('error', reject);
    child.once('close', code => {
      consume(pending);
      if (code !== 0) return reject(new Error(stderr.trim() || 'Transcription failed.'));
      if (!Array.isArray(result?.chunks) || typeof result.text !== 'string') {
        return reject(new Error('The engine did not return a valid transcript.'));
      }
      resolve({ ...result, id });
    });
  });
}

ipcMain.handle('transcribe-batch', async (event, { jobs, mode, language, speakers, speakerCount = -1 }) => {
  if (activeTranscriptions) throw new Error('A batch is already in progress.');
  if ((speakerCount !== -1 && (!Number.isInteger(speakerCount) || speakerCount < 2 || speakerCount > 10)) ||
      !Array.isArray(jobs) || !jobs.length || !modes.has(mode) ||
      !/^(auto|[a-z]{2})$/.test(language) || jobs.some(job =>
        !Number.isSafeInteger(job?.id) || typeof job.path !== 'string' || !path.isAbsolute(job.path))) {
    throw new Error('Invalid transcription request.');
  }

  function send(message) {
    if (!event.sender.isDestroyed()) event.sender.send('batch-event', message);
  }

  activeTranscriptions++;
  try {
    for (const job of jobs) {
      if (event.sender.isDestroyed()) break;
      const deliver = message => send({ ...message, id: job.id });
      deliver({ stage: 'loading', message: 'Opening recording' });
      try {
        const stat = await fs.promises.stat(job.path);
        if (!stat.isFile() || !mediaExtensions.has(path.extname(job.path).slice(1).toLowerCase())) {
          throw new Error('Choose a supported audio or video file.');
        }
        const result = await transcribeFile(job.path, { mode, language, speakers, speakerCount }, deliver);
        result.created = Date.now();
        result.sourceFolder = path.basename(path.dirname(job.path));
        try {
          await fs.promises.writeFile(path.join(transcriptDirectory(result.id), 'result.json'), JSON.stringify(result), { flag: 'wx' });
          await fs.promises.writeFile(path.join(transcriptDirectory(result.id), 'summary.json'),
            JSON.stringify({ id: result.id, name: path.basename(job.path), created: result.created, sourceFolder: result.sourceFolder }), { flag: 'wx' });
        } catch (error) {
          result.warning = [result.warning, 'Could not save this transcript to history: ' + error.message].filter(Boolean).join(' ');
        }
        deliver({ stage: 'result', result });
      } catch (error) {
        deliver({ stage: 'failed', message: error.code === 'ENOENT'
          ? 'The recording or transcription engine is missing.' : error.message });
      }
    }
  } finally {
    activeTranscriptions--;
    restartToInstallUpdateWhenIdle();
  }
});

ipcMain.handle('export-transcript', async (_, { name, txt, srt }) => {
  if (typeof name !== 'string' || [txt, srt].some(value => value !== null && typeof value !== 'string') ||
      (txt === null && srt === null)) throw new Error('Choose an export format.');
  let base = path.parse(path.basename(name)).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .slice(0, 100).replace(/[. ]+$/, '') || 'Transcript';
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(base)) base = '_' + base;
  if (txt !== null && srt !== null) {
    const folder = await dialog.showOpenDialog(win, { title: 'Choose an export folder', properties: ['openDirectory', 'createDirectory'] });
    if (folder.canceled) return false;
    const destination = await fs.promises.mkdtemp(path.join(folder.filePaths[0], base + '-'));
    try {
      await fs.promises.writeFile(path.join(destination, 'Transcript.txt'), txt);
      await fs.promises.writeFile(path.join(destination, 'Subtitles.srt'), srt);
    } catch (error) {
      await fs.promises.rm(destination, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return true;
  }
  const extension = txt === null ? 'srt' : 'txt';
  const save = await dialog.showSaveDialog(win, { defaultPath: base + '.' + extension,
    filters: [{ name: extension === 'txt' ? 'Transcript' : 'Subtitles', extensions: [extension] }] });
  if (save.canceled) return false;
  await writeAtomically(save.filePath, txt ?? srt);
  return true;
});

function transcriptDirectory(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error('Invalid transcript ID.');
  }
  return path.join(app.getPath('userData'), 'transcripts', id);
}

ipcMain.handle('list-transcripts', async () => {
  const root = path.join(app.getPath('userData'), 'transcripts');
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const results = [];
  const legacy = new Map();
  for (const entry of entries) {
    const extension = path.extname(entry.name).toLowerCase();
    if (!entry.isFile() || !['.txt', '.srt'].includes(extension)) continue;
    const base = path.parse(entry.name).name;
    if (!legacy.has(base)) legacy.set(base, {});
    legacy.get(base)[extension] = path.join(root, entry.name);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const summary = JSON.parse(await fs.promises.readFile(
        path.join(transcriptDirectory(entry.name), 'summary.json'), 'utf8'));
      if (summary.id === entry.name && typeof summary.name === 'string') results.push(summary);
    } catch (error) {
      console.warn('Could not load transcript summary:', error.message);
    }
  }
  const storedIds = new Set(results.map(result => result.id));
  for (const [base, sources] of legacy) {
    try {
      const id = createHash('sha256').update('legacy:' + base).digest('hex').slice(0, 32)
        .replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
      if (storedIds.has(id)) continue;
      const imported = await importLegacyTranscript(id, base, sources);
      if (imported) results.push(imported);
    } catch (error) {
      console.warn('Could not import an earlier transcript:', error.message);
    }
  }
  return results.sort((a, b) => b.created - a.created);
});

async function importLegacyTranscript(id, name, sources) {
  const subtitleFile = sources['.srt'];
  const textFile = sources['.txt'];
  const txt = textFile ? (await fs.promises.readFile(textFile, 'utf8')).trim() : '';
  const srt = subtitleFile ? await fs.promises.readFile(subtitleFile, 'utf8') : '';
  const timing = /^(\d+:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d+:\d{2}:\d{2}[,.]\d{3})$/;
  const seconds = stamp => stamp.replace(',', '.').split(':').reduce((total, part) => total * 60 + Number(part), 0);
  const chunks = [];
  for (const block of srt.split(/\r?\n(?:[ \t]*\r?\n)+/)) {
    const lines = block.trim().split(/\r?\n/);
    const timestampIndex = lines.findIndex(line => timing.test(line));
    if (timestampIndex < 0) continue;
    const [, start, end] = timing.exec(lines[timestampIndex]);
    const text = lines.slice(timestampIndex + 1).join('\n').trim();
    if (text) chunks.push({ start: seconds(start), end: seconds(end), text });
  }
  const text = txt || chunks.map(chunk => chunk.text).join('\n');
  if (!text) return null;
  const stat = await fs.promises.stat(textFile || subtitleFile);
  const summary = { id, name, created: stat.mtimeMs };
  const result = { id, text, chunks, duration: chunks.at(-1)?.end };
  const directory = transcriptDirectory(id);
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(path.join(directory, 'result.json'), JSON.stringify(result));
  await fs.promises.writeFile(path.join(directory, 'summary.json'), JSON.stringify(summary));
  return summary;
}

ipcMain.handle('read-transcript', async (_, id) => {
  const directory = transcriptDirectory(id);
  const result = JSON.parse(await fs.promises.readFile(path.join(directory, 'result.json'), 'utf8'));
  try {
    result.labels = JSON.parse(await fs.promises.readFile(path.join(directory, 'labels.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') result.warning = [result.warning, 'Saved speaker labels could not be loaded.'].filter(Boolean).join(' ');
  }
  return result;
});

ipcMain.handle('save-speaker-labels', async (_, { id, labels }) => {
  const directory = transcriptDirectory(id);
  const result = JSON.parse(await fs.promises.readFile(path.join(directory, 'result.json'), 'utf8'));
  if (!Array.isArray(labels?.speakers) || labels.speakers.length !== result.chunks.length ||
      labels.speakers.some(speaker => speaker !== null && (typeof speaker !== 'string' || speaker.length > 80)) ||
      !Array.isArray(labels.names) || labels.names.some(pair =>
        !Array.isArray(pair) || pair.length !== 2 || pair.some(value => typeof value !== 'string' || value.length > 80))) {
    throw new Error('Invalid speaker labels.');
  }
  await writeAtomically(path.join(directory, 'labels.json'), JSON.stringify(labels));
});

async function writeAtomically(destination, contents) {
  const temporary = path.join(path.dirname(destination), randomUUID() + '.tmp');
  try {
    await fs.promises.writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    await fs.promises.rename(temporary, destination);
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
  }
}
