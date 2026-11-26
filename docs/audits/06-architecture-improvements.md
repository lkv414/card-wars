# Аудит архитектуры на улучшения (Card Wars v3)

Аудит проведён по фактическому состоянию кода во всех 6 пакетах (`domain`, `application`, `protocol`, `content`, `server`, `client`) и `tools/build-catalog.mjs`. Фокус — конкретные архитектурные улучшения с привязкой к `file:line` и приоритетами **P0 / P1 / P2**.

---

## 1. Domain & Mechanics v2

### 1.1. Декомпозиция монолитных файлов механик и устранение дублей хелперов
- **Где:** `packages/domain/src/mechanics/handlers-expansion.ts` (4414 строк), `handlers-audit.ts` (901), `handlers-h16.ts` (622), `handlers.ts` (523), `handlers-h3.ts` (173), `registry.ts:83-195`.
- **Проблема:** `handlers-expansion.ts` смешивает сотни именных обработчиков и локальные копии доменных примитивов (`bounceToHand`, `healPlayer`, `freezeLand`, `addBonus`, `addShield`, `discardCardFromHand` в `handlers-expansion.ts:19-96`). Это уже привело к расхождению контрактов: `discardCardFromHand` (`handlers-expansion.ts:86-96`) эмитит `card_discarded` и ставит в очередь `on_card_discarded`, но **не** вызывает `noteDiscard` (в отличие от `apply.ts:226`, `match/floop.ts:139`, `match/play.ts:183,248`).
- **Улучшение (P1):**
  1. Вынести общие примитивы (`discardFromHand`, `bounceToHand`, `freezeLand`, `healPlayer`, `payAdditionalCost`) в единый модуль `mechanics/primitives.ts` и использовать их и в `match/{play,floop}.ts`, и в `apply.ts`, и во всех `handlers-*.ts`.
  2. Разбить `handlers-expansion.ts` по доменным группам эффектов (`handlers/damage.ts`, `handlers/cards-hand.ts`, `handlers/lands.ts`, `handlers/tokens-auras.ts`, `handlers/deck-peek.ts`) и заменить ручной импорт 100+ символов в `registry.ts:5-62` на реэкспорт модульных карт `Record<string, MechanicHandler>`.

### 1.2. Дублирование правил между `domain`, `client` и `server`
- **Где:**
  - `apps/client/src/game/scene/CombatForecast.tsx:13-66` дублирует `packages/domain/src/zones.ts:4-103` (`mirrorZoneIndex`, `neighborOfView` / `neighborOf`, `opponentZoneForView` / `opponentZoneFor`) и формулу `canAttack` (`CombatForecast.tsx:181-187` vs `match/combat.ts:34-39`).
  - `apps/client/src/game/targeting.ts:64-284` дублирует логику легальности целей из `packages/domain/src/mechanics/resolve.ts:78-249` (`validTargets` vs `choiceMatchesAsk` + `askFilterPasses`), причём уже с расхождениями: в `targeting.ts` отсутствуют проверки `protections`, `targetingSuppressed`, `peek_card`, `adjacent_*` с учётом `countsAsTypes`, а также `undamaged` и `zoneToken` в `passes` (`targeting.ts:120-133` vs `resolve.ts:88-93`).
  - `apps/server/src/bot.ts:130-138` (`landRequirementMet`) и `apps/server/src/bot.ts:113` (`firstRoundForbidden`) дублируют `packages/domain/src/match/play.ts:27-35` и `packages/domain/src/match/floop.ts:57-68` без учёта `landCountModifier` и `frozenPlayPermitted`.
- **Улучшение (P1):**
  - Выделить чистые функции, работающие на минимальном интерфейсе проекции (`{ order, mode, teamVariant, teams, players }`), в общий чистый модуль `@card-wars/domain` (`zones` / `view-queries`) или `@card-wars/protocol`, чтобы `CombatForecast.tsx` и `domain` использовали одну математику линий и соседей.
  - Вынести перечисление легальных кандидатов целей (`enumerateValidTargets`) на базе общего `TargetAsk` + фильтрации или отдавать `validTargets` / `legalMoves` метаданными в `PendingChoiceView` (см. п. 3.2), убрав ручной `switch (ask.kind)` из `targeting.ts:135-250` и `bot.ts:44-102`.

