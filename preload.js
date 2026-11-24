const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('transcriber', {
  pickAudio: () => ipcRenderer.invoke('pick-audio'),
  pathForFile: file => webUtils.getPathForFile(file),
  transcribeBatch: options => ipcRenderer.invoke('transcribe-batch', options),
  setWindowTheme: light => ipcRenderer.invoke('set-window-theme', light),
  exportTranscript: options => ipcRenderer.invoke('export-transcript', options),
  listTranscripts: () => ipcRenderer.invoke('list-transcripts'),
  readTranscript: id => ipcRenderer.invoke('read-transcript', id),
  saveSpeakerLabels: options => ipcRenderer.invoke('save-speaker-labels', options),
  onBatchCloseBlocked: callback => { ipcRenderer.on('batch-close-blocked', () => callback()); },
  onBatchEvent: callback => { ipcRenderer.on('batch-event', (_, data) => callback(data)); },
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onAppUpdate: callback => { ipcRenderer.on('app-update-status', (_, data) => callback(data)); }
});
