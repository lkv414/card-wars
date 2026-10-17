# Card Wars v2 — план рефакторинга и handoff

> Живой документ. Обновляется по ходу работы. Если сессия/контекст оборвётся —
> восстанавливай состояние отсюда, а не из чата.
>
> Последнее обновление: **Этап 6 сделан** (6a–6d). GameRoom держит сессию в
> SQLite самого DO (Supabase из DO убран), партии транзитные, есть бот-псевдо-игрок
> и вход «Играть против бота» из лобби. Дальше — Этап 8 (уборка Supabase-остатков
> в `package.json`/README) и ревизия каталога (`docs/CATALOG_REVIEW.md`).

---

## 1. Цель

Упростить `card_game` (Card Wars): убрать Supabase (БД/auth/админку), перевести
карты и прочие данные на **локальные JSON**, оставить **Cloudflare Workers +
Durable Objects** как единственный авторитет партии. Никаких параллельных
источников правды.

### Что оставляем
- Cloudflare Workers + DO — авторитет, 2–4 игрока, вся логика партии в движке.
- 3D-доска на React Three Fiber (закладка на эффекты в будущем).
- Редактор колоды, игра против бота, онлайн-мультиплеер, коллекция карт.
- `individual_cards/cards.json` — **единственный source of truth** по картам.

### Что убираем
- Supabase (БД), auth, админка.
- KV-каталог, SQL-фоллбеки боевых действий.
- Мёртвый код, дубли данных, мусор.

### Зафиксированные решения
| Тема | Решение |
|---|---|
| Multiplayer | Workers + DO — авторитет, 2–4 игрока |
| 3D | R3F остаётся |
| Auth + админка | удалить полностью |
| Карты | `cards.json` → сгенерированный каталог-модуль, вшитый в Worker и клиент |
| lands / heroes / presets | локальные JSON |
| Бот | псевдо-игрок внутри GameRoom (тот же движок) |
| Партии | живут только на время сессии; вышел последний игрок → комната удаляется |
| Картинки | PNG → WebP → static assets (`public/cards/`) |

### Ключевое техническое открытие
- Лимит бандла Cloudflare Workers теперь **64 MiB uncompressed** (free и paid,
  с сентября 2026) → каталог `cards.json` (~600 КБ) можно **вшивать модулем**,
  цепочка `Supabase → KV → catalog:migrate` не нужна (KV всё равно был пуст).
- **Картинки — 504 PNG, ~209 МБ** (до 750 КБ каждая) → в бандл не влезают,
  только статика. Отсюда решение WebP → `public/cards/`.
- DO уже на `new_sqlite_classes` → можно хранить партию в SQLite внутри DO и
  отказаться от Supabase-снимков.

### Целевая архитектура
```
individual_cards/cards.json (+ lands/heroes/presets.json)
        │ scripts/build-catalog.mjs   (TODO, Этап 5)
        ▼
   src/generated/catalog.ts ──► Worker (GameRoom/LobbyRoom DO + бот)
        │                              ▲
        └──────────────────────────────┘ WebSocket
        ▼
   Клиент: каталог + игра + колоды(localStorage) + 3D
   Картинки: public/cards/*.webp — static assets
```

---

## 2. Окружение и правила

### Репозиторий / ветки
- Рабочая ветка: **`v2`** (создана от `tester_00005`).
- `main` **не трогать**.
- `v2` никуда **не запушена** — историю можно свободно переписывать
  (уже переписывали автора коммитов).
- Оригинальная ветка сравнения — `tester_00005`.

### Git-идентичность
Ранее репозиторный `.git/config` содержал `[user] name=kereu / email=kereu@local`
и переопределял всё. Теперь локальная секция `[user]` удалена, глобально:
```
user.name  = lkv414
user.email = 82571424+lkv414@users.noreply.github.com
```

### Тест-гейт (обязателен после каждого этапа)
```
npm test               # всё в src/: node:test-файлы + файлы на API vitest
npm run test:smoke     # vitest, smoke-тесты компонентов (.smoke.test.jsx)
npm run test:store     # vitest, store/утилиты (3 файла)
npx vitest run --root workers --config vitest.engine.config.ts   # движок Worker
npm run build
```
- `npm test` **работает**: `scripts/run-unit-tests.mjs` сам раскладывает
  `src/**/*.test.js` по API (node:test vs vitest) и гоняет оба прогона.
  Сейчас: node:test 227 + vitest 26. (В доке раньше было «сломан» — неверно,
  перепроверено 17.10.2026.)
