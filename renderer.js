// renderer.js

const FIREFOX_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0';


// --- STATE ---
const defaultState = {
    activeWorkspaceId: 1,
    activeTabId: null,
    workspaces: [
        { id: 1, name: "Default", tabs: [] },
        { id: 2, name: "Gaming", tabs: [] }
    ]
};
let state = { ...defaultState };

// History Data
let browserHistory = [];
let lastUrl = ""; // To prevent spamming history

// Context Menu Data
let contextLinkUrl = null;
let contextImageUrl = null;
let contextWebviewId = null;

// Permission Data
let pendingPermissionRequest = null;
let permissionPreferences = {};

// Download Data
let activeDownloads = [];

// --- SOUND EFFECTS ---

// Create audio context for sound effects
let audioContext = null;

function playClickSound() {
    try {
        // Create a simple click sound using Web Audio API
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Create a short, pleasant click sound
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.05);

        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.05);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.05);
    } catch (e) {
        console.log('Audio not supported:', e);
    }
}

// --- UTILS ---
function loadState() {
    const saved = localStorage.getItem('neonGxState');
    if (saved) {
        try { state = JSON.parse(saved); }
        catch(e) { console.error("Corrupt save"); }
    }

    const savedHistory = localStorage.getItem('neonGxHistory');
    if (savedHistory) {
        try {
            browserHistory = JSON.parse(savedHistory);
        } catch(e) {
            console.error("Corrupt history file");
        }
    }

    // Load permission preferences
    const savedPermissions = localStorage.getItem('neonGxPermissions');
    if (savedPermissions) {
        try {
            permissionPreferences = JSON.parse(savedPermissions);
        } catch(e) {
            console.error("Corrupt permissions file");
        }
    }
}

function saveState() {
    localStorage.setItem('neonGxState', JSON.stringify(state));
}

function savePermissions() {
    localStorage.setItem('neonGxPermissions', JSON.stringify(permissionPreferences));
}

// --- PERMISSION MANAGEMENT ---

// Format permission type for display
function formatPermissionType(permission) {
    const permissionTypes = {
        'notifications': 'Notifications',
        'geolocation': 'Location',
        'media': 'Camera/Microphone',
        'midi': 'MIDI',
        'pointerLock': 'Pointer Lock',
        'fullscreen': 'Fullscreen',
        'openExternal': 'Open External Links'
    };
    return permissionTypes[permission] || permission;
}

// Show permission request modal
function showPermissionRequest(data) {
    pendingPermissionRequest = data;

    const modal = document.getElementById('permissionModal');
    const permissionType = document.getElementById('permissionType');
    const requestingUrl = document.getElementById('requestingUrl');

    permissionType.textContent = formatPermissionType(data.permission);
    requestingUrl.textContent = data.url;

    modal.style.display = 'flex';
}

// Handle permission response
function handlePermissionResponse(allowed) {
    if (pendingPermissionRequest) {
        // Send response to main process
        window.electronAPI.respondToPermission(pendingPermissionRequest.id, allowed);

        // Save preference for this origin
        const origin = new URL(pendingPermissionRequest.url).origin;
        permissionPreferences[`${origin}:${pendingPermissionRequest.permission}`] = allowed;
        savePermissions();

        // Hide modal
        document.getElementById('permissionModal').style.display = 'none';

        // Clear pending request
        pendingPermissionRequest = null;
    }
}

// --- DOWNLOAD MANAGEMENT ---

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Format duration
function formatDuration(ms) {
    if (!ms) return '';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}

// Get download progress percentage
function getDownloadProgress(download) {
    if (download.totalBytes === 0) return 0;
    return Math.round((download.receivedBytes / download.totalBytes) * 100);
}

// Toggle downloads panel
function toggleDownloads() {
    const panel = document.getElementById('downloadsPanel');
    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'block';
        updateDownloadsList();
    } else {
        panel.style.display = 'none';
    }
}

