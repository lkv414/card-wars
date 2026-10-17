# Card Wars v2 — план рефакторинга и handoff

> Живой документ. Обновляется по ходу работы. Если сессия/контекст оборвётся —
> восстанавливай состояние отсюда, а не из чата.
>
> Последнее обновление: Этап 4 завершён. Следующий — Этап 5.

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
npm run test:smoke     # vitest, smoke-тесты компонентов
npm run test:store     # vitest, store/утилиты
npx vitest run --root workers --config vitest.engine.config.ts   # движок Worker
npm run build
```
- `npm test` — **сломан** (legacy `node --test`), не использовать; переписать на
  vitest в Этапе 8.
- `npm run lint` = `eslint .`. В проекте **есть 2 pre-existing ошибки**
  (`react-hooks/refs` в `src/components/Game/scene/useCardAnimation.js`) и
  несколько warning'ов (PostProcessing, cardFaceModel, gameStatePatch, usePlayCard
  eslint-disable). Они **не наши** — не гоняться за ними в этапах 1–6, разобрать в
  Этапе 4/7 при чистке сцены. `npx eslint src/hooks/game` — чисто.
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
| `src/hooks/useGraphicsSettings.js` | 0 импортов, **но упомянут в `skills/r3f-board-3d`** → ⚠️ открытое решение: удалить или подключить (для эффектов). Спросить пользователя. |
| `src/utils/gameStatePatch.js` — `applyFlipCardPatch`, `applyAttackPatch` | Стали мёртвыми после Этапа 3 (не покрыты тестами). Кандидаты на удаление. |
| `src/utils/gameStatePatch.js` — `applyEndTurnPatch`, `applyDrawPatch`, `normalizeDrawRpcData` | Держатся тестами `gameStatePatch.test.js`, но продукт-мёртвы. Решить: удалить функции+тесты или оставить. |
| `src/hooks/game/format.js` | Оставить только 3 `normalize*`, остальное проверить на использование. |
| `src/hooks/game/useGameState.js` | После Этапа 3 `writeGameState` не нужен действиям; проверить `isApplying`/`error` в `useGameAction`/`GameScreen` → вероятно Этап 5. |

Осознанно **не** тронуто в этом этапе:
- `src/utils/gameStatePatch.test.js` — **осиротевший**: не входит ни в один vitest-конфиг
  (`vitest.store.config.js` его не включает) и тестирует функции, ставшие мёртвыми после
  Этапа 3. Живой в `gameStatePatch.js` только `applyPlayCardPatch`; мёртвые экспорты —
  `applyEndTurnPatch`, `applyDrawPatch`, `normalizeDrawRpcData`,
  `sanitizeDrawRpcDataForSync`, `applyBattleEventPatch`, `applyPlayCardZoneSnapshot`,
  `applyFlipCardPatch`, `applyAttackPatch`. Снести вместе с тестом — Этап 8.
- `src/hooks/game/format.js` — `normalizeZoneRow` и `gameToEngineFormat` имеют 0 внешних
  использований; оставлены (малый риск), добить в Этапе 8.
- `src/hooks/game/useGameState.js` — после Этапа 3 `writeGameState` не нужен действиям;
  проверить `isApplying`/`error` и решить в Этапе 5.

### ⏳ Этап 5 — данные на JSON
- Написать генератор каталога (`scripts/build-catalog.mjs`) → `src/generated/catalog.ts`.
- Переписать `useCatalog`/`useLands`/`useHeroes`/`usePresetDecks` на JSON.
- Убрать цепочку memory→IDB→Worker→Supabase; убрать KV-биндинг и `workers/src/catalog.ts`.
- Убрать `src/utils/supabase.js`, `useGameLoader`/`guestSession` RPC → WS/DO.

### ⏳ Этап 6 — транзитные партии + бот
- `workers/src/game-room.ts`: SQLite только на сессию + cleanup по alarm.
- Бот-псевдо-игрок внутри GameRoom.
- Убрать `supabase.ts`/`persistSnapshot` из DO.

### ⏳ Этап 7 — картинки + skills/docs
- PNG → WebP → `public/cards/`.
- Почистить `skills/` (оставить по делу: `card-wars-rules`, `r3f-board-3d`,
  `worker-durable-objects`, `project-gate`) и `docs/`.

### ⏳ Этап 8 — финальная уборка
- `package.json`: убрать Supabase-зависимости и SQL-скрипты; `npm test` → vitest.
- `README`, единый local mode (без Supabase env).

---

## 4. Как продолжить (resume)

1. Убедиться, что ты на ветке `v2` и дерево чистое: `git status`, `git log --oneline -6`.
2. Прочитать раздел «Этап 4» выше — там готовый список к удалению.
3. Спросить пользователя про `useGraphicsSettings` (удалить или подключить).
4. Удалить подтверждённые мёртвые файлы (`git rm`), обновить `useGameAction`/импорты
   при необходимости.
5. Прогнать тест-гейт (см. §2).
6. Коммит: `refactor(v2): stage 4 - remove dead code`.
7. Перейти к Этапу 5.

### Полезные ориентиры
- Аудит (детали, местами устарел): `docs/_archive/FULL_AUDIT_tester_00005.md`.
- Память проекта (агентская): `.workbuddy-ai/memory/*.md`.
- План cutover (агентский, архивный): `.hermes/plans/local-supabase-cutover.md`.

---

## 5. История коммитов v2 (актуальная)

```
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
| `npm test` сломан (legacy `node --test`) | `package.json` | Этап 8 |
| 2 pre-existing lint-ошибки `react-hooks/refs` | `src/components/Game/scene/useCardAnimation.js` | Этап 4/7 |
| Lint-warning'и (unused `gl`, `useFrame`, eslint-disable, `isFlippedCard`) | PostProcessing, cardFaceModel, gameStatePatch | Этап 4/7 |
| `gameStatePatch.test.js` — осиротевший тест (не входит ни в один vitest-конфиг) + мёртвые экспорты `gameStatePatch.js` | `src/utils/` | Этап 8 |
| `format.js`: `normalizeZoneRow`, `gameToEngineFormat` — 0 использований | `src/hooks/game/format.js` | Этап 8 |
| `useGameState.js`: `writeGameState` больше не нужен действиям | `src/hooks/game/` | Этап 5 |
| Остаточные `supabase.rpc` (основной путь, не фоллбек) | `useGameLoader.js`, `guestSession.js` | Этап 5 |
| `supabase/` (40 файлов) ещё в репо | — | Этап 5 |
| `исходники/` (1932 файла) в индексе | — | по решению пользователя оставлено |
| Картинки 209 МБ PNG | `individual_cards/images/` | Этап 7 |