- `npm run lint` = `eslint .`. Остаётся **5 проблем**: 2 pre-existing ошибки
  (`react-hooks/refs` в `src/components/Game/scene/useCardAnimation.js`) и 3 warning'а
  (PostProcessing, cardFaceModel). Они **не наши** — разобрать в Этапе 7.
  (`npx eslint src/hooks/game` — чисто.)
- `npx eslint src workers/src` падает: `workers/src` не покрыт конфигом ESLint —
  линтить только `src`.

### Прочее окружение
- Терминал: Windows PowerShell. Кириллические пути работают только в кавычках.
- Нельзя чейнить команды через `;` с `echo`/`printf` — вывод мусорится
  (ограничение харнесса). Отдельные вызовы.
- Baseline на старте: `test:smoke` 47, `test:store` 26, `test:engine` 51, build ✅.

### Правила работы
- Идти по этапам строго по порядку, после каждого — тест-гейт.
- Удалять только то, что реально перестало использоваться; перед удалением —
  `grep` по имени (аудит местами устарел, пример: `useAbility` жив, хоть аудит
  звал его мёртвым).
- **Worker — единственный авторитет**: любое игровое действие идёт только по WS,
  без SQL-дублей.
- Данные карт — только из `individual_cards/cards.json`, не плодить копии.
- Коммит-сообщения в стиле `refactor(v2): stage N - ...`.
- Не «чинить» тесты ослаблением assert'ов.

### Gotcha
- `исходники/` записан в `.gitignore`, но **1932 файла там реально в индексе**
  (закоммичены раньше правила). `.gitignore` не убирает уже отслеживаемое.
  Сознательно **не** снимаем с отслеживания (решение пользователя).
- `individual_cards/images/` — 504 PNG (~209 МБ), отслеживаются. **Не** игнорируем.
- `.hermes/` — игнорируется и снят с отслеживания (файлы на диске остались).

---

## 3. Состояние по этапам

### ✅ Этап 0 — baseline
Тесты и сборка зелёные (см. выше). `npm test` сломан (известно).

### ✅ Этап 1 — мусор
Коммит `3e05120` (был `111c1bf`):
- удалены `dist/`, `workers/.wrangler/`, `scripts/__pycache__/`;
- `исходники/_json_backup_before_rebuild/`, `исходники/_rebuild_v2/` → `.archive/исходники/`;
- `git rm`: `backups/`, `individual_cards/cards_mapped.json`, `visual-audit-*.json` (6),
  `исходники/cards.clean.json`, `cards.dedup_by_name.json`, `cards.with_mechanics.json`;
- 7 старых доков → `docs/_archive/`.

> ВАЖНО: `исходники/cards.with_mechanics.json` был **фикстурой теста**
> `workers/src/game-engine/mechanics.test.ts`. Тест переведён на
> `individual_cards/cards.json` — дубль остаётся удалённым, engine снова 51 ✅.

### ✅ Этап 2 — админка и auth
Коммит `fd5c8d3` (был `08153ae`), −2421 строк:
- удалены `components/AdminPanel.jsx`, `AdminPanel.smoke.test.jsx`, `CardForm.jsx`,
  `components/admin/*` (AdminBulkEdit, AdminCardTile, AdminFilters, AdminLogin,
  AdminRoute, CardArtEditor), `context/AdminAuthContext*.js`, `useAdminAuth.js`,
  `utils/adminAuth.js`, `adminCardValidation.js(+test)`, `adminCatalogExport.js`,
  `hooks/useCards.js`, `useSupabaseTable.js`, `useCardArt.js`, `styles/admin.css`;
- `LibraryContext.jsx` → `useCatalog('cards')` + `useCatalog('lands')` (без admin-путей);
- `LibraryPages.jsx` → только `DeckBuilderPage`;
- `GameScreen.jsx` → `useCatalog('cards')`;
- `App.css` — убран импорт `admin.css`.

### ✅ Этап 3 — закрыть SQL-фоллбеки
Коммит `2a85fe8` (был `77…`), −971 строк. **Worker — единственный авторитет.**
- 10 хуков `src/hooks/game/*` переписаны в WS-only: `usePlayCard`, `useFlipCard`,
  `useDrawCard`, `useDrawFreeCard`, `useDiscardFromHand`, `useDiscardFromZone`,
  `useShuffleDeck`, `useAttack`, `useTurnControl`, `useLandSetup`.
- Оптимистичные патчи (play_card, end_turn) сохранены; после сбоя WS теперь
  возвращается явная ошибка `«… недоступно (обновите сервер)»`.
