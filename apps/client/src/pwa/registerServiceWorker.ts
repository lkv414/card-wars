// Service Worker registration helper

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Avoid Service Worker interception during Vite dev mode
  if (import.meta.env.DEV) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                // New update available
                console.info('[PWA] New version of Card Wars available.');
              } else {
                // Pre-cached for offline use
                console.info('[PWA] Card Wars cached for offline play.');
              }
            }
          };
        };
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