// Update downloads list UI
function updateDownloadsList() {
    const list = document.getElementById('downloadsList');

    if (activeDownloads.length === 0) {
        list.innerHTML = '<div class="downloads-empty">No active downloads</div>';
        return;
    }

    list.innerHTML = '';

    // Sort by time (newest first)
    const sortedDownloads = [...activeDownloads].reverse();

    sortedDownloads.forEach(download => {
        const div = document.createElement('div');
        div.className = 'download-item';

        const progress = getDownloadProgress(download);
        const isCompleted = download.state === 'completed';
        const isInterrupted = download.state === 'interrupted';

        let statusIcon = '';
        let statusText = '';

        if (isCompleted) {
            statusIcon = '<i class="fa-solid fa-check-circle" style="color: #27c93f;"></i>';
            statusText = 'Completed';
        } else if (isInterrupted) {
            statusIcon = '<i class="fa-solid fa-exclamation-circle" style="color: #ffbd2e;"></i>';
            statusText = 'Interrupted';
        } else {
            statusIcon = '<i class="fa-solid fa-spinner fa-spin"></i>';
            statusText = `${progress}%`;
        }

        div.innerHTML = `
            <div class="download-info">
                <div class="download-filename">
                    <span class="download-status-icon">${statusIcon}</span>
                    <span>${download.filename}</span>
                </div>
                <div class="download-details">
                    <span>${formatBytes(download.receivedBytes)} / ${formatBytes(download.totalBytes)}</span>
                    ${download.duration ? `<span class="download-time">${formatDuration(download.duration)}</span>` : ''}
                </div>
            </div>
            <div class="download-actions">
                ${isCompleted ? `<button class="download-action-btn" onclick="openDownloadedFile('${download.savePath}')" title="Open"><i class="fa-solid fa-folder-open"></i></button>` : ''}
                <button class="download-action-btn" onclick="cancelDownload('${download.id}')" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
            </div>
            ${!isCompleted ? `<div class="download-progress-bar"><div class="download-progress-fill" style="width: ${progress}%"></div></div>` : ''}
        `;

        list.appendChild(div);
    });

    // Update downloads count badge
    const badge = document.getElementById('downloadsBadge');
    const activeCount = activeDownloads.filter(d => d.state === 'progress').length;
    if (activeCount > 0) {
        badge.textContent = activeCount;
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }
}

// Cancel a download
async function cancelDownload(downloadId) {
    await window.electronAPI.cancelDownload(downloadId);
    const index = activeDownloads.findIndex(d => d.id === downloadId);
    if (index !== -1) {
        activeDownloads[index].state = 'cancelled';
        updateDownloadsList();
    }
}

// Open downloaded file
async function openDownloadedFile(filePath) {
    await window.electronAPI.openDownloadedFile(filePath);
}

// Open downloads folder
async function openDownloadsFolder() {
    await window.electronAPI.openDownloadsFolder();
}

// Clear completed downloads
async function clearCompletedDownloads() {
    await window.electronAPI.clearCompletedDownloads();
    activeDownloads = activeDownloads.filter(d => d.state === 'progress');
    updateDownloadsList();
}

// --- CONTEXT MENU MANAGEMENT ---

// Get current page URL from active webview
function getCurrentPageUrl() {
    const wv = document.getElementById(`view-${state.activeTabId}`);
    return wv ? wv.getURL() : '';
}

// Get current page title from active webview
function getCurrentPageTitle() {
    const ws = getCurrentWorkspace();
    const tab = ws.tabs.find(t => t.id === state.activeTabId);
    return tab ? tab.title : '';
}

// Show context menu at correct position
function showContextMenu(e, tabId = null) {
    console.log('Context menu event received:', e);
    console.log('Tab ID:', tabId);

    e.preventDefault();

    const menu = document.getElementById('contextMenu');
    const viewport = document.getElementById('viewport');

    // Get viewport bounds
    const viewportRect = viewport.getBoundingClientRect();

    // Calculate position - add viewport offset
    let x = e.params.x + viewportRect.left;
    let y = e.params.y + viewportRect.top;

    // Store context data
    contextLinkUrl = e.params.linkURL || null;
    contextImageUrl = e.params.srcURL || e.srcElement?.src || null;
    contextWebviewId = tabId || state.activeTabId;

    // Update menu items based on context
    updateContextMenuItems(e);

    // Position menu with boundary checking
    const menuWidth = 240;
    const menuHeight = menu.scrollHeight || 200;

    // Adjust if menu would go off right edge
    if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 10;
    }

    // Adjust if menu would go off bottom edge
    if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 10;
    }

    // Apply position
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = 'block';

    // Play click sound
    playClickSound();
}

