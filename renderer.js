'use strict';

const api = window.transcriber;
const $ = id => document.getElementById(id);
const files = [];
const transcripts = new Map();
let requestNumber = 0;
let savingLabels = false;
let nextId = 1;
let running = false;
let browsing = false;
let selected = null;
const queueRows = new Map();
let exporting = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, onClick, className) {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function announce(message) {
  $('announcement').textContent = message;
}

function setPage(page) {
  const queue = page === 'queue';
  $('queuePage').hidden = !queue;
  $('resultsPage').hidden = queue;
  for (const id of ['navQueue', 'navResults']) $(id).removeAttribute('aria-current');
  $(queue ? 'navQueue' : 'navResults').setAttribute('aria-current', 'page');
}

$('navQueue').onclick = () => { setPage('queue'); $('queueTitle').focus(); };
function showResultList() {
  requestNumber++;
  selected = null;
  setPage('results');
  paintResults();
  paintReader();
  $('resultsTitle').focus();
}
$('navResults').onclick = showResultList;
$('backToResults').onclick = showResultList;
for (const [trigger, dialog] of [['openSettings', 'settingsDialog'], ['openOptions', 'optionsDialog']]) {
  $(trigger).onclick = () => $(dialog).showModal();
}
$('mode').onchange = () => {
  $('modeSummary').textContent = '· ' + $('mode').selectedOptions[0].textContent.split(' · ')[0];
};
$('detectSpeakers').onchange = () => { $('speakerCountField').hidden = !$('detectSpeakers').checked; };
document.querySelectorAll('[data-close]').forEach(control => {
  control.onclick = () => { if (!exporting && !savingLabels) $(control.dataset.close).close(); };
});

const systemTheme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const theme = $('theme').value;
  const light = theme === 'light' || (theme === 'system' && !systemTheme.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  api.setWindowTheme(light).catch(console.warn);
}
const savedTheme = localStorage.getItem('whale-theme');
if (['dark', 'light', 'system'].includes(savedTheme)) $('theme').value = savedTheme;
$('theme').onchange = () => {
  localStorage.setItem('whale-theme', $('theme').value);
  applyTheme();
};
systemTheme.addEventListener('change', applyTheme);
applyTheme();

function addFiles(items) {
  let added = 0;
  let skipped = 0;
  for (const item of items) {
    if (!item.path || !/\.(mp3|wav|m4a|aac|flac|ogg|opus|mp4|mov|mkv|webm|avi)$/i.test(item.name)) {
      skipped++;
      continue;
    }
    if (files.some(file => file.path.toLowerCase() === item.path.toLowerCase())) {
      skipped++;
      continue;
    }
    files.push({ ...item, id: nextId++, state: 'Waiting', detail: '', progress: null });
    added++;
  }
  paintQueue();
  $('queueSummary').textContent = added + ' added' + (skipped ? ' · ' + skipped + ' unsupported or already in the queue' : '');
}

$('browse').onclick = async () => {
  if (browsing || running) return;
  browsing = true;
  updateControls();
  try {
    const items = await api.pickAudio();
    if (items.length) addFiles(items);
  } catch (error) {
    $('queueSummary').textContent = 'Could not open the file picker. ' + error.message;
  } finally {
    browsing = false;
    updateControls();
  }
};

const dropzone = $('dropzone');
const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files');
window.addEventListener('dragover', event => {
  if (isFileDrag(event)) event.preventDefault();
});
window.addEventListener('drop', event => { if (isFileDrag(event)) event.preventDefault(); });
dropzone.addEventListener('dragover', event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = running ? 'none' : 'copy';
  dropzone.classList.toggle('drag', !running);
});
dropzone.addEventListener('dragleave', event => {
  if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('drag');
});
dropzone.addEventListener('drop', event => {
  event.preventDefault();
  dropzone.classList.remove('drag');
  if (running || browsing) {
    $('queueSummary').textContent = 'Wait for the current action to finish before adding files.';
    return;
  }
  addFiles(Array.from(event.dataTransfer.files, file => {
    try { return { name: file.name, path: api.pathForFile(file) }; }
    catch { return { name: file.name, path: '' }; }
  }));
});

