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

// Downloads Data
let downloads = [];

// Permissions Data
let permissions = []; // Store pending permissions

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

    const savedDownloads = localStorage.getItem('neonGxDownloads');
    if (savedDownloads) {
        try {
            downloads = JSON.parse(savedDownloads);
        } catch(e) {
            console.error("Corrupt downloads file");
        }
    }

    const savedPermissions = localStorage.getItem('neonGxPermissions');
    if (savedPermissions) {
        try {
            permissions = JSON.parse(savedPermissions);
        } catch(e) {
            console.error("Corrupt permissions file");
        }
    }
}

function saveState() {
    localStorage.setItem('neonGxState', JSON.stringify(state));
}

function saveDownloads() {
    localStorage.setItem('neonGxDownloads', JSON.stringify(downloads));
}

function savePermissions() {
    localStorage.setItem('neonGxPermissions', JSON.stringify(permissions));
}

// --- INIT ---
window.addEventListener('DOMContentLoaded', () => {
    loadState();

    const ws = getCurrentWorkspace();
    if (!ws || ws.tabs.length === 0) {
        createTab('https://www.google.com');
    } else {
        restoreTabs();
    }

    renderWorkspaces();

    // Hide menus on global click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu') && !e.target.closest('.modal-overlay')) {
            document.getElementById('contextMenu').style.display = 'none';
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

    // --- PERMISSION RESPONSE HANDLERS ---
    document.getElementById('permAllowBtn').addEventListener('click', () => {
        respondPermission(true);
    });
    document.getElementById('permDenyBtn').addEventListener('click', () => {
        respondPermission(false);
    });
});

// --- WORKSPACES ---
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
        alert("Please enter a valid name.");
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

        // Add delete icon (prevent click propagation so it doesn't switch workspace)
        div.innerHTML = `
            <i class="fa-solid fa-folder"></i>
            <span style="flex:1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ws.name}</span>
            <i class="fa-solid fa-trash ws-delete-btn" onclick="event.stopPropagation(); deleteWorkspace(${ws.id})"></i>
        `;

        div.onclick = () => switchWorkspace(ws.id);
        list.appendChild(div);
    });
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

// --- TABS ---
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

    // History Logic
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

    // FIX 1: Context Menu Logic with Correct Positioning
    webview.addEventListener('context-menu', (e) => {
        e.preventDefault();

        // Get Link if clicked
        contextLinkUrl = e.params.linkURL || e.srcElement.src || tab.url;

        // Position Menu - FIX: Use getBoundingClientRect for accurate positioning
        const menu = document.getElementById('contextMenu');
        const viewport = document.getElementById('viewport');

        // Get the actual viewport position relative to the viewport
        const viewportRect = viewport.getBoundingClientRect();

        // Calculate screen position relative to the window
        // e.params.x and e.params.y are relative to the webview
        const x = e.params.x + viewportRect.left;
        const y = e.params.y + viewportRect.top;

        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.display = 'block';

        // FIX 2: Ensure menu doesn't go off-screen
        const menuRect = menu.getBoundingClientRect();
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        // Adjust if menu goes off the right edge
        if (x + menuRect.width > screenWidth) {
            menu.style.left = (x - menuRect.width) + 'px';
        }

        // Adjust if menu goes off the bottom edge
        if (y + menuRect.height > screenHeight) {
            menu.style.top = (y - menuRect.height) + 'px';
        }
    });

    // Permission Request Handling
    webview.addEventListener('permission-request', async (e) => {
        e.preventDefault();

        const permissionRequest = {
            id: Date.now(),
            tabId: tab.id,
            permissionType: e.permission,
            url: tab.url,
            timestamp: Date.now()
        };

        // Check if we have a saved decision for this domain
        const domain = new URL(tab.url).hostname;
        const savedPermission = permissions.find(p =>
            p.domain === domain && p.type === e.permission
        );

        if (savedPermission) {
            // Use saved decision
            const webviewEl = document.getElementById(`view-${tab.id}`);
            if (webviewEl) {
                webviewEl.send(e.requestId);
            }
        } else {
            // Show permission modal
            showPermissionModal(permissionRequest, e.requestId);
        }
    });

    // Download Handling
    webview.addEventListener('did-start-loading', () => {
        // Can show loading indicator here
    });

    webview.addEventListener('did-finish-load', () => {
        // Hide loading indicator here
    });

    webview.addEventListener('will-navigate', (e) => {
        // Track navigation for downloads
    });

    viewport.appendChild(webview);
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