// Update context menu items based on what was clicked
function updateContextMenuItems(e) {
    const menu = document.getElementById('contextMenu');
    const hasLink = !!e.params.linkURL;
    const hasImage = !!e.params.srcURL || !!e.srcElement?.src;
    const hasSelection = e.params.selectionText && e.params.selectionText.trim().length > 0;
    const isEditable = e.params.isEditable || false;
    const hasMedia = e.params.mediaType === 'image' || e.params.mediaType === 'video';

    // Build menu HTML dynamically
    let menuHTML = '';

    // Link-related options
    if (hasLink) {
        menuHTML += `
            <div class="menu-item" data-action="openLink" title="Open link in current tab">
                <i class="fa-solid fa-link"></i> Open Link
            </div>
            <div class="menu-item" data-action="openLinkNewTab" title="Open link in new tab">
                <i class="fa-solid fa-plus"></i> Open in New Tab
            </div>
            <div class="menu-item" data-action="copyLink" title="Copy link address">
                <i class="fa-regular fa-copy"></i> Copy Link Address
            </div>
            <div class="menu-divider"></div>`;
    }

    // Selection options
    if (hasSelection) {
        menuHTML += `
            <div class="menu-item" data-action="copy" title="Copy selection">
                <i class="fa-regular fa-copy"></i> Copy
            </div>
            <div class="menu-item" data-action="cut" title="Cut selection">
                <i class="fa-solid fa-scissors"></i> Cut
            </div>
            <div class="menu-item" data-action="paste" title="Paste">
                <i class="fa-solid fa-paste"></i> Paste
            </div>
            <div class="menu-divider"></div>`;
    } else if (isEditable) {
        menuHTML += `
            <div class="menu-item" data-action="paste" title="Paste">
                <i class="fa-solid fa-paste"></i> Paste
            </div>
            <div class="menu-divider"></div>`;
    }

    // Image-related options
    if (hasImage) {
        menuHTML += `
            <div class="menu-item" data-action="openImage" title="Open image in new tab">
                <i class="fa-regular fa-image"></i> Open Image
            </div>
            <div class="menu-item" data-action="copyImage" title="Copy image">
                <i class="fa-regular fa-image"></i> Copy Image
            </div>
            <div class="menu-item" data-action="copyImageAddress" title="Copy image address">
                <i class="fa-regular fa-copy"></i> Copy Image Address
            </div>
            <div class="menu-divider"></div>`;
    }

    // Page options
    menuHTML += `
        <div class="menu-item" data-action="back" title="Go back">
            <i class="fa-solid fa-arrow-left"></i> Back
        </div>
        <div class="menu-item" data-action="forward" title="Go forward">
            <i class="fa-solid fa-arrow-right"></i> Forward
        </div>
        <div class="menu-item" data-action="reload" title="Reload page">
            <i class="fa-solid fa-rotate-right"></i> Reload
        </div>
        <div class="menu-divider"></div>
        <div class="menu-item" data-action="copyPageUrl" title="Copy page URL">
            <i class="fa-regular fa-copy"></i> Copy Page URL
        </div>
        <div class="menu-item" data-action="inspect" title="Open DevTools">
            <i class="fa-solid fa-code"></i> Inspect Element
        </div>
    `;

    menu.innerHTML = menuHTML;

    // Add click handlers to all menu items
    menu.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.getAttribute('data-action');
            handleContextMenuAction(action);
        });

        // Add hover sound
        item.addEventListener('mouseenter', playClickSound);
    });
}

