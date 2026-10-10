# Полный аудит `tester_00005` (кончик `17a5786`)

Дата аудита: 2026-10-10. Ветка: `tester_00005`. HEAD: `17a5786 fix: use desktop OpenCode MCP config format`.

Этот файл — **единственный источник правды для всех дальнейших фаз**. Перед каждой фазой
правок его нужно перечитать. Если находка ниже противоречит инструкции «Шаг 2» — побеждает
этот файл; расхождение названо явно в разделе 10.

Все числа в документе получены прогоном по коду и по `individual_cards/cards.json`
(504 карты), а не пересказом `docs/`. Где я опираюсь на `docs/MECHANICS_ENGINE_AUDIT.md`,
`docs/PERFORMANCE_AUDIT_3D.md`, `docs/PERFORMANCE_AUDIT_WORKERS.md` — это отмечено, и в
двух местах эти документы уже расходятся с кодом (см. 6.5 и 4.8).

---

## 0. Состояние рабочего дерева и baseline тестов

Это не «находка», это предусловие: **до начала любых правок снять baseline**, иначе
невозможно отличить регрессию от существующей поломки.

### 0.1. Рабочее дерево грязное

`git status --porcelain` на входе: **1059 записей** (изменённые, удалённые, неотслеживаемые).
В частности не закоммичены: `src/components/Shared/CardDisplay.jsx`,
`src/components/Shared/CardDisplay.css`, `src/components/Game/scene/PostProcessing.jsx`,
`src/components/Game/scene/useCardAnimation.js`, `individual_cards/cards_mapped.json`,
5 × `individual_cards/visual-audit-*.json`. При этом `individual_cards/cards_supabase.sql`,
`individual_cards/mechanics-review.json`, `individual_cards/mechanics_engine_audit.sql`,
`individual_cards/mechanics_schema_v2_draft.sql` и ~540 файлов
`individual_cards/images/0xxx-*.png` — **удалены** (D), а ~500 новых `*.png` — неотслеживаемые.

**Риск:** `CardDisplay.jsx` уже участвует в четырёх компонентах (см. раздел 2) и при этом
не закоммичен. Любая фаза, где этот файл потеряется, ломает колоду, админку, руку и превью
одновременно. **Первое действие фазы 2 — закоммитить текущее состояние отдельным
`chore`-коммитом в `tester_00005`, не трогая `main`.**

### 0.2. Baseline тестов (прогон 2026-10-10)

| Команда | Результат |
|---|---|
| `npm test` (`node --test src/**/*.test.js`) | **УЖЕ СЛОМАН**, 7 файлов падают, 206/213 тестов проходят |
| `npm run test:smoke` (`vitest run`) | 29/29 ✅ |
| `npm run test:store` | 26/26 ✅ |
| `npx vitest run` в `workers/` (`--config vitest.engine.config.ts`) | 50/50 ✅ |

`npm test` падает на всех `.test.js`, которые импортируют соседей **без расширения**
(`./wsQueue`, `./layout.js` и т.п.) — `node --test` не резолвит extensionless ESM.
Те самые файлы проходят под vitest. То есть `npm test` не является рабочей проверкой.

Падающие файлы (проверено):
`src/components/Game/gameBoard3D/layout.test.js`,
`src/hooks/useCatalog.smoke.test.js`,
`src/store/gameStore.test.js`,
`src/utils/cardKey.smoke.test.js`,
`src/utils/sceneResources.smoke.test.js`,
`src/utils/stabilizeGameState.test.js`,
`src/utils/wsQueue.test.js`.

**Отдельно:** `layout.test.js` импортирует `./layout.js`, которого **не существует** —
файл был удалён при слиянии `layout.js` → `gameObjectPlacement.js` (пункт D1 из
`PERFORMANCE_AUDIT_3D.md`), а тест остался. Это не «сломанный раннер», это осиротевший тест.

**Отдель��о:** для `workers/src/game-engine` в `package.json` **нет npm-скрипта**.
Проверка запускается только вручную из каталога `workers/`. Это дыра в CI (см. 10, П1.0).

---

## 1. Карта архитектуры

### 1.1. Слои (сверху вниз)

```
Браузер
├─ App.jsx ─ react-router ─ MainMenu / DeckList / DeckBuilder / AdminPanel
│                            Lobby / GameScreen
├─ Zustand
│   ├─ src/store/gameStore.js   — game + serverVersion + pendingActions (optimistic)
│   └─ src/store/uiStore.js     — тосты, модалки
├─ src/hooks/game/*             — клиентские обёртки над действиями
├─ src/hooks/useLobbyWebSocketTransport.js, useGameTransport.js
├─ src/utils/gameWebSocket.js   — WS-клиент
│
├─ HTTP: GET /catalog/cards|lands  → Worker (KV) → fallback Supabase
│
└─ Cloudflare Worker (workers/src/index.ts)
   ├─ /game/:id/ws   → GameRoom (Durable Object)
   ├─ /lobby/:id/ws  → LobbyRoom (Durable Object)
   ├─ /catalog/*     → workers/src/catalog.ts → KV CATALOG
   └─ GameRoom → workers/src/game-engine/*  (авторитет)
                  ↘ persistSnapshot → Supabase games.state (снимок, не источник)
```

### 1.2. Где считается правило — три разных места

| Слой | Файл | Что решает | Статус |
|---|---|---|---|
| **Клиент (pre-flight)** | `workers/src/game-engine/validation.ts`, зеркало `src/shared/game-engine/validation.ts` | Проверка «можно ли» до отправки | 🟡 жив, но **используется 1 местом** |
| **Клиент (дубли правил)** | `src/hooks/game/format.js:clampZones`, `src/hooks/game/zoneCards.js:canPlayCardToSlot`, `src/utils/cardFields.ts:isLandCompatible`, `src/components/Game/GameBoard3D.jsx:handleRayRelease` | Проверка земли/слота/зоны перед drop | 🟠 жив, продублировано 4× |
| **Worker (авторитет)** | `workers/src/game-engine/{validation,cards,combat,turn}.ts` | Реальное применение | 🟢 единственный авторитет |
| **SQL RPC (legacy)** | `supabase/migrations/*`, `src/hooks/game/*.js` (fallback) | Дубль боя в БД | 🔴 жив, см. 9.1 |

### 1.3. Что живое, что мёртвое

**Живое и рабочее:**
- `workers/src/game-room.ts` — единственный авторитет партии. WS, snapshot, KV-каталог, `rawToGameState`.
- `workers/src/game-engine/*` — чистые функции, покрыты 50 тестами.
- `workers/src/catalog.ts` — чтение KV с per-isolate LRU.
- `src/store/gameStore.js` + `stabilizeGameState` — приём авторитетных снапшотов.
- `src/components/Game/GameBoard3D.jsx` + `scene/*` + `gameBoard3D/*` — 3D-стол.

