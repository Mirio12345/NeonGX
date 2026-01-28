// main.js
const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let pendingPermissionRequest = null;
let activeDownloads = new Map();
const downloadItems = new Map();

// Path to store permission preferences
const permissionsFilePath = path.join(app.getPath('userData'), 'permission-preferences.json'); 
// Helper functions to load/save permissions
function loadPermissionPreferences() {
    try {
        if (fs.existsSync(permissionsFilePath)) {
            const data = fs.readFileSync(permissionsFilePath, 'utf-8');
            const prefs = JSON.parse(data);
            console.log('Loaded preferences from file:', prefs);
            return prefs;
        } else {
            console.log('No preferences file found, returning empty object');
        }
    } catch (error) {
        console.error('Error loading permission preferences:', error);
    }
    return {};
}

function savePermissionPreferences(preferences) {
    try {
        fs.writeFileSync(permissionsFilePath, JSON.stringify(preferences, null, 2), 'utf-8');
        console.log('Saved preferences to file:', preferences);
    } catch (error) {
        console.error('Error saving permission preferences:', error);
    }
}

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
}).catch(err => {
  console.log('Failed to set Google cookie:', err);
});

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

// 5. YOUTUBE-SPECIFIC AD BLOCKING (ENHANCED)
webviewSession.webRequest.onBeforeRequest((details, callback) => {
  const url = details.url.toLowerCase();
  
  // Only process YouTube URLs
  if (!url.includes('youtube.com') && !url.includes('youtu.be') && !url.includes('googlevideo.com')) {
    callback({});
    return;
  }

  // Enhanced ad patterns (but still safe)
  const youtubeAdPatterns = [
    // Known ad servers
    'doubleclick.net',
    'googleads.g.doubleclick.net',
    'googleadservices.com',
    'googlesyndication.com',
    
    // YouTube ad endpoints
    'youtube.com/pagead/',
    'youtube.com/api/stats/ads',
    'youtube.com/ptracking',
    'youtube.com/aclk',
    
    // Ad click tracking
    '/aclk',
    '/ptracking',
    
    // Ad servers
    'ad.doubleclick.net',
    'pagead2.googlesyndication.com',
    
    // Rendition patterns (YouTube's ad servers)
    /r[0-9]+---sn-.*\/adserver/,
    /r[0-9]+---sn-.*doubleclick/,
    
    // Video ads (specific pattern)
    'googlevideo.com/videoplayback?ad_',
    'googlevideo.com/videoplayback&ad_',
  ];

  const isAd = youtubeAdPatterns.some(pattern => {
    if (typeof pattern === 'string') {
      return url.includes(pattern);
    } else if (pattern instanceof RegExp) {
      return pattern.test(url);
    }
    return false;
  });

  if (isAd) {
    console.log('🚫 Blocked ad:', url.substring(0, 80));
    callback({ cancel: true });
  } else {
    callback({});
  }
}, { urls: ['<all_urls>'] });

// 3. PERMISSION MANAGEMENT (UPDATED VERSION)
webviewSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    console.log('Permission request:', permission, details);

    // RELOAD PREFERENCES FROM FILE (don't use cached version!)
    const currentPreferences = loadPermissionPreferences();
    
    // Store the callback
    const requestId = Date.now().toString();
    pendingPermissionRequest = {
        id: requestId,
        permission: permission,
        details: details,
        callback: callback,
        url: webContents.getURL()
    };

    // Check if we have a saved preference (reload from file to be sure)
    const origin = new URL(webContents.getURL()).origin;
    const key = `${origin}:${permission}`;
    
    console.log('Checking for saved preference:', key);
    
    if (currentPreferences[key] !== undefined) {
        // Use saved preference automatically
        const savedValue = currentPreferences[key];
        console.log(`Using saved preference for ${key}: ${savedValue}`);
        pendingPermissionRequest = null;
        callback(savedValue);
    } else {
        // No saved preference, show permission request modal to user
        console.log(`No saved preference for ${key}, asking user...`);
        if (mainWindow) {
            mainWindow.webContents.send('permission-request', {
                id: requestId,
                permission: permission,
                details: details,
                url: webContents.getURL()
            });
        }
    }
});

  // 4. DOWNLOAD MANAGEMENT (FIXED VERSION)