### 1.3. Консистентность `afterEffects`, `PendingChoice` и мёртвый код в `match/`
- **Где:**
  - `packages/domain/src/deaths.ts:112-152` (`afterEffects`): вызывает `processDeaths` → проверку элиминации/победы → `drainTriggers`. Если во время `drainTriggers` срабатывает триггер, наносящий урон или сжигающий жизни, `afterEffects` повторно не вызывается до конца следующей команды (или вообще не вызывается, если триггер был последним в `resolvePending` — `mechanics/dispatch.ts:505,566`).
  - `packages/domain/src/match/play.ts:151`: для `companion` переменная `zone` равна `undefined`, но формируется ключ `` `${playerId}:${zone}` `` (`p1:undefined`) в `draft.zoneEntersThisTurn`.
  - `packages/domain/src/match/play.ts:83`: условие `p.zones === draft.players[pid]!.zones || true` всегда истинно (мёртвая ветка).
  - `packages/domain/src/match/turn.ts:81-86`: вычисляется `protectedIds` и затем `void protectedIds;`.
  - `packages/domain/src/match/turn.ts:131,146` и `151-155`: `draft.abilityUseCounts = {};` сбрасывается дважды; `draft.spellBansActive` фильтруется дважды подряд.
  - `packages/domain/src/match/floop.ts:127-147` и `match/play.ts:177-191`: дублируется код оплаты `additionalCost` (`handPicks`, `floopPicks`, `killPicks`).
- **Улучшение (P0/P1):**
  - **(P0)** В `resolvePending` (`dispatch.ts:505,566`) и в конце итерации `drainTriggers` (когда `queue` пустеет и `!draft.pending`) гарантировать фикс-поинт через `afterEffects` или цикл `processDeaths` + проверка победы, чтобы урон от отложенных триггеров не оставлял существ с `damage >= effDefense` на столе.
  - **(P1)** Почистить мёртвый код в `play.ts:83,151` и `turn.ts:81-86,131,146,151-155`; объединить оплату `additionalCost` в `mechanics/costs.ts`.

---

## 2. Protocol & Application

### 2.1. Дельта-стриминг журнала вместо отправки до 500 строк в каждом `snapshot`
- **Где:** `apps/server/src/room.ts:690-698, 897-902`, `packages/protocol/src/index.ts:121, 315-319`, `packages/application/src/view.ts:7, 170`.
- **Проблема:** При каждом действии любого игрока или бота `Room` вызывает `broadcastSnapshots` (`room.ts:905-913`), который сериализует `view.journal` целиком — до `MAX_JOURNAL_LINES = 500` строк (`room.ts:690`) на каждого подключённого клиента при **каждом** снапшоте. За партию из 150 команд это десятки мегабайт лишнего трафика и избыточной работы `ServerMessageSchema.safeParse` на клиенте (`connection.ts:72`).
- **Улучшение (P1):**
  - В `snapshot` передавать полный `journal` только при первичном подключении / реконнекте (или полем `journalSeq`), а инкрементальные строки слать в `events` (или отдельным компактным полем `journalDelta: string[]` + `journalSeq: number` в `snapshot` / `events`).
  - Клиентский `store.ts` накапливает журнал локально с ограничением `MAX_JOURNAL_LINES`, а при расхождении `journalSeq` запрашивает/получает полный срез.

### 2.2. Строгий тест-инвариант утечки скрытых данных в `GameEvent`
- **Где:** `packages/domain/src/events.ts:5-51`, `packages/application/src/view.test.ts:40-57`, `apps/server/src/room.ts:915-919`.
- **Проблема:** `Room.broadcastEvents` рассылает все `GameEvent` широковещательно (`room.ts:918`). В `view.test.ts:49-52` проверяется только `viewFor`, но **нет** автоматического инвариантного теста, проверяющего, что ни одно событие в `events` (включая `cards_revealed`, `hand_revealed`, `card_discarded`, `choice_required`) не утекает `instanceId` или `cardId` из скрытых рук/колод или приватных `peeks` (`Рикардио`).
- **Улучшение (P0):**
  - Добавить в `packages/application/src/view.test.ts` (и/или `property.test.ts`) строгий тест-инвариант: прогонять сидированные партии (и сценарии с `peeks`, `discard_from_hand`, `mulligan`, `draw_extra`) и проверять для каждого `GameEvent`, что JSON события не содержит ни одного `instanceId` из `hand` (если только это не публичный `hand_revealed` / `card_discarded`) и `deck` любого игрока, а `card_drawn` не содержит `cardId`/`instanceId`.