**Мёртвое (проверено grep'ом по всему `src/`):**

| Файл | Почему мёртв |
|---|---|
| `src/components/Game/hud/HeroAvatar.jsx` | Импортируется **только сам собой** (0 внешних импортов). При этом сам компонент не рисует `hero.image_url` вообще — только имя. |
| `src/utils/validateBeforeSend.ts` | Экспортирует `validateBeforeSend`, который **не вызывается нигде**. Единственный потребитель движка на клиенте — этот файл, и он сам никем не используется. |
| `src/hooks/game/format.js:clampZones`, `normalizePlayerZones`, `gameToEngineFormat` | 0 использований. `format.js` целиком мёртв, кроме `normalizeZoneCards` / `normalizeZoneRow` / `normalizePlayerZoneRows`. |
| `src/store/gameStore.js:selectIsMyTurn` | 0 использований. Более того, он **врёт**: возвращает `current_player_id !== null` («ход существует»), а не «мой ход». |
| `src/hooks/useGraphicsSettings.js` | 0 использований. Отдаёт `shadowsEnabled`/`textureScale`, которые никто не читает. |
| `src/hooks/game/useAbility.js` | 0 использований (см. 4.7) — `use_ability` до UI не доведён. |
| `src/components/Game/scene/FramePump.jsx:useFramePulse` | Экспортируется, 0 использований → анимации в `demand`-режиме не получают кадров (см. 6.4). |
| `src/utils/zoneCards.js:findPlayableZone` | 0 использований. |
| `src/hooks/game/useBoardUi.js` | 0 импортов. Дублирует `GameBoard3D` (тот же `battleEventsToVisuals`, та же логика выделения). Похоже на незавершённый рефакторинг D2. |

**`src/shared/game-engine` — это НЕ второй движок.**

Все 7 файлов `src/shared/game-engine/*.ts` — это **тонкие реэкспорт-шимсы** размером
10–22 строки, которые делают `export { … } from '../../workers/src/game-engine/*.js'`.
Собственной логики в них нет (проверено построчно). То есть задача «не разъезжаются»
**уже выполнена** — разъезда кода нет.

Но есть два реальных дефекта этого зеркала:

1. **`src/shared/game-engine/index.ts` экспортирует не всё.** В нём нет `playCard`,
   `flipCard`, `resolveAttack`, `endTurn`, `canFlipCard`, `cleanupTemporaryEffects`,
   `effectiveAttackForCombat`, `effectiveHealthForCombat`, `activateAbility`,
   `resolveSpell`, `mechanics` из `mechanics-runtime`. Клиентский потребитель
   (`validateBeforeSend`) всё равно мёртв, поэтому дыра пока не стреляет.
2. **Клиент тянет файлы из `workers/` наружу.** `src/utils/validateBeforeSend.ts` →
   `../shared/game-engine/validation.js` → `../../workers/src/game-engine/validation.js`.
   Vite это собирает (корень проекта — общий), но любой будущий `tsc --noEmit` на
   `tsconfig.json` (`include: ["src/**/*"]`) не увидит `workers/**` и не проверит типы.
   Плюс в `workers/src/game-engine/validation.ts` есть импорт `./combat`, а тот — `./mechanics-runtime`,
   а тот — `./types`: в клиентский бандл попадёт весь боевой модуль, если хоть кто-то
   дотянется до `index.ts`.

**Вердикт по разделу 1, задача «кто кого импортирует»:** разъезда нет, но зеркало
неполное, используется в 0.5% проекта и тянет серверный код в клиент. Раздел 10 предлагает
не «сливать два движка», а **удалить мёртвое зеркало целиком** и оставить проверку на
клиенте там, где она реально нужна (см. 10, П2.2) — либо довести её до одного честного
потребителя. Это расходится с ожиданием «Шаг 2.2», и я прямо это фиксирую.

### 1.4. Разделение Supabase / KV

- `supabase/seed/cards_full.sql` — единственный источник для **reseed** таблицы `public.cards`.
- `scripts/migrate-catalog-to-kv.mjs` — `select * from cards` → KV `CATALOG/cards`.
- `workers/src/catalog.ts` → `GameRoom.loadGame()` → `GameState.catalog` (per-isolate кэш, TTL 60 с).
- `blueprint(state, card)` в `mechanics-runtime.ts` = `{...catalog[id], ...card}`.

Проблема: **`catalog:migrate` в этом репозитории не выполнялся.** Проверено напрямую —
`workers/.wrangler/state/v3/kv/miniflare-KVNamespaceObject/*.sqlite`, таблица `_mf_entries`:
**0 строк**. Локально `getCards()` возвращает `[]` → `GameRoom.loadGame` логирует
`catalog hydration failed`/`cardCatalog = {}` → `state.catalog` пуст. Локально механики
не исполняются вообще. Подробности в 4.9.

---

## 2. Инвентарь отрисовки карты

Цель раздела — доказать, что колода, админка, рука, превью и 3D-стол — это **разные
лица одной карты**, и назвать единственное место, куда их слить.

### 2.1. Реестр мест (все найдены)

| # | Файл | Роль | Живой? |
|---|---|---|---|
| F1 | `src/components/Shared/CardTile.jsx` | плитка в библиотеке колоды | 🟢 |
| F2 | `src/components/Shared/CardDisplay.jsx` + `.css` | «единый» компонент карты (новый, не закоммичен) | 🟢 в 4 местах |
| F3 | `src/components/admin/AdminCardTile.jsx` | плитка в админке | 🟢 |
| F4 | `src/components/Game/hud/HUDHand.jsx` | карта в руке | 🟢 |
| F5 | `src/components/Game/hud/CardPreviewModal.jsx` | превью по двойному клику | 🟢 |
| F6 | `src/components/Game/hud/ZoneCardActionMenu.jsx` / `CardActionMenu.jsx` | меню действий | 🟢 / 🟡 |
| F7 | `src/components/CardForm.jsx` (блок `.card-form-preview-*`) | превью в форме админки | 🟢 **отдельное лицо** |
| F8 | `src/utils/cardCompositeTexture.js` + `src/components/Game/scene/GameObject.jsx` | 3D-карта на столе | 🟢 **отдельное лицо** |
| F9 | `src/components/Game/LandSetupOverlay.jsx` | земли в оверлее | 🟢 |
| — | `src/components/Game/Replay.jsx` | **карт не рисует вообще** — только текстовый лог | — |
| — | `src/components/CardGrid.jsx`, `src/components/deck/DeckCardList.jsx` | обёртки над F1, своего дизайна нет | — |

### 2.2. Таблица «поле → кто рисует по-своему»

| Поле | F1 CardTile | F2 CardDisplay | F3 Admin | F4 HUDHand | F5 Preview | F7 CardForm | F8 3D |
|---|---|---|---|---|---|---|---|
| `name` | `item.name` ✅ | `card.name` ✅ | через F2 | — | через F2 | ✅ | через текстуру ✅ |
| `image_url` / `card_url` | `item.card_url \|\| item.image_url` ⚠️ **два имени** | `card.image_url` ⚠️ **одно имя** | через F2 | через F2 | через F2 | `form.image_url` ⚠️ | `resolveCardImageUrl(card)` ✅ |
| `cost` | `item.cost` ⚠️ **сырое поле**, обход `getCardCost` | `getCardCost()` ✅ | через F2 | `getCardCost()` ✅ | через F2 | `form.cost` ⚠️ | `card.cost` ⚠️ **сырое** |
| `attack` | `item.attack` ⚠️ | `getCardAttack()` ✅ | через F2 | — | через F2 | ✅ | `card.attack` ⚠️ |
| `health`/`defense` | `item.health` ⚠️ **только health, `defense` игнорируется** | `getCardHealth()` ✅ (health→defense) | через F2 | — | через F2 | ✅ | `card.health ?? card.defense` ✅ |
| тип карты | `item.card_type === 'creature'` ⚠️ **обходит `getCardType` (`type` не понимает)** | `card.card_type === 'creature'` ⚠️ **то же, хотя импортирует `cardFields`** | через F2 | — | через F2 | `CARD_TYPES[form.card_type]` ✅ | не читается вовсе |
| земля | `item.card_type`-косвенно, `land_type` не используется | `LAND_TYPES[card.land_type]` ⚠️ **не из `landColors.js`** | через F2 | `getLandCardBorder(c.land_type)` ✅ | через F2 | `LAND_TYPES[form.land_type]` ⚠️ | `LAND_TYPE_LABELS` ⚠️ **собственные аббревиатуры CR/IC/GD/SW/SN/BL/\*** |
| флип | нет | только `flip_description` в `mode='full'` ⚠️ **нет `has_flip`, нет угла «перевёрнута»** | флаг-бейдж `Флюп` ✅ | нет | через F2 | ✅ | `canFlip` → значок `↻` ✅ |
| «перевёрнута вниз» | нет | нет | нет | нет | нет | нет | `card.flipped` только в подписи кэша, **не рисуется** |
| герой | нет | нет | нет | нет | нет | нет | нет |
| баффы (`*_bonus`) | нет | нет | нет | нет | нет | нет | нет ⚠️ |
| механики (`mechanics`) | нет | нет | нет | нет | нет | JSON-текстарея | нет |

### 2.3. Доказательство «разные лица одной карты»

**Пять независимых мест читают поля карты напрямую, минуя `src/utils/cardFields.ts`:**

1. `CardTile.jsx:196-201` — `item.cost`, `item.attack`, `item.health`, `item.card_type`.
2. `CardDisplay.jsx:100,106,145,153` — `card.card_type` (хотя `getCardCost/Attack/Health` импортированы из `cardFields.ts` в той же строке 15).
3. `cardCompositeTexture.js:194-198` — `card.cost`, `card.attack`, `card.health ?? card.defense`, `card.land_type`.
4. `GameObject.jsx` — `isFlipped` влияет только на `rotation.z`, но `ZoneColumn` его **не передаёт**.
5. `CardForm.jsx:184,229,265` — `LAND_TYPES`/`CARD_TYPES` из `constants/game.js`.

**Три несогласованных источника земель:**
- `src/constants/game.js:7` `LAND_TYPES` — `{shortLabel, label, icon}` (7 значений).
- `src/constants/landColors.js:7` `LAND_TYPE_COLORS` + `:18` `LAND_CARD_BORDER` — `{fill, emissive, label}` / hex (7 значений).
- `src/utils/cardCompositeTexture.js:71` `LAND_TYPE_LABELS` — 2-буквенные коды `CR/IC/GD/SW/SN/BL/*` (3-е место, ни от чего не зависит).

Три места с разными ключами на одно и то же понятие — `constants/game.js`, `constants/landColors.js`,
`cardCompositeTexture.js`. Плюс `LAND_TYPES` используется в `CardDisplay`, `CardForm`,
`useBoardModel`-соседе; `landColors` — в `GameLand`, `HUDHand`, `PlayFieldGrid`, `TableDecor`,
`resolveCardVisual`-нет.

**Доказательство «смена рамки в одном месте не видна везде»:**
`.card-display` задаёт **свой** `--card-radius: 10px` (`CardDisplay.css:6`), тогда как
`variables.css:44` определяет `--radius: 12px`. `.card-tile-compact` задаёт свой
`--card-width: 120px` (`card-tile.css:172`) против `--card-width: 140px` в `variables.css:13`.
Рамка 3D-карты — `CARD_PLANE` из `sceneResources.js` плюс `Outlines` из drei
(`GameObject.jsx:168,187`). Правка рамки требует минимум 4 правок в 4 файлах.

**Доказательство «3D — это второй дизайн, а не кэш»:**
`cardCompositeTexture.js` содержит собственную палитру `COLORS` (8 цветов: `#FF9800`,
`#F44336`, `#4CAF50`, `#FFC107`, placeholder `#5d4e8a`) и собственные коды земель.
DOM-сторона использует эмодзи `💧 ⚔️ ❤️` (`CardDisplay.jsx:105-110`, `CardTile.jsx:196-201`).
Это два несовместимых визуальных языка для одной карты. Кэш тут ни при чём — кэш
(`MAX_CACHE = 64`, LRU, `disposeEntry`) реализован корректно, но он кэширует **чужой** дизайн.

### 2.4. Единственное место, куда слить

**`src/utils/cardFields.ts`** — единственный файл, который уже существует, уже содержит
нормализацию `card_type|type`, `health|defense`, `getCardCost`, `getCardLandType`,
`isLandCompatible`, и который **уже** импортируется в `zoneCards.js`, `GameBoard3D.jsx`,
`CardDisplay.jsx`, `HUDHand.jsx`. Правильный целевой вид — **один `CardFace`
(`src/components/Shared/CardFace.jsx`)**:

- читает **все** поля **только** через `cardFields.ts`;
- землю/тип/флип/героя берёт **только** из `src/constants/landColors.js` + `LAND_TYPES`
  (после слияния этих двух таблиц в одну);
- 3D-путь **не рисует** карту сам, а **кэширует DOM-отрендеренное лицо** через
  `html-to-image`/`OffscreenCanvas` → `CanvasTexture`, либо (проще и дешевле) 3D
  получает те же `getCardCost/getCardAttack/getCardHealth/getCardLandType`, а палитра
  бейджей переезжает в `landColors.js`.

Ключевое: `cardCompositeTexture` остаётся **кэшем**, но перестаёт быть вторым дизайном —
он рисует ровно те же значения, которые рисует DOM, беря их из `cardFields.ts`.

### 2.5. Что уже сделано и не откатывается

`CardDisplay.jsx` уже подключён в `CardTile` (не-artOnly-ветка), `AdminCardTile`,
`HUDHand`, `CardPreviewModal`. Это правильное направление, его надо довести, а не отменять.
Не тронуты: `cardCompositeTexture`, `ZoneColumn`, `useBoardModel`, `HeroPicker`,
`mechanics-runtime`, JSON каталога.

---

## 3. Модель данных

### 3.1. Сверка источников

| Источник | Поля |
|---|---|
| `public.cards` в **живой БД** (`supabase/full_dump.sql:23`) | `id, card_number, name, description, card_type, cost, attack, health, has_flip, flip_description, mechanics, image_url, created_at, updated_at, land_type, is_rainbow, **rarity**, **source**, **hero**, **notes**` |
| `docs/CURRENT_DB_SCHEMA.sql:6-26` | те же, **кроме** `rarity, source, hero, notes` |
| `individual_cards/cards.json` (504 шт.) | `id, name, card_number, card_type, cost, attack, health, land_type, is_rainbow, has_flip, flip_description, description, mechanics, image_url, mechanics_version, mechanics_status, image_index` |
| `CardForm.jsx:6-24` (`emptyCard`) | `card_number, name, card_type, cost, attack, health, land_type, is_rainbow, has_flip, flip_description, description, image_url, mechanics, **rarity, hero, source, notes**` |
| `src/utils/cardFields.ts` (`CardLike`) | `card_type, type, health, defense, attack` (+ `cost`, `land_type` в сигнатурах) |

**Вывод 3.1 (прямой ответ на вопрос задания):**
`hero`, `rarity`, `source`, `notes` **есть в живой БД и в форме админки**, и **нет ни в
`docs/CURRENT_DB_SCHEMA.sql`, ни в экспорте `individual_cards/cards.json`**. Экспорт их
потерял. `docs/CURRENT_DB_SCHEMA.sql` устарел как минимум на 4 колонки.

### 3.2. Поля, которые есть в JSON/форме, но не работают в игре

| Поле | Где есть | Что в игре |
|---|---|---|
| `rarity` | БД, `CardForm` | **нигде**. Не в `cardFields.ts`, не в рендере, нет фильтра/сортировки. |
| `source` | БД, `CardForm` | **нигде**. `enrichGameCards.js:7` и `deckCode.js:197` его **селектят** — то есть он едет в бандл WS/hand без пользы. |
| `hero` | БД, `CardForm` | Только строковое поле колоды (`decks.heroId`), **не связанно** с `cards.hero`. В игру не попадает (см. 5). |
| `notes` | БД, `CardForm` | нигде. |
| `image_index` | только в `cards.json` | нигде. |
| `mechanics_status`, `mechanics_version` | только в `cards.json` | **не доезжают до БД** — см. 3.3. |

### 3.3. Как карта в руке отличается от карты каталога

Три разных пути доставки полей в игру:

1. **Worker-каталог (KV).** `catalog:migrate` → `select * from public.cards` → все колонки,
   включая `mechanics_status`. Попадает в `GameState.catalog`. *(Локально пусто, см. 1.4.)*
2. **Рука из лобби.** `src/utils/deckCode.js:197` селектит
   `id, card_number, name, description, card_type, cost, attack, health, land_type, is_rainbow, has_flip, flip_description, image_url, mechanics, hero, source`.
   → **`mechanics_status` и `mechanics_version` НЕ селектятся.**
   `lobbyDeck.js:26-37` (`expandSelectionToInstances`) копирует объект целиком + `instanceId`.
3. **Обогащение на клиенте.** `enrichGameCards.js:6-7` — тот же список минус `card_type`
   нет, но с `hero, source`; тоже **без** `mechanics_status/mechanics_version`.

Следствие: `blueprint(state, card)` в `mechanics-runtime.ts:57` для карты из руки имеет
`mechanics_status === undefined`, и проверка `mechanicsFor` (строка 69) пропускает её.
Аналогично клиентский `resolveCardVisual` никогда не видит `mechanics_status`.

**`card_type` vs `type`, `health` vs `defense`:**
`cardFields.ts` их нормализует. Но `enrichGameCards.js:134` уже пишет
`card_type: card.card_type || card.type || db.card_type` — то есть **третий** нормализатор,
дублирующий `getCardType`. И `enrichCard` (строка 124-137) **не трогает** `defense`:
если в БД поле называется `defense`, оно останется `defense`, и `enrichCard` не сольёт
его с `health`. `cardFields.getCardHealth` это спасёт только в тех местах, где он вызывается
(см. 2.2).

### 3.4. Формат `mechanics` — главный разрыв

| Источник | Формат механик |
|---|---|
| `individual_cards/cards.json` | v1-конверт: `{trigger, actions[], conditions[], description, source_text}` |
| Живая БД (`full_dump.sql:23`, `lobby_players.deck`) | **старый**: `{"type":"passive_buff","value":1,"condition":{"type":"count_unique",...}}`, `{"type":"ability","effect":"discard_hand_then_deal_damage","params":{...}}` |
| `scripts/seed-mechanics.mjs` | пишет только `mechanics` из `исходники/cards.with_mechanics.json` |
| `supabase/seed/cards_full.sql` | `INSERT` из `reseed-cards.mjs:49` — **без колонок `mechanics_status` / `mechanics_version`** |

**Что это значит фактически.** Если в БД лежит старый формат, то в рантайме:
- `mechanicsFor` → `array(source.mechanics)` вернёт массив объектов;
- `applyMechanic` прочитает `mechanic.actions` → `undefined` → `array(undefined)` → `[]` → **ничего не выполнится**;
- `findTrigger(mechanic, type)` сравнит `mechanic.trigger` (`'passive'`/`'manual'`) с `MechanicEventType` → **не совпадёт никогда**.

То есть **на старом формате механики молча не делают ничего, но и не падают**.
Это маскирует проблему: «вроде работает, карты ничего не делают».

И обратная сторона: `mechanics_status` в `cards.json` (415 `text_only` / 89 `implemented`)
**не доезжает до БД вообще** — `reseed-cards.mjs` его не пишет, `seed-mechanics.mjs` его
не пишет, миграция `20260924120000` ставит всем `DEFAULT 'unreviewed'`. Только
`build-individual-supabase-sql.mjs:79-100` умеет его писать, но его выход — другой файл.

---

## 4. Каталог и механики

### 4.1. Реальный путь данных (по коду, не по `docs/MECHANICS_ENGINE_AUDIT.md`)

```
исходники/cards.with_mechanics.json
  ├─ parse_mechanics.py → структурированные механики
  ├─ scripts/rebuild-card-json.mjs / build-individual-card-export.mjs
  │     → individual_cards/cards.json          (v1-конверт + mechanics_status)
  ├─ scripts/reseed-cards.mjs → supabase/seed/cards_full.sql
  │     → TRUNCATE public.cards CASCADE + INSERT (БЕЗ mechanics_status/version)
  └─ scripts/seed-mechanics.mjs → supabase/seed/mechanics_data.sql
        → UPDATE public.cards SET mechanics = $mech$…$

public.cards ──(scripts/migrate-catalog-to-kv.mjs, select *)──▶ KV CATALOG['cards']
KV CATALOG ──(workers/src/catalog.ts, per-isolate LRU 60с)──▶ GameState.catalog
GameState.catalog ──(GameRoom.loadGame, blockConcurrencyWhile)──▶ blueprint(state, card)
blueprint ──▶ mechanicsFor() ──▶ applyMechanic() ──▶ applyAction()
```

`docs/MECHANICS_ENGINE_AUDIT.md` частично устарел: он не описывает
`mechanics_status`/`mechanics_version`, снятие проверки статуса и текущую карту target'ов.
Всё ниже — по коду.

### 4.2. Что исполняет `applyAction` (workers/src/game-engine/mechanics-runtime.ts:184-302)

Реализовано **13** типов: `deal_damage`, `aoe_damage`, `face_attack`, `heal`, `draw_cards`,
`discard_cards`, `destroy`, `move`, `return_from_discard`, `stat_buff`, `gain_actions`,
`cost_reduction`, `play_for_free`. Всё остальное уходит в `default: return next` — **молча**.

### 4.3. Что объявлено в `mechanics.ts`, но не исполняется

Объявлено **24** типа. Не исполняются **8** (+`imperative/manual/passive` — это
специально, они не «исполняемые»):

| Тип | Есть в `hydrateAction` | Есть в `applyAction` | В каталоге |
|---|---|---|---|
| `freeze_landscape` | ✅ | ❌ | **10** действий |
| `mill` | ✅ | ❌ | 2 |
| `flip_landscape` | ✅ | ❌ | 2 |
| `search` | ✅ | ❌ | 1 |
| `immunity` | ✅ | ❌ | 1 |
| `peek` | ✅ | ❌ | 1 |
| `flip_ability` | ✅ | ❌ | 0 |
| `ignore_damage` | ✅ | ❌ | 0 |
| `aoe_damage` | ✅ | ✅ | 0 |

**Итого 17 действий в каталоге** относятся к типам, которые рантайм не выполняет.
Они нигде не логируются и не отличаются от «сработало».

### 4.4. Как `conditionAllows` относится к `if` / `while` / `requires`

```ts
// mechanics-runtime.ts:164-172
function conditionAllows(conditions: unknown): boolean {
  if (!Array.isArray(conditions)) return true
  return conditions.every((c) => {
    const condition = object(c)
    return condition.type === 'cost_actions' || condition.type === 'verb'
  })
}
```

Это **whitelist из двух типов**. Всё, чего нет в списке, делает `every()` ложным →
`applyMechanic` (строка 305) **молча возвращает исходное состояние**.

Распределение `conditions` в каталоге: `if` — 55, `cost_actions` — 46, `verb` — 42,
`while` — 21, `prerequisite` — 3.

**Последствие (посчитано): 79 механик из 543 полностью заблокированы** `if`/`while`/`prerequisite`.
Они не исполняются, не логируются и не отличаются в UI от «успеха».

`requires` в коде **отсутствует как отдельный тип** — `mechanics.ts:527-532` объявляет
`cost_actions | prerequisite | verb | if | while`. То есть парсер может выдать `requires`,
и он попадёт в ту же «неизвестную» ветку → блокировка. Гипотеза «`requires` исполняется
как `if`» **не подтверждается кодом**.

### 4.5. `chosen_*` без `targetCardIds`

```ts
// mechanics-runtime.ts:137-148
function targetCards(state, owner, target, targetIds = [], sourceCardId?) {
  if (targetIds.length) return targetIds.map(id => findCard(state, id)).filter(Boolean)
  ...
  case 'chosen_creature':
  case 'chosen_opponent_creature':
  case 'chosen_opponent':
    return []          // ← без targetCardIds цель не разрешается ВООБЩЕ
```

Значит: `chosen_*` **без** `targetCardIds` → `selected = []` → для `deal_damage` срабатывает
ветка «бросить в лицо» (`else if (target.includes('opponent') …)`, строка 207-210):
**урон уходит в героя вместо выбранного существа**. Для `heal`/`destroy`/`stat_buff`/
`move`/`discard_cards` — не происходит ничего.

**Хуже: `if (targetIds.length)` стоит ДО `switch`, поэтому переданные `targetCardIds`
игнорируют селектор целиком.** `validation.ts` (случай `use_ability`, строки 66-75)
проверяет только `mechanicIndex < 0`. Владельность `targetCardIds` **не проверяется нигде**:
`findCard` (строка 97) ищет по всем зонам всех игроков. Итог: клиент может передать
`use_ability` с `targetCardIds` чужих карт и, например, забаффить их или снять им здоровье.
В каталоге `chosen_*` встречается **41** раз (26 `chosen_creature` + 8 `chosen_opponent_creature`
+ 7 `chosen_opponent`), из них `implemented`-карт — 0 напрямую, но путь общий.

### 4.6. `mechanics_status`: `implemented` vs `text_only`

**Смысл по SQL-контракту** (`supabase/migrations/20260924120000_cards_mechanics_runtime_metadata.sql:106-107`):
> `unreviewed` (not executable), `text_only` (not executable), `implemented` (runtime-approved), `disabled`.

**Что делает рантайм** (`mechanics-runtime.ts:62-71`):
```ts
function mechanicsFor(state, card) {
  const source = blueprint(state, card)
  // Status check removed: 'text_only' cards still have valid mechanics data
  // (parsed from card descriptions) that should execute in-game.
  if (source.mechanics_version !== undefined && Number(source.mechanics_version) !== 1) return []
  if (source.mechanics_status === 'disabled') return []
  return array(source.mechanics)
}
```
Проверка статуса **снята намеренно**, комментарий прямо говорит обратное SQL-контракту.
Фактически: исполняется всё, кроме `disabled` и кроме `mechanics_version !== 1`.

**Фактические числа по каталогу:**

| `mechanics_status` | карт | с механиками | всего действий | из них «исполняемых» | карт, где все действия — generic |
|---|---|---|---|---|---|
| `text_only` | **415** | 415 | 470 | **111** | **340** |
| `implemented` | **89** | 78 | 78 | 78 | 0 |
| `unreviewed` / `disabled` | 0 | — | — | — | — |

То есть **415 карт из 504 (82%) сейчас исполняются**, хотя SQL-контракт говорит «не исполнять».

**`implemented` ≠ «работает».** Метка выставляется скриптом
`scripts/assign-mechanics-status.mjs:15-26` — чистый whitelist по JSON:
`supportedActions` (13 типов, совпадает с `switch` в `applyAction`) и
`supportedTriggers` (8 типов), плюс запрет `action.source_type`.
Никакой связи с тестом «механика → состояние» нет. Два следствия:

1. **11 «implemented»-карт имеют `mechanics: []`** (89 − 78) — помечены реализованными вакуумно,
   потому что цикл `for` по пустому массиву не выполняется и `implemented()` возвращает `true`.
2. **`stat_buff` со строковым amount** считается реализованным, но
   `applyAction:290` делает `typeof amount === 'string' ? 0 : Number(amount)` — то есть
   применяет **+0**. В каталоге такой ровно 1 случай (`amount: "equal_to_damage"`),
   и он попадает в `implemented`.

Тест `mechanics-runtime.test.ts:90-102` называется
`does not execute text-only abilities as fake effects`, но проверяет только ветку
`source_type === 'unparsed_description'` (через `isGenericAction`). **Проверки
`mechanics_status` в тестах нет ни одной.**

### 4.7. Триггеры: что вообще может сработать

`dispatchMechanicEvent` (строка 324) принимает `MechanicEventType` из 12 значений.
Фактические точки вызова:

| Триггер | Где диспатчится |
|---|---|
| `on_enters_play` | `cards.ts:161` |
| `on_flip` | `cards.ts:416` |
| `on_draw` | `cards.ts:199`, `cards.ts:228` |
| `end_of_turn` | `turn.ts:114` |
| `on_creature_attacks` | `turn.ts:122`, `engine.ts:105` |
| `start_of_next_turn`, `start_of_turn` | `turn.ts:201-202` |
| `on_damage_dealt` | **никогда** |
| `on_damage_taken` | **никогда** |
| `on_death` | **никогда** |
| `on_discard` | **никогда** |
| `on_line_change` | **никогда** |

А в каталоге: `manual` — **315**, `on_enters_play` — 59, `conditional` — **57**,
`persistent` — **55**, `start_of_turn` — 23, `on_creature_attacks` — 21, `on_line_change` — 6,
`on_flip` — 2, `on_death` — 2, `on_damage_dealt` — 1, `start_of_next_turn` — 1, `on_draw` — 1.

Итог:
- **`conditional` (57) и `persistent` (55) — 112 механик**, чей триггер не существует в
  `MechanicEventType`. Они не сработают **никогда**, ни при каких условиях.
- **`manual` — 315 механик** (58% всех). Единственный путь — `use_ability`.
  `use_ability` реализован в `engine.ts:55-65` и `activateAbility` (строка 346), но
  `src/hooks/game/useAbility.js` **не импортируется ни одним файлом**, а
  `ZoneCardActionMenu`/`CardActionMenu` предлагают только «Флюп» и «В сброс».
  **Клиентского пути к `use_ability` не существует.** Значит 315 механик недостижимы из UI.

### 4.8. Дыры runtime с приоритетом

| # | Дыра | Файл:строка | Приоритет | Последствие |
|---|---|---|---|---|
| M1 | Снята проверка `mechanics_status`; исполняется `text_only` | `mechanics-runtime.ts:64-70` | 🔴 | 415 карт исполняют неревьюенные механики; прямое противоречие SQL-контракта |
| M2 | `conditionAllows` — whitelist из 2 типов | `:164-172` | 🔴 | 79 механик молча выключены |
| M3 | `targetCardIds` не проверяются на принадлежность | `:138` + `validation.ts:66-75` | 🔴 | Чужой игрок может целиться в чужие карты (бафф/лечение/урон) |
| M4 | 17 действий объявлены, но не реализованы | `:299-301` | 🔴 | Молчаливый no-op + ложный `applied: true` |
| M5 | `conditional`/`persistent` — 112 механик без события | `:5-17` vs `:324` | 🔴 | Мёртвые данные в каталоге |
| M6 | `use_ability` недостижим из UI | `useAbility.js` (0 импортов) | 🔴 | 315 механик нельзя применить |
| M7 | `each_creature_adjacent` фильтрует по `zone_position` **карт**, не зон | `:155` | 🟠 | Соседство считается по всем игрокам сразу (1..4 у всех), т.е. «соседние» — фактически «все» |
| M8 | `each_creature_in_lane` / `each_creature_landscape` игнорируют линию/землю | `:157-158` | 🟠 | Возвращают ВСЕ существа |
| M9 | `move` с `destination: 'opponent_lane'` двигает внутри зон **своего** игрока | `:268-278` | 🟠 | `p.zones[p.zones.length-1]` — последняя зона атакующего, не противника |
| M10 | `aoe_damage`/`face_attack` бьют по **всем** противникам, `filter` игнорируется | `:213-220` | 🟠 | AoE-фильтры из карточек не работают |
| M11 | `stat_buff` со строковым `amount` даёт +0 | `:290` | 🟠 | «×2»/«equal_to_damage» тихо не работают |
| M12 | `chosen_*` без `targetCardIds` → урон уходит в лицо | `:207-210` | 🟠 | Неверная цель вместо «ничего не делать» |
| M13 | `heal` `cap = 25` по умолчанию | `:223` | 🟡 | HP существа ограничено 25 независимо от базы |
| M14 | `cost_reduction` / `free_play_next` пишутся в PlayerState, но не гасятся, если карта ушла | `:295-298` vs `turn.ts:92-93` | 🟡 | Сброс только на границе хода |
| M15 | Нет логирования пропущенных механик | везде | 🟡 | Нечем диагностировать M1-M14 в проде |

### 4.9. Что опасно включить сразу

1. **Включить `text_only` (или оставить как есть после починки M2-M4) одним куском.**
   82% каталога начнёт исполняться одновременно. `deal_damage` в каталоге встречается
   38 раз, из них **14 — на `text_only`-картах**. Одна ошибка в резолве цели (M3/M12) станет
   мультиплеерным эксплойтом.
2. **Починить M2 (`conditionAllows`) раньше, чем M1.** Иначе 79 «разблокированных»
   механик получат шанс исполниться неревьюенными.
3. **Починить M3 (проверка `targetCardIds`) последним.** Это единственная защита; пока её
   нет, расширять `use_ability` в UI нельзя.
4. **Не запускать `catalog:migrate` до того, как БД переведён на v1-формат механик.**
   Иначе `mechanics-runtime` получит старый формат и — как показано в 3.4 — всё будет
   молча «работать», ничего не делая, а `mechanics_status` окажется `unreviewed` у всех.
5. **`card_type: 'special'` (5 карт) конфликтует с CHECK-констрейнтом.**
   `docs/CURRENT_DB_SCHEMA.sql:11`: `card_type = ANY (ARRAY['creature','building','spell'])`.
   `supabase/seed/cards_full.sql` вставляет `'special'`. Ни одна миграция констрейнт не
   расширяет (проверено grep по `supabase/migrations`). То есть **reseed упадёт**.
   `CARD_TYPES` в `src/constants/game.js` тоже не содержит `special`, поэтому в админке
   эти 5 карт не редактируются.

---

## 5. Герои

### 5.1. Инвентарь

| Слой | Файл | Что показывает | Арт? |
|---|---|---|---|
| Выбор в колоде | `src/components/DeckBuilder/HeroPicker.jsx` | `<img>` + имя + описание | ✅ да |
| Список/модалка колоды | `src/components/HeroDisplay.jsx` | кнопка с **именем** + tooltip + модалка с `<img>` | 🟡 текст + модалка |
| Бейдж | `src/components/deck/HeroBadge.jsx` | `<img>` 16px + имя + tooltip | ✅ да |
| Данные | `src/hooks/useHeroes.js` | `heroes_v`, `deck_heroes_v`: `id, number, name, description, image_url, **mechanics**, **script**, hero_slug` | — |
| Выбор сохранён | `useDeckSelection` → `deckState.js` → `decks.heroId` | строка | — |
| Лобби | `src/components/Lobby/LobbyScreen.jsx:49-51` | `HeroDisplay` | 🟡 |
| HUD | `src/components/Game/hud/HeroAvatar.jsx` | только имя текстом | ❌ **`hero.image_url` не используется вообще** |
| 3D-стол | — | — | ❌ нет |

### 5.2. Где герой только строка

`src/utils/lobbyDeck.js:87-96` (`buildLobbyDeckPayload`) формирует payload для
`lobby_players.deck`: `code, name, selectedCards, selectedLands, cards, lands, cardCount, landCount`.
**`heroId` там нет.** Проверено: в `workers/src` подстрока `hero` (регистронезависимо)
не встречается **ни разу** — ни в `game-room.ts`, ни в `lobby-room.ts`, ни в `protocol.ts`,
ни в `game-engine/*`.

### 5.3. Есть ли механика героя в данных

`heroes_v` отдаёт колонку `mechanics` и `script`. В `supabase/full_dump.sql:11` видно
формат: `{"type":"ability","effect":"discard_hand_then_deal_damage","params":{...},"trigger":"manual"}`,
`{"type":"win_condition",...,"trigger":"passive"}`, `{"type":"buff",...,"trigger":"passive"}`.
Это **другой словарь**, чем v1-конверт (`{trigger, actions[], conditions[]}`), и он
не совпадает ни с одним типом из `Trigger` в `mechanics.ts`
(`once_per_turn` в строке `Монка` не существует вовсе).

**Ответ: пассивки героя нет ни в Worker, ни в `mechanics-runtime`.** Даже если бы
`heroId` доехал до партии, исполнить её нечем. Поэтому шаг 2.4 («пускать пассивку только
если она уже есть в данных») — **невыполним в текущем видео данных**: данных нет.

### 5.4. Вывод по разделу

Герой — это **декоративная строка в двух местах** (DeckBuilder, Lobby/DeckList) плюс
**мёртвый компонент** `HeroAvatar`, который к тому же не рисует картинку.
Данные для пассивки есть, но в несовместимом формате и не доходят до Worker.

**Не создавать героя заново.** Доделывать нужно ровно три вещи: (1) убрать мёртвый
`HeroAvatar` или дорисовать его через существующий `HeroBadge`-подход; (2) донести
`heroId` до лобби-payload и до `PlayerState`; (3) **не** трогать `mechanics-runtime`
под пассивку, пока формат `heroes_v.mechanics` не приведён к v1 — иначе это будет
второй несовместимый словарь рядом с уже существующим.

---

## 6. 3D-сцена и HUD

### 6.1. Что уже сделано после PERFORMANCE_AUDIT_3D.md (по коду)

| Пункт аудита | Статус | Чем подтверждено |
|---|---|---|
| K1 убрать `<Environment preset="city">` | ✅ | `GameExperience.jsx:106-109` — ambient+hemisphere+directional+point |
| K2 выключить тени | ✅ | `GameCanvas.jsx:86` `shadowMap.enabled = false`; `castShadow` нет |
| K3 убрать troika `<Text>` с карт | ✅ | `GameObject.jsx:184` — одна `CanvasTexture`; `troika-text` в UI карт нет |
| K4 композитная текстура | ✅ | `cardCompositeTexture.js` |
| K5 LRU + dispose текстур | ⚠️ частично | `textureCache.js` сделан правильно, **но** `cardCompositeTexture` держит **второй** неучтённый кэш (см. 6.4) |
| K6 `frameloop="demand"` | ⚠️ частично | `GameCanvas.jsx:105` + `FramePump`, но `pulse` никем не вызывается (6.4) |
| V1 рабочий `memo` | ✅ частично | `useBoardModel`, `ZoneColumn`, `resolveCardVisual` |
| V2 шарённые геометрии | ⚠️ частично | `sceneResources.js` есть, но `SlotPad`, `AttackTarget`, `MatLine`, `TableDecor` создают `<planeGeometry>/<cylinderGeometry>` инлайн |
| V3 инстансинг | ⚠️ частично | `BoardOutlines` (InstancedMesh) — есть; слоты — нет |
| V4 `matrixAutoUpdate=false` | ✅ | `GameLand.jsx:242`, `TableDecor.jsx:44,50`, `PlayFieldGrid.jsx:21` |
| V5 `FrontSide` | ✅ | `GameObject.jsx:43`, `GameLand.jsx:72`, `GameLand.jsx:183` |
| V6 адаптивное качество | ❌ | `detectDeviceProfile` есть, но `useGraphicsSettings`/`textureScale` не подключены (0 импортов) |
| V7 object pooling | ❌ | не сделано |
| V8 баги (`onLandClick`, позиция после flash, `registerPlayableSlot`, `setCrossOrigin`, rect-кэш, таймеры, лимит battleEvents) | ✅ | `GameLand.jsx:209`, `GameObject.jsx:105-112`, `slotRegistry.js`, `textureCache.js:29`, `GameBoard3D.jsx:227-263,436-441,64,71` |
| D1 удалить дубли геометрии | ⚠️ | `layout.js` удалён, но `layout.test.js` остался и падает |
| D2 разбить GameBoard3D | ⚠️ частично | `useBoardModel` + `ZoneColumn` есть; `useBoardInteraction`/`useDamageVisuals` — нет, файл 716 строк |
| D3 zustand→diff→3D | ❌ | не начато |
| D4 разделение бандла | ✅ | `vite.config.js:119-134` |
| D5 дельты в WS | ❌ | `state-broadcast.ts` шлёт полный снапшот |
| D6 perf-тест на drawCalls | ❌ | не сделано |

### 6.2. Что уже сделано после PERFORMANCE_AUDIT_WORKERS.md

| Пункт | Статус | Чем подтверждено |
|---|---|---|
| K1 `blockConcurrencyWhile` в `loadGame` | ✅ | `game-room.ts:337,344` |
| K2 rehydrate-race | ✅ | `game-room.ts:216` |
| K3 timeout на Supabase | ✅ | `supabase.ts:33-50`, 8 с |
| **K4 `SNAPSHOT_EVERY_N_ACTIONS = 20`** | ❌ **аудит врёт** | `game-room.ts:62` = **1**. Комментарий: «intentionally conservative while the mechanics runtime is being introduced». `docs/PERFORMANCE_AUDIT_WORKERS.md:316` утверждает 20 — **документ устарел** |
| K5 race в `persistSnapshot` | ✅ | `game-room.ts:444` |
| K6 удалить `action-router.ts` | ✅ | файла нет |
| K7 батч state+battle | ✅ | `game-room.ts:617-628`, `state_with_battle` |
| K8 кэш `getPlayerGameState` | ✅ | `supabase.ts:88-130` |
| V1 broadcast-delta | ❌ намеренно | полный снапшот |
| V2 алиас `winner_id` в events | ❌ | в `state-broadcast`/`protocol` нет |
| V3 кэш lobby snapshot | ⚠️ | есть логика в `lobby-room`, но TTL-кеш заявлен в аудите — код не сверялся построчно в этом аудите |
| V4 in-memory card index в DO | ❌ | `getCardIndex` пересобирается на каждый `loadGame` (`game-room.ts:351`) |
| V5 dedup по `requestId` | ✅ | `game-room.ts:528-534, 546-553` |

**Расхождение аудита и кода №1:** `SNAPSHOT_EVERY_N_ACTIONS` (см. выше). Аудиты не
переписываем — фиксируем факт здесь.

### 6.3. Где клики и drag хрупкие

**D1 (реальный баг). `PlacementPointerRelease.jsx:27`**
```js
const rect = boardRectRef?.current?.getBoundingClientRect?.()
```
`boardRectRef.current` уже **хранит `DOMRect`** (`GameBoard3D.jsx:233`:
`boardRectRef.current = el.getBoundingClientRect()`). У `DOMRect` нет метода
`getBoundingClientRect`, опциональный вызов `?.()` вернёт `undefined` — исключения не будет,
но **`rect` всегда `undefined`**, значит `ndcFromClient` возвращает `null`, и raycast
работает по **устаревшей** `pointerRef.current` (последний `pointermove`).
Итог: карта встаёт не туда, куда отпустили, если между последним `pointermove` и
`pointerup` сдвинулась камера (OrbitControls живут постоянно).

**D2. `getPlayableSlotTargets` (`slotRegistry.js:32-36`)** считает объект мёртвым по
`obj.parent == null && obj.children == null`. У `<mesh>` есть `children` (всегда массив),
поэтому проверка почти никогда не срабатывает → мёртвые таргеты копятся.
При этом `raycaster.intersectObjects` требует актуальных `matrixWorld`.

**D3. `SlotPad` (`GameLand.jsx:156`)** рендерится, если `show = playable || rayHovered || dropState`,
но регистрируется в `slotRegistry` только при `playable` (строка 151). Расхождение
`show`/`playable` означает «видимую подсветку слота, в который нельзя положить».

**D4. `getLandMaterial` (`GameLand.jsx:47-51`)**:
```js
const color = isSelected ? '#fff8e1' : dropState === 'valid' ? palette.fill : palette.fill
```
Обе ветки `dropState` идентичны — мёртвый тернарник.

**D5. `handleRayRelease` (`GameBoard3D.jsx:334`)** всегда передаёт `slotType = 1`:
```js
const result = await onPlayCard?.(cardIdx, target.zoneIndex, 1, target.slotType)
```
Третий аргумент — литерал `1`. Если он трактуется как `slotType`, то для зданий всегда
уходит «1». Нужно проверить сигнатуру `usePlayCard` перед правкой (в этом аудите
`usePlayCard.js` построчно не разбирался).

**D6. `handleLandClick` (`GameBoard3D.jsx:270-273`)** игнорирует клик, если
`activeCardRef.current` — то есть при выбранной карте клик по земле не снимает выделение.

### 6.4. Свет и читаемый урон (открытые пункты)

1. **Двойной tone mapping.** `GameCanvas.jsx:82-83` ставит
   `gl.toneMapping = ACESFilmicToneMapping`, `toneMappingExposure = 1.08`, и при этом
   `GameExperience.jsx:130` рендерит `<PostProcessing />`, который добавляет ещё один
   `<ToneMapping mode={ACES_FILMIC}>` (`PostProcessing.jsx:42-45`). ACES применяется дважды:
   картинка вымывается, тени уходят в грязь. Это и есть «свет» из ожиданий шага 2.5.
2. **`useGraphicsSettings` не подключён** (0 импортов). Пользовательский переключатель
   качества существует в хуке и никуда не выведен — в UI его нет вообще.
3. **Урон не анимируется в `demand`-режиме.** `useFramePulse` (0 использований) —
   единственный механизм, который продлевает рендер. `GameObject.jsx:126-138` трясёт
   карту 600 мс внутри `useFrame`, но в `demand` без `pulse()` отработает 1-2 кадра.
   То же для `GameDamageFloater` и `useCardAnimation`.
4. **Урон/цифры читаются плохо.** `cardCompositeTexture.drawBadge` рисует цифры
   `h*0.65px` на холсте 512×731 без обводки/тени, поверх произвольного арта;
   `PlayerNameLabels` использует `outlineWidth 0.018` — единственное место с обводкой.

### 6.5. Компоненты HUD

`GameBoard3D` → `GamePanel` → `HUDOverlay` → `HUDTopBar`, `HUDOpponents`,
`PlayerSideIndicator`, `HUDBottomBar`, `HUDHand`, `HUDConnectionBanners`, `Replay`,
`CardActionMenu`, `ZoneCardActionMenu`.

`HeroAvatar` в этот граф **не входит** (0 импортов), хотя его докринг говорит
«используется в HUDOverlay».

---

## 7. Повторяющийся код вне карт

Только реальные копии, с путями. Похожие имена без совпадения тела не приводятся.

### 7.1. Нормализация `land_type` / проверка земли

| Файл:строка | Тело |
|---|---|
| `src/utils/cardFields.ts:62-69` | `isLandCompatible(cardLand, zoneLand)` |
| `workers/src/game-engine/cards.ts:58-62` | `isLandCompatible(cardLand, zoneLand)` — **та же логика, второй экземпляр** |
| `src/hooks/game/zoneCards.js:55` | вызов `cardFields.isLandCompatible` |
| `src/components/Game/GameBoard3D.jsx:323,489` | вызов `cardFields.isLandCompatible` |
| `workers/src/game-engine/validation.ts` | **не проверяет землю вовсе** |
| `workers/src/game-engine/types.ts:52` | комментарий перечисляет `corn/ice/good/swamp/sand/blue/any` — третья копия списка |

Следствие: клиент проверит землю, Worker — нет. Клиентский pre-flight не является защитой.

### 7.2. Стоимость карты

| Файл:строка | Тело |
|---|---|
| `src/utils/cardFields.ts:41-45` | `getCardCost` (дефолт 1, `Math.max(0,n)`) |
| `workers/src/game-engine/cards.ts:70-76` | `getCardCost` (та же логика + `cost_reduction`/`free_play_next`) |
| `workers/src/game-engine/validation.ts:27-33` | `getCardCost` — **третья копия, дословно** |

`workers/src/game-engine/cards.ts:70` и `validation.ts:27` — побайтово одинаковые функции
с разными именами (`getCardCost` в обоих). При правке одной забудут про другую.

### 7.3. Тип/слот карты

| Файл:строка | Тело |
|---|---|
| `src/utils/cardFields.ts:14,29,33,37` | `getCardType/isCreatureCard/isBuildingCard/isSpellCard` |
| `src/hooks/game/zoneCards.js:8-11,20` | `getCardSlotType`/`splitZoneCards` — через `getCardType` ✅ |
| `src/utils/enrichGameCards.js:134` | `card_type: card.card_type \|\| card.type \|\| db.card_type` — **третья реализация `getCardType` вручную** |
| `workers/src/game-engine/cards.ts:79-84` | `getCardSlot` — 4-я реализация, на стороне Worker |
| `workers/src/game-engine/validation.ts:56` | инлайн `state.catalog?.[card.id]?.card_type === 'building' \|\| card.card_type === 'building'` — 5-я |

### 7.4. Здоровье/атака с баффами

| Файл:строка | Тело |
|---|---|
| `workers/src/game-engine/mechanics-runtime.ts:81-87` | `effectiveAttack` / `effectiveHealth` (`+ *_bonus`) |
| `workers/src/game-engine/combat.ts:122-126` | использует `effectiveAttackForCombat`/`effectiveHealthForCombat` ✅ |
| `workers/src/game-engine/validation.ts:146` | `effectiveAttackForCombat(attacker) <= 0` ✅ |
| `src/utils/stabilizeGameState.js:26-27` | сравнивает `ca.health / ca.defense`, **но не `*_bonus`** ⚠️ |

### 7.5. Перемешивание

| Файл:строка | Тело |
|---|---|
| `workers/src/game-engine/utils.ts:89-98` | `shuffleDeck(deck, rng)` |
| `src/utils/lobbyDeck.js:104-111` | `shuffleDeck(cards)` — **Fisher-Yates копия**, без rng |

### 7.6. Стабилизация/дедуп карт

| Файл:строка | Что |
|---|---|
| `src/utils/stabilizeGameState.js:140-161` | `dedupCardsById` |
| `src/utils/stabilizeGameState.js:6-10` | `cardKey` |
| `src/components/Game/GameBoard3D.jsx:176-188` | инлайн-дедуп `handCards` по `instanceId\|\|id` — **та же логика** |
| `src/components/Game/hud/HUDHand.jsx:30-42` | инлайн-дедуп `uniqueHand` — **та же логика, третья копия** |

### 7.7. Список земель

Три независимых списка (см. 2.3): `constants/game.js:7`, `constants/landColors.js:7,18`,
`cardCompositeTexture.js:71`.

### 7.8. Логирование/дебаг

| Файл | Что |
|---|---|
| `src/utils/gameDebug.js` | `gameDebugLog` |
| `src/utils/errorLogger.js` | `logError` |
| `src/utils/console.log` в `game-room.ts:167,586` | прямые `console.log` в проде |

### 7.9. Мёртвые дубли, которые стоит удалить

`src/hooks/game/format.js` целиком (кроме трёх `normalize*`), `src/utils/validateBeforeSend.ts`
вместе со всем `src/shared/game-engine/`, `src/components/Game/hud/HeroAvatar.jsx`,
`src/components/Game/gameBoard3D/layout.test.js`,
`src/hooks/useGraphicsSettings.js` (до решения — подключить или удалить),
`selectIsMyTurn` в `gameStore.js`.

---

## 8. Недоделанные куски

### 8.1. Флип — инфраструктура есть, данных нет

| Слой | Состояние |
|---|---|
| Worker `canFlipCard`/`flipCard` | ✅ реализовано (`cards.ts:332-418`) |
| Клиент `hasFlipAbility` | ✅ реализовано (`src/hooks/game/cardAbilities.js:21-35`) |
| UI: `ZoneCardActionMenu` / `CardActionMenu` | 🟡 кнопка «🔄 Флюп» есть |
| Проводка `GameBoard3D → onFlipCard` | 🔴 **сломана**, см. 8.2 |
| **Данные** | 🔴 **`has_flip: true` — 0 карт из 504. `flip_description` непустой — 0 карт. Действий `flip_ability` — 0.** |

То есть **флип физически невозможен ни на одной карте**: `canFlipCard` вернёт
«У карты нет способности Флюп» всегда. Это не баг, это отсутствие данных —
но UI при этом предлагает кнопку.

Дополнительно: `getFlipCost` (`cardAbilities.js:45-51`) **всегда возвращает 0**,
тело функции после `if (!Array.isArray(card.mechanics)) return 0` — мёртвый `return 0`.
`findFlipAbility` в `workers/.../cards.ts:313-330` дублирует `hasFlipAbility` клиента.

### 8.2. `use_ability` — серверная часть есть, клиентской нет

- Worker: `engine.ts:55-65` + `activateAbility` (`mechanics-runtime.ts:346-364`) ✅
- Клиентский хук: `src/hooks/game/useAbility.js` ✅ написан, **0 импортов**
- UI выбора цели: ❌ нет вообще
- `mechanics-runtime.test.ts:65-88` покрывает `activateAbility` ✅

**315 из 543 механик (58%) — `manual`-триггер, недостижимы из UI.**

### 8.3. Сломанная проводка флипа (реальный баг)

`GameBoard3D.jsx:617`:
```js
await onFlipCard?.(zoneCardActionMenu.playerId, zoneCardActionMenu.zoneIndex, cardId)
```
`useFlipCard.js:13` принимает `(playerIndex, zoneIndex, cardId)` и на строке 20 делает
`game.players?.[playerIndex]`. Сюда передаётся **`player_id` (строка)**, а нужен **индекс**.
Результат: `player === undefined` → `{ error: 'Игрок не найден' }`.

Дополнительно: `useFlipCard.js:53-70` — если WS-транспорт не дал `ok`, хук **падает
в SQL RPC `flip_card`**, а не в Worker. Это запрещено параллельное исполнение (см. 9.1).

### 8.4. Спеллы

Реализованы: `playCard` (`cards.ts:104,159-175`) → `resolveSpell` → эффекты → карта в сброс.
Не сделано: выбор цели для спелла с `chosen_*` (нужен UI), нет `targetCardIds` из HUDHand.
Из 123 спеллов в каталоге у 123 `attack=null, health=null` — статы не рисуются
(это корректно и совпадает с `CardDisplay`, который прячет статы для не-`creature`).

### 8.5. Баффы `this_turn`

- Запись: `mechanics-runtime.ts:290` пишет `${stat}_bonus` + `${stat}_buff_duration`.
- Сброс: `cleanupTemporaryEffects` (`mechanics-runtime.ts:370-390`) вызывается
  **только** из `turn.ts:113` — в начале `endTurn`, то есть **в конце хода владельца**.
- Проблема А: `stat_buff` на карте противника тоже сбрасывается в конце чужого хода
  (`cleanupTemporaryEffects` чистит **все** игроков).
- Проблема Б (главная): `stabilizeGameState.js:12-34` (`cardsEquivalent`) **не сравнивает
  `*_bonus` и `*_buff_duration`** → бафф не меняет ссылку на карту → `ZoneColumn`/`GameObject`
  не перерендерятся → **бафф не виден ни на столе, ни в HUD**. Плюс подпись кэша текстуры
  в `cardCompositeTexture.buildSignature` считает только `attack`/`health` из карты,
  а не `attack_bonus` → **текстура тоже не обновится** даже при ререндере.

Итог: баффы применяются в состоянии и не отображаются. Это самая недооценённая дыра
из всех — она соединяет раздел 4 (механики) и раздел 2 (отрисовка).

### 8.6. Герой

См. раздел 5. Строки в двух местах, пассивки нет, на столе нет, `HeroAvatar` мёртв.

### 8.7. Оффлайн/локальное лобби

Реализовано и работает: `src/utils/offlineMode.js` (`VITE_OFFLINE_TEST_MODE`),
`src/utils/localLobbyClient.js`, `src/fixtures/testCatalog.js`, ветки в `useCatalog`,
`useHeroes`, `useDecks`, `guestSession`, `LobbyScreen:103`.
Worker: `index.ts:59` `const localLobbyEnabled = true` — **хардкод**, фича не выключается,
и комментарий над ним противоречит коду. Плюс `dev-fixtures.ts` + ветка `ensureDevGame`
в `game-room.ts:398-431` добавляют фиктивного `'test-bot'` вторым игроком.
**Не доделано:** dev-обход включается только при `ENVIRONMENT !== 'production'`
**и** `ALLOW_DEV_BYPASS === '1'` (`game-room.ts:117-118`) — в `wrangler.jsonc` надо проверить
значения; при `local-` префиксе создаётся комната без Supabase (строка 172-175).

### 8.8. Ручная атака: хук есть, кнопки нет

Цепочка **живая до конца и обрывается на последнем шаге**:
`src/hooks/game/useAttack.js` (реализован, есть SQL-fallback с флагом) →
`useGameAction.js:33` → `GameScreen.jsx:113` → **`GameScreen.jsx:212` передаёт
`onAttack={attack}`** → **`GameBoard3D.jsx:109-132` не деструктурирует `onAttack`**.

То есть колбэк молча отбрасывается: `GameBoard3D` его не принимает и никуда не передаёт.
Атака в игре происходит только внутри `endTurn` (`turn.ts:120-138` → `resolveAttack`
× 4 линии), выбрать конкретного атакующего игрок не может.

`src/hooks/game/zoneOpposition.js` при этом жив — `getAttackTargets` используется
в `battlePhase.js:51` для расчёта маркеров урона. Готова вся «логика кто чей сосед»,
не хватает только UI выбора цели и проброса колбэка.

Это ровно тот же разрыв, что и в §8.2 (`use_ability`) и §8.3 (флип): серверная часть
написана и протестирована, клиентский проводящий путь не доведён.

### 8.9. `useBoardUi` — незавершённый рефакторинг D2

`src/hooks/game/useBoardUi.js` не импортируется никем (0 ссылок). Он дублирует то, что
уже есть в `GameBoard3D`: `battleEventsToVisuals`, состояние выделения. Похоже на начатый
по D2 из `PERFORMANCE_AUDIT_3D.md` разбор `GameBoard3D` на хуки, который не довели
до конца — вместо него появились `useBoardModel` и `ZoneColumn`.

---

## 9. Риски

### 9.1. Параллельный SQL RPC + Worker 🔴

Прямое нарушение заданного ограничения. Клиент пробует Worker, а при неудаче
**безусловно** уходит в SQL:

| Файл | RPC | Защищено `ALLOW_CLIENT_FALLBACK`? |
|---|---|---|
| `usePlayCard.js:129,141` | `play_card` | ✅ да |
| `useAttack.js:65` | `perform_attack` | ✅ да |
| `useTurnControl.js:63,160` | `end_turn`, `forfeit_game` | ✅ да |
| `useLandSetup.js:20,41` | `reorder_player_lands`, `confirm_land_setup` | ✅ да |
| **`useFlipCard.js:62`** | `flip_card` | ❌ **нет** |
| **`useDrawFreeCard.js:27`** | `draw_free_card` | ❌ **нет** |
| **`useDrawCard.js:27`** | `draw_card_for_action` | ❌ **нет** |
| **`useDiscardFromHand.js:48`** | `discard_from_hand` | ❌ **нет** |
| **`useDiscardFromZone.js:63`** | `discard_from_zone` | ❌ **нет** |
| **`useShuffleDeck.js:25`** | `shuffle_deck` | ❌ **нет** |
| `useGameLoader.js:40` | `get_player_game_state` | ❌ чтение, не опасность |

`featureFlags.js`: в DEV флаг `true` **по умолчанию**. Значит в локальной разработке
6 боевых действий уходят в SQL параллельно Worker, если WS-ответ не пришёл вовремя
(а он приходит через `sendActionAsync` с таймаутом — при лаге это воспроизводимо).
Результат: действие применяется дважды, к двум разным источникам правды.

**До правок фичи это надо закрыть**, иначе любая проверка механик даёт невоспроизводимый результат.

### 9.2. Снимок DO и версия

`SNAPSHOT_EVERY_N_ACTIONS = 1` (`game-room.ts:62`) → PATCH `games.state` на каждое
действие. Плата — egress и задержка в Supabase. Поднять до 20 (как советовал аудит)
**нельзя до фикса `use_ability`**: если DO выгрузит партию и перезапустится, несохранённые
действия будут потеряны безвозвратно.

`persistSnapshot` пишет `players[].{...}` — но **не** `catalog` (правильно) и **не**
`card_art`. Каталог в снимке не нужен, он перечитывается из KV.

Отдельный риск: `persistSnapshot` берёт `const game = this.currentGame` **внутри**
`blockConcurrencyWhile` (`game-room.ts:449`) — корректно, но `devMode` при этом
пропускает persist (строка 443), т.е. локальные комнаты не восстанавливаются.

### 9.3. Каталог KV

- Локально пуст (0 записей) → `state.catalog = {}` → механики выключены, а
  `getCardCost` падает в `card.cost` (строка 72 `cards.ts`), а не в каталог.
- `catalog.ts:47` `cacheTtl: 300` + per-isolate `CACHE_TTL_MS = 60_000` → после
  `catalog:migrate` до 60 с в изоляте виден старый каталог. В проде это ок, в тестах — нет.
- `game-room.ts:379-383` при ошибке каталога **молча** ставит `cardCatalog = {}` и продолжает
  партию. Механики выключаются без единого признака на клиенте.

### 9.4. Тесты

- `npm test` уже красный (7 файлов) — нельзя использовать как гейт, пока не починен.
- Для `workers/src/game-engine` нет npm-скрипта — легко «забыть прогнать».
- `test:smoke` и `test:store` зелёные, но **не трогают** ни одну из дыр M1-M15.
- `layout.test.js` падает на отсутствующем `./layout.js`.
- Тест `does not execute text-only abilities` не проверяет `mechanics_status`.

### 9.5. Регрессии, которых легко получить

| Действие | Что сломается |
|---|---|
| Правка `getCardCost` только в `cards.ts` | `validation.ts` продолжит считать по-старому → клиент и Worker разойдутся в цене |
| Правка `cardsEquivalent` без синхронизации `buildSignature` | Баффы начнут «появляться» текстурой, но не в DOM, и наоборот |
| Удаление `cat` из `blueprint` | 415 карт потеряют механики; тест `mechanics-runtime.test.ts:44` это поймает |
| Перенос `isLandCompatible` в один модуль | Клиент начнёт блокировать drop, который Worker пропускает (или наоборот) |
| Правка `state.catalog` в бродкасте | Утечка всего каталога (~504 карты с механиками) на каждого клиента |
| Включение `mechanics_status` как фильтра | 415 карт потеряют свои (неревьюенные) эффекты — резкое изменение баланса |

### 9.6. Безопасность

- `index.ts:6-11` `Access-Control-Allow-Origin: '*'` на всех маршрутах, включая `/catalog/*`.
  Каталог и лобби публично читаются.
- `buildBroadcastState` (`state-broadcast.ts:15-23`) редактирует только `hand` и `deck_pile`.
  `discard_pile`, `cost_reduction`, `free_play_next`, `free_draw_used`, `paid_draw_used`
  видны сопернику целиком. Для `hand` это критично (и сделано), для остального —
  решение по правилам, но сейчас оно неявное.
- `M3` (см. 4.8) — целочисленность мультиплеера.

---

## 10. План работ

План построен **только** из находок этого файла. Каждая фаза имеет критерий готовности.
Фазы 0 и 1 — обязательные, без них пункты дальше нельзя проверять.

**Порядок неочевиден в двух местах; это следствия находок, а не перестраховка:**

- **Шаг 2.1 в ТЗ обещает «3D использует тот же рендер через кэш текстуры (cardCompositeTexture
  как кэш, а не второй дизайн)».** Аудит показал, что `cardCompositeTexture` — это именно
  второй дизайн со своей палитрой `COLORS` и своими кодами земель (`2.3`). Слить «в один
  рендер» нельзя, не сделав сначала единый источник значений — иначе 3D станет третьим
  потребителем палитры, а не вторым. Поэтому в плане сначала источник значений (Ф3),
  потом `CardFace` (Ф4), и только потом 3D (Ф7).
- **Шаг 2.2 в ТЗ предполагает, что два движка разъехались и их надо «слить».**
  Аудит показал обратное: `src/shared/game-engine/*` — это реэкспорт-шимсы без логики
  (`1.3`), разъезда кода нет, а потребитель у них ровно один и он мёртв. «Сливать» нечего;
  правильное действие — удалить мёртвое зеркало и не тащить серверный движок в клиентский
  бандл. Это **устаревшая часть шага 2.2**, и я её выполняю в этом смысле.

Ещё одно расхождение: **шаг 2.3 требует «text_only показывать текстом и не исполнять»** —
это совпадает с SQL-контрактом (`4.6`) и требует включения проверки статуса. Одновременно
текущий код прямо говорит обратное. Аудит и ТЗ здесь совпадают, менять ничего не надо.

---

### Ф0. Зафиксировать состояние (блокирует всё остальное)

**Файлы:** коммит текущего дерева в `tester_00005`, без правок кода.
**Что:** `git add -A && git commit -m "chore: snapshot tester_00005 worktree before CardFace unification"`.
Особенно важно для `src/components/Shared/CardDisplay.{jsx,css}` — они уже в 4 компонентах
и не закоммичены (`0.1`).
**Критерий готовности:** `git status --porcelain` пуст.
**Почему так:** без этого шага любая правка по плану необратима для 4 потребителей карты.

---

### Ф1. Вернуть зелёный тестовый гейт (блокирует всё остальное)

**Файлы:**
- `package.json` — заменить `"test": "node --test src/**/*.test.js"` на рабочий раннер
  (vitest по конфигу `vitest.config.js` с include только `src/**/*.test.js`, без `.smoke.`),
  добавить `"test:engine": "vitest run --root workers --config vitest.engine.config.ts"`.
- удалить `src/components/Game/gameBoard3D/layout.test.js` (осиротевший, `0.2`)
  **или** переписать его на `../utils/gameObjectPlacement.js` — предпочтительно переписать,
  там 15 проверок геометрии, которые стоит сохранить.

**Критерий готовности:** `npm test`, `npm run test:smoke`, `npm run test:store`,
`npm run test:engine` — все зелёные; `npm run test:engine` воспроизводит текущие 50/50.
**Чего не делать:** не «чинить» тесты ослаблением assert'ов. Если `layout.test.js`
переписывается — переносить те же 15 ассертов на `gameObjectPlacement`.

---

### Ф2. Закрыть параллельный SQL (риск 9.1) — ДО любых изменений механик

**Файлы:** `src/hooks/game/useFlipCard.js`, `useDrawFreeCard.js`, `useDrawCard.js`,
`useDiscardFromHand.js`, `useDiscardFromZone.js`, `useShuffleDeck.js`.

**Что:** привести к схеме уже сделанного в `usePlayCard.js` — вызывать SQL только за
`ALLOW_CLIENT_FALLBACK`-флагом, иначе возвращать явную ошибку. В `useFlipCard.js`
дополнительно убрать «мягкий» возврат: `if (wsOk) return wsOk` → жёсткая ошибка,
если Worker недоступен.
**Критерий готовности:** `grep -n "supabase.rpc" src/hooks/game` показывает, что каждый
боевой RPC защищён `ALLOW_CLIENT_FALLBACK`; при `VITE_ALLOW_CLIENT_FALLBACK=false` в DEV
ни одно действие не доходит до SQL.
**Почему так:** иначе результат Ф6 невозможно интерпретировать — действие может примениться
дважды.

---

### Ф3. Единый источник значений о карте (ядро всего плана)

**Файлы:** новый `src/utils/cardFaceModel.js`; расширить `src/utils/cardFields.ts`;
`src/constants/landColors.js`; `src/constants/game.js`.

**Что:**
1. `landColors.js` становится единственным источником по типам земель:
   `{ fill, emissive, label, shortLabel, icon, cssBorder, badge }` одним объектом на тип,
   7 типов. `constants/game.js:7` `LAND_TYPES` — удалить, импортеры переключить на
   `landColors.js`. `cardCompositeTexture.js:71` `LAND_TYPE_LABELS` — удалить.
2. `cardFaceModel.js` — чистая функция `resolveCardFace(card)`, возвращающая
   `{ id, name, imageUrl, cost, attack, health, type, landType, isRainbow, hasFlip,
   flipDescription, isFlipped, rarity, hero, source }`.
   Внутри — **только** `cardFields.ts`. Она же нормализует `card_url|image_url`.
3. Расширить `cardFields.ts`: добавить `getCardFlipInfo`, `isFlippedCard`,
   `getCardImageUrl`. Убрать ручную нормализацию типа из `enrichGameCards.js:134`
   (заменить вызовом `getCardType`).
4. **Добавить `alias` для неизвестных `land_type`.** Сейчас 99 карт имеют
   `land_type` вне списка (`cute` 36, `plains` 27, `sandy` 13, `plain` 8, `cotton` 8,
   `desert` 7), и **80 карт (66 существ + 12 строений + 2 `special`) нельзя положить
   на землю при строгом правиле** — это ломает игру, а не косметика (`4.9.1`).
   Плюс `mechanics-runtime` и клиент должны использовать одну функцию.

**Критерий готовности:** новый тест `src/utils/cardFaceModel.test.js`:
для карты с `land_type:'cute'` и для `land_type:'corn'` модель одинаково не падает;
`getCardType` корректно читает `type` и `card_type`; `getCardHealth` читает `defense`.
`npm test` зелёный.
**Почему так:** без Ф3 у Ф4 и Ф7 не будет общего источника, и «смена рамки в одном месте»
невозможна в принципе.

---

### Ф4. Один `CardFace` для DOM (все 6 мест)

**Файлы:** новый `src/components/Shared/CardFace.jsx` + `.css`;
`CardDisplay.jsx` (свести к обёртке над `CardFace` или удалить);
`CardTile.jsx`, `AdminCardTile.jsx`, `HUDHand.jsx`, `CardPreviewModal.jsx`,
`CardForm.jsx` (блок `.card-form-preview-*`), `LandSetupOverlay.jsx`.

**Что:**
- `CardFace` — единственный DOM-рендер карты: арт, имя, стоимость, атака/здоровье,
  бейдж типа, рамка по земле, метка флипа, герой. Один набор классов.
- `CardDisplay` сейчас — уже «почти CardFace». **Не переписывать с нуля** (задание это
  запрещает): перенести его разметку в `CardFace` и сделать `CardDisplay` тонкой
  обёрткой, сохранив `mode='tile'|'hand'|'full'` как пропсы `CardFace`.
- `CardTile` перестаёт рисовать статы сам (строки 194-203, 210-224) — только `CardFace`.
- `CardForm` перестаёт рисовать превью сам — только `CardFace`.
- CSS: убрать локальные `--card-radius: 10px` и `--card-width: 120px`, брать
  `--radius` / `--card-width` из `variables.css`. Эмодзи `💧 ⚔️ ❤️` — в один place-holder
  `CardFace`, а не в 4 JSX-файла.
- `useGraphicsSettings` (0 импортов): либо подключить к `CardFace` (пониженная детализация),
  либо удалить. В Ф7 он нужен — здесь зафиксировать решение.

**Критерий готовности:** `grep -rn "card-tile-stats\|card-display-stats\|card-form-preview-stats" src/`
не находит мест, которые считают статы сами; все 6 мест рендерятся через `CardFace`;
правка рамки в `CardFace.css` видна в колоде, админке, руке, превью и форме.
Тест `src/components/Shared/CardFace.smoke.test.jsx`: рендер карты с
`land_type:'corn'` и `land_type:'cute'` даёт одинаковый набор DOM-узлов.

---

### Ф5. Механики: закрыть дыры M1–M6 по порядку

**Файлы:** `workers/src/game-engine/mechanics-runtime.ts`,
`workers/src/game-engine/validation.ts`, новые тесты в `workers/src/game-engine/`.

**Порядок строго такой (см. 4.9):**

- **M3 первым.** `targetCards` (`mechanics-runtime.ts:137-138`): если `targetIds` непустой,
  фильтровать по `target`-селектору И проверять принадлежность. Плюс `validation.ts`
  случай `use_ability`: `targetCardIds` должен ссылаться на карты, чьи зоны принадлежат
  игроку, и соответствовать селектору. **Без этого остальное трогать нельзя.**
- **M6 вторым.** `use_ability` в UI: `src/hooks/game/useAbility.js` подключить в `HUDOverlay`,
  а в `ZoneCardActionMenu`/`CardActionMenu` показывать кнопки только для карт, у которых
  есть исполняемая `manual`-механика; при `targetCardIds`-селекторе — режим выбора цели
  кликом по своей/чужой карте на столе. Без этого 315 механик остаются недостижимыми.
- **M1 третьим.** Вернуть проверку статуса в `mechanicsFor` (`:62-71`) по контракту из
  `supabase/migrations/20260924120000...:106-107`:
  исполнять только `mechanics_status === 'implemented'`; `text_only` — показывать текстом,
  не исполнять. Убрать комментарий, противоречащий контракту.
- **M4 четвёртым.** Для 8 нереализованных типов (`freeze_landscape`, `mill`,
  `flip_landscape`, `search`, `immunity`, `peek`, `flip_ability`, `ignore_damage`):
  либо реализовать, либо, что дешевле и честнее, **убрать из `hydrateAction`/`supportedActions`
  и вернуть карту в `text_only`**. Как минимум — `applyMechanic` должен помечать механику
  как `skipped: 'unsupported_action:<type>'` (M15), чтобы это было видно.
- **M2 пятым.** `conditionAllows`: `if`/`while`/`prerequisite` не должны молча выключать
  механику. Минимум — возвращать `{ allowed, reason }` и логировать/отдавать в UI причину.
  Полная реализация `if`/`while` — вне этой фазы.
- **M5 шестым.** `conditional`(57) и `persistent`(55): либо завести события
  `conditional`/`persistent` и вычислять их при смене состояния, либо (дешевле и честнее)
  перевести эти 112 механик в `text_only`, чтобы они не выглядели живыми.
- **M11/M12.** Строковый `amount` в `stat_buff` (`:290`) не должен давать +0 — либо
  реализовать `"xN"`/`equal_to_damage`, либо `skipped`. `chosen_*` без `targetCardIds`
  (`:207-210`) не должен бить в лицо — возвращать «нет выбранной цели».
- **M7/M8/M9/M10.** `each_creature_adjacent`, `each_creature_in_lane`,
  `each_creature_landscape`, `move(opponent_lane)`, `aoe_damage` — либо чинить, либо
  помечать `skipped`. `move` с `opponent_lane` сейчас двигает по своим зонам — это
  потенциальная порча состояния, чинить в первую очереду среди этой группы.

**Тесты (новые, в `workers/src/game-engine/`):**
- «механика → состояние» для **каждого** типа из `implemented`: таблица 89 карт,
  для каждой — ожидаемый дельт-ассерт. Это и есть требование
  «implemented только с тестом механика → состояние».
- Явный тест на `mechanics_status`: карта со статусом `text_only` и исполняемым
  `deal_damage` **не** меняет состояние (закрывает дыру в существующем тесте
  `does not execute text-only abilities`, который сейчас проверяет только `source_type`).
- Тест на M3: `targetCardIds` чужой карты → отказ.
- Тест на M2: механика с `conditions:[{type:'if'}]` не молча исчезает, а помечается.

**Критерий готовности:** `npm run test:engine` зелёный; ни одна карта со статусом
`implemented` не проходит тест по причине «действие не реализовано» или «цель не разрешена»;
`text_only` не исполняется ни в одном тесте.
**Чего не делать:** не пересобирать механики из OCR, не трогать `individual_cards/*.json`,
не менять `scripts/parse_mechanics.py`.

---

### Ф6. Прогон данных до БД и KV (риск 9.3)

**Файлы:** `scripts/reseed-cards.mjs`, `scripts/build-individual-supabase-sql.mjs`,
`supabase/migrations/<new>.sql`, `docs/CURRENT_DB_SCHEMA.sql`.

**Что (по порядку, иначе получится «работает, но ничего не делает»):**
1. `docs/CURRENT_DB_SCHEMA.sql` — дописать `rarity, source, hero, notes`
   (сверка с живой БД, `3.1`).
2. Расширить `card_type` CHECK под `'special'` **или** перевести 5 карт в `creature`
   в экспорте. Сейчас reseed упадёт (`4.9.5`).
3. Научить `reseed-cards.mjs` писать `mechanics_version` и `mechanics_status`
   (сейчас `INSERT` без них, `3.4`).
4. Новая миграция: привести старый формат `mechanics` (из `full_dump.sql`) к v1-конверту
   **или** объявить, что таблица должна быть пересеяна из `cards_full.sql`.
   Без этого `mechanics-runtime` будет получать нечто, у чего нет `actions[]` (`3.4`).
5. `npm run catalog:mechanics` → `npm run catalog:migrate`.
6. Проверка: `state.catalog` непустой в локальной комнате.

**Критерий готовности:** локальный `_mf_entries` содержит ключ `cards` с 504 строками;
`GameRoom.loadGame` не пишет `catalog hydration failed`; выборка из
`public.cards` показывает `mechanics_status` из `cards.json` без ручной правки.
**Почему так:** Ф5 без Ф6 бессмысленно — каталога в Worker нет.

---

### Ф7. 3D = тот же язык значений + читаемый свет/урон

**Файлы:** `src/utils/cardCompositeTexture.js`, `src/components/Game/scene/GameObject.jsx`,
`GameCanvas.jsx`, `GameExperience.jsx`, `scene/PostProcessing.jsx`,
`gameBoard3D/PlacementPointerRelease.jsx`, `gameBoard3D/slotRegistry.js`,
`scene/GameLand.jsx`, `gameBoard3D/ZoneColumn.jsx`.

**Что:**
1. `cardCompositeTexture` перестаёт быть вторым дизайном: палитра `COLORS` и
   `LAND_TYPE_LABELS` удаляются, значения приходят из `cardFaceModel`/`landColors`
   (Ф3). Значит он остаётся кэшем, а не вторым лицом.
2. `extractStats` берёт `attack/health` **с учётом `attack_bonus`/`health_bonus`**,
   и `buildSignature` их учитывает. Иначе баффы (Ф8) по-прежнему не видны.
3. `ZoneColumn` передаёт `isFlipped` в `GameObject` (сейчас не передаёт, `2.2`) —
   перевёрнутая карта на столе должна отражаться.
4. Убрать двойной tone mapping (`6.4.1`): оставить один. Рекомендую оставить
   `PostProcessing`' `<ToneMapping>` и снять `gl.toneMapping` в `GameCanvas:82`.
5. Подключить `useGraphicsSettings` (`6.4.2`): `textureScale` → размер canvas в
   `cardCompositeTexture`, `shadowsEnabled` → уже выключены, `quality` — влиять на
   DPR.
6. Починить `PlacementPointerRelease:27` — `boardRectRef.current` уже `DOMRect`,
   вызовать `.getBoundingClientRect()` нельзя (риск 9.5 / `6.3` D1).
7. `useFramePulse` подключить в `GameBoard3D` при `damageFlash` и при появлении
   маркеров урона (Ф8) — иначе в `demand`-режиме анимация не проиграет (`6.4.3`).
8. `slotRegistry.getPlayableSlotTargets` — чинить проверку мёртвых объектов (`6.3` D2).
9. `SlotPad` — регистрировать/рендерить по одному условию (`6.3` D3);
   убрать мёртвый тернарник в `getLandMaterial` (`6.3` D4).
10. `GameCanvas` unmount должен чистить **и** `textureCache`, **и** кэш
    `cardCompositeTexture` (сейчас только первый — неучтённая VRAM-утечка,
    дыра K5 из `PERFORMANCE_AUDIT_3D.md`).
11. Убрать `<planeGeometry>`/`AttackTarget` из `SlotPad` в `sceneResources.js` (V2).
12. **Не возвращать `Suspense` на карту в `Canvas`.** `GameCanvas:111` — `<Suspense
    fallback={null}>` вокруг `children`; `cardCompositeTexture` не использует
    `useLoader`/`useTexture`, поэтому сетевых suspense-загрузок на картах нет.
    Это требование выполняется уже — просто **не сломать** его в Ф7.1-7.5:
    любая замена `Image()` на `useLoader` вернёт размонтирование всей сцены
    (это был исходный баг K1).

**Критерий готовности:** карта на столе и в HUD показывают одинаковые значения при
`attack_bonus > 0`; `renderer.info.drawCalls` не растёт от числа стат-индикаторов;
`npm run test:smoke` зелёный; клик-и-дроп кладёт карту в зону под курсором при
движении камеры.

---

### Ф8. Связать состояние и отрисовку (баффы видны)

**Файлы:** `src/utils/stabilizeGameState.js`, `src/utils/cardCompositeTexture.js`,
`src/hooks/game/zoneCards.js`.

**Что:** `cardsEquivalent` (`stabilizeGameState.js:12-34`) должен сравнивать
`*_bonus`, `*_buff_duration`, `isFlipped`, `flipped_this_turn`, `slot_type`,
`instanceId`. Без этого `mechanics-runtime` меняет состояние, а React его не видит.
Тест: `src/utils/stabilizeGameState.test.js` — карта, у которой изменился только
`attack_bonus`, даёт **новую** ссылку.
**Почему так:** это прямая причина того, что баффы «применяются, но не видны» (`8.5`).

---

### Ф9. Герой: доделать, не пересоздавая

**Файлы:** `src/components/Game/hud/HeroAvatar.jsx`, `src/components/deck/HeroBadge.jsx`,
`src/utils/lobbyDeck.js`, `workers/src/protocol.ts`, `workers/src/game-engine/types.ts`,
`workers/src/game-room.ts`.

**Что:**
1. Удалить `HeroAvatar` **или** перевести его на тот же примитив, что `HeroBadge`
   (единственный, кто рисует `image_url` компактно). Сейчас он не импортируется нигде
   и не рисует картинку (`5.1`).
2. Донести `heroId`: `lobbyDeck.js:87` → payload лобби → `PlayerState` →
   `game-room.rawPlayer`/`persistSnapshot` → `state-broadcast.buildBroadcastState`
   → HUD и `PlayerNameLabels` на 3D-столе.
3. **Пассивку героя не трогать.** Данных в совместимом формате нет (`5.3`):
   `heroes_v.mechanics` использует словарь `{type,effect,params,trigger}`, а рантайм
   ждёт `{trigger,actions[],conditions[]}`. Приводить формат — отдельная задача Ф6.4;
   пока герой — визуал.

**Критерий готовности:** герой выбранной колоды виден в HUD и под ником на 3D-столе
одним и тем же компонентом; в `workers/src` `heroId` присутствует в типах и в снапшоте;
`grep -rn "mechanics" workers/src/game-engine/mechanics-runtime.ts` не содержит новой
логики пассивок.

---

### Ф10. Единый визуальный язык

**Файлы:** `src/styles/variables.css`, `src/styles/game-hud.css`, `src/styles/deck/card-tile.css`,
`src/components/Shared/CardFace.css`, `src/constants/landColors.js`, `scene/GameLand.jsx`.

**Что:**
- Все земельные цвета — только из `landColors.js` (Ф3.1), включая хардкоды в `GameLand`
  (`#ff5252`, `#fff3c4`, `#fbbf24`) — вынести в токены и связать с
  `--game-danger`/`--game-accent` из `variables.css:57-58`.
- Стык DOM ↔ 3D: `variables.css` уже содержит `--game-*`; 3D читает литералы.
  Связать через один модуль констант.
- Читаемость урона на столе: обводка/тень под цифрами в `drawBadge` (`6.4.4`).

**Критерий готовности:** `grep -rn "#[0-9a-fA-F]\{6\}" src/components/Game/scene/ src/utils/cardCompositeTexture.js`
не находит цветов земель/статов вне `landColors.js` и `variables.css`.
**Правила боя не трогать.**

---

### Ф11. Уборка мёртвого (последняя, после зелёного гейта)

**Файлы:** удалить `src/shared/game-engine/*` (8 файлов),
`src/utils/validateBeforeSend.ts`, `src/components/Game/hud/HeroAvatar.jsx` (если не ожил в Ф9),
неиспользуемое в `src/hooks/game/format.js`, `selectIsMyTurn` в `gameStore.js`,
`useFramePulse`-заглушки, если не нужны.

**Перед удалением `src/shared/game-engine`** обязательно убедиться, что Ф1 и Ф7 не ввели
новых потребителей. Цель удаления — чтобы серверный движок физически не попадал в
клиентский бандл (`1.3`, расхождение с шагом 2.2).
**Критерий готовности:** `npm run build` успешен; в `dist` нет `workers/src/game-engine`;
`grep -rn "shared/game-engine" src/` — пусто; все тесты зелёные.

---

### Что НЕ делать (зафиксировано, чтобы не спорить потом)

- Не пересобирать механики из OCR и не править `individual_cards/*.json` руками.
- Не расширять SQL RPC боя и не добавлять новых вызовов в SQL.
- Не включать Ably.
- Не менять стек (React 19 / Vite / R3F / Zustand / Supabase / DO).
- Не менять правила боя ради картинки (`combat.ts`).
- Не возвращать `Suspense` на карту в `Canvas`.
- Не коммитить `.env`, `.env.local`, `.env.production` (в репозитории они уже есть —
  см. «Остаточные вопросы к пользователю»).
- Не переписывать `docs/PERFORMANCE_AUDIT_3D.md` и `docs/PERFORMANCE_AUDIT_WORKERS.md`
  (в том числе «поправить» в них K4=20): расхождение зафиксировано в §6.2.

---

## Остаточные вопросы к пользователю

Эти пункты я **не** решал сам, потому что они либо требуют доступа к prod, либо
конфликтуют с заданными ограничениями. Каждый — с проверяемым фактом.

1. **`.env.local` и `workers/.dev.vars` НЕ отслеживаются git** — это проверено
   (`git ls-files` показывает только `.env.example` и `.env.production`). `.env` в
   `.gitignore`. Коммит `.env.production` — осознанный и задокументирован
   (`.gitignore`: «.env.production holds the Supabase anon publishable key … See
   BUILD_ENV.md»). То есть **запрет «не коммитить секреты из .env» сейчас не нарушен**,
   и отдельной фазы не требуется. Проверено, что в рабочем дереве `.env.local`
   существует и не отслеживается — риска утечки нет.
2. **`SNAPSHOT_EVERY_N_ACTIONS = 1` при 4 игроках.** Поднимать до 20 (рекомендация
   `PERFORMANCE_AUDIT_WORKERS K4`) можно **только после** Ф5 — иначе выгрузка партии
   потеряет несохранённые `use_ability`. План Ф11 этого не делает намеренно.
3. **`card_type: 'special'` (5 карт).** Нужно решение: расширять CHECK-констрейнт
   миграцией или переводить эти карты в `creature` в экспорте. Аудит не выбирает —
   это продуктовое решение. До него Ф6.2 не выполним.
4. **Ручная атака не подключена, хотя хук жив.** Проверено: `useAttack` → `useGameAction`
   → `GameScreen.jsx:212` передаёт `onAttack={attack}` в `GameBoard3D`, но
   `GameBoard3D` (строки 109-132) `onAttack` **не деструктурирует** — колбэк молча
   отбрасывается. Плюс `src/hooks/game/zoneOpposition.js` (с `getAttackTargets`,
   `canAttack`) жив — его использует `battlePhase.js:51` для маркеров урона, — но
   интерактивного выбора цели на столе нет: атака происходит только внутри `endTurn`.
   Нужно решение: планируется ли ручной выбор атакующего? Если да — это отдельная
   функциональная фаза (и она тянет за собой UI выбора цели и `use_ability`).

---

## Приложение A. Сводка «файл → что делает → чем дублируется → риск»

Компактная таблица для быстрой навигации по §2, §7 и §9.

| Файл | Что делает | Дублируется чем | Риск |
|---|---|---|---|
| `src/shared/game-engine/*.ts` (8) | реэкспорт-шимсы на `workers/` | — | тянет серверный движок в клиент; потребитель один и мёртв |
| `src/utils/cardFields.ts` | нормализация полей карты | `enrichGameCards.js:134`, `cards.ts:79`, `validation.ts:56` | 5 реализаций `getCardType` |
| `src/constants/game.js:7` `LAND_TYPES` | подписи/иконки земель | `landColors.js:7,18`, `cardCompositeTexture.js:71` | 3 несогласованных списка земель |
| `src/constants/landColors.js` | цвета земель (единственный «правильный») | — | эталон для Ф3 |
| `src/utils/cardCompositeTexture.js` | 3D-лицо карты | `CardDisplay.jsx`, `CardTile.jsx`, `CardForm.jsx` | вторая палитра; кэш не чистится при unmount |
| `src/components/Shared/CardDisplay.jsx` | «единый» компонент карты | обходит `getCardType` в 4 местах | не закоммичен, но уже в 4 потребителях |
| `src/components/Shared/CardTile.jsx:194-224` | статы плитки | `CardDisplay.jsx:104-112` | рисует сам, минуя `cardFields` |
| `src/components/CardForm.jsx:141-202` | превью формы | `CardDisplay.jsx` | отдельное лицо; не содержит `special` |
| `src/utils/stabilizeGameState.js:12-34` | сравнение карт для реконсиляции | — | **не видит `*_bonus` → баффы невидимы** |
| `src/hooks/game/zoneCards.js` | слоты зоны | `cards.ts:79` (Worker) | `findPlayableZone` мёртв |
| `src/hooks/game/cardAbilities.js:45` `getFlipCost` | стоимость флипа | `cards.ts:364` (Worker) | всегда 0, тело мёртвое |
| `src/hooks/game/useAbility.js` | отправка `use_ability` | — | 0 импортов → 315 механик недостижимы |
| `src/hooks/game/format.js` | нормализация зон | `useBoardModel.resolveLandType` | 3 из 5 экспортов мертвы |
| `src/utils/lobbyDeck.js:104` `shuffleDeck` | перемешивание | `workers/.../utils.ts:89` | копия без rng |
| `src/hooks/game/useFlipCard.js:62` | флип | — | **SQL-fallback без флага** + передаёт `player_id` как индекс |
| `src/hooks/game/useDraw*.js`, `useDiscard*.js`, `useShuffleDeck.js` | действия | — | **SQL-fallback без флага** |
| `src/hooks/useGraphicsSettings.js` | качество графики | — | 0 импортов; `textureScale` игнорируется |
| `src/components/Game/scene/FramePump.jsx` | `pulse()` для `demand` | — | `useFramePulse` 0 импортов → анимации не идут |
| `src/components/Game/gameBoard3D/PlacementPointerRelease.jsx:27` | drop по raycast | — | **`DOMRect.getBoundingClientRect()` не существует → drop мимо** |
| `src/components/Game/GameBoard3D.jsx:617` | флип с поля | — | передаёт `player_id` вместо индекса |
| `src/components/Game/GameBoard3D.jsx:334` | `onPlayCard` | — | третий арг — литерал `1` |
| `src/components/Game/scene/PostProcessing.jsx:42` | ACES | `GameCanvas.jsx:82` | **двойной tone mapping** |
| `src/components/Game/hud/HeroAvatar.jsx` | аватар героя | `HeroBadge.jsx` | 0 импортов, не рисует `image_url` |
| `src/utils/lobbyDeck.js:87` | payload колоды в лобби | — | **нет `heroId`** → герой не доходит до партии |
| `workers/src/game-engine/mechanics-runtime.ts:62` | отбор механик | SQL-контракт | **снята проверка статуса → 415 карт исполняются** |
| `workers/src/game-engine/mechanics-runtime.ts:138` | резолв целей | — | **`targetCardIds` без проверки владельца** |
| `workers/src/game-engine/mechanics-runtime.ts:164` | условия | — | **whitelist из 2 типов → 79 механик выключены** |
| `workers/src/game-engine/mechanics-runtime.ts:299` | applyAction | `mechanics.ts` (24 типа) | **8 типов — молчаливый no-op, 17 действий в каталоге** |
| `workers/src/game-engine/cards.ts:70` vs `validation.ts:27` | `getCardCost` | друг друга | **побайтово одинаковы, в 2 файлах** |
| `workers/src/game-engine/cards.ts:58` | `isLandCompatible` | `cardFields.ts:62` | клиент проверяет землю, Worker — нет |
| `workers/src/game-engine/game-room.ts:62` | частота снапшота | `PERFORMANCE_AUDIT_WORKERS:316` | **аудит говорит 20, код — 1** |
| `workers/src/catalog.ts` | KV-каталог | — | локально 0 записей → механики выключены |
| `scripts/reseed-cards.mjs:49` | полный reseed | `build-individual-supabase-sql.mjs` | **не пишет `mechanics_status`/`version`**; `special` конфликтует с CHECK |
| `scripts/assign-mechanics-status.mjs:15` | метка `implemented` | — | whitelist, без тестов; 11 карт помечены вакуумно |

---

*Конец аудита. По этому файлу можно править код, не перечитывая проект целиком.*