function updateControls() {
  const waiting = files.filter(file => ['Waiting', 'Failed', 'Partial'].includes(file.state)).length;
  $('start').disabled = running || browsing || !waiting;
  $('start').textContent = running ? 'Transcribing batch' : waiting ? 'Transcribe ' + waiting : 'Transcribe';
  $('browse').disabled = running || browsing;
  $('openOptions').disabled = running;
}

async function showTranscript(file) {
  const request = ++requestNumber;
  setPage('results');
  try {
    if (!file.result) {
      $('resultsSummary').textContent = 'Opening transcript';
      file.result = await api.readTranscript(file.id);
      const labels = file.result.labels;
      if (Array.isArray(labels?.speakers) && labels.speakers.length === file.result.chunks.length) {
        file.result.chunks.forEach((chunk, index) => { chunk.speaker = labels.speakers[index]; });
        file.names = new Map(labels.names);
      }
    }
    if (request !== requestNumber || $('resultsPage').hidden) return;
    selected = file;
    paintResults();
    paintReader();
    $('readerTitle').focus();
  } catch (error) {
    if (request === requestNumber) $('resultsSummary').textContent = 'Could not open this transcript. ' + error.message;
  }
}

function removeFromQueue(file) {
  if (running) return;
  files.splice(files.indexOf(file), 1);
  paintQueue();
  const next = $('queue').querySelector('button');
  (next || $('browse')).focus();
}

function paintQueue() {
  $('queue').replaceChildren();
  queueRows.clear();
  const visible = files;
  $('queue').hidden = !visible.length;
  for (const file of visible) {
    const entry = element('li');
    const row = element('div', undefined, 'file-row');
    const name = element('span', file.name, 'file-name');
    name.title = file.path;
    row.append(name, element('span', file.state, 'file-state'));
    if (file.result) row.append(button('Open', () => showTranscript(file.result)));
    const remove = button('×', () => removeFromQueue(file), 'quiet');
    remove.setAttribute('aria-label', 'Remove ' + file.name + ' from queue');
    remove.disabled = running;
    row.append(remove);
    entry.append(row);
    const detail = element('p', undefined, 'file-detail');
    const meter = element('progress');
    meter.max = 100;
    meter.setAttribute('aria-label', 'Progress for ' + file.name);
    entry.append(detail, meter);
    queueRows.set(file.id, { detail, meter });
    paintProgress(file);
    $('queue').append(entry);
  }
  updateControls();
}

function paintProgress(file) {
  const { detail, meter } = queueRows.get(file.id);
  detail.textContent = file.detail;
  detail.hidden = !file.detail;
  detail.classList.toggle('warning', ['Failed', 'Partial', 'Warning'].includes(file.state));
  meter.hidden = file.state !== 'Processing';
  if (file.progress === null) meter.removeAttribute('value');
  else meter.value = file.progress;
}

function paintResults() {
  const completed = Array.from(transcripts.values()).reverse();
  $('resultCount').textContent = completed.length;
  $('resultCount').hidden = !completed.length;
  $('resultsSummary').textContent = completed.length
    ? 'Choose a recording to read or export its transcript.' : 'Completed recordings appear here.';
  $('results').replaceChildren();
  $('resultsHeading').hidden = Boolean(selected);
  $('backToResults').hidden = !selected;
  $('results').hidden = Boolean(selected) || !completed.length;
  const counts = new Map();
  for (const file of completed) counts.set(file.name, (counts.get(file.name) || 0) + 1);
  for (const file of completed) {
    const row = element('li');
    const link = button(file.name, () => showTranscript(file), 'result-link');
    link.title = file.path || file.name;
    if (counts.get(file.name) > 1) {
      const date = file.created ? new Date(file.created).toLocaleString() : '';
      link.append(element('small', [file.sourceFolder, date].filter(Boolean).join(' · '), 'result-source'));
    }
    row.append(link);
    $('results').append(row);
  }
}

function timestamp(seconds, subtitle = false) {
  if (!Number.isFinite(seconds)) return null;
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor(ms / 60000) % 60;
  const ss = Math.floor(ms / 1000) % 60;
  const clock = [hh, mm, ss].map(n => String(n).padStart(2, '0')).join(':');
  return subtitle ? clock + ',' + String(ms % 1000).padStart(3, '0') : clock;
}

