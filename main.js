// main.js
const { app, BrowserWindow, ipcMain, session, dialog, shell } = require('electron');
const path = require('path');

let mainWindow;

// Store active downloads
const activeDownloads = new Map();

// Store pending permission requests
const pendingPermissionRequests = new Map();

// Comprehensive ad/tracking blocking patterns
const AD_PATTERNS = {
  // Ad domains
  domains: [
    'doubleclick.net',
    'googleads.g.doubleclick.net',
    'googleadservices.com',
    'googlesyndication.com',
    'googletagmanager.com',
    'googletagservices.com',
    'ads-twitter.com',
    'twitter.com/i/jot',
    'facebook.com/tr',
    'facebook.com/xti.php',
    'connect.facebook.net',
    'amazon-adsystem.com',
    'amazon-adsystem.com',
    'adnxs.com',
    'adsystem.com',
    'advertising.com',
    'analytics.com',
    'pixel.facebook.com',
    'analytics.google.com',
    'youtube.com/pagead',
    'youtube.com/ptracking',
    'googlevideo.com',
    'ytimg.com/yts/img/pixel',
    'pubmatic.com',
    'rubiconproject.com',
    'scorecardresearch.com',
    'quantserve.com',
    'adserver.com',
    'ads.yahoo.com',
    'adserver.yahoo.com',
    'adtechus.com',
    'advertising.com',
    'yieldmo.com',
    'criteo.com',
    'scorecardresearch.com',
    'rlcdn.com',
    'adcolony.com',
    'tapad.com',
    'adsystem.com',
    'adsystem.net',
    'adserver.com',
    'adnxs.com',
    'bluekai.com',
    'contextweb.com',
    'trkcdn.net',
    'trackad.net',
    'tracking',
    'telemetry',
    'beacon',
    'pixel',
    'analytics'
  ],

  // URL patterns for ads
  urlPatterns: [
    '/ads.',
    '/adserver.',
    '/advertising.',
    '/adtech.',
    '/adnxs.',
    '/banner',
    '/popup.',
    '/popunder.',
    '/sponsor',
    '/promo.',
    '/affiliate',
    '/tracking.',
    '/telemetry.',
    '/beacon.',
    '/pixel.',
    '/analytics.',
    '/metrics.',
    '/collector.',
    '/logger.',
    '/tracker.',
    '/fingerprint.',
    '/stat.',
    '/log.',
    '/report.'
  ],

  // Script paths to block
  scriptPatterns: [
    '/ads.js',
    '/adsbygoogle.js',
    '/advertising.js',
    '/tracker.js',
    '/analytics.js',
    '/telemetry.js',
    '/beacon.js',
    '/pixel.js',
    '/fingerprint.js',
    '/tracker.js',
    '/ga.js',
    '/gtag.js',
    '/fbq.js',
    '/bq.js',
    '/snowplow.js'
  ]
};

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
      webSecurity: false, // Needed for extensions to work with webview
      allowRunningInsecureContent: true,
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

  // Get webview session
  const webviewSession = session.fromPartition('persist:main');

  console.log('Setting up ad blocker and extensions...');

  // SETUP MANUAL AD BLOCKING
  setupAdBlocking(webviewSession);

  // Configure User Agent and Client Hints
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

  // Permission request handler - forward to renderer
  webviewSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = webContents.getURL();
    console.log(`Permission request: ${permission} from ${url}`);

    const requestId = Date.now();

    // Store callback so renderer can respond
    pendingPermissionRequests.set(requestId, callback);

    // Send request to renderer
    if (mainWindow) {
      mainWindow.webContents.send('permission-request', {
        requestId: requestId,
        permission: permission,
        url: url,
        details: details
      });
    }

    // Don't call callback immediately - wait for renderer response
    // Set timeout to auto-deny if no response
    setTimeout(() => {
      if (pendingPermissionRequests.has(requestId)) {
        const storedCallback = pendingPermissionRequests.get(requestId);
        storedCallback(false);
        pendingPermissionRequests.delete(requestId);
      }
    }, 30000); // 30 second timeout
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

