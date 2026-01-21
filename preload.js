// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // RAM stats
  getRamStats: () => ipcRenderer.invoke('get-ram-usage'),

  // Extension functions
  openDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  installExtension: (path) => ipcRenderer.invoke('install-extension', path),

  // Download functions
  getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),
  downloadFile: (url, options) => ipcRenderer.invoke('download-file', url, options),
  cancelDownload: (id) => ipcRenderer.send('cancel-download', id),
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path),

  // Permission functions
  clearPermissions: () => ipcRenderer.invoke('clear-permissions'),

  // Event listeners for downloads
  onDownloadStarted: (callback) => {
    ipcRenderer.on('download-started', (event, data) => callback(data));
  },
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  }
});
