# Аудит Card Wars (v2) — 2026-10-18

Составлен по результатам статического анализа репозитория `card_game` (ветка `v2`).
Фокус: механики и рантайм, работоспособность во время сессии игры, визуальное отображение.

## 0. Исправлено в этой итерации (2026-10-18)

- `src/components/Game/GameBoard3D.jsx` — `handleRayRelease`: передача `myIndex` вместо жёсткого `1` в `onPlayCard`.
- `package.json` — `test` теперь `vitest run` (ранее ссылался на удалённый скрипт).
- `workers/src/game-engine/mechanics-runtime.ts` — `applyMechanic`: откат verb-уничтожения источника, если ни одно действие не applied.
- `workers/src/game-engine/mechanics-runtime.ts` — `deal_damage`/`aoe_damage`: учёт `immune_to` (пропуск целей, невосприимчивых к урону от заклинаний).
- `workers/src/game-room.ts` — `loadGame`: всегда публиковать state после загрузки; `canReadGame`: fallback-загрузка при eviction.
- `src/components/Game/GameBoard3D.jsx` — passive markers: поддержка `Map` (cardCatalog), а не только массив.
- `src/components/Game/GameBoard3D.jsx` / `ZoneColumn.jsx` — `damageFlashKeys` (массив) вместо одной строки — подсветка нескольких карт.
- `src/components/Game/GameBoard3D.jsx` — `myIndex` добавлен в deps `handleRayRelease`.

## 0. Общее состояние репозитория

- `npm test` сломан: `package.json` вызывает `node scripts/run-unit-tests.mjs`, но папка `scripts/` удалена (AGENTS.md). Восстановить скрипт или переписать команду на `vitest run`.
- `test:engine` и `test:smoke` падают в текущем окружении из-за OOM/worker-crash (не обязательно код). `test:store` тоже падает OOM. Для CI нужен запуск с `--max-old-space-size` и ограничением параллелизма.
- Каталог: 504 карты. `implemented` — 89 (17.7%), `text_only` — 75, `unreviewed` — остальные. 177 карт с неоднозначными землями (`cute`, `cotton`, `plains`, `plain`, `rainbow`, `sandy`, `desert`). 94 карты `ftg` с OCR-ошибками. 7 карт с `null` attack/health. 5 карт типа `special`. 15 карт без изображений.
- Скиллы в `skills/` каноничны, локальные копии в `.agents/skills/` могут расходиться.

## 1. Механики и рантайм (engine)

### 1.1. `evaluatePredicate` — хрупкий хардкод русских строк
- Файл: `workers/src/game-engine/mechanics-runtime.ts`, функция `evaluatePredicate`.
- Все условия проверяются по подстрокам `description` (русский текст). Любое изменение описания карты ломает условие. Нет типизированных условий.
- **Улучшение:** ввести структурированные условия (`type`, `value`, `op`) в каталоге, оставить `description` только для UI. `evaluatePredicate` должен работать по полям, а не по тексту.

### 1.2. Нереализованные таргеты
- `resolveTargets` возвращает `[]` для `each_creature_in_lane`, `each_creature_landscape`, `each_opponent`. Эти таргеты есть в `IMPRECISE_TARGETS`, поэтому механики с ними всегда дают `imprecise_target` и не применяются.
- **Улучшение:** реализовать логику или убрать эти таргеты из каталога и пометить карты `text_only`.

### 1.3. `move` с `destination: 'opponent_lane'` не поддерживается
- Возвращает `unsupported_move:opponent_lane`. Если такие механики есть в каталоге — они мёртвые.
- **Улучшение:** реализовать перемещение на вражескую линию или исключить из `EXECUTABLE_ACTION_TYPES`.

### 1.4. `stat_buff` со строковым `amount`
- `unsupportedActionReason` отклоняет `stat_buff` с `amount` типа string. В каталоге могут быть такие карты (например, "x2", "equal_to_damage").
- **Улучшение:** либо реализовать парсинг строковых amount, либо пометить такие карты `text_only` и убрать из `implemented`.

### 1.5. `immunity` — мёртвый код
- `immune_to` устанавливается на карту, но нигде не проверяется (ни в `combat.ts`, ни в `deal_damage`). Поле не влияет на исход.
- **Улучшение:** либо реализовать проверку `immune_to` в `deal_damage`/`aoe_damage`/combat, либо убрать действие.

### 1.6. `dispatchMechanicEvent` использует исходное состояние
- Итерирует `allCards(state)` (старое состояние), а не `next`. Карты, появившиеся в ходе события (например, через `mill`), не получают триггеры `on_enters_play`.
- **Улучшение:** пересчитывать `allCards` от `next` после каждой мутации или вызывать диспатч рекурсивно.