- Удалены: `src/utils/featureFlags.js` (`ALLOW_CLIENT_FALLBACK`),
  `src/hooks/game/rpcUtils.ts`, `vitest.supabase.config.js`,
  `tests/supabase/rpc-contract.test.js`.
- Осталось на Этап 5 (НЕ фоллбеки, а основной путь): `supabase.rpc` в
  `src/hooks/game/useGameLoader.js` (`get_player_game_state`) и
  `src/utils/guestSession.js` (`set_guest_id`).

### ✅ Этап 4 — мёртвый код
- удалены `src/shared/game-engine/*` (8 реэкспорт-шимов на `workers/`),
  `src/utils/validateBeforeSend.ts` (0 вызовов), `src/components/Game/hud/HeroAvatar.jsx`
  (0 импортов), `src/hooks/game/useBoardUi.js` (0 импортов, дубль `GameBoard3D`),
  `src/hooks/useGraphicsSettings.js` (0 импортов; строка про него убрана из
  `skills/r3f-board-3d/SKILL.md`);
- из `src/store/gameStore.js` удалён мёртвый селектор `selectIsMyTurn`;
- из `package.json` удалён `test:supabase` (конфиг удалён ещё в Этапе 3);
- `src/components/Game/gameBoard3D/layout.test.js` уже не существовал — переименован
  в `src/utils/gameObjectPlacement.test.js`.

Проверено `grep`'ом (итог — что было мертво):

| Кандидат | Статус |
|---|---|
| `src/shared/game-engine/*` (cards, combat, engine, index, turn, types, utils, validation — 8 файлов) | Мёртво: тонкие реэкспорт-шимы на `workers/`; единственный потребитель — `validateBeforeSend.ts`, который сам мёртв. **Удалить все 8.** |
| `src/utils/validateBeforeSend.ts` | 0 вызовов. **Удалить.** |
| `src/components/Game/hud/HeroAvatar.jsx` | 0 внешних импортов. **Удалить** (или оживить на `HeroBadge`-примитиве — тогда отложить). |
| `src/hooks/game/useBoardUi.js` | 0 импортов, дубль `GameBoard3D`. **Удалить.** |
| `selectIsMyTurn` (`src/store/gameStore.js:277`) | 0 использований. **Удалить.** |
| `src/components/Game/gameBoard3D/layout.test.js` | **Уже не существует** — переименован в `src/utils/gameObjectPlacement.test.js`. Ничего не делать. |
| `src/hooks/useGraphicsSettings.js` | 0 импортов, **но упоминался в `skills/r3f-board-3d`**. Решение пользователя: **удалить** (сделано). |
| `src/utils/gameStatePatch.js` — `applyFlipCardPatch`, `applyAttackPatch` | Мёртвые после Этапа 3 (и без тестов). **Удалено в 4b.** |
| `src/utils/gameStatePatch.js` — `applyEndTurnPatch`, `applyDrawPatch`, `normalizeDrawRpcData` и др. | Продукт-мёртвые после Этапа 3. **Удалено в 4b** вместе с тестами. |
| `src/hooks/game/format.js` | `gameToEngineFormat` удалён, `normalizeZoneRow` сделан внутренним (4b). |
| `src/hooks/game/useGameState.js` | После Этапа 3 `writeGameState` не нужен действиям; проверить `isApplying`/`error` в `useGameAction`/`GameScreen` → вероятно Этап 5. |