### 2.3. Разделение `cards-lite` и `abilities` для быстрого старта клиента
- **Где:** `tools/build-catalog.mjs:62-86, 128-130`, `packages/content/src/index.ts:2-58`, `apps/client/src/game/targeting.ts:1, 49-62`, `apps/client/src/game/scene/CardMesh.tsx:5, 40, 74`.
- **Проблема:** `cards.json` (23 851 строка, ~831 КБ) импортируется синхронно в `packages/content/src/index.ts:2`, причём содержит полное AST `abilities` всех 853 карт. Клиенту для рендера лобби, редактора колод и большинства 3D-компонентов нужны только метаданные (`id`, `name`, `type`, `cost`, `landType`, `attack`, `defense`, `image`, `description`, `deckSet`, `rumble`), а `abilities` нужны только для `targeting.ts` / тултипов в матче. Дополнительно, `targeting.ts:50,58,98,103,307-308,328-335` и `CardMesh.tsx:40` делают линейный `catalog.find(...)` по массиву из 853 элементов вместо `Map` (`catalog.getCard` уже есть в `content/src/index.ts:56`, но не используется в клиенте!).
- **Улучшение (P1):**
  - В `tools/build-catalog.mjs` генерировать `cards-lite.json` (без `abilities`) и `cards-abilities.json` (словарь `Record<cardId, AbilitySpec[]>`), подгружаемый лениво при входе в матч.
  - **(Quick Win, P1)** Сразу перевести `targeting.ts` и `CardMesh.tsx` на `catalog.getCard(id)` / `catalog.getHero(id)` (`O(1)` через `Map` из `@card-wars/content`) вместо `cards.find(...)` (`O(N)` на каждый рендер/кадр).

---

## 3. Server (Cloudflare Worker + Durable Object `Room`)

### 3.1. Разделение ключей хранения `RoomState` в Durable Object
- **Где:** `apps/server/src/room.ts:51-70, 105-118`.
- **Проблема:** Вся комната (сессии лобби с колодами по 40 карт, полный `MatchState`, до 500 строк `journal`, таймеры) хранится под одним ключом `'room'` и целиком перезаписывается при каждом действии (`ctx.storage.put('room', this.state!)`, `room.ts:117`), даже когда сменился только `botActionAt`, `timers` или пришёл `hurry`.
- **Улучшение (P2):**
  - Разделить хранение в `ctx.storage` на независимые ключи (или таблицы `ctx.storage.sql`):
    - `'meta'`: `version`, `phase`, `hostId`, `mode`, `hidden`, `anyLand`, `timers`, `paused`, deadlines;
    - `'sessions'`: массив `Session` (меняется в лобби и при connect/disconnect);
    - `'match'`: `MatchState` (меняется только при командах матча);
    - `'journal'`: дописывать батчами или хранить кольцевым буфером в SQLite, не перезаписывая при `hurry` / `lobby`.
  - В `persist()` писать только грязные (`dirty`) сегменты, чтобы не сериализовать колоды и журнал на каждый тик таймера.

### 3.2. Архитектура таргетинга ботов
- **Где:** `apps/server/src/bot.ts:19-109, 111-192`.
- **Проблема:**
  1. `findPlay` (`bot.ts:169-178`) и `findFloop` (`bot.ts:116-126`) **не передают `targets`** в команды `play_card` и `floop`, хотя домен требует их сразу для неинтерактивных заклинаний/флюпов (`play.ts:172`, `floop.ts:123`). При провале валидации `Room.performBotAction` (`room.ts:785-787`) молча откатывается на `go_battle`, из-за чего бот пропускает ход с доступными картами/флюпами.
  2. `resolvePendingForBot` (`bot.ts:44-102`) вручную перебирает часть `ask.kind` и игнорирует `ask.filter` (`landType`, `ready`, `maxCost`, `cardType`), `adjacent_creature`, `own_building`, `opponent_building`, `peek_card`, `damage_distribution`, а при ошибке снова падает в `go_battle` (который отклонён, пока есть `pending`!).
