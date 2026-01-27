// webview-preload.js

(function() {
    'use strict';

    // 1. Hide webdriver
    Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
    });

    // 2. FIREFOX SPECIFIC
    Object.defineProperty(navigator, 'product', {
        get: () => 'Gecko',
    });
    Object.defineProperty(navigator, 'vendor', {
        get: () => '',
    });

    Object.defineProperty(navigator, 'plugins', {
        get: () => [],
    });

    Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
    });

    Object.defineProperty(navigator, 'platform', {
        get: () => 'Win32',
    });

    // 3. REMOVE CHROME OBJECT
    if (window.chrome) {
        delete window.chrome;
    }

    if (navigator.userAgentData) {
        Object.defineProperty(navigator, 'userAgentData', {
            get: () => undefined,
        });
    }

    // 4. Fix Permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
    );

    // 5. NEW: Hide context menu on click inside webview
    // Listen for clicks anywhere in the webview and notify the main renderer
    document.addEventListener('click', () => {
        // Send message to the embedder (main renderer)
        const { ipcRenderer } = require('electron');
        ipcRenderer.sendToHost('webview-click');
    });

    // Also listen for right-click to handle the case where user right-clicks elsewhere
    document.addEventListener('contextmenu', (e) => {
        // Only send if NOT opening context menu (right-click with no modifiers)
        if (!e.ctrlKey && !e.shiftKey) {
            const { ipcRenderer } = require('electron');
            ipcRenderer.sendToHost('webview-contextmenu');
        }
    });

    // --- 6. INJECT COSMETIC CSS (YouTube Cleanup) ---
    function injectCosmetics() {
        const style = document.createElement('style');
        style.textContent = `
            /* Hide Homepage Ads (Banners, Sidebar) */
            ytd-display-ad-renderer, ytd-ad-slot-renderer, #masthead-ad,
            #player-ads, .ytp-ad-overlay-slot {
                display: none !important;
            }

            /* Hide Video Overlay Ads (The boxes over the video) */
            .ytp-ad-module, .ytp-ad-overlay-image, .ytp-ad-text {
                display: none !important;
            }

            /* Hide "Skip Ad" button related UI if we can't block the video itself */
            .ytp-ad-preview-container {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Run immediately
    if (document.head) {
        injectCosmetics();
    } else {
        document.addEventListener('DOMContentLoaded', injectCosmetics);
    }

})();