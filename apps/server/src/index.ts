// Этап 0: минимальный Worker. Роуты: /health; остальное — статика клиента через assets.
// Этап 2 добавит WebSocket (/ws) и Durable Object Room (docs/TECH.md, «Сервер»).
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response('ok', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler;
