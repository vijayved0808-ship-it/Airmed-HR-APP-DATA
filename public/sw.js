// Dummy Service Worker for PWA Installability
self.addEventListener('install', (e) => {
    console.log('[Service Worker] Installed');
});

self.addEventListener('fetch', (e) => {
    // Basic fetch event to pass PWA criteria
});
