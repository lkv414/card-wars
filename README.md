# Card Wars

Браузерная карточная игра по мотивам Adventure Time: Card Wars.
React + Cloudflare Workers (Durable Objects) + Supabase.

---

## 🚀 Быстрый старт

```bash
npm install
npm run workers:dev      # в отдельном терминале
npm run dev              # фронт на http://localhost:5173
```

Подробнее — **[BUILD_ENV.md](./BUILD_ENV.md)** (там и прод-деплой, и troubleshooting).

---

## 🏗️ Архитектура

```
Browser ──WebSocket──► Cloudflare Worker (GameRoom / LobbyRoom Durable Object)
                              │
                              │ in-memory game-engine (TypeScript, pure)
                              │
                              └──► Supabase (Postgres + Auth)
                                    - cards, lands, decks        (read-only каталог)
                                    - lobbies, lobby_players     (multiplayer social)
                                    - auth.users                  (login)
                                    - match_history              (analytics)
                                    - games.state jsonb           (snapshot каждые 5 действий)
```

Ключевое: **game-engine живёт в Worker'е как чистая TypeScript-функция**.
Supabase RPC (plpgsql) больше не вызывается на горячем пути — только на старте/снапшоте.

---

## 📁 Структура

```
src/                          React + R3F клиент
├── hooks/                     useCatalog, useGameAction, useGameTransport...
├── shared/game-engine/        mirror копия engine для клиентской pre-validation
├── components/
│   ├── Game/                  3D-доска, HUD, replay
│   ├── Lobby/                 мультиплеер-лобби
│   ├── admin/                 админка карт
│   └── DeckBuilder/           редактор колоды
└── utils/                     catalogIdb, gameWebSocket, supabase, ...

workers/                       Cloudflare Worker
├── src/
│   ├── game-engine/           pure TypeScript движок (cards, combat, turn, validation)
│   ├── game-room.ts           Durable Object: GameRoom (WebSocket + in-memory state)
│   ├── lobby-room.ts          Durable Object: LobbyRoom
│   ├── catalog.ts             KV-кэш каталога
│   ├── state-broadcast.ts     fog-of-war broadcast
│   ├── action-router.ts       (legacy) — Supabase RPC
│   └── protocol.ts            WebSocket-протокол
└── wrangler.jsonc             Cloudflare bindings (GameRoom, LobbyRoom, CATALOG KV)

supabase/migrations/           plpgsql-миграции (каталог + legacy RPC + новые state-функции)
scripts/                       утилиты миграции (catalog → KV и т.д.)
skills/                        AI-agent skills (см. skills/README.md)
```

---

## 🧪 Тесты

```bash
npm run test:smoke           # Фронт smoke (29 тестов)
npm run lint                 # ESLint
npm run build                # Production build
cd workers && npx vitest run --config vitest.engine.config.ts  # engine (32 теста)
```

Все тесты должны проходить перед push'ем.

---

## 📚 Skills

Проект использует `skills/` для AI-агентов. Если вы работаете с этим репо через ИИ-помощника (Cursor, Claude Code, ECC и т.д.), агенты читают `skills/` чтобы понять conventions проекта. Подробнее — [`skills/README.md`](./skills/README.md).

---

## 🔐 Безопасность

- **Supabase publishable key** (`VITE_SUPABASE_PUBLISHABLE_KEY`) — публичный по дизайну, безопасен для браузера.
- **Supabase service role key** (`SUPABASE_SERVICE_ROLE_KEY` для Worker) — секретный, хранится в Wrangler secrets, **никогда** не попадает в бандл.
- **RLS** на Supabase таблицах — отложено (см. примечание ниже).

> ⚠️ **TODO**: включить RLS на всех таблицах для защиты direct table access (см. `_rules_full.txt`).

---

## 📜 Лицензия и контент

Использует изображения и названия из Adventure Time (Cartoon Network / Warner Bros).
Только для некоммерческого использования.

---

Подробнее о проекте — в `исходники/` и `docs/`.