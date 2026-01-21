// main.js
const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron'); // ADD THIS
const path = require('path');


let mainWindow;

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
      // allowRunningInsecureContent: true, // Optional: Helps with some content
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


app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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