function speakerName(file, chunk) {
  return chunk.speaker ? (file.names?.get(chunk.speaker) || chunk.speaker) : '';
}

function paintReader() {
  $('reader').hidden = !selected?.result;
  if (!selected?.result) return;
  const { result } = selected;
  $('readerTitle').textContent = selected.name;
  $('readerMeta').textContent = [result.language?.toUpperCase(), timestamp(result.duration),
    result.device?.toUpperCase()].filter(Boolean).join(' · ');
  $('readerWarning').textContent = result.warning || '';
  $('readerWarning').hidden = !result.warning;
  $('transcript').replaceChildren();
  const items = document.createDocumentFragment();
  for (const chunk of result.chunks) {
    const row = element('li');
    const time = $('showTimes').checked ? timestamp(chunk.start) : null;
    if (time) {
      row.classList.add('timed');
      row.append(element('span', time, 'time'));
    }
    const content = element('div');
    const name = speakerName(selected, chunk);
    if (name) content.append(element('strong', name, 'speaker'));
    content.append(document.createTextNode(chunk.text));
    row.append(content);
    items.append(row);
  }
  if (!result.chunks.length) items.append(element('li', result.text || 'No speech was detected.'));
  $('transcript').append(items);
  $('openSpeakers').disabled = !result.chunks.length;
  $('openExport').disabled = !result.chunks.length && !result.text;
  $('copy').disabled = $('openExport').disabled;
}

function plainText(file, times) {
  return file.result.chunks.map(chunk => {
    const time = times && timestamp(chunk.start);
    const name = speakerName(file, chunk);
    return (time ? '[' + time + '] ' : '') + (name ? name + ': ' : '') + chunk.text;
  }).join('\n') || file.result.text;
}

function subtitles(file) {
  return file.result.chunks.filter(chunk => Number.isFinite(chunk.start) && Number.isFinite(chunk.end) &&
    chunk.end > chunk.start).map((chunk, index) => {
    const name = speakerName(file, chunk);
    const text = ((name ? name + ': ' : '') + chunk.text).replace(/[&<>]/g, character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
    return [index + 1, timestamp(chunk.start, true) + ' --> ' + timestamp(chunk.end, true), text].join('\r\n');
  }).join('\r\n\r\n');
}

$('showTimes').onchange = paintReader;
$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(plainText(selected, $('showTimes').checked));
    announce('Transcript copied.');
    $('copy').textContent = 'Copied';
    setTimeout(() => { $('copy').textContent = 'Copy'; }, 1400);
  } catch (error) {
    announce('Could not copy the transcript. Use Export to save it.');
    $('readerWarning').hidden = false;
    $('readerWarning').textContent = error.message;
  }
};

function syncExport() {
  $('exportTimes').disabled = !$('includeTxt').checked;
  $('saveExport').disabled = exporting || (!$('includeTxt').checked && !$('includeSrt').checked);
}
$('openExport').onclick = () => {
  $('includeTxt').checked = true;
  $('includeSrt').checked = false;
  $('includeSrt').disabled = !selected.result.chunks.some(chunk =>
    Number.isFinite(chunk.start) && Number.isFinite(chunk.end) && chunk.end > chunk.start);
  $('exportTimes').checked = true;
  $('exportError').hidden = true;
  syncExport();
  $('exportDialog').showModal();
};
$('includeTxt').onchange = $('includeSrt').onchange = syncExport;
$('exportDialog').addEventListener('cancel', event => { if (exporting) event.preventDefault(); });
$('exportForm').onsubmit = async event => {
  event.preventDefault();
  if (exporting || $('saveExport').disabled) return;
  exporting = true;
  syncExport();
  $('exportError').hidden = true;
  try {
    const withText = $('includeTxt').checked;
    const withSubtitles = $('includeSrt').checked;
    const saved = await api.exportTranscript({
      name: selected.name,
      txt: withText ? plainText(selected, $('exportTimes').checked) + '\n' : null,
      srt: withSubtitles ? subtitles(selected) + '\r\n' : null
    });
    if (saved) { $('exportDialog').close(); announce('Export saved.'); }
  } catch (error) {
    $('exportError').textContent = 'Could not save. ' + error.message;
    $('exportError').hidden = false;
  } finally {
    exporting = false;
    syncExport();
  }
};