// --- AD BLOCKING ---
function setupAdBlocking(webviewSession) {
  let blockedCount = 0;

  webviewSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url.toLowerCase();
    const { resourceType } = details;

    // Skip blocking for main page loads, documents, scripts, stylesheets
    if (['mainFrame', 'subFrame', 'stylesheet', 'script', 'xhr', 'fetch'].includes(resourceType)) {
      callback({ cancel: false });
      return;
    }

    // Check if should block
    let shouldBlock = false;
    let blockReason = '';

    // Check domain blocking
    for (const pattern of AD_PATTERNS.domains) {
      if (url.includes(pattern)) {
        shouldBlock = true;
        blockReason = `Ad domain: ${pattern}`;
        break;
      }
    }

    // Check URL pattern blocking
    if (!shouldBlock) {
      for (const pattern of AD_PATTERNS.urlPatterns) {
        if (url.includes(pattern)) {
          shouldBlock = true;
          blockReason = `Ad URL pattern: ${pattern}`;
          break;
        }
      }
    }

    // Check script blocking
    if (!shouldBlock && resourceType === 'script') {
      for (const pattern of AD_PATTERNS.scriptPatterns) {
        if (url.includes(pattern)) {
          shouldBlock = true;
          blockReason = `Ad script: ${pattern}`;
          break;
        }
      }
    }

    // Check tracking/analytics blocking
    if (!shouldBlock) {
      for (const pattern of ['tracking', 'telemetry', 'beacon', 'pixel', 'analytics', 'metrics']) {
        if (url.includes(pattern)) {
          // More aggressive blocking for tracking
          const isTracker = url.includes('track') || 
                         url.includes('telemetry') || 
                         url.includes('beacon') ||
                         url.includes('pixel');
          
          if (isTracker) {
            shouldBlock = true;
            blockReason = `Tracking: ${pattern}`;
            break;
          }
        }
      }
    }

    if (shouldBlock) {
      blockedCount++;
      console.log(`🚫 Blocked: ${blockReason} - ${url}`);
      callback({ cancel: true });
    } else {
      callback({ cancel: false });
    }
  }, { urls: ['<all_urls>'] });

  console.log(`✅ Ad blocker initialized with ${blockedCount} potential blocking rules`);
}

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

// Extension installation - Load into webview session
ipcMain.handle('install-extension', async (event, extensionPath) => {
  try {
    console.log('Installing extension from:', extensionPath);

    // CRITICAL: Load extension into webview session
    const webviewSession = session.fromPartition('persist:main');
    const id = await webviewSession.loadExtension(extensionPath);

    console.log(`✅ Extension loaded in webview session: ${id}`);
    console.log('Extension will work in webviews now!');

    return { success: true, id: id };
  } catch (e) {
    console.error('❌ Failed to load extension:', e);
    console.error('Error details:', e.message);
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

// Start download
ipcMain.handle('download-file', async (event, url) => {
  if (!mainWindow) return { success: false, error: 'No main window' };

  try {
    const downloadId = Date.now();
    return {
      success: true,
      downloadId: downloadId
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

// Respond to permission request
ipcMain.on('permission-response', (event, { requestId, allowed }) => {
  if (pendingPermissionRequests.has(requestId)) {
    const callback = pendingPermissionRequests.get(requestId);
    callback(allowed);
    pendingPermissionRequests.delete(requestId);
  }
});

// Get ad blocker statistics
ipcMain.handle('get-adblocker-stats', async () => {
  return {
    patterns: AD_PATTERNS.domains.length + AD_PATTERNS.urlPatterns.length + AD_PATTERNS.scriptPatterns.length,
    manualBlocking: true
  };
});

// --- DOWNLOAD HANDLER ---
function setupDownloadHandler(browserWindow) {
  const webviewSession = session.fromPartition('persist:main');

  webviewSession.on('will-download', (event, item, webContents) => {
    // DO NOT prevent default - let download happen!
    // event.preventDefault(); // <-- REMOVED THIS LINE

    const downloadId = Date.now();

    // Store download item so we can cancel it if needed
    activeDownloads.set(downloadId, item);

    // Set save path to downloads folder
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
