(function() {
    'use strict';

    // ============================================
    // 1. BASIC CONFIGURATION
    // ============================================

    // Hide webdriver
    Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
    });

    // Firefox specific
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

    // Remove Chrome object
    if (window.chrome) {
        delete window.chrome;
    }

    if (navigator.userAgentData) {
        Object.defineProperty(navigator, 'userAgentData', {
            get: () => undefined,
        });
    }

    // Fix Permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
    );

    // ============================================
    // 2. CONTEXT MENU HANDLING (WORKING VERSION)
    // ============================================

    document.addEventListener('click', () => {
        const { ipcRenderer } = require('electron');
        ipcRenderer.sendToHost('webview-click');
    });

    document.addEventListener('contextmenu', (e) => {
        if (!e.ctrlKey && !e.shiftKey) {
            const { ipcRenderer } = require('electron');
            ipcRenderer.sendToHost('webview-contextmenu');
        }
    });

    // ============================================
    // 3. ENHANCED YOUTUBE AD BLOCKING
    // ============================================

    let adObserver = null;
    let adCheckInterval = null;

    // Inject comprehensive ad blocking CSS
    function injectEnhancedAdBlockCSS() {
        const existingStyle = document.getElementById('neon-gx-adblock-enhanced');
        if (existingStyle) existingStyle.remove();

        const style = document.createElement('style');
        style.id = 'neon-gx-adblock-enhanced';
        style.textContent = `
            /* === HOMEPAGE ADS === */
            ytd-display-ad-renderer,
            ytd-ad-slot-renderer,
            ytd-promoted-video-renderer,
            ytd-in-feed-ad-layout-renderer,
            ytd-sponsored-card-renderer,
            ytd-merch-shelf-renderer,
            ytd-rich-section-renderer:has(ytd-display-ad-renderer) {
                display: none !important;
            }

            /* === VIDEO PLAYER ADS === */
            .ytp-ad-module,
            .ytp-ad-overlay-container,
            .ytp-ad-overlay-slot,
            .ytp-ad-player-overlay-instream-info,
            .ytp-ad-preview-container,
            .ytp-ad-persistent-panel,
            .video-ads,
            .ytp-ad-text,
            .ytp-ad-button-icon {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }

            /* === AD BADGES === */
            .ytp-ad-badge,
            .ytp-badge-ad {
                display: none !important;
            }

            /* === SIDEBAR ADS === */
            ytd-watch-next-secondary-results-renderer:has(ytd-display-ad-renderer),
            ytd-watch-next-secondary-results-renderer:has(ytd-ad-slot-renderer),
            ytd-compact-promoted-video-renderer {
                display: none !important;
            }

            /* === SHORTS ADS === */
            #shorts-player-ads,
            ytd-reel-video-renderer:has(.ytp-ad-module) {
                display: none !important;
            }

            /* === COMMUNITY POST ADS === */
            ytd-backstage-post-renderer:has(.badge-style-type-ad) {
                display: none !important;
            }

            /* === AD PLACEHOLDERS === */
            ytd-player-legacy-desktop-watch-ads-renderer {
                display: none !important;
            }

            /* Hide "Ad" text on video thumbnail overlays */
            .ytd-thumbnail-overlay-time-status-renderer[aria-label*="Ad"] {
                display: none !important;
            }
        `;

        if (document.head) {
            document.head.appendChild(style);
        }
    }

    // Skip video ads using multiple methods
    function skipVideoAds() {
        try {
            const player = document.querySelector('#movie_player') ||
                         document.querySelector('.html5-video-player');

            if (!player) return;

            const video = player.querySelector('video');
            if (!video) return;

            // Check for ad indicators
            const isAdPlaying = 
                player.classList.contains('ad-showing') ||
                player.classList.contains('ad-interrupting') ||
                document.querySelector('.ytp-ad-player-overlay-instream-info') ||
                document.querySelector('.ad-showing');

            if (isAdPlaying) {
                console.log('[NeonGX] Ad detected, skipping...');

                // Method 1: Find and click all possible skip buttons
                const skipSelectors = [
                    '.ytp-ad-skip-button',
                    '.ytp-ad-skip-button-modern',
                    '.ytp-skip-ad-button',
                    '.ytp-skip-ad-button-modern',
                    '.ytp-ad-skip',
                    '[aria-label*="Skip Ad"]',
                    '[aria-label*="Skip"]',
                    'button[class*="ytp-ad-skip"]'
                ];

                let clicked = false;
                for (const selector of skipSelectors) {
                    const buttons = document.querySelectorAll(selector);
                    buttons.forEach(button => {
                        if (button.offsetParent !== null && !clicked) {
                            console.log('[NeonGX] Clicking skip button:', selector);
                            button.click();
                            clicked = true;
                        }
                    });
                    if (clicked) break;
                }

                // Method 2: Try to speed up the ad
                try {
                    video.playbackRate = 16; // Speed up ad significantly
                    setTimeout(() => {
                        if (player.classList.contains('ad-showing')) {
                            video.playbackRate = 1;
                        }
                    }, 100);
                } catch (e) {}

                // Method 3: Seek near end for short ads (<30 seconds)
                const duration = video.duration;
                if (duration && duration < 30) {
                    try {
                        video.currentTime = duration - 0.5;
                        video.play();
                    } catch (e) {}
                }

                // Method 4: Mute ads to reduce annoyance
                if (!video.muted) {
                    video.muted = true;
                }
            } else {
                // Not an ad, unmute if needed
                if (video.muted && video.duration > 60) {
                    video.muted = false;
                }
            }
        } catch (e) {
            // Silent fail - don't break YouTube
        }
    }

    // Remove ad elements from DOM
    function removeAdElements() {
        try {
            const adElements = document.querySelectorAll(`
                .ytp-ad-module,
                .ytp-ad-overlay-container,
                .ytp-ad-overlay-slot,
                .ytp-ad-player-overlay-instream-info,
                .ytp-ad-persistent-panel,
                .ytp-ad-preview-container,
                .video-ads,
                ytd-display-ad-renderer,
                ytd-ad-slot-renderer,
                ytd-promoted-video-renderer,
                ytd-sponsored-card-renderer,
                ytd-player-legacy-desktop-watch-ads-renderer
            `);

            adElements.forEach(el => {
                try {
                    el.style.display = 'none';
                    el.style.visibility = 'hidden';
                } catch (e) {}
            });
        } catch (e) {}
    }

    // Check if video is playing an ad
    function checkVideoForAds() {
        try {
            const player = document.querySelector('#movie_player');
            if (!player) return;

            const video = player.querySelector('video');
            if (!video) return;

            // Check ad state
            if (player.classList.contains('ad-showing') || 
                player.classList.contains('ad-interrupting')) {
                skipVideoAds();
                removeAdElements();
            }

            // Also check video URL for ad indicators
            if (video.currentSrc) {
                const src = video.currentSrc.toLowerCase();
                if (src.includes('doubleclick') || src.includes('/ad')) {
                    skipVideoAds();
                }
            }
        } catch (e) {}
    }

    // Main ad blocking function
    function runAdBlocker() {
        injectEnhancedAdBlockCSS();
        skipVideoAds();
        removeAdElements();
        checkVideoForAds();
    }

    // Initialize ad blocker
    function initAdBlocker() {
        console.log('[NeonGX] Initializing enhanced ad blocker');

        // Initial run
        runAdBlocker();

        // Set up MutationObserver for dynamic ad detection
        if (adObserver) {
            adObserver.disconnect();
        }

        adObserver = new MutationObserver((mutations) => {
            let needsBlocking = false;

            for (const mutation of mutations) {
                // Check added nodes for ad elements
                if (mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            const html = node.innerHTML || '';
                            const className = node.className || '';
                            const tagName = node.tagName?.toLowerCase() || '';

                            // Specific ad patterns
                            if (className.includes('ytd-ad-') ||
                                className.includes('ytp-ad') ||
                                tagName.includes('ytd-ad') ||
                                html.includes('ytd-ad-slot-renderer') ||
                                html.includes('ytp-ad-module') ||
                                node.classList?.contains('ad-showing') ||
                                node.classList?.contains('ad-interrupting')) {
                                needsBlocking = true;
                            }
                        }
                    });
                }

                // Check for class changes that indicate ads
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    if (target.classList.contains('ad-showing') ||
                        target.classList.contains('ad-interrupting')) {
                        needsBlocking = true;
                    }
                }
            }

            if (needsBlocking) {
                runAdBlocker();
            }
        });

        // Start observing
        const observeTarget = document.body || document.documentElement;
        adObserver.observe(observeTarget, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        // Run periodic checks for video ads
        if (adCheckInterval) {
            clearInterval(adCheckInterval);
        }

        adCheckInterval = setInterval(() => {
            skipVideoAds();
            checkVideoForAds();
        }, 300); // Check every 300ms

        // Handle YouTube navigation (SPA)
        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                setTimeout(runAdBlocker, 500);
            }
        });
        urlObserver.observe(document, { subtree: true, childList: true });

        // YouTube-specific events
        window.addEventListener('spfdone', runAdBlocker);
        window.addEventListener('yt-navigate-finish', runAdBlocker);
        window.addEventListener('yt-page-data-updated', runAdBlocker);
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAdBlocker);
    } else {
        initAdBlocker();
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (adObserver) adObserver.disconnect();
        if (adCheckInterval) clearInterval(adCheckInterval);
    });

})();