webviewSession.on('will-download', (event, item, webContents) => {
    const downloadId = Date.now().toString();
    const url = item.getURL();
    const filename = item.getFilename();
    const totalBytes = item.getTotalBytes();

    // Set default save path to downloads folder
    const downloadsPath = app.getPath('downloads');
    const savePath = path.join(downloadsPath, filename);
    item.setSavePath(savePath);

    // Create download object - use object literal directly to avoid scoping issues
    const downloadData = {
        id: downloadId,
        filename: filename,
        url: url,
        totalBytes: totalBytes,
        receivedBytes: 0,
        savePath: savePath,
        state: 'progress',
        startTime: Date.now()
    };

    // Store in activeDownloads Map
    activeDownloads.set(downloadId, downloadData);
    downloadItems.set(downloadId, item); 

    // Send download started event to renderer
    if (mainWindow) {
        mainWindow.webContents.send('download-started', downloadData);
    }

    // Track download progress
    item.on('updated', (event, state) => {
        // Get the current download data from Map
        const currentDownload = activeDownloads.get(downloadId);
        if (!currentDownload) return;

        if (state === 'interrupted') {
            currentDownload.state = 'interrupted';
            currentDownload.paused = true;
        } else if (state === 'progressing') {
            if (item.isPaused()) {
                currentDownload.state = 'interrupted';
                currentDownload.paused = true;
            } else {
                currentDownload.state = 'progress';
                currentDownload.receivedBytes = item.getReceivedBytes();
                currentDownload.paused = false;
            }
        }

        // Update the Map with modified data
        activeDownloads.set(downloadId, currentDownload);

        // Send update to renderer
        if (mainWindow) {
            mainWindow.webContents.send('download-updated', currentDownload);
        }
    });

    item.on('done', (event, state) => {
        // Get the current download data
        const currentDownload = activeDownloads.get(downloadId);
        if (!currentDownload) return;

        currentDownload.state = state;

        if (state === 'completed') {
            currentDownload.receivedBytes = currentDownload.totalBytes;
            currentDownload.endTime = Date.now();
            currentDownload.duration = currentDownload.endTime - currentDownload.startTime;

            // Show notification
            const { Notification } = require('electron');
            if (Notification.isSupported()) {
                try {
                    new Notification({
                        title: 'Download Complete',
                        body: `${currentDownload.filename} has been downloaded successfully.`
                    }).show();
                } catch (e) {
                    console.log('Failed to show notification:', e);
                }
            }
        } else {
            currentDownload.endTime = Date.now();
        }

        // Update the Map
        activeDownloads.set(downloadId, currentDownload);

        // Send completion event to renderer
        if (mainWindow) {
            mainWindow.webContents.send('download-completed', currentDownload);
        }

        // Remove from active downloads after some time
        setTimeout(() => {
            activeDownloads.delete(downloadId);
        }, 60000);

        downloadItems.delete(downloadId);
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
    console.log('Permission response received:', requestId, allowed);
    
    if (pendingPermissionRequest && pendingPermissionRequest.id === requestId) {
        console.log(`Permission ${requestId}: ${allowed ? 'granted' : 'denied'}`);

        // Call the callback
        pendingPermissionRequest.callback(allowed);

        // RELOAD FROM FILE to ensure we're working with latest data
        const currentPreferences = loadPermissionPreferences();
        
        // Save preference to file
        const origin = new URL(pendingPermissionRequest.url).origin;
        const key = `${origin}:${pendingPermissionRequest.permission}`;
        
        currentPreferences[key] = allowed;
        savePermissionPreferences(currentPreferences);
        
        console.log(`Saved permission preference: ${key} = ${allowed}`);

        // Clear pending request
        pendingPermissionRequest = null;
    }
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

// Update the cancel-download handler:
ipcMain.handle('cancel-download', async (event, downloadId) => {
    console.log('Cancel download requested:', downloadId);

    try {
        // Get the actual DownloadItem from our Map
        const downloadItem = downloadItems.get(downloadId);

        if (!downloadItem) {
            console.log('Download item not found:', downloadId);
            return { success: false, error: 'Download not found' };
        }

        // Check the download state using getState() instead of isComplete()
        const state = downloadItem.getState();
        console.log('Download state:', state);

        if (state === 'completed') {
            console.log('Download already complete, cannot cancel');
            return { success: false, error: 'Download already complete' };
        }

        if (state === 'cancelled') {
            console.log('Download already cancelled');
            return { success: false, error: 'Download already cancelled' };
        }

        // Cancel the download
        downloadItem.cancel();

        // Update the download state in our tracking
        const currentDownload = activeDownloads.get(downloadId);
        if (currentDownload) {
            currentDownload.state = 'cancelled';
            currentDownload.endTime = Date.now();
            activeDownloads.set(downloadId, currentDownload);

            // Notify the renderer about the cancellation
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('download-updated', currentDownload);
            }
        }

        // Clean up the item reference
        downloadItems.delete(downloadId);
        activeDownloads.delete(downloadId);

        console.log('Download cancelled successfully:', downloadId);
        return { success: true };

    } catch (error) {
        console.error('Error canceling download:', error);
        return { success: false, error: error.message };
    }
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


// ============================================
// COOKIES & PERMISSIONS MANAGEMENT
// ============================================

// Get all cookies
ipcMain.handle('get-cookies', async (event, filter = '') => {
    try {
        const cookies = await session.fromPartition('persist:main').cookies.get({});
        
        if (filter) {
            const lowerFilter = filter.toLowerCase();
            return cookies.filter(cookie => 
                cookie.domain.toLowerCase().includes(lowerFilter) ||
                cookie.name.toLowerCase().includes(lowerFilter)
            );
        }
        
        return cookies;
    } catch (error) {
        console.error('Failed to get cookies:', error);
        return [];
    }
});

// Clear all cookies
ipcMain.handle('clear-all-cookies', async () => {
    try {
        await session.fromPartition('persist:main').cookies.flushStore();
        await session.fromPartition('persist:main').clearStorageData({
            storages: ['cookies', 'localstorage', 'cachestorage'],
            quotas: ['temporary', 'persistent', 'syncable']
        });
        return { success: true };
    } catch (error) {
        console.error('Failed to clear all cookies:', error);
        return { success: false, error: error.message };
    }
});

// Clear cookies for a specific domain
ipcMain.handle('clear-domain-cookies', async (event, domain) => {
    try {
        const sessionPartition = session.fromPartition('persist:main');
        const cookies = await sessionPartition.cookies.get({});
        
        let removedCount = 0;
        
        // Normalize the search domain for comparison
        const searchDomain = domain.toLowerCase().replace(/^\./, '').replace(/^www\./, '');
        
        for (const cookie of cookies) {
            // Normalize cookie domain for comparison
            let cookieDomain = cookie.domain.toLowerCase();
            
            // Remove leading dot from cookie domain
            if (cookieDomain.startsWith('.')) {
                cookieDomain = cookieDomain.substring(1);
            }
            
            // Remove www from cookie domain for comparison
            if (cookieDomain.startsWith('www.')) {
                cookieDomain = cookieDomain.substring(4);
            }
            
            // Match domains (more flexible matching)
            if (cookieDomain === searchDomain || 
                cookieDomain.endsWith('.' + searchDomain) ||
                searchDomain === cookieDomain ||
                searchDomain.endsWith('.' + cookieDomain)) {
                
                // Build proper URL for removal
                const protocol = cookie.secure ? 'https' : 'http';
                let urlDomain = cookie.domain;
                
                // Handle domain cookies (starting with dot)
                if (urlDomain.startsWith('.')) {
                    urlDomain = 'www' + urlDomain;
                }
                
                const url = `${protocol}://${urlDomain}`;
                
                try {
                    await sessionPartition.cookies.remove(url, cookie.name);
                    removedCount++;
                    console.log(`Removed cookie: ${cookie.name} from ${cookie.domain}`);
                } catch (err) {
                    console.log('Failed to remove cookie:', cookie.name, err.message);
                }
            }
        }
        
        console.log(`Total cookies removed for ${domain}: ${removedCount}`);
        return { success: true, removedCount };
    } catch (error) {
        console.error('Failed to clear domain cookies:', error);
        return { success: false, error: error.message };
    }
});

// Clear all browser data
ipcMain.handle('clear-browser-data', async () => {
    try {
        await session.fromPartition('persist:main').clearStorageData({
            storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'cachestorage', 'serviceworkers'],
            quotas: ['temporary', 'persistent', 'syncable']
        });
        
        // Also clear HTTP cache
        await session.fromPartition('persist:main').clearCache();
        
        return { success: true };
    } catch (error) {
        console.error('Failed to clear browser data:', error);
        return { success: false, error: error.message };
    }
});

// Handle setting a permission preference
ipcMain.handle('set-permission-preference', async (event, { origin, permission, allowed }) => {
    try {
        if (!permissionPreferences) {
            permissionPreferences = loadPermissionPreferences();
        }
        
        const key = `${origin}:${permission}`;
        permissionPreferences[key] = allowed;
        
        savePermissionPreferences(permissionPreferences);
        console.log(`Setting permission preference: ${origin} - ${permission} = ${allowed}`);
        return { success: true };
    } catch (error) {
        console.error('Error setting permission preference:', error);
        return { success: false, error: error.message };
    }
});

// Handle getting permission preferences
ipcMain.handle('get-permission-preference', async () => {
    console.log('Getting permission preferences from file...');
    
    // ALWAYS reload from file (don't use undefined global variable!)
    const preferences = loadPermissionPreferences();
    console.log('Loaded preferences:', preferences);
    
    return preferences || {};
});

// Handle removing a permission preference
ipcMain.handle('remove-permission-preference', async (event, key) => {
    console.log('Removing permission preference:', key);
    
    try {
        // RELOAD FROM FILE to get current state
        const currentPreferences = loadPermissionPreferences();
        
        if (currentPreferences[key] !== undefined) {
            delete currentPreferences[key];
            
            // Save back to file
            savePermissionPreferences(currentPreferences);
            
            console.log('Deleted preference:', key);
            console.log('Updated preferences after deletion:', currentPreferences);
            
            return { success: true };
        }
        
        return { success: false, error: 'Permission preference not found' };
    } catch (error) {
        console.error('Error removing permission preference:', error);
        return { success: false, error: error.message };
    }
});