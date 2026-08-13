# WebSocket game server (Cloudflare Workers)

Realtime и игровые действия через **Cloudflare Workers + Durable Objects**. Postgres (Supabase) пока остаётся source of truth: Worker проксирует RPC, затем рассылает персонализированный `state` каждому игроку.

## Архитектура

```
Browser ──WebSocket──► Worker router ──► GameRoom DO (per gameId)
                              │
                              └──► Supabase RPC (service role)
                              └──► broadcast get_player_game_state per client
```

Маршруты:

| Path | Durable Object |
|------|----------------|
| `GET /health` | health check |
| `WS /game/:gameId/ws` | `GameRoom` |
| `WS /lobby/:lobbyId/ws` | `LobbyRoom` |

## Локальная разработка

### 1. Секреты Worker

```bash
# из корня репозитория
npm install

# Supabase service role — только на Worker, НЕ в Vite
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config workers/wrangler.jsonc

# URL можно задать в wrangler.jsonc vars или secret:
npx wrangler secret put SUPABASE_URL --config workers/wrangler.jsonc
```

Либо создай `workers/.dev.vars` (gitignored):

```
SUPABASE_URL=https://<supabase-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 2. Запуск Worker

```bash
npm run workers:dev
# default: http://127.0.0.1:8787
```

### 3. Frontend

В `.env.local`:

```
VITE_GAME_WS_URL=http://127.0.0.1:8787
```

При заданном `VITE_GAME_WS_URL`:

- **GameScreen** — WebSocket transport ([`useGameTransport`](../src/hooks/useGameTransport.js)), Ably и poll отключены
- **Lobby** — WebSocket transport ([`useLobbyWebSocketTransport`](../src/hooks/useLobbyWebSocketTransport.js))
- Все игровые хуки (`draw`, `play`, `attack`, …) идут через WS → Worker → Supabase RPC

Без `VITE_GAME_WS_URL` — прежний путь: Ably + прямые RPC из браузера.

## Протокол (кратко)

**Client → Server**

```json
{ "type": "join", "clientId": "<guest-uuid>" }
{ "type": "action", "action": "draw_free", "payload": {}, "requestId": "r1" }
```

**Server → Client**

```json
{ "type": "state", "version": 12, "game": { ... } }
{ "type": "error", "code": "action_failed", "message": "..." }
```

Действия `action` → RPC: см. [`workers/src/protocol.ts`](../workers/src/protocol.ts) (`GAME_ACTION_RPC`).

## Deploy

```bash
npm run workers:deploy
```

После деплоя:

```
VITE_GAME_WS_URL=https://card-wars-game.<your-subdomain>.workers.dev
```

## Дальнейшие фазы

1. **Сейчас:** WS transport + RPC proxy (Tier 2)
2. **Далее:** перенос правил в `packages/game-engine` внутри DO (Tier 3)
3. **Выключить:** Ably, client `publishGameSync`, poll fallback

## Проверка

```bash
npm run workers:check
curl http://127.0.0.1:8787/health
```

WebSocket вручную (websocat / browser devtools): подключиться к `ws://127.0.0.1:8787/game/<game-uuid>/ws`, отправить `join`.
