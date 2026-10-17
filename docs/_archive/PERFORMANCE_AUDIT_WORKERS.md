# Аудит производительности и надёжности: workers (Cloudflare DO)

Дата: 2026-09-02
Объём: `workers/src/**` (game-room, lobby-room, state-broadcast, action-router, supabase,
catalog, game-engine/*, protocol, index).

Стек: Cloudflare Workers + Durable Objects (DO) + WebSocket Hibernation + Supabase (REST RPC)
+ Cloudflare KV (catalog). TypeScript 5, ESM.

---

## 1. Оценка производительности и стоимости

### 1.1 Бандл и cold-start

- `workers/src/index.ts` — 135 строк, обрабатывает маршруты `/health`, `/catalog/*`,
  `/game/:id/ws`, `/lobby/:id/ws`, `/lobby/:id/notify`.
- DO-классы GameRoom (675 строк) и LobbyRoom (252 строки) — основная бизнес-логика.
- Engine (`game-engine/`) — чистые pure-функции, ~1500 строк, инстанс-per-isolate,
  детерминированные тесты.

Тяжёлых зависимостей нет (только `cloudflare:workers` + встроенный fetch). Размер
бандла Worker < 200 KB — ок для бесплатного плана.

### 1.2 Стоимость вызовов Supabase

| Операция | Стоимость | Частота |
|---|---|---|
| `get_player_game_state` RPC | 1 REST POST | на каждый WS join (~1/игра) |
| `get_full_game_state` RPC | 1 REST POST | на loadGame + на rehydrate после eviction |
| `saveFullGameState` REST PATCH | 1 REST POST | каждые 5 actions + gameFinished |
| `assertPlayerInLobby` (lobby_players select) | 1 REST GET | на каждый WS join в лобби |
| `fetchLobbySnapshot` (lobbies + lobby_players + deck) | 1 REST GET | на join + на каждое lobby-action |
| RPC каждого lobby-action (`set_lobby_player_ready`, `leave_lobby`, …) | 1 POST | на каждое действие |
| `catalog` (KV) | 1 KV read | на каждый catalog endpoint; in-memory TTL 60s |

**Главная находка**: `buildBroadcastState` (game-room.ts:437-471) делает **по 1 buildBroadcastState
на каждого живого клиента** при каждом action. Для 4 игроков это 4 разных state-объекта
на одно действие (потому что redactForViewer / revealForViewer пересоздают объекты).
Это 4 разных сериализации JSON + 4 ws.send(). Допустимо, но не оптимально — дельты
были бы в ~10-50× меньше.

### 1.3 Стоимость WS-памяти

- В Durable Object все `ctx.getWebSockets()` хранятся в памяти, пока соединение живо.
  Hibernate-API освобождает JS-память после `webSocketClose` / `webSocketError`.
- Состояние `currentGame` — единичный объект в DO, размер зависит от количества карт:
  4 игрока × (5 hand + 20 deck + 4 zones × 2 cards + 5 discard) ≈ 140 карт.
  Каждая карта ~200-500 байт JSON → ~50-70 КБ JSON-стек на DO.
- Проблема: `loadGame()` (game-room.ts:272-281) кешируется флагом `currentGame`, но
  eviction DO может сбросить этот флаг — после rehydrate он загружает заново.

### 1.4 Game-engine (чистые функции)

Производительность engine высокая (~0.1-1ms на action для 4 игроков), но есть проблемы:
- `players.map(p => fn(p))` на каждом мутирующем методе — O(N) на копию.
  На 4 игроках это не проблема; при расширении до 8-16 станет узким местом.
- `endTurn` (turn.ts:94) делает 4 `resolveAttack` последовательно — можно батчить,
  но движок чистый, батчинг только усложнит тестируемость.
- Никакого in-memory кеша производных (alive players, current_player_index). Для
  hot-path `endTurn` это +O(N) каждый ход.

### 1.5 Snapshot-персистентность

- `SNAPSHOT_EVERY_N_ACTIONS = 5` — каждые 5 action'ов DO делает PATCH games.
- При длительной партии (200+ ходов) — 40+ PATCH'ей, по ~50-70 КБ каждый = 2-3 МБ egress.
- Альтернативы:
  - snapshot только в конце хода + gameFinished;
  - delta patches (UPDATE SET ... = jsonb_set);
  - background alarm API.

---

## 2. Детальный анализ

### 2.1 state-broadcast.ts

```
buildBroadcastState(game, viewerId)
  → game.players.map(p => ({...base, hand_count, deck_pile_count}))
```

Проблемы:
1. **Spread** на каждом игроке создаёт новый объект. На 4 игроках = 4 новых объекта на
   каждый action. Сейчас не критично (JSON.stringify оптимизирует), но:
2. **Нет дельт.** Полный снимок ~30-50 КБ JSON на каждый push. При серии быстрых
   действий — заметная нагрузка на egress Supabase (если DO не использует Durable
   Object storage) и на клиентский reconcile.
3. **`hand_count` / `deck_pile_count` дублируют `hand.length` / `deck_pile.length`** —
   эти поля на фронте уже не нужны (там есть `hand_count` через safePlayer).

### 2.2 game-room.ts

Сильные стороны:
- ✅ `webSocketMessage` корректно работает с DO Hibernation (request захвачен в
  attachment один раз).
- ✅ Engine action через applyAction, не RPC — никаких лишних round-trip'ов.
- ✅ Rehydrate на action после eviction — нет «silently failing for others».

Слабые:
1. **`currentGame` инвалидируется после каждого DO eviction**, но **нет `blockConcurrencyWhile`**
   для синхронизации `loadGame`. Два join'а в одном тике могут параллельно прочитать
   Supabase (race condition на первой загрузке).
2. **`broadcastPersonalizedStates`** (game-room.ts:437-471) запускает `Promise.all`
   для каждого сокета, но каждый ивент внутри последовательно:
   - buildBroadcastState → JSON.stringify → ws.send
   - battle_events JSON.stringify → ws.send
   Это значит, на одно action:
   - 4-8 ws.send() per live socket × 2 событий (state + battle_events) = 8-16 sends.
   На 4 живых игроков = 32-64 ws.send() на действие. Можно батчить в один payload.
3. **`persistSnapshot`** (game-room.ts:321-366) — внутри `JSON.stringify` огромного
   payload. На длинной партии этот PATCH может занимать 50+ КБ.
4. **`getSession` / `getFullGameState` / `persistSnapshot`** — async без timeout'а.
   При зависшей Supabase RPC весь DO-инстанс висит.
5. **`safeSend`** (game-room.ts:258-266) — `try/catch` ловит исключение, но
   `ws.readyState !== 1` может гонка с disconnect между проверкой и send().
6. **`handleAction`** (game-room.ts:374-411) — `broadcastPersonalizedStates` всегда
   вызывается, даже если state не изменился (валидация упала → выбрасываем throw,
   broadcast уже не вызывается, ок).
7. **`SNAPSHOT_EVERY_N_ACTIONS = 5`** — слишком часто. Партия 100 ходов × 4 игрока ×
   5 actions = 80 PATCH'ей = ~4 МБ egress. **Можно поднять до 20 или сделать в конце хода.**

### 2.3 lobby-room.ts

Сильные:
- ✅ Простой WS-lobby без сложного state.
- ✅ Поддерживает hibernation.

Слабые:
1. **`fetchLobbySnapshot`** (lobby-room.ts:180-196) — каждый WS join + каждый action
   делает REST GET с `select=*,lobby_players(*,deck)`. Это JOIN через REST PostgREST —
   медленный endpoint (~50-200 мс). Лучше — RPC или KV-cache с TTL.
2. **`runLobbyAction`** — отдельный RPC на каждое действие (`set_lobby_player_ready`,
   `leave_lobby`, …). На партию в 4 игрока × 5 действий = 20 RPC. Лучше — батч в
   один SQL через RPC.
3. **`broadcastLobby`** — на каждом action делает `fetchLobbySnapshot` снова (не
   кешируется между join и action). Race condition: action 1 изменил → fetch →
   другой action тоже fetch → 2 RPC'а.
4. **`broadcastPresence`** вызывается на каждое close/error — хорошо, но нет
   дедупликации (тот же clientId broadcastится).

### 2.4 action-router.ts

- **`buildRpcArgs`** (action-router.ts:26-88) — **полностью мёртвый код**.
  На фронте actions идут через WS напрямую в GameRoom.applyAction, который НЕ вызывает
  `runGameAction`. Это fallback для HTTP-API, который не используется.
- Поиск использований: только в `protocol.ts` импортируется `GAME_ACTION_RPC`, но
  в коде не вызывается.
- Можно удалить целиком.

### 2.5 supabase.ts

- **`callRpc`** (supabase.ts:14-41) — синхронный POST без timeout'а. Если Supabase
  висит — DO висит.
- **`getPlayerGameState`** (supabase.ts:43-56) — RPC на каждый WS join. Можно
  использовать in-memory cache (5-секундный TTL) для hot rooms.
- **`saveFullGameState`** (supabase.ts:88-106) — не имеет защиты от concurrent calls.
  Если два action'а завершаются в один тик и оба попадают в `actionsSinceSnapshot >= 5`,
  могут быть race conditions (PATCH может перетереться).

### 2.6 catalog.ts

✅ Хороший код:
- In-memory cache с TTL 60s (catalog.ts:33-35).
- Per-isolate cache.

⚠️ Потенциальные проблемы:
1. **`getCardIndex`** (catalog.ts:76-83) — пересоздаёт Map каждый вызов. Если
   hot-path'у нужно резолвить карты по id, можно держать готовый `Map` в кеше.
2. Cache eviction: нет TTL-based очистки. Если в isolate поочерёдно приходят разные
   catalog key'ы — map растёт (но у нас их всего 2).

### 2.7 game-engine/types.ts

✅ Хорошо:
- Типизированные actions, GameState, PlayerState.
- EngineError discriminated union.

⚠️ Проблемы:
1. `Card` interface имеет `[extra: string]: unknown` — это убивает type safety для
   карт. Можно вынести в discriminated union, но для бэкенда это норм (rich payload).
2. **`isEngineError`** (types.ts:159) проверяет только `error` field — но
   ApplyResult может иметь `error` в payload (если оно попадёт). Сейчас нет, но
   fragile.

### 2.8 game-engine/cards.ts / turn.ts / combat.ts

Pure functions, тестируемые, детерминированные. Узких мест нет.

### 2.9 protocol.ts

✅ Чистый typed union. ⚠️:
1. **`battle_events`** содержит `winnerId` (snake_case + camelCase смешаны).
   На фронте ожидается `winnerId` (camelCase).
2. **`requestId` пробрасывается в каждом сообщении** — отлично для корреляции.

### 2.10 index.ts

- ✅ CORS через `withCors` обёртку — корректно копирует headers + body.
- ✅ `/catalog/*` обслуживается из KV (быстро).
- ⚠️ `roomUrl.searchParams.set('gameId', gameId)` — нужно для game-room, чтобы
  internal fetch имел правильный search. Корректно.
- ⚠️ Catalog endpoint **не использует** `withCors` на 503-ошибке — не критично.

---

## 3. Что переделать: приоритеты

### 🔴 Критично (сильно бьёт по стоимости и надёжности)

**K1. Починить race condition в `loadGame`.**
Сейчас два параллельных join'а могут оба прочитать Supabase. Нужен `blockConcurrencyWhile`:
```ts
async loadGameOnce() {
  if (this.currentGame) return
  await this.ctx.blockConcurrencyWhile(async () => {
    if (this.currentGame) return
    // load
  })
}
```

**K2. Починить rehydrate race на action.**
`handleAction` сначала проверяет `if (!this.currentGame) { await this.loadGame() }` —
но между проверкой и await может произойти eviction. Нужен атомарный rehydrate под
`blockConcurrencyWhile`.

**K3. Добавить timeout на Supabase вызовы.**
Если Supabase висит 10 с, DO зависает. Обернуть `fetch` с `AbortController` и
timeout 8 с. На timeout — log + throw.

**K4. Уменьшить частоту snapshot'ов.**
Поднять `SNAPSHOT_EVERY_N_ACTIONS` с 5 до 20. Также snapshot только в конце хода.
Партия 100 ходов × 4 игрока × 5 = 80 PATCH → × 20 = 20 PATCH = −75% egress.

**K5. Починить race в `persistSnapshot`.**
Под `blockConcurrencyWhile`. Два одновременных PATCH'а могут друг друга перетереть.

**K6. Удалить мёртвый `action-router.ts`.**
Никто не вызывает `runGameAction` после миграции на engine в DO.

**K7. Батчить `state` + `battle_events` в один WS frame.**
На каждом action'е два `ws.send()` на одного клиента → один объединённый payload.
4 клиента × 2 sends = 8 sends → 4 sends (−50% нагрузки на WS).

**K8. Кеш `getPlayerGameState` в DO.**
На один и тот же (gameId, clientId) в течение 5 с — отдаём из кеша без RPC.
Игра «hot» в момент своего хода, RPC может вернуть stale version — ок, мы уже
делаем loadGame() один раз.

### 🟠 Важно

**V1. Broadcast delta (частичный).**
Полный snapshot — не всегда нужен. Можно отправлять только `{version, players.affected}`.
Но это breaking change клиентского протокола, лучше оставить как есть (5-секундный
TTL + авто-merge на фронте через `stabilizeGameState`).

**V2. Добавить `winnerId` → `winner_id` алиас в battle_events.**
Сейчас `winnerId` (camelCase) — ok для фронта, но исторически Supabase использует
snake_case. Добавить алиас для совместимости.

**V3. Кеш lobby snapshot (TTL 5с).**
`fetchLobbySnapshot` делает JOIN через PostgREST — медленно. Можно держать
in-memory snapshot с TTL и обновлять при каждом action. На `notify`/`action` —
инвалидировать кеш.

**V4. In-memory card index в DO.**
Пересоздание Map в `getCardIndex` на каждом запросе — мелочь, но `endTurn` +
`resolveAttack` могут вызывать `state.catalog[id]` десятки раз. Завести derived
индекс.

**V5. Action handler должен идемпотентно применять.**
Если клиент повторяет тот же action после reconnect — engine отдаёт другую ошибку
(state уже не тот). Нужен dedup по `requestId`.

### 🟡 Желательно

**D1. Удалить мёртвый код:**
- `action-router.ts` целиком.
- `card` параметр в нескольких местах cards.ts (`getCardLandType`/`getCardCost` —
  если catalog уже в state, можно упростить).

**D2. Перейти на snake_case для Supabase-полей в GameState.**
Сейчас `current_player_id`, `winner_id` — snake_case, ok. Но `current_player_order`
внутри `PlayerState` — это derived, а не Supabase. Не трогать.

**D3. Engine: использует `Math.random` по умолчанию в shuffleDeck.**
Это делает shuffleDeck недетерминированным — если есть hot-path (например, на каждом
end_turn), это норм. Но в тестах нужен seeded rng (есть).

**D4. CI-гейт на бюджет сценариев:**
- PATCH size в persistSnapshot не более X КБ;
- Количество Supabase RPC на один action не более 2;
- Количество ws.send на один action не более N (live players).

---

## 4. Конкретные оценки по чек-листу skills

| Skill | Что проверить | Статус |
|---|---|---|
| `react-performance` | Frontend не оптимизирован по мемо (см. аудит 3D) | ❌ (отдельный аудит) |
| `cloudflare-workers` | Кеш, evict, hibernation, RPC patterns | ⚠️ частично |
| `postgres-patterns` | RPC patterns, indexing | ⚠️ на стороне supabase |
| `error-handling` | timeout, retry, fallback | ❌ нет timeout'ов |
| `caching-patterns` | in-memory TTL caches | ⚠️ только в catalog.ts |

---

## 5. Реализованные исправления

См. коммит-логи. Кратко:

- **K1+K2+K5**: `blockConcurrencyWhile` для loadGame / rehydrate / persistSnapshot
- **K3**: `AbortController` + 8s timeout на все Supabase вызовы
- **K4**: `SNAPSHOT_EVERY_N_ACTIONS = 20`, snapshot в конце хода
- **K6**: удалён `action-router.ts`
- **K7**: объединены `state` + `battle_events` в один payload
- **K8**: in-memory кеш `getPlayerGameState` (TTL 5с)
- **V3**: in-memory кеш lobby snapshot с invalidation

---

(Конец аудита — 230 строк)