### 1.7. Verb-обработка не откатывается при неуспехе
- В `applyMechanic` уничтожение источника (verb `уничтожь`) выполняется до применения действий. Если действия не applied, источник уже удалён — `applyMechanicOrKeep` возвращает старое состояние, но мутация verb уже применена к `next`.
- **Улучшение:** выполнять verb-обработку только после успешного применения хотя бы одного действия, либо откатывать при `!applied`.

### 1.8. `mill` — сложная и непроверенная логика
- Цикл `while (deck.length && !found)` с условием выхода `drew >= count + revealed.length + (found ? 1 : 0)`. Возможна потеря карт или зацикливание при больших `count`.
- **Улучшение:** добавить тесты на крайние случаи (пустая колода, нет существ, count > размер колоды).

### 1.9. `canPlayerDealDamage` — спорная логика для 3-4 игроков
- Формула `attackerOrder >= aliveCount || turn >= aliveCount - 1`. Для 4 игроков только 4-й бьёт на ходах 0-2, все бьют с хода 3. Нужно сверить с оригинальным SQL.
- **Улучшение:** вынести в отдельный тест с ожидаемыми значениями из `DB_SCHEMA.sql` / оригинальных правил.

### 1.10. `cleanupTemporaryEffects` — только 3 стата
- Очищает бонусы только для `attack`/`defense`/`health` с duration `this_turn`. Если появятся другие временные эффекты (например, `shield`), они не очистятся.
- **Улучшение:** обобщить через список временных полей.

### 1.11. `cardKey` vs `instanceId`
- В engine `cardKey` = `instanceId ?? id`. В клиенте `makeCardKey` использует `instanceId || id`. В broadcast `hand: []` для чужих игроков. Если `instanceId` отсутствует, возможны коллизии. Нужно гарантировать `instanceId` при создании игры.

## 2. Работоспособность во время сессии игры

### 2.1. `handleRayRelease` — передаёт `1` вместо `myIndex`
- Файл: `src/components/Game/GameBoard3D.jsx`, функция `handleRayRelease`.
- Вызов `onPlayCard?.(cardIdx, target.zoneIndex, 1, target.slotType)` — третьим аргументом передаётся `1` (жёстко), хотя должен быть `myIndex` (индекс игрока). Это приводит к тому, что карта кладётся не на ту сторону/в не тот слот.
- **Улучшение:** заменить `1` на `myIndex` (или убрать аргумент, если не нужен).

### 2.2. `npm test` и тесты
- `package.json` → `node scripts/run-unit-tests.mjs` (файл удалён). Команда всегда падает.
- **Улучствие:** обновить `test` на `vitest run` или восстановить скрипт.

### 2.3. `canReadGame` — зависимость от lobby DO
- Если DO evicted и `currentGame` null, проверка идёт через `isNativeLobbyMember` → HTTP-запрос в lobby DO. Если lobby DO недоступен, доступ запрещён.
- **Улучшение:** добавить fallback-проверку по `currentGame` после загрузки и кэшировать membership.

### 2.4. `loadGame` — публикация только при ботах
- После загрузки `publishCurrentState` вызывается только если `ensureBotSeats()` вернул `true`. Если ботов нет, состояние не пушится автоматически — клиент получит его только при join.
- **Улучшение:** всегда публиковать после успешной загрузки.

### 2.5. `processedRequests` — idempotency только при requestId
- Если клиент не передаёт `requestId`, дублирование не предотвращается.
- **Улучшение:** гарантировать `requestId` на клиенте (уже делает `useGameTransport`).

### 2.6. `state-broadcast` — redaction
- `redactForViewer` обнуляет `hand` и `deck_pile`, но `hand_count`/`deck_pile_count` добавляются отдельно. Нужно проверить, что клиент использует именно эти поля, а не `hand.length`.
- **Улучшение:** добавить тест на broadcast shape.

### 2.7. `gameStore.applyServerState` — версионирование
- Отклоняет state с `incomingVersion < currentVersion`. При reconnect с той же версией применяется. Но `stabilizeGameState` может терять данные (не изучено).
- **Улучшение:** добавить тест на reconcile после reconnect.

### 2.8. `useGameTransport` — timeout 45s
- `ACTION_TIMEOUT_MS = 45_000`. Долгие действия (например, бот-ход) могут превысить лимит.
- **Улучшение:** увеличить таймаут или сделать динамическим.

### 2.9. Passive markers в `GameBoard3D`
- Логика `passiveCardsRef` использует `cardCatalog` как массив, но проп `cardCatalog` может быть объектом (catalog). Если объект — `Array.isArray` false, и passive markers никогда не срабатывают.
- **Улучшение:** нормализовать проп (принимать и массив, и объект) или передавать массив.

