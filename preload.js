const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('transcriber', {
  pickAudio: () => ipcRenderer.invoke('pick-audio'),
  transcribe: options => ipcRenderer.invoke('transcribe', options),
  openFile: p => ipcRenderer.invoke('open-file', p),
  onProgress: callback => ipcRenderer.on('engine-progress', (_, data) => callback(data)),
  onAppUpdate: callback => ipcRenderer.on('app-update-status', (_, data) => callback(data))
});
