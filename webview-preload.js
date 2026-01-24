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

    // --- 5. NEW: INJECT COSMETIC CSS (YouTube Cleanup) ---
    // This function injects styles to hide ads visually
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
