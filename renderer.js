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
}

function saveState() {
    localStorage.setItem('neonGxState', JSON.stringify(state));
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
    document.addEventListener('click', () => {
        document.getElementById('contextMenu').style.display = 'none';
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
    
    // Fix 5: Context Menu Logic
    webview.addEventListener('context-menu', (e) => {
        e.preventDefault();
        
        // Get Link if clicked
        contextLinkUrl = e.params.linkURL || e.srcElement.src || tab.url;

        // Position Menu
        // We need to add the offset of the viewport (108px top, 240px left)
        const menu = document.getElementById('contextMenu');
        const viewport = document.getElementById('viewport');
        
        // Calculate screen position relative to the window
        // e.params.x is relative to the webview
        const x = e.params.x + viewport.offsetLeft;
        const y = e.params.y + viewport.offsetTop;

        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.display = 'block';
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

// --- FIX 5: CONTEXT MENU FUNCTIONS ---
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
    // Hard to inspect via API in frameless mode easily, but we can alert
    alert("DevTools are disabled for security/design purposes.");
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