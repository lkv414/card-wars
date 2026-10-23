---
name: worker-durable-objects
description: Авторитетная партия в Cloudflare Worker / Durable Object — действия, снимки, протокол с клиентом
metadata:
  audience: developers
  project: card_game
  opencode/autoinvoke: "true"
---

## Что делаю
Меняю серверную логику партии в `workers/src`, сохраняя авторитетность Worker.

## Когда использовать
Изменения в `workers/src/game-room.ts`, `workers/src/game-engine/*`, протокол
действий клиент ↔ Worker.

## Правила
- Worker — единственный источник истины по партии. Клиент не считает исход.
- SQL RPC боя не расширять и не вызывать параллельно с Worker.
- Ably не включать.
- `SNAPSHOT_EVERY_N_ACTIONS = 1` (game-room.ts) не поднимать, пока не закрыт `use_ability`.
- Новое действие: добавить в `payloadToEngineAction`, в `applyAction` и в тест.
  Ответ клиенту содержит `applied` и `reason`.
- Перед деплоем проверять типы: `npx.cmd tsc --noEmit -p workers/tsconfig.json`.
- Не коммитить `workers/.dev.vars` и секреты.

## WebSocket (DooDge, версия v2+)
- Цепочка `index.ts` → `withCors` → `GameRoom.fetch` → `new Response(null, { status: 101, webSocket })`.
- **Правило:** `withCors` НЕ должен навешивать CORS-заголовки на WebSocket-ответы.
  CORS-заголовки ломают handshake (браузер закрывает соединение до `101`).
  Формат: `if (response имеет webSocket) return response;`, иначе навешиваем `CORS_HEADERS`.
- Ниже `withCors` свойство `webSocket` читается через type assertion
  `(response as Response & { webSocket?: WebSocket | null })`.

## Проверка
- `npm run test:engine`
- `npx.cmd tsc --noEmit -p workers/tsconfig.json`
- Для деплоя — через `wrangler`, а не через MCP, если нет явной просьбы.
