# Card Wars

Браузерная карточная игра по мотивам Adventure Time: Card Wars.
React + Cloudflare Workers (Durable Objects). Каталог карт — локальный JSON.

---

## 🚀 Быстрый старт

```bash
npm install
npm run workers:dev      # в отдельном терминале, локальный Worker
npm run dev              # фронт на http://localhost:5173
```

### Локальный режим без Supabase

Включён через `.env.local`:

```env
VITE_OFFLINE_TEST_MODE=true
VITE_LOCAL_WORKER_URL=http://127.0.0.1:8787
```

В этом режиме каталог и тестовая колода берутся из локальных fixtures,
лобби хранится в `LobbyRoom`, а игра — в локальном `GameRoom`.
Кнопка «Тестовая игра без Supabase» доступна в главном меню.

Production bypass не включается: `workers/wrangler.dev.jsonc` используется
только для `npm run workers:dev`.

Подробнее — **[BUILD_ENV.md](./BUILD_ENV.md)** (там и прод-деплой, и troubleshooting).

---

## 🏗️ Архитектура

```
Browser ──WebSocket──► Cloudflare Worker (GameRoom / LobbyRoom Durable Object)
                              │
                              ├── GameRoom: authoritative in-memory game engine
                              └── LobbyRoom: lobby state, players, ready/start
                                    │
                                    └──► Durable Object Storage
                                         (lobby snapshot, no Supabase)

Supabase is used for authentication/catalog/legacy game snapshots only.
Lobby membership and game creation are no longer stored in Supabase.
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
│   ├── lobby-room.ts          Durable Object: LobbyRoom + local/DO lobby snapshot
│   ├── catalog.ts             KV-кэш каталога
│   ├── state-broadcast.ts     fog-of-war broadcast
│   ├── supabase.ts            только game snapshot/auth adapter
│   └── protocol.ts            WebSocket-протокол
├── wrangler.jsonc             production bindings
└── wrangler.dev.jsonc         local bindings + explicit dev bypass

supabase/migrations/           только каталог/аутентификация/legacy совместимость
scripts/                       утилиты миграции (catalog → KV и т.д.)
skills/                        AI-agent skills (см. skills/README.md)
```

---

## 🧪 Тесты

```bash
npm run test:smoke           # Фронт smoke (29 тестов)
npm run lint                 # ESLint
npm run build                # Production build
cd workers && npx vitest run --config vitest.engine.config.ts  # engine (46 тестов)
```

Все тесты должны проходить перед push'ем.

---

## 📚 Skills

Проект использует `skills/` для AI-агентов. Если вы работаете с этим репо через ИИ-помощника (Cursor, Claude Code, ECC и т.д.), агенты читают `skills/` чтобы понять conventions проекта. Подробнее — [`skills/README.md`](./skills/README.md).

---

## 🔐 Безопасность

- **Supabase publishable key** (`VITE_SUPABASE_PUBLISHABLE_KEY`) — публичный по дизайну, безопасен для браузера.
- **Supabase service role key** (`SUPABASE_SERVICE_ROLE_KEY` для Worker) — секретный, хранится в Wrangler secrets, **никогда** не попадает в бандл.
- **RLS** на каталог и legacy game tables — отдельная задача; lobby больше не хранится в Supabase.
- **GameRoom** в production не принимает `x-dev-bypass`; bypass включается только через `wrangler.dev.jsonc`.

> ⚠️ **TODO**: включить RLS на всех таблицах для защиты direct table access (см. `_rules_full.txt`).

---

## 📜 Лицензия и контент

Использует изображения и названия из Adventure Time (Cartoon Network / Warner Bros).
Только для некоммерческого использования.

---

Подробнее о проекте — в `исходники/` и `docs/`.