// Handle context menu actions
function handleContextMenuAction(action) {
    const wv = document.getElementById(`view-${state.activeTabId}`);

    if (!wv) {
        hideContextMenu();
        return;
    }

    switch (action) {
        case 'openLink':
            if (contextLinkUrl) {
                wv.src = contextLinkUrl;
            }
            break;

        case 'openLinkNewTab':
            if (contextLinkUrl) {
                createTab(contextLinkUrl);
            }
            break;

        case 'copyLink':
        case 'copyLinkAddress':
        case 'copyImageAddress':
            if (contextLinkUrl || contextImageUrl) {
                const urlToCopy = contextLinkUrl || contextImageUrl;
                navigator.clipboard.writeText(urlToCopy).then(() => {
                    console.log('Copied:', urlToCopy);
                });
            }
            break;

        case 'copy':
            wv.executeJavaScript(`
                (function() {
                    const selection = window.getSelection();
                    if (selection.toString()) {
                        document.execCommand('copy');
                        return true;
                    }
                    return false;
                })()
            `);
            break;

        case 'cut':
            wv.executeJavaScript(`
                (function() {
                    const selection = window.getSelection();
                    if (selection.toString()) {
                        document.execCommand('cut');
                        return true;
                    }
                    return false;
                })()
            `);
            break;

        case 'paste':
            wv.executeJavaScript(`
                (function() {
                    document.execCommand('paste');
                    return true;
                })()
            `);
            break;

        case 'openImage':
            if (contextImageUrl) {
                createTab(contextImageUrl);
            }
            break;

        case 'copyImage':
            wv.executeJavaScript(`
                (function() {
                    const img = document.querySelector('img[src="${contextImageUrl}"]');
                    if (img) {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        canvas.toBlob((blob) => {
                            const item = new ClipboardItem({ 'image/png': blob });
                            navigator.clipboard.write([item]);
                        });
                    }
                })()
            `);
            break;

        case 'back':
            if (wv.canGoBack()) {
                wv.goBack();
            }
            break;

        case 'forward':
            if (wv.canGoForward()) {
                wv.goForward();
            }
            break;

        case 'reload':
            wv.reload();
            break;

        case 'copyPageUrl':
            const pageUrl = wv.getURL();
            if (pageUrl) {
                navigator.clipboard.writeText(pageUrl).then(() => {
                    console.log('Copied page URL:', pageUrl);
                });
            }
            break;

        case 'inspect':
            wv.openDevTools();
            break;
    }

    // Hide menu after action
    hideContextMenu();
}

// Hide context menu
function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    menu.style.display = 'none';

    // Clear context data
    contextLinkUrl = null;
    contextImageUrl = null;
    contextWebviewId = null;
}

// --- INIT ---
window.addEventListener('DOMContentLoaded', () => {
    loadState();

    // Setup permission request listener
    window.electronAPI.onPermissionRequest((data) => {
        console.log('Permission request received:', data);

        // Check if we have a saved preference
        const origin = new URL(data.url).origin;
        const preferenceKey = `${origin}:${data.permission}`;

        if (permissionPreferences[preferenceKey] !== undefined) {
            // Use saved preference automatically
            window.electronAPI.respondToPermission(data.id, permissionPreferences[preferenceKey]);
        } else {
            // Show permission request modal
            showPermissionRequest(data);
        }
    });

    // Setup download event listeners
    window.electronAPI.onDownloadStarted((download) => {
        console.log('Download started:', download);
        activeDownloads.push(download);
        updateDownloadsList();
    });

    window.electronAPI.onDownloadUpdated((download) => {
        console.log('Download updated:', download);
        const index = activeDownloads.findIndex(d => d.id === download.id);
        if (index !== -1) {
            activeDownloads[index] = download;
            updateDownloadsList();
        }
    });

    window.electronAPI.onDownloadCompleted((download) => {
        console.log('Download completed:', download);
        const index = activeDownloads.findIndex(d => d.id === download.id);
        if (index !== -1) {
            activeDownloads[index] = download;
            updateDownloadsList();
        }

        // Show notification
        if (download.state === 'completed') {
            // You could also show a toast notification here
            console.log('Download complete:', download.filename);
        }
    });

    // Load active downloads from main process
    window.electronAPI.getActiveDownloads().then(downloads => {
        activeDownloads = downloads || [];
        updateDownloadsList();
    });

    const ws = getCurrentWorkspace();
    if (!ws || ws.tabs.length === 0) {
        createTab('https://www.google.com');
    } else {
        restoreTabs();
    }

    renderWorkspaces();

    // Hide context menu on global click (but NOT when clicking inside menu)
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('contextMenu');
        if (menu.style.display === 'block' && !menu.contains(e.target)) {
            hideContextMenu();
        }
    });

    // Hide context menu on right click elsewhere
    document.addEventListener('contextmenu', (e) => {
        const menu = document.getElementById('contextMenu');
        if (menu.style.display === 'block' && !menu.contains(e.target)) {
            hideContextMenu();
        }
    });

    // Hide context menu on scroll
    window.addEventListener('scroll', () => {
        const menu = document.getElementById('contextMenu');
        if (menu.style.display === 'block') {
            hideContextMenu();
        }
    });

    // --- TAB SCROLL WITH MOUSE WHEEL ---
    const tabBar = document.getElementById('tabBar');

    tabBar.addEventListener('wheel', (e) => {
        // Check if there is actually overflow to scroll
        if (tabBar.scrollWidth > tabBar.clientWidth) {
            // Prevent default vertical scrolling
            e.preventDefault();

            // Convert vertical scroll (deltaY) to horizontal scroll (scrollLeft)
            tabBar.scrollLeft += e.deltaY;
        }
    });

    // --- RESIZABLE SIDEBAR LOGIC ---
    const resizer = document.getElementById('resize-handle');
    const sidebar = document.querySelector('aside');
    const root = document.documentElement; // Access CSS Variables
    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'ew-resize';
        // Prevent text selection while dragging
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        // Calculate new width based on mouse X position
        // Minimum width 150px, Maximum width 500px
        let newWidth = e.clientX;
        if (newWidth < 150) newWidth = 150;
        if (newWidth > 500) newWidth = 500;

        // Update CSS Variable for --sidebar-width
        root.style.setProperty('--sidebar-width', newWidth + 'px');
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'none'; // Reset user select
        }
    });

    // Allow pressing "Enter" to create workspace
    document.getElementById('wsNameInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            confirmWorkspace();
        }
    });
});