- **Улучшение (P0/P1):**
  - Вынести общий генератор валидных целей (из п. 1.2) в `@card-wars/domain` (`legalTargetsForAsk(stateOrView, ...)`), чтобы бот собирал корректный массив `targets` перед отправкой `play_card` / `floop` / `hero_ability` и при `resolvePendingForBot` учитывал `ask.filter` и все `TargetAskKind`.
  - Добавить в `bot.ts` поддержку `additionalCost` (`costPicksCount`) и скоринг целей (бить по самому опасному существу врага, баффать своё).

### 3.3. Защита от флуда (rate limiting) и лимиты размера WebSocket-сообщений
- **Где:** `apps/server/src/index.ts:27-37`, `apps/server/src/room.ts:131-175`.
- **Проблема:** `Room.webSocketMessage` (`room.ts:131-148`) принимает строку любой длины, парсит `JSON.parse(message)` и прогоняет через `ClientMessageSchema.safeParse(raw)` без ограничения размера payload и без rate limiting на одного клиента (например, спам `tomato`, `hurry`, невалидными `command` или гигантским JSON).
- **Улучшение (P1):**
  - В `room.ts:132` добавить жёсткий лимит размера входящего сообщения (например, `MAX_WS_MESSAGE_BYTES = 16_384`) до вызова `JSON.parse`.
  - Добавить легковесный in-memory rate limiter (token bucket на `WebSocket` / `playerId` в памяти DO, сбрасываемый при гибернации), ограничивающий частоту сообщений (например, не более 20 сообщений/сек и отдельный кулдаун на `tomato` / `hurry`).

---

## 4. Client State & 3D

### 4.1. Декомпозиция `store.ts` на слайсы
- **Где:** `apps/client/src/store.ts:47-148, 150-430`.
- **Проблема:** `store.ts` (430 строк) объединяет в одном плоском сторе и модульных глобальных переменных (`tomatoSeq`, `emoteTimeout`, `hintTimeout`) 4 разных домена:
  1. Сетевое состояние (`status`, `you`, `lobby`, `view`, `timer`, `error`, `eventsLog`, `sendCommand` sink);
  2. Игровой UI / DnD / таргетинг (`dragging`, `holdingFloop`, `targeting`, `zoomedCard`, `unfreezePrompt`);
  3. Камера и её снапы (`cameraMode`, `cameraSnap`, `watchMode`, `snapCameraTop/Player/Combat`, `cycleCameraPlayer` с повторяющимся парсингом префиксов `player_`/`top_`/`combat_` в `store.ts:231-350`);
  4. Эффекты соц-взаимодействия (`activeEmote`, `tomatoMode`, `tomatoFlights`, `tomatoSplats`).
- **Улучшение (P2):**
  - Разбить `store.ts` на Zustand-слайсы (`slices/connectionSlice.ts`, `slices/cameraSlice.ts`, `slices/interactionSlice.ts`, `slices/socialSlice.ts`), а логику разбора `cameraSnap` вынести в один хелпер `parseSnapTarget(snap)` в `cameraSnap.ts` (устранив 4-кратное дублирование `startsWith('player_' | 'top_' | 'combat_')` в `store.ts:240-326`).

### 4.2. Переиспользование геометрий/материалов и `InstancedMesh` в 3D-сцене
- **Где:**
  - `apps/client/src/game/scene/CardMesh.tsx:44-61, 379-386, 401-410, 419-446`: каждый экземпляр `CardMesh` создаёт собственные `<boxGeometry>`, `<planeGeometry>`, `<ringGeometry>`, `<circleGeometry>` и `new THREE.MeshLambertMaterial({ map: back })` (`CardMesh.tsx:49`).
  - `apps/client/src/game/scene/PlayerBoard.tsx:146-161`: `DeckPile` рендерит до 8 отдельных `<mesh>` со своими `<boxGeometry>` и `<meshLambertMaterial>` на каждую колоду (до 32 draw calls только на стопки колод в 2v2).
  - `apps/client/src/game/scene/PlayerBoard.tsx:319-335`: `OpponentHand` рендерит до 10 `<mesh>` с отдельными `<boxGeometry>` на каждого соперника (до 30 draw calls в 4-плеере).
  - `apps/client/src/game/scene/PlayerBoard.tsx:341-356`: `LivesTokens` рендерит до 20 `TokenMesh` (`cylinderGeometry` + `meshLambertMaterial`) на игрока.
  - `apps/client/src/game/scene/CombatForecast.tsx:145-165`: `ForecastIndicator` создаёт новые `<planeGeometry>` и `<coneGeometry>` на каждую стрелу.
