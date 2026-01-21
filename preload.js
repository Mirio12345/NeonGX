// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getRamStats: () => ipcRenderer.invoke('get-ram-usage'),
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    
    // NEW: Extension functions
    openDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
    installExtension: (path) => ipcRenderer.invoke('install-extension', path)
});