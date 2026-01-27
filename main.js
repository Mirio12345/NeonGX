// main.js
const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const path = require('path');

let mainWindow;
let pendingPermissionRequest = null;
let activeDownloads = new Map();

function createWindow() {
  // FIX: Check if window already exists!
  // If it does, just show it/focus it and stop.
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

      // ADD THIS: Allow extensions to inject content scripts
      plugins: true,
    }

  });

  mainWindow.loadFile('index.html');

  // FIX: Clear reference when window is closed so we know it's gone
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // 1. CREATE WINDOW
  createWindow();

  // 2. INITIALIZE AD BLOCKER
  // We need to block ads in the 'persist:main' session (which your webview uses)
  //
  ElectronBlocker.fromPrebuiltAdsAndTracking().then((blocker) => {
     //Enable blocking for the specific session your webview uses
    blocker.enableBlockingInSession(session.fromPartition('persist:main'));
    console.log("Ad Blocker Activated!");
  }).catch((err) => {
    console.error("Failed to load ad blocker:", err);
  });

  const webviewSession = session.fromPartition('persist:main');

  // NEW: Configure cookies for better Google login support
webviewSession.cookies.set({
  url: 'https://accounts.google.com',
  name: 'test_cookie',
  value: '1',
  domain: '.google.com'
}).catch(() => {});

  // 2. MODIFY REQUEST HEADERS TO MIMIC FIREFOX
  webviewSession.webRequest.onBeforeSendHeaders((details, callback) => {

    // 1. Set Firefox User Agent
    details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0';

    // 2. CRITICAL: Delete Chrome Client Hints (Firefox doesn't use these)
    delete details.requestHeaders['Sec-CH-UA'];
    delete details.requestHeaders['Sec-CH-UA-Mobile'];
    delete details.requestHeaders['Sec-CH-UA-Platform'];
    delete details.requestHeaders['Sec-CH-UA-Full-Version-List'];

    callback({ requestHeaders: details.requestHeaders });
  }, { urls: ['<all_urls>'] });

  // 3. PERMISSION MANAGEMENT
  webviewSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    console.log('Permission request:', permission, details);

    // Store the callback to be used after user responds
    const requestId = Date.now().toString();
    pendingPermissionRequest = {
      id: requestId,
      permission: permission,
      details: details,
      callback: callback,
      url: webContents.getURL()
    };

    // Send permission request to renderer
    if (mainWindow) {
      mainWindow.webContents.send('permission-request', {
        id: requestId,
        permission: permission,
        details: details,
        url: webContents.getURL()
      });
    }
  });

  // 4. DOWNLOAD MANAGEMENT
  webviewSession.on('will-download', (event, item, webContents) => {
    const downloadId = Date.now().toString();
    const url = item.getURL();
    const filename = item.getFilename();
    const totalBytes = item.getTotalBytes();

    // Set default save path to downloads folder
    const downloadsPath = app.getPath('downloads');
    const savePath = path.join(downloadsPath, filename);
    item.setSavePath(savePath);

    // Create download item
    const download = {
      id: downloadId,
      filename: filename,
      url: url,
      totalBytes: totalBytes,
      receivedBytes: 0,
      savePath: savePath,
      state: 'progress', // 'progress', 'completed', 'cancelled', 'interrupted'
      startTime: Date.now()
    };

    activeDownloads.set(downloadId, download);

    // Send download started event to renderer
    if (mainWindow) {
      mainWindow.webContents.send('download-started', download);
    }

    // Track download progress
    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        download.state = 'interrupted';
        download.paused = true;
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          download.state = 'interrupted';
          download.paused = true;
        } else {
          download.state = 'progress';
          download.receivedBytes = item.getReceivedBytes();
          download.paused = false;
        }
      }

      // Send update to renderer
      if (mainWindow) {
        mainWindow.webContents.send('download-updated', download);
      }
    });

    item.on('done', (event, state) => {
      download.state = state; // 'completed', 'cancelled', 'interrupted'

      if (state === 'completed') {
        download.receivedBytes = download.totalBytes;
        download.endTime = Date.now();
        download.duration = download.endTime - download.startTime;

        // Show notification
        const { Notification } = require('electron');
        if (Notification.isSupported()) {
          new Notification({
            title: 'Download Complete',
            body: `${filename} has been downloaded successfully.`
          }).show();
        }
      } else {
        download.endTime = Date.now();
      }

      // Send completion event to renderer
      if (mainWindow) {
        mainWindow.webContents.send('download-completed', download);
      }

      // Remove from active downloads after some time
      setTimeout(() => {
        activeDownloads.delete(downloadId);
      }, 60000); // Keep in memory for 1 minute
    });
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    }
  });

  app.on('window-all-closed', () => {
    // On Windows/Linux, quit the app when ALL windows are closed.
    // On macOS, usually we keep it running, but since we have a frameless custom app,
    // we can let it quit to keep it simple.
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
});

