import { Room } from './room';

export { Room };

interface Env {
  ROOM: DurableObjectNamespace<Room>;
}

// Stage-2 Worker: /health, /ws (WebSocket upgrade routed to the Room DO by code),
// everything else is served by the client static assets binding.
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
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

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/** Room code: exactly `lobbyCodeDigits` digits (docs/CONFIG.md). */
function sanitizeCode(raw: string | null): string | null {
  if (!raw) return null;
  return /^\d{4}$/.test(raw) ? raw : null;
}