// --- WORKSPACES (Fix 3) ---
function getCurrentWorkspace() {
    return state.workspaces.find(w => w.id === state.activeWorkspaceId);
}

function addWorkspace() {
    // 1. Show Modal
    document.getElementById('wsModal').style.display = 'flex';
    // 2. Clear old input and Focus
    const input = document.getElementById('wsNameInput');
    input.value = "";
    input.focus();
}

function confirmWorkspace() {
    // 1. Get Value
    const input = document.getElementById('wsNameInput');
    const name = input.value;

    // 2. Check Validity
    if (name && name.trim() !== "" && typeof name === 'string') {
        const newId = Date.now();
        state.workspaces.push({
            id: newId,
            name: name.trim(),
            tabs: []
        });
        switchWorkspace(newId);
    } else {
        // Optional: Shake input or show error if empty
        alert("Please enter a valid name."); // You can use alert for errors, or just do nothing
        return;
    }

    // 3. Hide Modal
    document.getElementById('wsModal').style.display = 'none';
    renderWorkspaces();
}

function cancelWorkspace() {
    document.getElementById('wsModal').style.display = 'none';
    renderWorkspaces();
}

function switchWorkspace(id) {
    saveState();
    state.activeWorkspaceId = id;

    document.querySelectorAll('webview').forEach(wv => wv.classList.remove('active'));

    const newWs = state.workspaces.find(w => w.id === id);
    if (newWs.tabs.length > 0) {
        state.activeTabId = newWs.tabs[0].id;
    } else {
        createTab('https://www.google.com');
        return;
    }

    renderWorkspaces();
    restoreTabs();
    saveState();
}

function renderWorkspaces() {
    const list = document.getElementById('wsList');
    list.innerHTML = '';

    state.workspaces.forEach(ws => {
        const div = document.createElement('div');
        div.className = `ws-item ${ws.id === state.activeWorkspaceId ? 'active' : ''}`;
        div.setAttribute('data-workspace-id', ws.id);

        // Add delete icon (prevent click propagation so it doesn't switch workspace)
        div.innerHTML = `
            <i class="fa-solid fa-folder"></i>
            <span style="flex:1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ws.name}</span>
            <i class="fa-solid fa-trash ws-delete-btn" onclick="event.stopPropagation(); deleteWorkspace(${ws.id})"></i>
        `;

        div.onclick = () => switchWorkspace(ws.id);

        // Drag and Drop Events for Moving Tabs to Workspaces
        div.addEventListener('dragover', handleWorkspaceDragOver);
        div.addEventListener('dragleave', handleWorkspaceDragLeave);
        div.addEventListener('drop', handleWorkspaceDrop);

        list.appendChild(div);
    });
}