### 2.10. Утечки таймеров
- `setTimeout` в `triggerPassiveVisual`, `triggerDamageVisual` и `passiveMarkers` не очищаются при unmount (кроме `damageTimersRef`). При частых обновлениях накапливаются.
- **Улучшение:** использовать единый таймер-менеджер с очисткой.

### 2.11. `GameBoard3D` — `damageFlashKey` только для одной карты
- Если несколько карт одновременно получают урон, подсветится только одна.
- **Улучшение:** сделать `damageFlashKey` массивом или Set.

## 3. Визуальное отображение

### 3.1. Единый `CardFace`
- Скилл `r3f-board-3d` требует, чтобы лицо карты рисовалось только через `CardFace`/`cardFaceModel.js`. Нужно проверить, что `scene/GameObject.jsx` и `Shared/CardDisplay.jsx` не дублируют логику.
- **Улучшение:** аудит на использование `CardFace` во всех местах.

### 3.2. `CardFace` и `cardFields.ts`
- Поля карты должны читаться только через `cardFields.ts`. Проверить `GameObject.jsx`, `ZoneColumn.jsx`, `HUDDropZones.jsx`.
- **Улучшение:** линтер-правило или тест на прямой доступ к полям.

### 3.3. Цвета земель
- Только из `src/constants/landColors.js`. Проверить, что `GameObject` и `GameLand` не хардкодят цвета.
- **Улучшение:** аудит.

### 3.4. `useGraphicsSettings`
- Качество и тени зависят от настроек. Проверить, что `GameCanvas` и `PostProcessing` уважают их.
- **Улучшение:** тест на переключение качества.

### 3.5. Позиции/повороты — модульные константы
- `sceneResources.js` содержит константы. Проверить, что `memo` работает (нет inline-объектов).
- **Улучшение:** профилирование re-render.

### 3.6. `onPointerMissed` и `PlacementPointerRelease`
- Не ломать при изменениях. Проверить после рефакторинга.
- **Улучшение:** smoke-тест на клик по пустому месту.

### 3.7. Accessibility
- ARIA, focus, keyboard. `frontend-a11y` скилл. Проверить модальные окна (`Modal.jsx`, `ConfirmDialog.jsx`) и меню.
- **Улучшение:** добавить focus-trap (уже есть `useFocusTrap.js`) везде.

### 3.8. Производительность 3D
- `BoardOutlines` использует InstancedMesh. Проверить остальные объекты.
- **Улучшение:** профилирование, lazy-loading текстур.

## 4. Каталог данных (кратко)

- Нормализовать `land_type` в `individual_cards/cards.json` (R1 из CATALOG_REVIEW).
- Исправить 94 `ftg` карты (OCR).
- Исправить 7 карт с null attack/health.
- Решить судьбу 5 `special` карт (2v2 или конвертация).
- Расширить покрытие `implemented` (сейчас 17.7%).
- `image_index` 33 пропуска — проверить маппинг.

## 5. Рекомендации (приоритеты)

### P0 (критично)
1. Исправить `handleRayRelease` (`1` → `myIndex`).
2. Восстановить `npm test` (scripts удалены).
3. Исправить verb-обработку в `applyMechanic` (откат при неуспехе).
4. Добавить проверку `immune_to` или убрать действие.

### P1 (высокий)
1. Реализовать или убрать `each_creature_in_lane`, `each_creature_landscape`, `each_opponent`.
2. Реализовать или убрать `opponent_lane` move.
3. Структурировать условия (`evaluatePredicate`) — убрать хардкод.
4. `dispatchMechanicEvent` использовать обновлённое состояние.
5. Нормализовать земли в каталоге.
6. Добавить тесты на крайние случаи (mill, search, peek).

### P2 (средний)
1. Унифицировать passive markers (использовать cardCatalog корректно).
2. Оптимизировать таймеры в `GameBoard3D`.
3. Проверить `stabilizeGameState` и `mapGameState`.
4. Добавить проверки `immune_to` в UI.
5. Всегда публиковать state после `loadGame`.

### P3 (низкий)
1. Улучшить 3D производительность (instancing, memo).
2. Добавить accessibility (ARIA, focus).
3. Обновить README (scripts удалены).
4. Профилирование re-render.

## 6. Источники

- `docs/CATALOG_REVIEW.md` — аудит каталога.
- `FIX_GAMEBOARD3D.md` — известные баги 3D.
- `MEMORY.md` — факты окружения.
- Скиллы: `card-wars-rules`, `r3f-board-3d`, `worker-durable-objects`, `project-gate`.
- Код: `workers/src/`, `src/`.