### ✅ Этап 4b — остатки мёртвого кода
Коммит `3b98026`, −658 строк:
- `src/utils/gameStatePatch.js` обрезан до единственного живого `applyPlayCardPatch`
  (используется в `usePlayCard.js`). Удалены мёртвые экспорты: `applyEndTurnPatch`,
  `applyDrawPatch`, `normalizeDrawRpcData`, `sanitizeDrawRpcDataForSync`,
  `applyBattleEventPatch`, `applyBattleEventsPatch`, `applyPlayCardZoneSnapshot`,
  `applyFlipCardPatch`, `applyAttackPatch` (+ внутренние helper'ы).
- `src/utils/gameStatePatch.test.js` обрезан до теста `applyPlayCardPatch`.
  (Файл **не** осиротевший — его гоняет `npm test`.)
- `src/hooks/game/format.js`: удалён `gameToEngineFormat` (0 внешних использований),
  `normalizeZoneRow` сделан внутренним (нужен `normalizePlayerZoneRows`).

Остаток на Этап 5: `src/hooks/game/useGameState.js` — после Этапа 3 `writeGameState`
не нужен действиям; проверить `isApplying`/`error` и решить.

### ✅ Этап 5 — данные на локальный JSON (сделан: 5a–5d)

**Итог (что теперь так):**

- Каталог карт — один файл `individual_cards/cards.json` (504 карты), импортируется
  напрямую и клиентом, и Worker'ом: `src/data/catalog.js` (клиент, читает `useCatalog`)
  и `workers/src/catalog.ts` (Worker). Импорт с атрибутом `with { type: 'json' }`
  (требование Node ESM) → `workers/tsconfig.json` получил `resolveJsonModule` и
  `module: ESNext`.
- Земли — не отдельный файл: выводятся из `LAND_DEFS`
  (`src/constants/landColors.js`). `id` земли = её `land_type`
  (`corn`, `ice`, `good`, `swamp`, `sand`, `blue`); таблица `lands` из дампа
  оказалась избыточной (те же названия уже были в коде).
- Герои — `src/data/heroes.json` (23 записи, извлечены из `supabase/full_dump.sql`
  скриптом), `src/data/heroes.js` + `useHeroes` читают их локально, без Supabase.
  `image_url` у героев пустой — как и было в БД, арта героев нет.
- Пресеты **удалены**: из 18 колод дампа ни одна не собиралась против нашего
  `cards.json` (совпадение 18–98%, две колоды пустые). Решение пользователя:
  «сейчас удалим, потом заново сделаем». `usePresetDecks.js` удалён, секция
  «Готовые колоды» и её CSS убраны из `DeckList`.
- KV убран целиком: нет `/catalog/{cards|lands}` в `workers/src/index.ts`, нет
  `CATALOG` в `workers/src/env.d.ts`, нет `kv_namespaces` в `wrangler.jsonc` /
  `wrangler.dev.jsonc`; удалены `scripts/migrate-catalog-to-kv.mjs` и npm-скрипт
  `catalog:migrate`.
- Кэш каталога на клиенте не нужен: удалён `src/utils/catalogIdb.js`,
  `useCatalog`/`useLands` стали синхронными обёртками над локальным модулем
  (API `{ rows, loading, error, reload }` сохранён, `source: 'local'`).
- Коды колод: `id` карт теперь слаги, а не UUID → в `deckCode.js` проверка UUID
  заменена на «непустая строка»; `expandDeckCodeWithCardData` раскрывает код по
  локальному каталогу (без Supabase) и стала синхронной. v1-формат кода (UUID)
  по-прежнему читается.
- Обогащение карт (`enrichGameCards`) полностью локальное: удалены
  `fetchCardsByIds`, `enrichGameStateAsync`, `mergeCatalogMaps`; `useGameEnrichment`
  синхронный, без Supabase.

**Что осталось на Supabase (Это этап 6):** `src/utils/supabase.js`,
`guestSession.js` (`set_guest_id`), `useGameLoader.js` (`get_player_game_state`),
`useGameState.js` (мёртвая запись `writeGameState`), предупреждение в `App.jsx`.

**Что было найдено при разведке (для истории):**

- `individual_cards/cards.json` — 504 карты. `id` — **слаги** (`card-костяная-палочка`),
  не UUID. Ключ: `id, name, card_number, card_type, cost, attack, health, land_type,
  is_rainbow, has_flip, flip_description, description, mechanics, image_url,
  mechanics_version, mechanics_status, image_index`. `image_url` — относительный
  локальный путь (`images/bmo_card_1.png`). `mechanics_status` ∈ {`text_only`, `implemented`}.
- **Данные lands/heroes/presets есть только в Supabase**, но их можно извлечь из
  `supabase/full_dump.sql` (8.9 МБ, INSERT'ы):
  - `public."lands"` — 6 строк (land_type: swamp, ice, sand, blue, corn, good);
  - `public."Heroes"` — hero_number 3001+ (mechanics/script/hero_slug/land_type);
  - `public."preset_decks"`, `public."deck_heroes"`, `public."preset_deck_cards"`;
  - `public."cards"` — те же карты, но с **UUID**-id.
- ⚠️ **Блокер для пресетов:** `preset_deck_cards.card_id` — UUID, а канон-`id` — слаг.
  Нужна карта `uuid → card_number/slug` из INSERT'а `cards` того же дампа.
- Worker-сторона: `workers/src/catalog.ts` (чтение KV), `workers/src/index.ts`
  (`/catalog/{cards|lands}`), `game-room.ts` (`getLands`/`getCardIndex` в строке ~351),
  `workers/src/env.d.ts` (`CATALOG: KVNamespace`), KV-биндинг в `workers/wrangler*.jsonc`.
- Клиент: `src/hooks/useCatalog.js` (memory→IDB→Worker→Supabase, `loadCatalog`,
  `invalidateCatalog`, `useCardsCatalog`, `useLandsCatalog`), `useLands.js` (обёртка),
  `useHeroes.js` (`heroes_v` + `deck_heroes_v`), `usePresetDecks.js`
  (`preset_decks` + вложенные `preset_deck_cards`), `src/utils/supabase.js`.
- Потребители: `GameScreen.jsx`, `LobbyScreen.jsx`, `DeckBuilder.jsx`, `DeckList.jsx`
  (+ их smoke-тесты).
- `LAND_TYPES`/`LAND_DEFS`/`LAND_TYPE_IDS` уже локальны — `src/constants/landColors.js`
  (реэкспорт из `src/constants/game.js`).

**План vs факт (чем реальность отличается от первоначального плана):**

- Планировались `scripts/build-catalog.mjs` → `src/generated/catalog.js` и
  `scripts/extract-supabase-data.mjs`. Реализовано проще: JSON импортируется
  напрямую (`with { type: 'json' }`), генератор не нужен; `heroes.json` извлечён
  одноразовым скриптом (в репо не оставлен).
- Планировалось `land.json` из дампа. Отброшено: `LAND_DEFS` уже канон, дубль не нужен.
- Порядок под-этапов в реализации: 5a (карты + земли + KV), 5b (коды колод +
  обогащение + развязка от supabase-аргументов), 5c (герои + удаление пресетов),
  5d (правка устаревших комментариев про KV в workers).
- 5c в первоначальном плане — «оставшиеся RPC»; они уехали в Этап 6, а освободившийся
  5c заняла работа по героям и пресетам.

**Проверки после каждого под-этапа:** `npm test` 230/230, `npm run test:smoke` 46/46,
`npm run test:store` 26/26, `npm run test:engine` 51/51, `npx vite build` — ok
(предупреждение про размер чанка, `index` вырос до ~782 КБ из-за каталога),
`npx tsc --noEmit -p workers/tsconfig.json` exit 0, `npx eslint src` 0 проблем,
`npm run workers:check` (wrangler dry-run) — 1255.85 KiB, биндингов каталога нет.

**Решения по вопросам планирования (для истории):**

1. **Где хранить JSON:** каталог карт — `individual_cards/cards.json` (source of truth,
   как и было); герои — `src/data/heroes.json`; земли — вообще не файл, а `LAND_DEFS`.
2. **Формат и шаринг:** обычный `.json` с `with { type: 'json' }`; один и тот же файл
   читают и vite (клиент), и esbuild (Worker) — дублей нет.
3. **Как клиент получает каталог:** прямой бандл-импорт (выбор пользователя).
   Цена — рост клиентского бандла (~+0.5 МБ), выигрыш — нет сети/IDB и работает офлайн.
4. **lands:** источник — `LAND_DEFS`; `land_type` дампа совпал с ним один в один.
5. **heroes:** прочитаны из дампа как есть (23 записи); арта нет, пассивки не подключены.
6. **presets:** восстановить нельзя (161 из 392 карт отсутствуют в нашем каталоге) → удалены.
7. **Бот:** пресетов ему не будет; колоду боту собирать в Этапе 6 из `cards.json`.
8. **Кто держит Supabase:** остались `supabase.js`, `useGameLoader`, `useGameState`,
   `guestSession`, `App.jsx` (см. списком выше) — Этап 6.
9. **Порядок:** клиент+Worker вместе (5a) → накопители данных (5b) → герои/пресеты (5c),
   после каждого шага полный тест-гейт.
10. **Тесты:** новый `useCatalog.smoke.test.js` проверяет локальный источник;
    `deckCode.test.js` — слаги вместо UUID; мок `../utils/supabase` убран из
    `DeckBuilder.smoke.test.jsx` (компонент больше не импортирует Supabase).

**Что осталось сделать по каталогу (отдельная задача, решение пользователя):**
перепроверить весь список карт и картинок на корректность (504 карты ↔
`public/cards/*.webp`) — предложить скрипт-ревизию отдельно.

### ✅ Этап 6 — транзитные партии + бот (сделан: 6a–6d)

**Сделано (6d, `881e0fa`):** `LobbyRoom` на `start_game` с `vsBot: true` добавляет
место бота (`bot-<random>`, `is_bot: true`, без колоды) в состав лобби и прокидывает
`is_bot` в состояние партии; `LobbyRoom.jsx` — кнопка «🤖 Играть против бота» для
хоста (нужна только своя колода), счётчики и предупреждения о колодах считают только
людей. `deck.ts`: зона с заглушкой `any` получает землю колоды (иначе правило
размещения запирало руку бота). `scripts/e2e-bot.mjs` + `npm run e2e:bot` — два
сценария на живом Worker.

**Сделано (6c, `e4fad43`):** удалены `src/utils/supabase.js`,
`src/utils/guestSession.js`, `src/hooks/game/useGameState.js`; из 11 action-хуков
убран `ensureGuestId` и мёртвые параметры; `utils/gameWebSocket.js` получил
`fetchGameState(gameId, playerId)` (GET `/game/:id/state`) вместо
`supabase.rpc('get_player_game_state')`; `mapRpcGameState` → `mapGameState`;
`useGameAction` больше не тянет `useGameState` (isApplying/error живут в store);
`App.jsx` без `ensureGuestId` и баннера про `VITE_SUPABASE_*`.

**Сделано (6b, `a5eb8c9`):** `workers/src/deck.ts` (`buildCatalogDeck`,
`fillSeatWithCatalogDeck`, `needsDeck`) — колода из `cards.json`; `workers/src/bot.ts`
(`chooseBotAction`, `findBotId`, `BOT_NICKNAME`); драйвер бота в `game-room.ts`
(`alarm`, `runBotStep`, `BOT_STEP_MS = 900`); багфикс `validation.ts` — `play_card`
проверяет занятость слота, как `playCard` (раньше `validateAction` пропускал, а
движок отказывал).

**Сделано (6a, `283e45e`):** сессия партии — в SQLite самого DO (`ctx.storage`, ключ
`game`), членство — только через нативный lobby DO (`isNativeLobbyMember`), очистка
по alarm (`ROOM_TTL_MS = 30 мин`, `WATCHED_ROOM_RECHECK_MS = 5 мин`), новый маршрут
`GET /game/:gameId/state?playerId=…` (fog of war внутри DO); удалён
`workers/src/supabase.ts`.

**Проверки этапа:**

| Команда | Результат |
| --- | --- |
| `npm test` | 234/234 (node:test) + 26/26 (store) |
| `npm run test:smoke` | 46/46 |
| `npm run test:engine` | 65/65 |
| `npm run test:store` | 26/26 |
| `npx vite build` | ok (только warning о размере чанка, 806 КБ `index`) |
| `npx tsc --noEmit -p workers/tsconfig.json` | exit 0 |
| `npx eslint src` | 0 проблем |
| `npm run workers:check` | 1247.85 KiB, биндингов Supabase/KV нет |
| `npm run e2e:bot` (живой `wrangler dev`) | лобби→бот: бот с колодой 5+15 из каталога, ход бота `2:bot → 7:host`, 3 карты разыграно; `GET /state` → 200 своему, 403 чужому; dev-комната `local-*` — обе колоды из каталога, бот играет |


### ✅ Этап 7 — картинки + lint (7a–7c сделаны; чистка `skills/` отложена по решению)

**Сделано (7c):** `src/utils/cardFaceModel.js` — убран неиспользуемый импорт
`isFlippedCard`; `src/components/Game/scene/PostProcessing.jsx` — убраны
неиспользуемые `useThree`/`gl`. `npx eslint src` → **0 проблем** (exit 0).
Коммит `ca9b309`.

**Сделано (7b):** `scripts/build-card-art.mjs` — 504 PNG (209.6 МБ) → WebP
(q82, max сторона 1024) в `public/cards/` (31.1 МБ, ×6.7). `image_url` в
`individual_cards/cards.json` переписан на `/cards/<stem>.webp`. `individual_cards/images/`
удалён из репо (оригиналы остаются в `исходники/карты/`, 840 файлов). Арт теперь
раздаётся статикой (раньше был 404 → placeholder). Коммит `b4385d1`.

**Сделано (7a):** `src/components/Game/scene/useCardAnimation.js` — сброс
spawn-анимации перенесён из рендера в `useEffect` (закрыты 2 ошибки
`react-hooks/refs`), удалён неиспользуемый импорт `useFrame`. `npx eslint src` →
**0 ошибок** (2 warning'а закрыты в 7c). Коммит `1fe99a6`.

**Арт карт — разведка (нужно решение):**
- `image_url` = `images/bmo_card_1.png` (так пишет
  `scripts/build-individual-card-export.mjs`), но статики нет: `public/` содержит
  только `favicon.svg`, `icons.svg`, `_redirects` (`/* /index.html 200`), а
  `vite.config.js` не переопределяет `publicDir`/`base`. → арт карт сейчас
  **не раздаётся**: `TextureLoader` (`src/utils/textureCache.js`) уходит в
  placeholder, то же для `<img src={image_url}>` (HeroPicker, HeroDisplay,
  DeckModal, GameBoard3D drag-preview).
- Объём: `individual_cards/images/` — 504 PNG, **209.6 МБ**.
- `sharp` доступен (транзитивная зависимость, `require.resolve('sharp')` проходит);
  `magick`/`ffmpeg`/`cwebp`/`sharp-cli` — нет.
- Предложение: `scripts/build-card-art.mjs` → WebP (q≈80, ограничение по большей
  стороне) в `public/cards/*.webp`, переписать `image_url` в `cards.json` на
  `cards/<name>.webp`. Решить: (а) оставлять ли PNG в репо после конвертации;
  (б) ресайз/качество; (в) место (`public/cards/` vs `public/images/`).

**skills/docs — нужно решение:** в `skills/` 70+ файлов (generic `threejs-*`,
`react-*`, `postgres-*` + проектные). План предлагал оставить 4
(`card-wars-rules`, `r3f-board-3d`, `worker-durable-objects`, `project-gate`), но
`threejs-*` релевантны R3F-доске — массовое удаление согласовать. `docs/_archive/*`
оставить как архив.

### ⏳ Этап 8 — финальная уборка
- `package.json`: убрать Supabase-зависимости и SQL-скрипты; `npm test` → vitest.
  (В package.json ещё живут `catalog:mechanics`, `db:push`, `db:schema`, `ocr`,
  ссылающиеся на скрипты Supabase-эпохи.)
- `README`, единый local mode (без Supabase env).

### 📋 Ревизия каталога — отдельная задача (план готов)
`docs/CATALOG_REVIEW.md` + `npm run catalog:audit` (`scripts/catalog-audit.mjs`).
Числа на 2026-10-17: 504 карты, арт структурно чист (504/504, сирот 0), но 177 карт
с неканоническими землями (`rainbow` 78, `plains` 27, `cute` 36, `sandy` 13,
`plain` 8, `cotton` 8, `desert` 7), 15 расхождений «имя ↔ арт», 94 карты группы
`ftg` вообще без сверки, 7 существ без статов, 5 карт `card_type: special`,
механик `implemented` 89 из 504.

---

## 4. Как продолжить (resume)

**Этапы 0–5 сделаны** (Этап 7a–7c — тоже). Дальше — **Этап 6: транзитные партии + бот**.

1. Убедиться, что ты на ветке `v2` и дерево чистое: `git status`, `git log --oneline -6`.
2. Прочитать §3 (состояние этапов) — Этап 5 (готово) и ниже план Этапа 6.

Объём Этапа 6 (что смотреть):
- `workers/src/game-room.ts` — убрать `getFullGameState`/`persistSnapshot`
  (`./supabase.js`), оставить SQLite на сессию DO + cleanup по alarm.
- `workers/src/index.ts` — маршрут загрузки состояния партии (замена
  `supabase.rpc('get_player_game_state')` в `src/hooks/game/useGameLoader.js`).
- Бот-псевдо-игрок внутри GameRoom (колоду собрать из `cards.json`).
- Клиент: удалить `src/utils/supabase.js`, `useGameState.js`, `guestSession.js`,
  предупреждение в `App.jsx`; убрать `gameId`-загрузку через Supabase.

Отдельная задача (после Этапа 6 или параллельно, по желанию):
- Скрипт-ревизия каталога: 504 карты ↔ `public/cards/*.webp`, дубли, битые
  `image_url`, поля `mechanics_status`.

Этап 4b (остатки мёртвого кода) — **сделан**, см. §3.

### Полезные ориентиры
- Аудит (детали, местами устарел): `docs/_archive/FULL_AUDIT_tester_00005.md`.
- Память проекта (агентская): `.workbuddy-ai/memory/*.md`.
- План cutover (агентский, архивный): `.hermes/plans/local-supabase-cutover.md`.

---

## 5. История коммитов v2 (актуальная)

```
881e0fa Этап 6d: игра против бота из лобби + E2E-сценарий
e4fad43 Этап 6c: клиент без Supabase — состояние по HTTP-маршруту GameRoom
a5eb8c9 Этап 6b: бот-псевдо-игрок внутри GameRoom + колода из cards.json
283e45e Этап 6a: GameRoom без Supabase — сессия в SQLite DO, очистка по alarm
06d7ece docs(v2): record stage 5 completion (data on local JSON)
01bf36d test(v2): stage 5 - guard catalog and art consistency
bef2256 docs(v2): stage 5 - drop stale KV catalog comments in workers
1fe595b refactor(v2): stage 5c - heroes from local JSON, remove preset decks
87a829b refactor(v2): stage 5b - deck codes and enrichment read the local catalog
02479b7 refactor(v2): stage 5a - serve cards catalog from bundled JSON, drop KV
ca9b309 refactor(v2): stage 7c - clear remaining lint warnings
6710ede docs(v2): record stage 7b completion
b4385d1 refactor(v2): stage 7b - convert card art to WebP in public/cards, drop PNG originals
53c6db9 docs(v2): journal entry and stage 7 art findings
1fe99a6 refactor(v2): stage 7a - fix scene lint debt in useCardAnimation
79dc330 chore: add docs-journal helper, AGENTS.md and skills index entry
3b98026 refactor(v2): stage 4b - trim dead gameStatePatch exports and format.js
6e0bf49 docs(v2): mark stage 5 as deferred, add planning checklist
b021f5d docs(v2): sync handoff after stage 4 (resume, history, lint debt)
80beeed docs(v2): stage 5 detailed plan and data-source findings
edf7d81 docs(v2): update handoff (stage 4 commit, remaining debt)
6bf18d7 refactor(v2): stage 4 - remove dead code
225e30b docs(v2): add refactor plan and handoff document
199269c chore(v2): ignore .hermes and common build artifacts
2a85fe8 refactor(v2): stage 3 - remove SQL fallbacks, Worker is sole authority
fd5c8d3 refactor(v2): stage 2 - remove admin panel, auth layer, card CRUD
c0ceab9 chore: enable lsp in opencode config
3e05120 chore(v2): stage 1 - drop junk, duplicate card json, stale audits
68fe492 feat: <вершина tester_00005>            ← база ветки
```
Все коммиты v2 — автор `lkv414 <82571424+lkv414@users.noreply.github.com>`.

---

## 6. Известные проблемы / долги

| Проблема | Где | Когда чинить |
|---|---|---|
| 2 pre-existing lint-ошибки `react-hooks/refs` | `src/components/Game/scene/useCardAnimation.js` | ✅ Этап 7a |
| Lint-warning'и (`isFlippedCard`, `gl`, `useFrame`) | `cardFaceModel.js`, `PostProcessing`, `useCardAnimation.js` | ✅ Этап 7c |
| Арт карт: 504 PNG → WebP, 209.6 → 31.1 МБ; PNG удалены | `public/cards/`, `individual_cards/cards.json` | ✅ Этап 7b |
| `useGameState.js`: `writeGameState` больше не нужен действиям | `src/hooks/game/` | ✅ Этап 6c |
| Остаточные `supabase.rpc` (основной путь, не фоллбек) | `useGameLoader.js`, `guestSession.js` | ✅ Этап 6c |
| `supabase/` (40 файлов) ещё в репо | — | Этап 8 |
| Пресеты колод удалены (восстановить из дампа нельзя) | `DeckList.jsx`, `usePresetDecks.js` (удалён) | пересобрать из `cards.json` после ревизии каталога |
| Каталог не сверен с артом: 15 расхождений имени, 94 карты `ftg` без сверки, 177 карт с неканоническими землями, 7 существ без статов | `individual_cards/`, `public/cards/` | 📋 план `docs/CATALOG_REVIEW.md`, аудит `npm run catalog:audit` |
| Остатки Supabase-эпохи в `package.json` (`catalog:mechanics`, `db:push`, `db:schema`, `ocr`) | `package.json`, `scripts/` | Этап 8 |
| Дубликат списка земель: `LAND_TYPE_IDS` (Worker) и `LAND_DEFS` (клиент) + псевдонимы только в `validation.ts` | `workers/src/catalog.ts`, `src/constants/landColors.js` | этап R3 ревизии каталога |
| `getCards()` в Worker не тестируется | `workers/src/catalog.ts` | при удобном случае |
| Дубликат списка земель: `LAND_TYPE_IDS` (Worker) и `LAND_DEFS` (клиент) | `workers/src/catalog.ts`, `src/constants/landColors.js` | при удобном случае |
| `исходники/` (1932 файла) в индексе | — | по решению пользователя оставлено |
| Картинки 209 МБ PNG | `individual_cards/images/` | Этап 7 |