// --- TABS (Fix 4 - Logic) ---
function createTab(url = 'https://www.google.com') {
    const id = Date.now();
    const tab = { id: id, url: url, title: 'Loading...' };

    const ws = getCurrentWorkspace();
    ws.tabs.push(tab);
    state.activeTabId = id;

    createWebviewElement(tab);
    renderTabs();
    saveState();
}

function restoreTabs() {
    const ws = getCurrentWorkspace();
    const viewport = document.getElementById('viewport');
    viewport.innerHTML = '';

    ws.tabs.forEach(tab => {
        createWebviewElement(tab);
    });

    renderTabs();

    const activeWv = document.getElementById(`view-${state.activeTabId}`);
    if(activeWv) activeWv.classList.add('active');
}

function createWebviewElement(tab) {
    const viewport = document.getElementById('viewport');
    const webview = document.createElement('webview');


    webview.setAttribute('preload', 'webview-preload.js');
    webview.id = `view-${tab.id}`;
    webview.src = tab.url;
    webview.setAttribute('partition', 'persist:main');
    webview.setAttribute('useragent', FIREFOX_USER_AGENT);
    webview.setAttribute('allowpopups', 'on');
    webview.classList.add('webview');
    if(tab.id === state.activeTabId) webview.classList.add('active');

    // Append to viewport FIRST
    viewport.appendChild(webview);

    // THEN attach event listeners (after webview is in DOM)
    // Fix 2: History Logic
    webview.addEventListener('did-navigate', (e) => {
        tab.url = e.url;
        if(state.activeTabId === tab.id) document.getElementById('urlInput').value = e.url;

        // Add to history if URL changed
        if(e.url !== lastUrl) {
            browserHistory.unshift({ url: e.url, title: tab.title, time: Date.now() });
            lastUrl = e.url;

            localStorage.setItem('neonGxHistory', JSON.stringify(browserHistory));
        }
        saveState();
    });

    webview.addEventListener('page-title-updated', (e) => {
        tab.title = e.title;
        renderTabs();
    });

   // Context Menu Logic
    webview.addEventListener('context-menu', (e) => {
        console.log('Webview context-menu event fired:', e);
        try {
            showContextMenu(e, tab.id);
        } catch (error) {
            console.error('Error showing context menu:', error);
        }
    });

    // === NEW: Listen for messages from webview preload script ===
    webview.addEventListener('ipc-message', (event) => {
        console.log('Received message from webview:', event.channel);
        
        // Hide context menu when user clicks or right-clicks inside webview
        if (event.channel === 'webview-click' || event.channel === 'webview-contextmenu') {
            hideContextMenu();
        }
    });
}

function closeTab(e, id) {
    e.stopPropagation();
    const ws = getCurrentWorkspace();
    const idx = ws.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    const wv = document.getElementById(`view-${id}`);
    if (wv) wv.remove();

    ws.tabs.splice(idx, 1);

    if (state.activeTabId === id) {
        if (ws.tabs.length > 0) {
            const newIdx = Math.max(0, idx - 1);
            state.activeTabId = ws.tabs[newIdx].id;
            const newWv = document.getElementById(`view-${state.activeTabId}`);
            if(newWv) newWv.classList.add('active');
        } else {
            createTab('https://www.google.com');
            return;
        }
    }

    renderTabs();
    saveState();
}

function switchTab(id) {
    const ws = getCurrentWorkspace();
    state.activeTabId = id;

    ws.tabs.forEach(t => {
        const el = document.getElementById(`view-${t.id}`);
        if (t.id === id) {
            el.classList.add('active');
            el.focus();
            document.getElementById('urlInput').value = t.url;
        } else {
            el.classList.remove('active');
        }
    });
    renderTabs();
    saveState();
}

// --- DRAG AND DROP FOR TABS ---

let draggedTabId = null;
let draggedTabWorkspaceId = null;

// Handle starting to drag a tab
function handleTabDragStart(e) {
    draggedTabId = parseInt(e.target.getAttribute('data-tab-id'));
    draggedTabWorkspaceId = state.activeWorkspaceId;

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedTabId.toString());

    // Add dragging class for visual feedback
    e.target.classList.add('tab-dragging');

    // Play click sound
    playClickSound();
}

// Handle drag end
function handleTabDragEnd(e) {
    e.target.classList.remove('tab-dragging');

    // Clean up any drop indicators
    document.querySelectorAll('.tab-drop-indicator').forEach(el => {
        el.classList.remove('tab-drop-indicator');
    });

    draggedTabId = null;
    draggedTabWorkspaceId = null;
}

