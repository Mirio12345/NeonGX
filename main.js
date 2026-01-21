// main.js
const { app, BrowserWindow, ipcMain, session, dialog, shell } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const path = require('path');
const { download } = require('electron-dl');

let mainWindow;

// Store active downloads
const activeDownloads = new Map();

function createWindow() {
  // Check if window already exists
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      plugins: true,
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Clear reference when window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Set up download handling
  setupDownloadHandler(mainWindow);
}

app.whenReady().then(() => {
  createWindow();

  // INITIALIZE AD BLOCKER
  ElectronBlocker.fromPrebuiltAdsAndTracking().then((blocker) => {
    blocker.enableBlockingInSession(session.fromPartition('persist:main'));
    console.log("Ad Blocker Activated!");
  }).catch((err) => {
    console.error("Failed to load ad blocker:", err);
  });

  // Configure User Agent and Client Hints
  const webviewSession = session.fromPartition('persist:main');

  webviewSession.webRequest.onBeforeSendHeaders((details, callback) => {
    // Set Firefox User Agent
    details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0';

    // Delete Chrome Client Hints
    delete details.requestHeaders['Sec-CH-UA'];
    delete details.requestHeaders['Sec-CH-UA-Mobile'];
    delete details.requestHeaders['Sec-CH-UA-Platform'];
    delete details.requestHeaders['Sec-CH-UA-Full-Version-List'];

    callback({ requestHeaders: details.requestHeaders });
  }, { urls: ['<all_urls>'] });

  // Set permission handling defaults
  webviewSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = webContents.getURL();
    console.log(`Permission request: ${permission} from ${url}`);

    // Default to deny for sensitive permissions
    // The renderer will handle the UI for this
    callback(false);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
});

// --- IPC HANDLERS ---

// Dialog handlers
ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: "Select Extension Folder"
  });
  return result.filePaths[0];
});

// Extension installation
ipcMain.handle('install-extension', async (event, extensionPath) => {
  try {
    const id = await session.fromPartition('persist:main').loadExtension(extensionPath);
    console.log(`Extension loaded in webview session: ${id}`);
    return { success: true, id: id };
  } catch (e) {
    console.error(e);
    return { success: false, error: e.message };
  }
});

// RAM usage
ipcMain.handle('get-ram-usage', async () => {
  const usage = process.getProcessMemoryInfo();
  return {
    private: usage.private / 1024 / 1024,
    shared: usage.shared / 1024 / 1024
  };
});

// Window controls
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// Get downloads path
ipcMain.handle('get-downloads-path', async () => {
  return app.getPath('downloads');
});

// Download file using electron-dl
ipcMain.handle('download-file', async (event, url, options) => {
  if (!mainWindow) return { success: false, error: 'No main window' };

  try {
    const downloadItem = await download(mainWindow, url, options);

    return {
      success: true,
      filePath: downloadItem.getSavePath(),
      filename: downloadItem.getFilename()
    };
  } catch (error) {
    console.error('Download error:', error);
    return { success: false, error: error.message };
  }
});

// Cancel download
ipcMain.on('cancel-download', (event, id) => {
  const downloadItem = activeDownloads.get(id);
  if (downloadItem) {
    downloadItem.cancel();
    activeDownloads.delete(id);
  }
});

// Open path
ipcMain.handle('open-path', async (event, filePath) => {
  shell.openPath(filePath);
});

// Show item in folder
ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});

// Clear permissions data
ipcMain.handle('clear-permissions', async () => {
  // This would clear stored permissions from a database or file
  return { success: true };
});

// --- DOWNLOAD HANDLER ---
function setupDownloadHandler(browserWindow) {
  const webviewSession = session.fromPartition('persist:main');

  webviewSession.on('will-download', (event, item, webContents) => {
    // Prevent default download behavior
    event.preventDefault();

    const downloadId = Date.now();

    // Store the download item
    activeDownloads.set(downloadId, item);

    // Set save path
    const fileName = item.getFilename();
    const savePath = path.join(app.getPath('downloads'), fileName);
    item.setSavePath(savePath);

    // Notify renderer of download start
    browserWindow.webContents.send('download-started', {
      id: downloadId,
      url: item.getURL(),
      filename: fileName,
      totalBytes: item.getTotalBytes()
    });

    // Update progress
    item.on('updated', (event, state) => {
      browserWindow.webContents.send('download-progress', {
        id: downloadId,
        state: state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes()
      });
    });

    // Download completed or cancelled
    item.on('done', (event, state) => {
      const progressData = {
        id: downloadId,
        state: state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        savePath: item.getSavePath()
      };

      browserWindow.webContents.send('download-progress', progressData);
      activeDownloads.delete(downloadId);
    });
  });
}