- **Улучшение (P2):**
  - Вынести общие `THREE.BoxGeometry` / `THREE.PlaneGeometry` / `THREE.CylinderGeometry` и `backMaterial` в модуль общих ресурсов сцены (`scene/sharedResources.ts`) — геометрии не зависят от карты и переиспользуются между всеми экземплярами без переаллокации GPU-буферов.
  - Перевести повторяющиеся однотипные меши (`DeckPile` слои, `OpponentHand` карты, `LivesTokens` / `DamagePile` жетоны) на `THREE.InstancedMesh` (1 draw call на стопку вместо 8–20).

---

## 5. Приоритизированная дорожная карта рефакторинга

### Quick Wins (1–2 дня, низкий риск)
| Задача | Пакет / Файл | Приоритет | Эффект |
|--------|--------------|-----------|--------|
| Заменить `cards.find` / `heroes.find` на `catalog.getCard` / `catalog.getHero` | `client/src/game/targeting.ts`, `CardMesh.tsx` | **P1** | O(1) поиск вместо O(N) по 853 картам |
| Добавить тест-инвариант отсутствия утечек скрытых ID в `GameEvent` | `application/src/view.test.ts` | **P0** | Гарантия скрытия информации для всех событий |
| Почистить мёртвый код и дубли в `play.ts:83,151` и `turn.ts:81,131,151` | `domain/src/match/{play,turn}.ts` | **P1** | Устранение потенциальных багов с `companion` и чистый код |
| Добавить лимит размера WS-сообщений и базовый rate limit | `server/src/room.ts:131-175` | **P1** | Защита DO от DoS и лишнего парсинга |
| Вынести `parseSnapTarget` и общие геометрии/backMaterial в `sharedResources.ts` | `client/src/store.ts`, `scene/*` | **P2** | Меньше кода и меньше GPU-аллокаций |

### Medium (3–5 дней)
| Задача | Пакет / Файл | Приоритет | Эффект |
|--------|--------------|-----------|--------|
| Фикс-поинт `afterEffects` после `resolvePending` / `drainTriggers` | `domain/src/mechanics/dispatch.ts`, `deaths.ts` | **P0** | Исключение зависших «неубитых» существ после отложенных триггеров |
| Единые `mechanics/primitives.ts` (включая `noteDiscard` и `additionalCost`) | `domain/src/mechanics/handlers-expansion.ts`, `match/*` | **P1** | Консистентность триггеров сброса и минус сотни строк дублей |
| Вынести `opponentZoneForView` / `neighborOfView` в общий модуль | `domain/src/zones.ts`, `client/.../CombatForecast.tsx` | **P1** | Единый источник правды для 2v2/FFA геометрии |
| Дельта-стриминг журнала (`journalDelta` + `journalSeq`) | `protocol/src/index.ts`, `server/src/room.ts`, `client/src/store.ts` | **P1** | Снижение размера каждого `snapshot` на десятки КБ |
| Разделить `cards-lite.json` и `cards-abilities.json` в сборке каталога | `tools/build-catalog.mjs`, `content/src/index.ts` | **P1** | Ускорение холодного старта клиента (меньше стартовый JS/JSON) |
| Вынести таргетинг ботов на общий генератор легальных целей | `domain/src/mechanics/resolve.ts`, `server/src/bot.ts` | **P0/P1** | Боты корректно играют таргетные карты/флюпы и фильтруемые `pending` |

### Strategic (1–2 недели)
| Задача | Пакет / Файл | Приоритет | Эффект |
|--------|--------------|-----------|--------|
| Разбить `handlers-expansion.ts` (4414 строк) на тематические модули | `domain/src/mechanics/handlers/*` | **P1** | Поддерживаемость и быстрая навигация по механикам |
| Разбить `RoomState` в DO на сегментированные ключи / SQLite-таблицы | `server/src/room.ts` | **P2** | Экономия I/O Durable Object и изоляция горячих данных (`timers`) |
| Слайсы в `store.ts` и `InstancedMesh` для стопок/жетонов/рук соперников | `client/src/store.ts`, `scene/{PlayerBoard,DamagePile}.tsx` | **P2** | Масштабируемый клиентский стейт и снижение draw calls в 2v2 |
