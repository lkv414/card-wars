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