// --- PERMISSION MANAGEMENT IPC HANDLERS ---

// Handle permission response from renderer
ipcMain.on('permission-response', (event, { requestId, allowed }) => {
  if (pendingPermissionRequest && pendingPermissionRequest.id === requestId) {
    console.log(`Permission ${requestId}: ${allowed ? 'granted' : 'denied'}`);

    // Call the original callback with the user's decision
    pendingPermissionRequest.callback(allowed);

    // Clear pending request
    pendingPermissionRequest = null;
  }
});

// Handle permission preferences
ipcMain.handle('get-permission-preferences', async () => {
  const preferences = {};
  return preferences;
});

ipcMain.handle('set-permission-preference', async (event, { origin, permission, allowed }) => {
  // You could save these to a file or database for persistence
  console.log(`Setting permission preference: ${origin} - ${permission} = ${allowed}`);
  return true;
});

// --- DOWNLOAD MANAGEMENT IPC HANDLERS ---

// Get list of active downloads
ipcMain.handle('get-active-downloads', async () => {
  return Array.from(activeDownloads.values());
});

// Pause a download
ipcMain.handle('pause-download', async (event, downloadId) => {
  // Note: Electron download items don't have a pause method by default
  // You would need to implement this differently
  return { success: false, error: 'Pause not supported' };
});

// Cancel a download
ipcMain.handle('cancel-download', async (event, downloadId) => {
  // Since downloads are managed by the session, we need to track them differently
  // This is a placeholder - you'd need to store the actual download item references
  console.log('Cancel download requested:', downloadId);
  return { success: true };
});

// Open downloads folder
ipcMain.handle('open-downloads-folder', async () => {
  const downloadsPath = app.getPath('downloads');
  const { shell } = require('electron');
  shell.openPath(downloadsPath);
  return { success: true };
});

// Open downloaded file
ipcMain.handle('open-downloaded-file', async (event, filePath) => {
  const { shell } = require('electron');
  shell.openPath(filePath);
  return { success: true };
});

// Clear completed downloads
ipcMain.handle('clear-completed-downloads', async () => {
  for (const [id, download] of activeDownloads.entries()) {
    if (download.state === 'completed' || download.state === 'cancelled' || download.state === 'interrupted') {
      activeDownloads.delete(id);
    }
  }
  return { success: true };
});

// --- EXISTING IPC HANDLERS ---

ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: "Select Extension Folder"
    });
    return result.filePaths[0];
});

ipcMain.handle('install-extension', async (event, extensionPath) => {
    try {
        // FIX: Target the 'persist:main' session specifically!
        const id = await session.fromPartition('persist:main').loadExtension(extensionPath);
        console.log(`Extension loaded in webview session: ${id}`);
        return { success: true, id: id };
    } catch (e) {
        console.error(e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-ram-usage', async () => {
  const usage = process.getProcessMemoryInfo();
  return {
    private: usage.private / 1024 / 1024,
    shared: usage.shared / 1024 / 1024
  };
});

// --- Control Window from Renderer ---
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());