// Handle dragging over another tab (for reordering)
function handleTabDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const targetTab = e.target.closest('.tab');
    if (!targetTab) return;

    const targetTabId = parseInt(targetTab.getAttribute('data-tab-id'));

    // Don't show indicator if dragging over itself
    if (targetTabId === draggedTabId) return;

    // Remove all existing indicators
    document.querySelectorAll('.tab-drop-indicator').forEach(el => {
        el.classList.remove('tab-drop-indicator');
    });

    // Add visual indicator
    targetTab.classList.add('tab-drop-indicator');
}

// Handle drag leaving a tab
function handleTabDragLeave(e) {
    const targetTab = e.target.closest('.tab');
    if (targetTab) {
        targetTab.classList.remove('tab-drop-indicator');
    }
}

// Handle dropping a tab on another tab (for reordering)
function handleTabDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetTab = e.target.closest('.tab');
    if (!targetTab) return;

    const targetTabId = parseInt(targetTab.getAttribute('data-tab-id'));
    const targetTabWorkspaceId = state.activeWorkspaceId;

    // Don't do anything if dropping on itself or different workspaces
    if (targetTabId === draggedTabId || targetTabWorkspaceId !== draggedTabWorkspaceId) {
        targetTab.classList.remove('tab-drop-indicator');
        return;
    }

    const ws = getCurrentWorkspace();
    const draggedIndex = ws.tabs.findIndex(t => t.id === draggedTabId);
    const targetIndex = ws.tabs.findIndex(t => t.id === targetTabId);

    if (draggedIndex === -1 || targetIndex === -1) {
        targetTab.classList.remove('tab-drop-indicator');
        return;
    }

    // Remove tab from old position
    const [tab] = ws.tabs.splice(draggedIndex, 1);

    // Insert at new position
    // Adjust index if dragging from right to left
    const insertIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    ws.tabs.splice(insertIndex, 0, tab);

    // Clean up
    targetTab.classList.remove('tab-drop-indicator');

    // Re-render
    renderTabs();
    saveState();

    playClickSound();
}

// --- DRAG AND DROP FOR WORKSPACES ---

// Handle dragging over a workspace (for moving tabs between workspaces)
function handleWorkspaceDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const targetWs = e.target.closest('.ws-item');
    if (!targetWs) return;

    const targetWsId = parseInt(targetWs.getAttribute('data-workspace-id'));

    // Don't show indicator if dragging to same workspace
    if (targetWsId === draggedTabWorkspaceId) return;

    targetWs.classList.add('ws-drop-indicator');
}

// Handle drag leaving a workspace
function handleWorkspaceDragLeave(e) {
    const targetWs = e.target.closest('.ws-item');
    if (targetWs) {
        targetWs.classList.remove('ws-drop-indicator');
    }
}

// Handle dropping a tab on a workspace (for moving to different workspace)
function handleWorkspaceDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedTabId) return;

    const targetWs = e.target.closest('.ws-item');
    if (!targetWs) return;

    const targetWsId = parseInt(targetWs.getAttribute('data-workspace-id'));

    // Don't do anything if same workspace
    if (targetWsId === draggedTabWorkspaceId) {
        targetWs.classList.remove('ws-drop-indicator');
        return;
    }

    // Find source and destination workspaces
    const sourceWs = state.workspaces.find(w => w.id === draggedTabWorkspaceId);
    const destWs = state.workspaces.find(w => w.id === targetWsId);

    if (!sourceWs || !destWs) return;

    // Find and remove tab from source workspace
    const tabIndex = sourceWs.tabs.findIndex(t => t.id === draggedTabId);
    if (tabIndex === -1) {
        targetWs.classList.remove('ws-drop-indicator');
        return;
    }

    const [tab] = sourceWs.tabs.splice(tabIndex, 1);

    // Add tab to destination workspace
    destWs.tabs.push(tab);

    // Clean up
    targetWs.classList.remove('ws-drop-indicator');

    // If we moved the active tab, switch to it in the new workspace
    if (state.activeTabId === draggedTabId) {
        switchWorkspace(targetWsId);
        state.activeTabId = tab.id;
    }

    // If source workspace is now empty and was active, create a new tab there
    if (sourceWs.tabs.length === 0 && sourceWs.id === state.activeWorkspaceId) {
        createTab('https://www.google.com');
    }

    // Re-render both tabs and workspaces
    renderTabs();
    renderWorkspaces();
    saveState();

    playClickSound();
}


