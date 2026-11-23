import { Room } from './room';
import { config } from './config';

export { Room };

interface Env {
  ROOM: DurableObjectNamespace<Room>;
  ASSETS?: Fetcher;
}

// Stage-2 Worker: /health, /ws (WebSocket upgrade routed to the Room DO by code),
// everything else is served by the client static assets binding.
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    if (url.pathname === '/version') {
      return new Response(JSON.stringify({ status: 'ok', service: 'card-wars' }), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      const code = sanitizeCode(url.searchParams.get('code'));
      if (!code) {
        return new Response('Bad code', { status: 400 });
      }
      const room = env.ROOM.getByName(code);
      return room.fetch(request);
    }

    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(request);

      // If an asset was requested but not found (env.ASSETS fell back to index.html),
      // do NOT return text/html for script or style files, which violates browser strict MIME checks.
      if (url.pathname.startsWith('/assets/')) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
          if (url.pathname.endsWith('.js')) {
            const recoveryJs = `
console.warn('[CardWars] Outdated or missing JS chunk requested (' + location.pathname + '), resetting worker and refreshing...');
if (typeof window !== 'undefined') {
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistrations().then(function(regs) {
      for (var i = 0; i < regs.length; i++) {
        regs[i].unregister();
      }
    });
  }
  if (window.caches) {
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() {
      var u = new URL(window.location.href);
      u.searchParams.set('_cw_bust', Date.now().toString());
      window.location.replace(u.toString());
    });
  } else {
    var u = new URL(window.location.href);
    u.searchParams.set('_cw_bust', Date.now().toString());
    window.location.replace(u.toString());
  }
}
export default {};
`;
            return new Response(recoveryJs, {
              status: 200,
              headers: {
                'content-type': 'application/javascript; charset=utf-8',
                'cache-control': 'no-cache, no-store, must-revalidate',
              },
            });
          }
          if (url.pathname.endsWith('.css')) {
            return new Response('/* Missing or outdated stylesheet */', {
              status: 200,
              headers: {
                'content-type': 'text/css; charset=utf-8',
                'cache-control': 'no-cache, no-store, must-revalidate',
              },
            });
          }
        }
      }

      // Ensure root index.html and sw.js are never aggressively cached in dev or between deploys
      if ((url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/sw.js') && res.status === 200) {
        const headers = new Headers(res.headers);
        headers.set('cache-control', 'no-cache, no-store, must-revalidate');
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      }

      if (url.pathname.startsWith('/content/') && res.status === 200) {
        const headers = new Headers(res.headers);
        headers.set('cache-control', 'public, max-age=31536000, immutable');
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      }
      return res;
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/** Room code: exactly `lobbyCodeDigits` digits (docs/CONFIG.md). */
function sanitizeCode(raw: string | null): string | null {
  if (!raw) return null;
  const pattern = new RegExp(`^\\d{${config.lobbyCodeDigits}}$`);
  return pattern.test(raw) ? raw : null;
}