const newSpeakerValue = '__new_speaker__';
let draftSpeakers;
let draftNames;
function storeSpeakerChoice() {
  const index = Number($('speakerLine').dataset.previous);
  let choice = $('lineSpeaker').value;
  if (choice === newSpeakerValue) {
    const name = $('newSpeaker').value.trim();
    if (!name) return;
    choice = 'manual-' + crypto.randomUUID();
    draftNames.set(choice, name);
    addSpeakerField(choice, name);
    $('lineSpeaker').add(new Option(name, choice));
  }
  draftSpeakers[index] = choice || null;
}

function addSpeakerField(id, name) {
  const field = element('input');
  field.type = 'text';
  field.maxLength = 80;
  field.value = name;
  field.dataset.speaker = id;
  field.setAttribute('aria-label', 'Rename ' + name);
  $('speakerFields').append(field);
}

function populateSegment() {
  const index = Number($('speakerLine').value);
  $('speakerLine').dataset.previous = String(index);
  $('lineSpeaker').value = draftSpeakers[index] || '';
  $('newSpeaker').value = '';
  $('lineSpeaker').onchange();
}

$('openSpeakers').onclick = () => {
  draftSpeakers = selected.result.chunks.map(chunk => chunk.speaker || null);
  draftNames = new Map(selected.names || []);
  $('speakerFields').replaceChildren();
  $('speakerLine').replaceChildren();
  $('lineSpeaker').replaceChildren(new Option('Unlabeled', ''), new Option('Add a speaker', newSpeakerValue));
  for (const id of new Set(draftSpeakers.filter(Boolean))) {
    const name = draftNames.get(id) || id;
    addSpeakerField(id, name);
    $('lineSpeaker').add(new Option(name, id));
  }
  selected.result.chunks.forEach((chunk, index) => {
    $('speakerLine').add(new Option((timestamp(chunk.start) || 'Segment ' + (index + 1)) +
      ' · ' + chunk.text.replace(/\s+/g, ' ').slice(0, 90), index));
  });
  populateSegment();
  $('speakerError').hidden = true;
  $('speakersDialog').showModal();
};
$('lineSpeaker').onchange = () => {
  const adding = $('lineSpeaker').value === newSpeakerValue;
  $('newSpeakerLabel').hidden = $('newSpeaker').hidden = !adding;
  $('newSpeaker').required = adding;
};
$('speakerLine').onchange = () => { storeSpeakerChoice(); populateSegment(); };
$('speakersDialog').addEventListener('cancel', event => { if (savingLabels) event.preventDefault(); });
$('speakerForm').onsubmit = async event => {
  event.preventDefault();
  if (savingLabels) return;
  storeSpeakerChoice();
  for (const field of $('speakerFields').querySelectorAll('input')) {
    const id = field.dataset.speaker;
    if (field.value.trim()) draftNames.set(id, field.value.trim());
  }
  const file = selected;
  const submit = $('speakerForm').querySelector('footer .primary');
  savingLabels = submit.disabled = true;
  $('speakerError').hidden = true;
  try {
    await api.saveSpeakerLabels({ id: file.id, labels: { speakers: draftSpeakers, names: [...draftNames] } });
    file.names = draftNames;
    file.result.chunks.forEach((chunk, index) => { chunk.speaker = draftSpeakers[index]; });
    $('speakersDialog').close();
    paintReader();
    announce('Speaker labels updated.');
  } catch (error) {
    $('speakerError').textContent = 'Could not save speaker labels. ' + error.message;
    $('speakerError').hidden = false;
  } finally {
    savingLabels = submit.disabled = false;
  }
};

