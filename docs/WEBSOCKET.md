# WebSocket game server (Cloudflare Workers)

**Единственный realtime-транспорт** для multiplayer: Cloudflare Workers + Durable Objects. Postgres (Supabase) — source of truth; Worker валидирует RPC и рассылает authoritative `state` / `lobby` всем клиентам без перезагрузки страницы.

## Архитектура (server-authoritative)

```
Browser ──WebSocket──► Worker router ──► GameRoom / LobbyRoom DO
                              │
                              └──► Supabase RPC (service role)
                              └──► broadcast персонализированный state каждому clientId
```

Паттерн как у production multiplayer:

1. Клиент шлёт **intent** (`action`), не мутирует state напрямую
2. Worker применяет RPC атомарно
3. Worker **broadcast** свежий snapshot всем в комнате
4. React обновляет UI через `commitGameState` — без reload
5. Reconnect: auto-rejoin + полный snapshot

## Маршруты

| Path | Назначение |
|------|------------|
| `GET /health` | health check |
| `WS /game/:gameId/ws` | `GameRoom` DO |
| `WS /lobby/:lobbyId/ws` | `LobbyRoom` DO |
| `POST /lobby/:lobbyId/notify` | push snapshot после create/join через REST |

## Локальная разработка

### 1. Секреты Worker

```bash
npm install

npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config workers/wrangler.jsonc
npx wrangler secret put SUPABASE_URL --config workers/wrangler.jsonc
```

Или `workers/.dev.vars` (gitignored):

```
SUPABASE_URL=https://<supabase-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 2. Worker + frontend

```bash
npm run workers:dev
# http://127.0.0.1:8787
```

`.env.local`:

```
VITE_GAME_WS_URL=http://127.0.0.1:8787
```

`VITE_GAME_WS_URL` **обязателен** для lobby и game.

## Протокол

**Client → Server**

```json
{ "type": "join", "clientId": "<guest-uuid>" }
{ "type": "action", "action": "draw_free", "payload": {}, "requestId": "r1" }
```

**Server → Client**

```json
{ "type": "state", "version": 12, "game": { ... } }
{ "type": "lobby", "lobby": { ... } }
{ "type": "presence", "onlineIds": ["uuid1", "uuid2"] }
{ "type": "closed", "reason": "lobby_gone" }
{ "type": "error", "code": "action_failed", "message": "..." }
```

Действия → RPC: [`workers/src/protocol.ts`](../workers/src/protocol.ts).

## Deploy

```bash
npm run workers:deploy
```

Production env:

```
VITE_GAME_WS_URL=https://card-wars-game.<your-subdomain>.workers.dev
```

## Проверка

```bash
npm run workers:check
curl http://127.0.0.1:8787/health
```

WebSocket: `ws://127.0.0.1:8787/game/<game-uuid>/ws` → `{ "type": "join", "clientId": "..." }`.