function renderTabs() {
    const bar = document.getElementById('tabBar');
    const btn = bar.querySelector('.new-tab-btn');
    bar.innerHTML = '';

    const ws = getCurrentWorkspace();
    ws.tabs.forEach(tab => {
        const el = document.createElement('div');
        el.className = `tab ${tab.id === state.activeTabId ? 'active' : ''}`;
        el.innerHTML = `
            <span class="tab-title">${tab.title}</span>
            <span class="tab-close" onclick="closeTab(event, ${tab.id})"><i class="fa-solid fa-xmark"></i></span>
        `;
        el.onclick = () => switchTab(tab.id);
        bar.appendChild(el);
    });
    bar.appendChild(btn);
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

// --- HISTORY FUNCTIONS ---
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

// --- CONTEXT MENU FUNCTIONS ---
function copyUrl() {
    if(contextLinkUrl) {
        navigator.clipboard.writeText(contextLinkUrl);
    }
}

function openNewTab() {
    if(contextLinkUrl) {
        createTab(contextLinkUrl);
    }
}

function inspect() {
    alert("DevTools are disabled for security/design purposes.");
}

// --- PERMISSION MANAGEMENT ---
function showPermissionModal(request, requestId) {
    const modal = document.getElementById('permModal');
    const title = document.getElementById('permTitle');
    const urlDisplay = document.getElementById('permUrl');
    const typeDisplay = document.getElementById('permType');

    // Permission type labels
    const permissionLabels = {
        'media': 'Access your camera/microphone',
        'geolocation': 'Access your location',
        'notifications': 'Show notifications',
        'midi': 'Access MIDI devices',
        'clipboard': 'Access clipboard'
    };

    title.textContent = 'Permission Request';
    urlDisplay.textContent = request.url;
    typeDisplay.textContent = permissionLabels[request.permissionType] || request.permissionType;

    modal.dataset.requestId = requestId;
    modal.dataset.tabId = request.tabId;
    modal.dataset.permissionType = request.permissionType;

    // Show "Remember this choice" option
    document.getElementById('permRemember').value = 'false';
    modal.style.display = 'flex';
}

async function respondPermission(allowed) {
    const modal = document.getElementById('permModal');
    const requestId = modal.dataset.requestId;
    const tabId = parseInt(modal.dataset.tabId);
    const permissionType = modal.dataset.permissionType;
    const remember = document.getElementById('permRemember').value === 'true';

    const webviewEl = document.getElementById(`view-${tabId}`);
    if (webviewEl) {
        if (allowed) {
            webviewEl.send(requestId);
        }
    }

    // Save permission if "Remember" is checked
    if (remember) {
        const tab = getCurrentWorkspace().tabs.find(t => t.id === tabId);
        if (tab) {
            const domain = new URL(tab.url).hostname;

            permissions.push({
                domain: domain,
                type: permissionType,
                allowed: allowed,
                timestamp: Date.now()
            });

            savePermissions();
        }
    }

    modal.style.display = 'none';
}

function togglePermissionsPanel() {
    const modal = document.getElementById('permissionsPanel');
    if (modal.style.display === 'flex') {
        modal.style.display = 'none';
    } else {
        modal.style.display = 'flex';
        renderPermissionsList();
    }
}

function renderPermissionsList() {
    const list = document.getElementById('permList');
    list.innerHTML = '';

    if (permissions.length === 0) {
        list.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">No saved permissions</div>';
        return;
    }

    permissions.forEach((perm, index) => {
        const div = document.createElement('div');
        div.className = 'perm-item';
        div.innerHTML = `
            <div>
                <div style="font-weight: bold; color: ${perm.allowed ? '#27c93f' : '#ff5f56'}">
                    ${perm.allowed ? 'Allowed' : 'Denied'}
                </div>
                <div style="font-size: 0.8rem; color: #aaa;">${perm.type}</div>
                <div style="font-size: 0.7rem; color: #666;">${perm.domain}</div>
            </div>
            <button class="btn-delete" onclick="deletePermission(${index})">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;
        list.appendChild(div);
    });
}

function deletePermission(index) {
    permissions.splice(index, 1);
    savePermissions();
    renderPermissionsList();
}

function clearAllPermissions() {
    if (confirm('Are you sure you want to clear all saved permissions?')) {
        permissions = [];
        savePermissions();
        renderPermissionsList();
    }
}

// --- DOWNLOAD MANAGEMENT ---
async function startDownload(url, filename = null) {
    const downloadId = Date.now();
    const download = {
        id: downloadId,
        url: url,
        filename: filename || url.split('/').pop() || 'download',
        filePath: null,
        totalBytes: 0,
        receivedBytes: 0,
        state: 'progressing', // progressing, completed, cancelled, interrupted
        savePath: null,
        timestamp: Date.now()
    };

    downloads.unshift(download);
    saveDownloads();
    renderDownloads();

    try {
        const result = await window.electronAPI.downloadFile(url, {
            savePath: `${window.electronAPI.getDownloadsPath()}/${download.filename}`,
            saveAs: true // Show save as dialog
        });

        if (result.success) {
            download.state = 'completed';
            download.savePath = result.filePath;
        } else {
            download.state = 'interrupted';
            download.error = result.error;
        }
    } catch (error) {
        download.state = 'interrupted';
        download.error = error.message;
    }

    saveDownloads();
    renderDownloads();
}

function cancelDownload(id) {
    window.electronAPI.cancelDownload(id);

    const download = downloads.find(d => d.id === id);
    if (download) {
        download.state = 'cancelled';
        saveDownloads();
        renderDownloads();
    }
}

function openDownload(id) {
    const download = downloads.find(d => d.id === id);
    if (download && download.savePath) {
        window.electronAPI.openPath(download.savePath);
    }
}

function showInFolder(id) {
    const download = downloads.find(d => d.id === id);
    if (download && download.savePath) {
        window.electronAPI.showItemInFolder(download.savePath);
    }
}

function deleteDownload(id) {
    const index = downloads.findIndex(d => d.id === id);
    if (index !== -1) {
        downloads.splice(index, 1);
        saveDownloads();
        renderDownloads();
    }
}

function clearDownloads() {
    // Clear completed downloads
    downloads = downloads.filter(d => d.state !== 'completed');
    saveDownloads();
    renderDownloads();
}

function toggleDownloadsPanel() {
    const panel = document.getElementById('downloadsPanel');
    if (panel.style.display === 'flex') {
        panel.style.display = 'none';
    } else {
        panel.style.display = 'flex';
        renderDownloads();
    }
}

function renderDownloads() {
    const list = document.getElementById('downloadsList');
    list.innerHTML = '';

    if (downloads.length === 0) {
        list.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">No downloads</div>';
        return;
    }

    downloads.forEach(download => {
        const div = document.createElement('div');
        div.className = 'download-item';

        const statusIcon = download.state === 'completed' ? 'fa-check-circle' :
                           download.state === 'cancelled' ? 'fa-times-circle' :
                           download.state === 'interrupted' ? 'fa-exclamation-circle' :
                           'fa-spinner fa-spin';

        const statusColor = download.state === 'completed' ? '#27c93f' :
                            download.state === 'cancelled' ? '#ff5f56' :
                            download.state === 'interrupted' ? '#ffbd2e' :
                            '#666';

        const progress = download.totalBytes > 0 ?
            Math.round((download.receivedBytes / download.totalBytes) * 100) : 0;

        div.innerHTML = `
            <div class="download-info">
                <div class="download-filename">
                    <i class="fa-solid ${statusIcon}" style="color: ${statusColor}; margin-right: 8px;"></i>
                    ${download.filename}
                </div>
                <div class="download-meta">
                    ${download.state === 'progressing' ?
                        `<span>${progress}%</span>` :
                        `<span>${download.state}</span>`
                    }
                    ${download.savePath ? `<span>• ${download.savePath}</span>` : ''}
                </div>
            </div>
            <div class="download-actions">
                ${download.state === 'progressing' ?
                    `<button class="btn-icon" onclick="cancelDownload(${download.id})">
                        <i class="fa-solid fa-xmark"></i>
                    </button>` :
                    download.state === 'completed' ?
                    `<button class="btn-icon" onclick="openDownload(${download.id})" title="Open">
                        <i class="fa-solid fa-folder-open"></i>
                    </button>
                    <button class="btn-icon" onclick="showInFolder(${download.id})" title="Show in Folder">
                        <i class="fa-solid fa-folder"></i>
                    </button>` :
                    ''
                }
                <button class="btn-icon" onclick="deleteDownload(${download.id})" title="Remove">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
        list.appendChild(div);
    });
}

// Handle download progress updates from main process
window.electronAPI.onDownloadProgress((event, progress) => {
    const download = downloads.find(d => d.id === progress.id);
    if (download) {
        download.receivedBytes = progress.receivedBytes;
        download.totalBytes = progress.totalBytes;
        download.state = progress.state;

        if (progress.savePath) {
            download.savePath = progress.savePath;
        }

        saveDownloads();
        renderDownloads();
    }
});

// --- EXTENSION INSTALLATION ---
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