function batchEvent(message) {
  const file = files.find(entry => entry.id === message.id);
  if (!file || !running) return;
  if (message.stage === 'result') {
    const transcript = { id: message.result.id, name: file.name, path: file.path,
      sourceFolder: message.result.sourceFolder, created: message.result.created, result: message.result };
    file.result = transcript;
    transcripts.set(transcript.id, transcript);
    file.detail = message.result.warning || '';
    file.state = file.detail.startsWith('Repeated-speech') ? 'Partial' : file.detail ? 'Warning' : 'Complete';
    paintResults();
    announce(file.name + ' · ' + file.state);
  } else if (message.stage === 'failed') {
    file.state = 'Failed';
    file.detail = message.message;
    announce(file.name + ' failed');
  } else {
    const alreadyProcessing = file.state === 'Processing';
    file.state = 'Processing';
    file.detail = String(message.message || '').replace(/\uFFFD/g, '');
    file.progress = message.stage === 'progress' && Number.isFinite(message.seconds) &&
      Number.isFinite(message.duration) && message.duration > 0
      ? Math.min(99, Math.max(0, Math.floor(message.seconds / message.duration * 100))) : null;
    if (alreadyProcessing && queueRows.has(file.id)) {
      paintProgress(file);
      return;
    }
  }
  paintQueue();
}
api.onBatchEvent(batchEvent);
api.onBatchCloseBlocked(() => {
  setPage('queue');
  $('queueSummary').textContent = 'Finish processing the current batch before closing Whale Local.';
  $('queueTitle').focus();
});
api.listTranscripts().then(history => {
  const current = [...transcripts];
  transcripts.clear();
  for (const file of history.reverse()) transcripts.set(file.id, file);
  for (const [id, file] of current) {
    transcripts.delete(id);
    transcripts.set(id, file);
  }
  paintResults();
}).catch(error => { $('resultsSummary').textContent = 'Could not load transcript history. ' + error.message; });
api.onAppUpdate(update => {
  const text = {
    checking: 'Checking for updates…',
    available: 'Whale Local ' + update.version + ' found. Downloading…',
    downloading: 'Downloading Whale Local update · ' + update.percent + '%',
    downloaded: 'Update downloaded. It will install when transcription is finished.',
    installing: 'Installing the Whale Local update',
    'up-to-date': 'Whale Local is up to date' + (update.version ? ' · ' + update.version : ''),
    error: 'Could not check for updates. Check your internet and try again.'
  }[update.state];
  $('updateStatus').textContent = text || 'Automatic update checks are active.';
  $('updateNotice').textContent = text || '';
  $('updateNotice').hidden = !text;
  $('checkUpdates').disabled = ['checking', 'available', 'downloading', 'downloaded', 'installing'].includes(update.state);
});

$('checkUpdates').onclick = async () => {
  $('checkUpdates').disabled = true;
  $('updateStatus').textContent = 'Checking for updates…';
  try {
    await api.checkForUpdates();
  } catch (error) {
    $('updateStatus').textContent = 'Could not check for updates. Check your internet and try again.';
    $('checkUpdates').disabled = false;
  }
};

$('start').onclick = async () => {
  if (running || browsing) return;
  const batch = files.filter(file => ['Waiting', 'Failed', 'Partial'].includes(file.state));
  if (!batch.length) return;
  running = true;
  for (const file of batch) {
    file.state = 'Queued';
    file.detail = '';
  }
  $('queueSummary').textContent = 'Processing ' + batch.length + (batch.length === 1 ? ' recording' : ' recordings');
  paintQueue();
  try {
    await api.transcribeBatch({
      jobs: batch.map(({ id, path }) => ({ id, path })),
      mode: $('mode').value,
      language: $('language').value,
      speakers: $('detectSpeakers').checked,
      speakerCount: Number($('speakerCount').value)
    });
  } catch (error) {
    for (const file of batch) {
      if (['Queued', 'Processing'].includes(file.state)) {
        file.state = 'Failed';
        file.detail = error.message;
      }
    }
  } finally {
    running = false;
    for (const file of batch) {
      if (['Queued', 'Processing'].includes(file.state)) {
        file.state = 'Failed';
        file.detail = 'The batch ended before this file finished. Try again.';
      }
    }
    const completed = batch.filter(file => ['Complete', 'Warning'].includes(file.state)).length;
    $('queueSummary').textContent = completed + ' of ' + batch.length + ' completed' +
      (completed < batch.length ? ' · Check the remaining files below' : '');
    paintQueue();
  }
};
