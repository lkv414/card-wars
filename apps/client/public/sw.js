// Service Worker for Card Wars v3
// Provides offline shell caching and static asset caching.

const CACHE_VERSION = 'v3.1.148';
const CACHE_NAME = `card-wars-${CACHE_VERSION}`;
const CONTENT_CACHE_NAME = 'card-wars-content-v1';

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME && key !== CONTENT_CACHE_NAME) {
              return caches.delete(key);
            }
            return undefined;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only cache GET requests
  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);

  // Ignore non-http(s) schemes (e.g. chrome-extension:)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // Bypass WebSockets and server-side RPC/API endpoints
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws') ||
    req.headers.get('Upgrade') === 'websocket'
  ) {
    return;
  }

  // 1. Navigation requests (HTML documents) -> Network First with Offline Shell Fallback
  if (req.mode === 'navigate') {
    // In local development, never cache index.html in Service Worker so chunk hashes update immediately
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      event.respondWith(fetch(req));
      return;
    }

    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          return caches.match('/index.html');
        })
    );
    return;
  }

  // 2. Vite hashed assets (/assets/...) -> Cache First (immutable)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const ct = networkRes.headers.get('content-type') || '';
            // Never return or cache HTML SPA fallback for a JavaScript module script request
            if (url.pathname.endsWith('.js') && !ct.includes('javascript')) {
              return new Response('Asset not found', { status: 404, statusText: 'Not Found' });
            }
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        });
      })
    );
    return;
  }

  // 3. Content art scans & portraits (/content/...) -> Cache First in permanent content cache
  if (url.pathname.startsWith('/content/')) {
    event.respondWith(
      caches.open(CONTENT_CACHE_NAME).then(async (contentCache) => {
        const cached = await contentCache.match(req);
        if (cached) return cached;
        return fetch(req).then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            contentCache.put(req, networkRes.clone());
          }
          return networkRes;
        });
      })
    );
    return;
  }

  // 4. Other static assets (icons, manifest) -> Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkRes;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