function renderTabs() {
    const bar = document.getElementById('tabBar');
    const btn = bar.querySelector('.new-tab-btn');
    const windowControls = bar.querySelector('.window-controls-container');
    bar.innerHTML = '';

    const ws = getCurrentWorkspace();
    ws.tabs.forEach((tab, index) => {
        const el = document.createElement('div');
        el.className = `tab ${tab.id === state.activeTabId ? 'active' : ''}`;
        el.setAttribute('draggable', 'true');
        el.setAttribute('data-tab-id', tab.id);
        el.setAttribute('data-tab-index', index);
        el.innerHTML = `
            <span class="tab-title">${tab.title}</span>
            <span class="tab-close" onclick="closeTab(event, ${tab.id})"><i class="fa-solid fa-xmark"></i></span>
        `;
        el.onclick = () => switchTab(tab.id);

        // Drag and Drop Events for Tab Reordering
        el.addEventListener('dragstart', handleTabDragStart);
        el.addEventListener('dragend', handleTabDragEnd);
        el.addEventListener('dragover', handleTabDragOver);
        el.addEventListener('drop', handleTabDrop);
        el.addEventListener('dragleave', handleTabDragLeave);

        bar.appendChild(el);
    });
    bar.appendChild(btn);
    bar.appendChild(windowControls);
}

// --- NAVIGATION ---
function handleUrl(e) {
    if (e.key === 'Enter') {
        let val = e.target.value;
        if (!val.includes('.')) val = 'https://www.google.com/search?q=' + val;
        else if (!val.startsWith('http')) val = 'https://' + val;

        const wv = document.getElementById(`view-${state.activeTabId}`);
        wv.src = val;
    }
}

function goBack() { const wv = document.getElementById(`view-${state.activeTabId}`); if(wv && wv.canGoBack()) wv.goBack(); }
function goForward() { const wv = document.getElementById(`view-${state.activeTabId}`); if(wv && wv.canGoForward()) wv.goForward(); }
function reload() { const wv = document.getElementById(`view-${state.activeTabId}`); if(wv) wv.reload(); }

// --- FIX 2: HISTORY FUNCTIONS ---
function toggleHistory() {
    const modal = document.getElementById('historyModal');
    const list = document.getElementById('historyList');

    if (modal.style.display === 'flex') {
        modal.style.display = 'none';
    } else {
        modal.style.display = 'flex';
        list.innerHTML = '';

        browserHistory.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item-ui';
            div.innerHTML = `
                <div class="history-time">${new Date(item.time).toLocaleTimeString()}</div>
                <div class="history-url">${item.url}</div>
            `;
            div.onclick = () => {
                const wv = document.getElementById(`view-${state.activeTabId}`);
                wv.src = item.url;
                modal.style.display = 'none';
            };
            list.appendChild(div);
        });
    }
}


function deleteWorkspace(id) {
    // Prevent deleting the only workspace
    if (state.workspaces.length <= 1) {
        alert("You cannot delete the last workspace.");
        return;
    }

    const index = state.workspaces.findIndex(w => w.id === id);
    if (index === -1) return;

    // 1. Remove from array
    state.workspaces.splice(index, 1);

    // 2. Handle Active Workspace Switch
    if (state.activeWorkspaceId === id) {
        // Switch to the first available workspace
        state.activeWorkspaceId = state.workspaces[0].id;

        // Force a re-render of the new workspace tabs
        const viewport = document.getElementById('viewport');
        viewport.innerHTML = ''; // Clear old tabs
        restoreTabs();
    }

    // 3. Save and Update UI
    saveState();
    renderWorkspaces();
}


async function installExtension() {
    // 1. Open dialog to select folder
    const path = await window.electronAPI.openDialog();

    if (path) {
        // 2. Try to install
        const result = await window.electronAPI.installExtension(path);

        if (result.success) {
            alert(`Extension Loaded! ID: ${result.id}\n\nNote: You likely need to RESTART the app for it to work on webpages.`);
        } else {
            alert("Failed to load extension: " + result.error);
        }
    }
}
