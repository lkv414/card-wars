// Service Worker registration helper

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Avoid Service Worker interception during Vite dev mode or local dev (localhost / 127.0.0.1)
  if (import.meta.env.DEV || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // Unregister any active service workers on localhost to prevent stale chunk caching
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    });
    if ('caches' in window) {
      caches.keys().then((keys) => {
        for (const key of keys) {
          caches.delete(key);
        }
      });
    }
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        // If a new worker is waiting, activate it immediately
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                // Activate the new service worker immediately without waiting
                installingWorker.postMessage({ type: 'SKIP_WAITING' });
                console.info('[PWA] Card Wars updated to latest version.');
              } else {
                console.info('[PWA] Card Wars cached for offline play.');
              }
            }
          };
        };

        // Check for updates periodically or on reload
        registration.update().catch(() => {});
      })
      .catch((error) => {
        console.warn('[PWA] Service worker registration failed:', error);
      });
  });
}

export function unregisterServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  navigator.serviceWorker.ready
    .then((registration) => registration.unregister())
    .catch((error) => console.warn('[PWA] Failed to unregister service worker:', error));
}
