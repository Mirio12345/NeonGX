// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getRamStats: () => ipcRenderer.invoke('get-ram-usage'),
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),

    // Extension functions
    openDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
    installExtension: (path) => ipcRenderer.invoke('install-extension', path),

    // Permission Management
    onPermissionRequest: (callback) => {
        ipcRenderer.on('permission-request', (event, data) => callback(data));
    },
    respondToPermission: (requestId, allowed) => {
        ipcRenderer.send('permission-response', { requestId, allowed });
    },
    getPermissionPreferences: () => ipcRenderer.invoke('get-permission-preferences'),
    setPermissionPreference: (origin, permission, allowed) => {
        return ipcRenderer.invoke('set-permission-preference', { origin, permission, allowed });
    },

    // Download Management
    onDownloadStarted: (callback) => {
        ipcRenderer.on('download-started', (event, data) => callback(data));
    },
    onDownloadUpdated: (callback) => {
        ipcRenderer.on('download-updated', (event, data) => callback(data));
    },
    onDownloadCompleted: (callback) => {
        ipcRenderer.on('download-completed', (event, data) => callback(data));
    },
    getActiveDownloads: () => ipcRenderer.invoke('get-active-downloads'),
    cancelDownload: (downloadId) => ipcRenderer.invoke('cancel-download', downloadId),
    openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
    openDownloadedFile: (filePath) => ipcRenderer.invoke('open-downloaded-file', filePath),
    clearCompletedDownloads: () => ipcRenderer.invoke('clear-completed-downloads'),

    // Helper to remove all listeners
    removeAllListeners: () => {
        ipcRenderer.removeAllListeners('permission-request');
        ipcRenderer.removeAllListeners('download-started');
        ipcRenderer.removeAllListeners('download-updated');
        ipcRenderer.removeAllListeners('download-completed');
    },
    getPermissionPreferences: () => ipcRenderer.invoke('get-permission-preference'), // NOT 'preferences'
    setPermissionPreference: (origin, permission, allowed) => 
    ipcRenderer.invoke('set-permission-preference', { origin, permission, allowed }),
    removePermissionPreference: (key) => ipcRenderer.invoke('remove-permission-preference', key),
    
    // Cookies APIs
    getCookies: (filter) => ipcRenderer.invoke('get-cookies', filter),
    clearAllCookies: () => ipcRenderer.invoke('clear-all-cookies'),
    clearDomainCookies: (domain) => ipcRenderer.invoke('clear-domain-cookies', domain),
    clearBrowserData: () => ipcRenderer.invoke('clear-browser-data'),
});
