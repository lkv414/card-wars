# Аудит производительности: card_game (3D-поле)

Дата: 2026-09-02
Объём анализа: `src/components/Game/**` (GameBoard3D, scene/*, gameBoard3D/*), утилиты
(`textureCache`, `useCardTexture`, `cardSceneHelpers`, `sceneHelpers`, `gameObjectPlacement`,
`stabilizeGameState`, `enrichGameCards`), стор (`store/gameStore`), транспорт
(`gameWebSocket`, `useGameTransport`, `useGameWsHandler`), `vite.config.js`, `dist/`, скиллы
`3d-web-experience` / `react-performance` / `vite-patterns` / `frontend-patterns` / `threejs-*`.

Стек: React 19.2 · Vite 8 · @react-three/fiber 9.6 · @react-three/drei 10.7 · three 0.185 ·
zustand 5 · Supabase + Cloudflare Workers (Durable Object, WS).

---

## 1. Оценка производительности проекта в целом

### 1.1 Бандл (факт по `dist/assets`)

| Файл | Размер | Комментарий |
|---|---|---|
| `three-vendor-B5Q9HIVP.js` | **1 078 KB** | three + R3F + drei + three-stdlib + troika + gainmap-js в один чанк |
| `index-G7t18LDJ.js` | **543 KB** | app-код + supabase-js + react-router |
| `GameBoard3D-*.js` | 50 KB | ленивый, ок |
| `GameScreen-*.js` | 36 KB | ленивый, ок |
| `index-*.css` | 79 KB | |
| **Итого (raw)** | **≈ 1.66 MB** | ≈ **430–480 KB gzip** на первый загруз `/game/:id` |

Оценка TBT на среднем Android (Snapdragon 6xx / A53): **1.5–3.0 с**. Парс+скомпилировать
1 МБ three-vendor — это главный вклад в TTI игрового экрана.

Проблемы:
- `vite.config.js:105-114` — один `manualChunks` на все `three`, `@react-three/fiber`,
  `@react-three/drei`. Из-за этого в чанк попадают транзитивные тяжёлые зависимости,
  которые реально не нужны на горячем пути: `three-stdlib` целиком (тянет `RGBELoader` +
  `EXRLoader` + `@monogrid/gainmap-js` + `troika-three-text` + `troika-worker-utils`).
  `useEnvironment` (`node_modules/@react-three/drei/core/useEnvironment.js:8`) импортирует
  все четыре загрузчика статически — вы платите за HDRJPG/GainMap, хотя грузите `.hdr`.
- Нет `rollup-plugin-visualizer`, нет `build.chunkSizeWarningLimit`, нет явного
  `build.target`. В `skills/vite-patterns` это прямо помечено как обязательная практика.
- `GameBoard3D` грузится лениво только на экране игры — нет `preload` на экране лобби
  (паттерн «preload on hover/focus» из `react-performance`).

### 1.2 React: ре-рендеры

**Что сделано хорошо** (видно, что боролись осознанно, см. `docs/BUG_RELOAD_DIAGNOSIS.md`):
- `useCardTexture` вместо `useLoader` → нет Suspense-thrash (RC1 закрыт).
- `stabilizeGameState` + `dedupCardsById` сохраняют ссылки при семантически равном стейте.
- `safePlayers`/`safePlayer` возвращают prev-ссылку, если Players не изменились.
- `makeCardKey` стабилизирует `key` карточек (RC5 закрыт).
- `memo(GameBoard3D, gameBoard3DAreEqual)` на верхнем уровне.

**Что сломано / не работает:**

1. **`memo` на `GameLand` и `GameObject` полностью бесполезен.**
   В `GameBoard3D.jsx:482-575` в рендере каждый раз создаются новые ссылки:
   ```jsx
   onClick={() => { ... }}                                   // новая функция
   position={[slots.creature.x, PLAY_FIELD_Y + 0.004, ...]}  // новый массив
   rotation={[-Math.PI / 2, 0, 0]}                           // новый массив
   card={resolveCardVisual(rawCreature, cardCatalog)}        // новый объект (spread, строка 146)
   slots={getLandSlotLayout()}                               // новый объект (строка 464, 8 раз за рендер)
   ```
   `memo` сравнивает по ссылкам → всегда промах → на **каждое** обновление стейта
   ре-рендерятся все 8 `GameLand` и до 16 `GameObject`, а внутри каждого — 8–10 R3F-узлов
   плюс 4 `<Text>` (troika). Итог: **≈ 180 React-узлов + 58 troika-текстов** ре-рендерятся
   при каждом WS-push и при каждом клике.

   *Хорошая новость:* геометрии при этом **не** пересоздаются. Проверено в
   `node_modules/@react-three/fiber/dist/events-b389eeca.esm.js:15354` — `reconstruct`
   только если изменились значения `args` (`is.equ(..., {arrays:'shallow'})`). То есть
   стоимость — чистый React-reconcile, не GPU. Но именно он даёт просадку в момент
   розыгрыша карты.

2. **`useStableZoneCards` (`GameBoard3D.jsx:72-97`) не даёт того, что обещает.**
   Два вложенных `useMemo`, оба в итоге зависят от `players`; а результат всё равно
   перетирается `resolveCardVisual()` в теле рендера (строка 460-461) — новая ссылка на карту
   каждый рендер. Сложность есть, выигрыша нет.

3. **`updatePointer` (`:277-293`) вызывает `getBoundingClientRect()` на каждый `pointermove`.**
   Это принудительный layout/reflow на каждое движение мыши, причём во время drag-and-drop,
   когда кадры всего дороже. Контейнер — `position: relative; width:100vw; height:100vh`
   (`src/styles/game.css:5-9`), его rect меняется только на resize.

4. **Ручной компаратор `gamesEqual` (`:703-728`) — хрупкий.**
   Сравниваются 6 скаляров + **только длина руки**. Любое семантическое изменение,
   не попавшее в этот список, молча теряется (сейчас спасает только `a.version !== b.version`).
   Функциональные пропсы (`toast`, `onPlayCard`…) не сравниваются вообще.

5. **Росты без границ и утечки таймеров:**
   - `setBattleEvents((prev) => [...prev, ...events])` (`:428`) — массив растёт всю партию;
     `HUDOverlay` на каждое изменение пересчитывает `mergeLogWithBattle` (`:53`).
   - `triggerDamageVisual` (`:392-411`) — два `setTimeout` без cleanup; при уходе со страницы
     таймеры стреляют в размонтированный компонент.
   - `handleEndTurn`/`handleRayRelease` — `useCallback` с зависимостью от `handCards`/`me`
     → новая ссылка почти на каждое обновление → `PlacementPointerRelease` переподписывает
     `window.addEventListener('pointerup', …, true)` (`PlacementPointerRelease.jsx:37`).

6. **`useGameEnrichment`** на каждое изменение `[game, game?.version]` делает
   `collectMissingCardIds` — полный обход hand/deck/discard/zones всех игроков
   (30–40 карт × 4 игрока = ~150 объектов) и затем `applyServerState` → ещё один
   проход `stabilizeGameState`. На каждый ход это 2–3 полных прохода по стейту.

7. `GameScreen.jsx:248` — `useGameSessionCache` — in-memory `Map`, безопасно (название
   `sessionStorage` в комментарии вводит в заблуждение, но проблемы нет).

### 1.3 Ассеты и текстуры

- **Исходники карт**: 1923 PNG, **1.06 GB** на диске, медианный размер **797×1104**.
  `textureCache.js:8-27` грузит их `THREE.TextureLoader` без ограничений:
  - `generateMipmaps` по умолчанию `true` → VRAM на одну карту
    `797 × 1104 × 4 × 1.33` ≈ **4.7 МБ**.
  - Полное поле (16 карт) + рука (DOM) → **75–110 МБ** только под art.
  - Нет KTX2/Basis, нет WebP/AVIF, нет ресайза под `maxTextureSize`, нет `anisotropy`.
- **`textureScale` из `useGraphicsSettings()` вычисляется и нигде не используется** —
  мёртвая настройка качества.
- **Текстуры никогда не освобождаются.** `clearTextureCache()` (`textureCache.js:29`)
  не вызывается нигде. За долгую партию с 30–40 уникальными картами
  (свои + все карты оппонентов, которые открывались) VRAM растёт монотонно до
  ~190 МБ → `webglcontextlost` на мобильных. **Это проблема №1 по памяти.**
- **Баг порядка** в `textureCache.js:13-23`: `loader.setCrossOrigin(...)` вызывается
  **после** `loader.load(...)`. Первая загрузка каждого URL идёт с предыдущим значением
  crossOrigin.
- Нет предзагрузки: каждая карта стартует с фиолетового `PLACEHOLDER_COLOR` и подменяется
  на art после сети → видимый pop-in при каждом розыгрыше.

### 1.4 Сеть / синхронизация

- WS-транспорт сделан качественно: reconnect с backoff (`gameWebSocket.js:163`),
  `join` на open, FIFO-очередь (`useGameWsHandler.js:36`), `sendActionAsync` с `requestId`
  и таймаутом 45 с. Нареканий нет.
- **Дублирование источника истины:** помимо WS есть Supabase-path
  `useGameState.writeGameState` (`useGameState.js:31-120`) — optimistic lock по `version`,
  3 ретрая с `sleep(100)` и **полным `reload()` после каждого успешного write** (`:92`).
  То есть один ход = write + reload + WS-push = **2–3 полных применения стейта**,
  каждое из которых = `stabilizeGameState` + `dedupCardsById` + React-reconcile.
- **Нет дельт.** DO шлёт **полный** снэпшот игры на каждое действие. Для 4 игроков
  × 4 зоны × колоды это 20–60 KB JSON; каждый push = `JSON.parse` + stabilize + ре-рендер
  180 узлов. При серии быстрых действий главный поток насыщается.
- `gameDebugLog` (`utils/gameDebug.js`) в prod выключен по умолчанию — ок.
- Fallback-загрузка через RPC только если за 12 с не пришло **ни одного** стейта
  (`GameScreen.jsx:154-164`); частичная деградация (WS жив, но пуши не идут) не обрабатывается.

### 1.5 Оценочные метрики (по коду, без профилирования на устройстве)

| Метрика | Desktop (dGPU) | Mid Android / iPhone SE | 4 игрока |
|---|---|---|---|
| Draw calls | ~182 | ~182 | ~350 |
| Треугольники | ~1.5 K | ~1.5 K | ~3 K |
| Прозрачных quad'ов | ~97 | ~97 | ~190 |
| Troika `<Text>` инстансов | 58 | 58 | 114 |
| VRAM (карты + SDF + PMREM + shadow) | 150–220 МБ | 150–220 МБ | 250–350 МБ |
| FPS в покое | 60 (но GPU греется зря) | 30–45 | 20–35 |
| FPS в момент розыгрыша карты | 45–60 | **12–25** | 8–18 |
| TBT на загрузке экрана игры | 300–600 мс | 1.5–3.0 с | то же |

**Вывод: сцена не упирается в геометрию (1.5 K треугольников — ничто). Она упирается в
draw calls, прозрачность/overdraw, troika-текст и постоянный 60 fps рендер при полностью
статичном кадре.**

---

## 2. Детальный анализ 3D-части

### 2.1 Архитектура сцены

```
GameScreen (zustand: gameStore)
└─ GameBoard3D  (memo; ВСЯ визуальное состояние в 6×useState)          740 строк
   ├─ GameCanvas  <Canvas> + <Suspense fallback={null}>                76 строк
   │  └─ GameExperience                                               120 строк
   │     ├─ <color> + <fog near=18 far=40>
   │     ├─ <Environment preset="city" />      ← SUSPENSE + внешний CDN
   │     ├─ ambient + hemisphere + directional(castShadow, 1024²) + point
   │     ├─ TableDecor: 2 cylinder + сукно + PlayFieldGrid (9 quad'ов)
   │     ├─ AdaptiveCamera (useLayoutEffect мутирует camera/controls)
   │     ├─ OrbitControls (enableDamping по умолчанию)
   │     ├─ zones.map(8) → <group> + GameLand + GameObject(creature) + GameObject(building)
   │     ├─ PlayerNameLabels → N × <Text>
   │     ├─ damageMarkers.map → GameDamageFloater × <Text>
   │     └─ PlacementPointerRelease (useThree + window pointerup)
   ├─ LandSetupOverlay / DamageFlashOverlay / ZoneCardActionMenu       DOM
   ├─ GamePanel → HUDOverlay (+ HUDHand: <img> на каждую карту)        DOM
   └─ drag ghost <img>                                                 DOM
```

Сильные стороны: чистое разделение Canvas / Experience / объекты; вся геометрия в чистых
функциях (`gameObjectPlacement.js`); HUD вне Canvas; Suspense-free текстуры.

Слабые: **единственный владелец состояния — React `useState` в компоненте, который
замемоен на версию сервера.** Любое визуальное изменение (hover, drag, вспышка урона)
перерисовывает всё поле. Нет разделения на «модель доски» и «представление», нет
императивного канала для анимаций.

### 2.2 Материалы, текстуры, кэширование

| Что | Как сейчас | Проблема |
|---|---|---|
| Лицо карты | свой `meshStandardMaterial` на карту (`GameObject.jsx:346`) | 16 разных PBR-материалов; батчинг невозможен |
| Индикаторы (cost/atk/hp/flip) | свой `meshStandardMaterial` + `planeGeometry` на каждый | PBR-шейдер для цветного квадрата 0.25×0.2 — дороже самой карты |
| Земля | свой материал + `useMemo(new THREE.Color())` | ок, но можно шарить по `landType` |
| Обводки | `meshBasicMaterial` | ок |
| Геометрии | `<planeGeometry args={...}/>` в каждом компоненте | **180 отдельных BufferGeometry** вместо 3–4 шаренных |
| `side={THREE.DoubleSide}` на карте (`:352`) | backface culling выключен | ×2 fragment-работы; камера всегда сверху (`maxPolarAngle = π/2.05`),背面 не видна |
| Текстуры | модульный `Map`, без LRU и без dispose | монотонный рост VRAM, `clearTextureCache()` мёртв |
| `<Outlines>` | +1 mesh + BackSide-шейдер на выделение | ок, но включается только по выделению |

Дублирование констант: `LAND_GEOMETRY` объявлен и в `cardSceneHelpers.js:33`, и в
`gameObjectPlacement.js:26`; `SELECTION_COLOR` — в `cardSceneHelpers.js:50` и
`sceneHelpers.js:95`, плюс хардкод `'#fbbf24'` в `GameObject.jsx:330/355`,
`GameLand.jsx:52`, `PlayerNameLabels.jsx:42`. `ATTACK_TARGET_COLOR`, `getLandColor`,
`getCardObjectType` не используются.

### 2.3 Draw calls, overdraw, инстансинг, culling

Реальный бюджет на 2 игроков, полное поле:

| Группа | Объектов | Draw calls |
|---|---|---|
| TableDecor (стол, войлок, сукно) | 3 меша | 3 |
| PlayFieldGrid (линии + рамка) | 9 quad'ов | 9 |
| Земли (8 × LandMat + 4 обводки + 2 слота) | 56 мешей | **56** |
| Карты: 8 существ × 8 узлов | 64 | **64** |
| Карты: 8 строений × 6 узлов | 48 | **48** |
| Ники игроков | 2 `<Text>` | 2 |
| **Итого** | | **≈ 182** |

Из них:
- **58 draw call'ов — troika `<Text>`** (4 на существо: cost/land/atk/hp; 3 на строение;
  +2 ника). Каждый `<Text>` = своя геометрия + свой материал + **свой SDF-atlas в canvas**
  + асинхронный layout через `troika-worker-utils`. Это самая дорогая часть сцены на CPU.
- **~97 прозрачных quad'ов** (16 слот-панелей + 32 обводки + 9 линий + 40 индикаторов).
  Слот-панели рисуются **всегда**, даже когда неактивны — с `opacity: 0.03`
  (`GameLand.jsx:121`), то есть blend считается для пустого результата.
- Все quad'ы с `transparent` сортируются по глубине каждый кадр.

**Инстансинг не используется вообще.** При этом структурно инстансируемо почти всё:
- 16 лиц карт (одна геометрия, разная текстура → решается **атласом**, см. ниже);
- 40 индикаторных квадратов 0.25×0.2 (один `instancedMesh`, цвет через `instanceColor`);
- 32 обводки земли (один `instancedMesh`, `meshBasicMaterial`);
- 16 слот-панелей (один `instancedMesh`).

Реалистичный потолок после инстансинга: **182 → ~25–35 draw calls**.

**Frustum culling** включён по умолчанию (R3F не отключает) — но для 180 мелов, которые
всегда в кадре, это чистые накладные расходы. `matrixAutoUpdate` включён у всех ~200
объектов → Three.js каждому кадру пересчитывает локальные + мировые матрицы статичного
стола, сетки, обводок и слотов. Нужно `matrixAutoUpdate = false` + `updateMatrix()` один раз.

**Overdraw на мобильном:** при DPR 2 на 1080-wide телефоне drawing buffer ≈ 2160 × 4000 =
8.6 М пикселей. Сукно покрывает ~60 % кадра; поверх него 8–10 слоев прозрачности →
**10–25 М blended-фрагментов на кадр** при PBR-шейдере с IBL. Это и есть потолок FPS.

### 2.4 Анимации и частота обновлений

- **`frameloop` не задан → `"always"`.** Сцена рендерится 60 fps вечно, хотя карточная игра
  95 % времени статична. На мобильном это батарея + нагрев + троттлинг, который потом и
  «съедает» FPS в момент хода.
- `GameObject.useFrame` (`:239-282`): 16 подписчиков. В `flatOnTable`-режиме early-return —
  ок. Но hover/ bounce-ветка (`:263-281`) **недостижима** на поле: оба вызова передают
  `flatOnTable`. Мёртвый код в горячем кадре.
- **Баг:** в `flatOnTable` + `damageFlash` (`:245-251`) `useFrame` пишет
  `g.position.x/z`, но `useEffect` (`:224-233`) не перезапускается при снятии
  `damageFlash` → карта **остаётся со сдвигом** последнего `shake` (заметно как «поехавшая»
  карта после вспышки урона).
- `matRef.current.emissive.setRGB(intensity, 0, 0)` выполняется **каждый кадр для каждой
  карты**, даже когда `intensity === 0`.
- `GameDamageFloater` мутирует `g.children[0].material.opacity` (`:42-44`) — работает, но
  опирается на порядок детей; `LIFETIME_MS` (1400) и таймер очистки в `GameBoard3D` (1500)
  не синхронизированы — floater исчезает рывком.
- `AdaptiveCamera` (`GameExperience.jsx:27-66`) — корректный `useLayoutEffect`, но мутирует
  камеру **после** того, как `Environment` может её «дёрнуть»; плюс `camera.far` поднимается
  до `max(80, dist*4)` при `near = 0.1` — лишняя потеря точности depth-буфера.
- **Туман** `fog near=18 far=40` при дистанции камеры ~8–13: поле **вообще не затуманено**
  (туман начинается за столом). При этом `USE_FOG` компилируется во все шейдеры.
- `<color attach="background">` (`GameExperience.jsx:74`) **перекрывает** CSS-градиент из
  `GameCanvas.jsx:67` — стиль мёртвый.

### 2.5 Мобильные устройства и слабые GPU

- `dpr={[1, 2]}` — на 3× телефоне R3F всё равно возьмёт 2. Нужно `[1, 1.5]` на мобильных.
- `antialias: true` — MSAA на default framebuffer: дорого на мобильных
  (4× MSAA по 8.6 М пикселей). На «низком» качестве надо отключать.
- **`shadows: true` по умолчанию, но ни один объект не `castShadow`.** Единственное
  вхождение `castShadow` во всём `src/` — `GameExperience.jsx:85` (на directionalLight).
  Следствия:
  1. аллоцируется depth-текстура 1024×1024 (4 МБ);
  2. каждый кадр выполняется **shadow-map pass** (обход сцены + рендер в depth);
  3. во все материалы компилируется `USE_SHADOWMAP` → + выборки текстуры во фрагментном
     шейдере каждого из 182 draw call'ов;
  4. результат — всегда «нет тени».
  **Это стопроцентные потери.**
- Нет `PerformanceMonitor`, `AdaptiveDpr`, `regress()`, `useDetectGPU` — хотя drei всё это
  даёт из коробки.
- Нет проверки WebGL2 / fallback-картинки. Есть только обработчик `webglcontextlost`,
  который показывает тост «перезагрузите страницу» (`GameCanvas.jsx:45-48`).
- `OrbitControls` без `enableDamping={false}` → per-frame `controls.update()`; это
  дополнительный аргумент за то, чтобы не переводить сцену в `frameloop="demand"` без
  аккуратной работы с `invalidate()`.

### 2.6 Память

| Источник | Объём | Освобождается? |
|---|---|---|
| `textureCache` (карточный art) | 75–190 МБ | **нет** (LRU/dispose отсутствуют) |
| 58 SDF-атласов troika | 20–60 МБ | частично (при unmount) |
| PMREM от HDR (potsdamer_platz_1k) | ~5 МБ | нет (ок) |
| Shadow map 1024² | 4 МБ | нет, и не нужен |
| 180 × BufferGeometry (2 треуг.) | ~1 МБ JS-heap | да (R3F dispose) |
| `battleEvents` / лог | растёт всю партию | нет |

Ключевая проблема — **текстуры карт не имеют владельца**: их создаёт модульный
`textureCache`, а освобождать должен был бы Canvas. Сейчас `clearTextureCache()`
существует, но никто её не зовёт.

### 2.7 Качество кода `GameBoard3D` и `scene/*`

Наблюдения и найденные баги:

1. **`<GameLand onClick={…}>` — мёртвый проп.** `GameBoard3D.jsx:493` передаёт
   `onClick`, но `GameLand` деструктурирует `onLandClick` (`GameLand.jsx:159`), а
   `LandMat` (`:33`) не объявляет `onClick` вообще. **Клик по поверхности земли не
   работает**, `handleLandClick`/`selectedZoneIndex` мертвы.
2. `creatureRayHover`, `buildingRayHover`, `isAttackTarget`, `onZoneAttackClick` объявлены
   в `GameLand`, но **ни разу не передаются** из `GameBoard3D` → hover-подсветка и красный
   оверлей атаки никогда не рисуются.
3. **`slotRegistry` не подключён.** `registerPlayableSlot` не вызывается нигде
   (проверено grep). Поэтому `placementRaycast.js:15-19` на каждый `pointerup` во время
   drag делает **полный `scene.traverse()`** (~250 узлов) + аллоцирует новый `Raycaster`
   и `Vector2`.
4. **`utils/sceneHelpers.js` целиком не используется игрой** — только своими тестами
   (`sceneHelpers.smoke.test.js`). Это скопированный из testing_3d код
   (`OBJECT_TYPES`, `randomPosition`, `createSceneObject`, `createSceneId`).
5. **`gameBoard3D/layout.js` — полный дубль `utils/gameObjectPlacement.js`** (те же
   `LANE_WIDTH`, `HALF_LANE_DEPTH`, `getLandSlotLayout`, `computeFieldCardScale`,
   `calculateTwoPlayerBoard`, `calculatePlayerSlotPositions`, `PLAY_FIELD_Y`). Два источника
   правды по геометрии; в комментариях помечено `@deprecated`, но импорты живые.
6. Док-комментарий в `GameLand.jsx:12` **противоречит коду**: «существа ставятся в
   building (нижняя половина), строения — в creature», тогда как код кладёт creature в
   `z<0`, building в `z>0`, и `GameBoard3D` передаёт `slots.creature` существу.
7. `GameCanvas.jsx:66` — `gl={{…}}` — новый объект каждый рендер. R3F
   (`events-b389eeca.esm.js:15807`) сравнит с `gl` через `is.equ(…, shallowLoose)` →
   `'antialias'` отсутствует в `WebGLRenderer` → не совпало → **`applyProps(gl, …)` на
   каждом рендере**, записывая мусорные поля `gl.antialias` / `gl.powerPreference`.
8. `GameBoard3D.jsx:589-591` — `zones.find(...)` внутри `damageMarkers.map` → O(n·m).
9. `GameBoard3D.jsx:289-292` — прямая мутация `document.body.style.cursor` в
   pointer-хендлерах (вместо `useCursor` из drei).
10. Дублирование в `CardBackdrop` / индикаторах: пять почти одинаковых подкомпонентов
    (`:48-174`) с копипастой `<planeGeometry args={[0.25, 0.2]}>` + `<Text>`.
11. Emoji-иконки земель (`GameObject.jsx:35-43`) и `★`/кириллица в никах рендерятся через
    troika без явного `font` → **глифы emoji/кириллицы могут отсутствовать** в fallback-шрифте
    troika → «тофу»-квадраты на поле.

---

## 3. Что переделать: приоритеты

### 🔴 Критично (сильно бьёт по FPS / стабильности)

**K1. Выкинуть `<Environment preset="city" />`.**
`useEnvironment.js:8` тянет `potsdamer_platz_1k.hdr` (~1.7 МБ) с
`https://raw.githack.com/pmndrs/drei-assets/…`. Это (а) внешний CDN в критическом пути,
(б) `useLoader` → **Suspense → весь `<Suspense fallback={null}>` в `GameCanvas` размонтирует
всю сцену на время загрузки**, (в) PMREM-генерация на CPU. В сетях, где raw.githack.com
недоступен/медленный, поле просто не появится.
→ Заменить на `<Environment>` с локальным `.hdr`/`.exr` из `public/`, либо на
`<Lightformer>`-сцену, либо вообще на `hemisphereLight` + `ambientLight` (карты лежат
плоско, IBL им почти не нужен; `metalness: 0.1` → можно обойтись без envMap).
**Эффект: −1.7 МБ сети, −200…600 мс до первого кадра, устранение «чёрного экрана» при
недоступном CDN, −5 МБ VRAM.**

**K2. Выключить тени.** Ни одного `castShadow`. Убрать `castShadow` с directionalLight и
`shadows` с Canvas (или оставить проп, но убрать `castShadow`).
**Эффект: −1 shadow pass/кадр, −4 МБ VRAM, −15…25 % фрагментной стоимости на мобильном.**

**K3. Убрать troika `<Text>` с поля (58 инстансов).**
Заменить cost/atk/hp/land/flip-индикаторы:
- вариант A (быстрый): один общий **атлас цифр и иконок** (512×512, ~40 глифов) + один
  `instancedMesh` на все индикаторы с UV-сдвигом через `instanceColor`/инстанс-атрибут;
- вариант B: рендерить статы в **`CanvasTexture` поверх самой карточки** (см. K4) — тогда
  индикаторы вообще не отдельные объекты;
- вариант C (минимум): `<Text>` только по hover/выделению.
**Эффект: −58 draw calls, −58 SDF-текстур (20–60 МБ), −58 асинхронных layout-джоб при
появлении карты, устранение главного «фриза» при розыгрыше.**

**K4. Одна текстура на карту вместо «картинка + 4 индикатора».**
Собирать композит: `art (797×1104, ресайз до 512×708) → canvas → нарисовать поверх
cost/atk/hp/иконку земли → одна `CanvasTexture` 512×708`.
Плюс собрать **атлас 8×8 = 64 карты по 256×356 → 2048×2848** и рендерить все лица карт
одним `instancedMesh` с UV-offset в инстанс-атрибуте.
**Эффект: −4.7 МБ → −0.36 МБ на карту (−92 % VRAM), −112 draw calls → 1–2, картинка
появляется мгновенно (без pop-in).**

**K5. Починить утечку текстур.** LRU в `textureCache` (лимит, например, 64 текстуры /
96 МБ) + `dispose()` при вытеснении + вызов `clearTextureCache()` в cleanup `GameCanvas`.

**K6. `frameloop="demand"` (или «умный always»).**
Перевести Canvas в `frameloop="demand"` и звать `invalidate()` из: OrbitControls-change,
анимаций урона, смены стейта. Для OrbitControls c damping — `onChange={invalidate}`.
**Эффект: −95 % GPU-работы в покое, нет нагрева/троттлинга на мобильных, −батарея.**

### 🟠 Важно (заметный прирост качества и производительности)

**V1. Сделать `memo` рабочим.** Вынести рендер зоны в `memo`-компонент
`<ZoneColumn zone row cardIds ... />`; все колбэки стабилизировать через
`useCallback` + `useLatest`-ref; `position`/`rotation` — модульные константы
(`const CARD_ROT = [-Math.PI/2, 0, 0]`); `resolveCardVisual` заменить на мемоизированный
по `card` + `catalog` lookup без spread (или spread только при реальном отличии);
`slots = getLandSlotLayout()` — вынести из `map`, замемоизировать один раз на модуль
(это чистая функция от констант — результат можно зафризить).
**Эффект: с 180 ре-рендерящихся узлов на ~8 при каждом WS-push; −30…70 мс на ход.**

**V2. Шаренные геометрии и материалы.**
```js
// shared/sceneResources.js — создаются один раз на модуль
export const CARD_PLANE = new THREE.PlaneGeometry(0.7, 1.0)
export const QUAD_025  = new THREE.PlaneGeometry(0.25, 0.2)
export const INDICATOR_MAT = { cost: new THREE.MeshBasicMaterial({ color:'#FF9800' }), … }
```
и `<mesh geometry={CARD_PLANE} material={…}>` вместо `<planeGeometry args=…/>`.
**Эффект: −180 BufferGeometry, −180 аллокаций, −GC-давление.**

**V3. Инстансинг однотипных quad'ов.** 32 обводки земли, 16 слот-панелей, 40 индикаторов →
три `instancedMesh` с `instanceColor`. Слот-панели при `opacity 0.03` — не рендерить вообще
(`count = 0`, когда не playable).

**V4. `matrixAutoUpdate = false`** на столе, сетке, обводках, слотах, землях + однократный
`updateMatrix()`. **Эффект: −~150 пересчётов матриц за кадр.**

**V5. `side={THREE.FrontSide}`** на лицах карт и индикаторах (−~40 % фрагментов на картах).

**V6. Адаптивное качество.** `PerformanceMonitor` + `AdaptiveDpr` из drei:
`dpr={[1, isMobile ? 1.5 : 2]}`, `antialias: !isMobile`, `gl.shadowMap.enabled = false`.
Подключить уже существующий (но не используемый) `textureScale` — ресайзить art
в `CanvasTexture` до `512 × textureScale` на низком качестве.

**V7. `Object pooling` для карт.** Сейчас карта = mount/unmount `GameObject` при каждом
розыгрыше/смерти (создаётся материал, геометрия, 4 текста). Завести пул из 16–24
предсозданных «карточных» узлов и переиспользовать, меняя только uniform-ы/текстуру.
**Эффект: убирает allocation-spike в момент хода.**

**V8. Починить найденные баги:** `GameLand` → `onLandClick` (K-баг №1), восстановление
позиции после `damageFlash`, `registerPlayableSlot` вместо `scene.traverse()`,
`setCrossOrigin` до `load()`, кэш `getBoundingClientRect`, cleanup таймеров, лимит
`battleEvents`.

### 🟡 Желательно (архитектура и поддерживаемость)

**D1.** Удалить дубли: `sceneHelpers.js` (мёртв), `gameBoard3D/layout.js`
(дубль `gameObjectPlacement.js`), `cardSceneHelpers.LAND_GEOMETRY/SELECTION_COLOR`.
Один источник правды по геометрии и цветам.

**D2.** Разбить `GameBoard3D` (740 строк):
```
GameBoard3D/                  — композиция
  useBoardModel(game)         — чистый derivation: zones, cards, dropStates
  useBoardInteraction()       — выделение/drag/raycast
  useDamageVisuals()          — маркеры/вспышки (с cleanup)
  <BoardScene model=… />      — R3F-дерево
  <BoardHud … />              — DOM
```

**D3.** Разделить состояние: **серверная модель** (zustand) → derivation → **3D-представление**.
Обновлять сцену через diff на уровне «слот → cardId», а не через ре-рендер всего дерева.
Идеальный паттерн: `useGameStore.subscribe(selector, cb)` + императивное обновление
инстанс-атрибутов в `useFrame`, без React-ре-рендера на каждый WS-push.

**D4.** Разделить бандл: `three-core` / `drei` / `text` / `supabase`; preload 3D-чанка
на экране лобби; подключить `rollup-plugin-visualizer` (скилл `vite-patterns`).

**D5.** Дельты в WS: слать `{version, ops:[...]}`, а не полный снэпшот; убрать двойной
`reload()` из `useGameState.writeGameState`, когда WS активен
(`reloadEnabled: !wsConfigured` уже есть — но `writeGameState` всё равно релоадит).

**D6.** Тесты производительности: smoke-тест с `renderer.info` (assert `drawCalls < 60`,
`textures < 20`, `geometries < 15`) — ловить регрессии draw calls в CI.

---

## 4. План улучшений

### Быстрые победы (1–3 дня)

| # | Изменение | Файлы | Эффект |
|---|---|---|---|
| 1 | Убрать `<Environment preset="city">`, заменить на 2 света | `GameExperience.jsx:78` | −1.7 МБ сети, −200…600 мс TTI, нет CDN-зависимости |
| 2 | Убрать `castShadow` + не рендерить слот-панели в покое | `GameExperience.jsx:85`, `GameLand.jsx:88-124` | −1 pass/кадр, −16 blend-слоёв, **+15…25 % FPS на мобильном** |
| 3 | `frameloop="demand"` + `invalidate()` | `GameCanvas.jsx:57` | −95 % GPU в покое, нет троттлинга |
| 4 | `dpr={[1, isMobile ? 1.5 : 2]}`, `antialias: !isMobile` | `GameCanvas.jsx:65-66` | **+30…60 % FPS на мобильном** |
| 5 | Кэш `getBoundingClientRect` в `updatePointer` | `GameBoard3D.jsx:277-293` | нет reflow на pointermove, плавный drag |
| 6 | Модульные константы `CARD_ROT`/`SLOTS`, стабильные колбэки | `GameBoard3D.jsx:453-575` | `memo` начинает работать, −70 % React-работы |
| 7 | LRU + dispose в `textureCache`, `clearTextureCache()` в cleanup | `textureCache.js`, `GameCanvas.jsx` | **−утечка VRAM**, нет context-loss |
| 8 | `registerPlayableSlot` в `SlotPad` | `GameLand.jsx:88`, `slotRegistry.js` | −`scene.traverse()` на каждый drop |
| 9 | Починить `onLandClick`, восстановление позиции после `damageFlash`, `setCrossOrigin` | `GameLand.jsx:159`, `GameObject.jsx:245-251`, `textureCache.js:23` | устранение 3 багов |
| 10 | `matrixAutoUpdate=false` на статике | `TableDecor`, `PlayFieldGrid`, `GameLand` | −150 matrix-обновлений/кадр |

**Ожидаемый суммарный эффект быстрых побед:** мобильный FPS в покое с 30–45 → 55–60
(за счёт demand + dpr), в момент хода с 12–25 → 30–40; VRAM −10…20 МБ; TTI −0.5 с.

### Среднесрочные (1–3 недели)

| # | Изменение | Эффект |
|---|---|---|
| 11 | Композитная `CanvasTexture` на карту (art + статы) вместо 4 `<Text>` + 3 quad'ов | **−58 draw calls, −50…100 МБ VRAM**, нет pop-in |
| 12 | Инстансинг: индикаторы, обводки, слоты (3 × `instancedMesh`) | −88 draw calls → 3 |
| 13 | Шаренные геометрии + материалы по `landType` | −180 geometry, −~30 material |
| 14 | `PerformanceMonitor` + `AdaptiveDpr` + реальное использование `textureScale` | авто-подстройка под устройство |
| 15 | Пул из 24 карточных узлов (object pooling) | нет allocation-spike на ход |
| 16 | Ресайз art до 512×708 (+ WebP/KTX2 на будущее) | −92 % VRAM на карту |
| 17 | Дельты в WS вместо полного снэпшота; убрать двойной reload | −50…80 % работы на WS-push |
| 18 | Разделение бандла + preload 3D-чанка из лобби | −150…250 KB gzip на первый экран |

**Ожидаемый эффект:** draw calls 182 → **30–40**; VRAM 150–220 МБ → **40–60 МБ**;
стабильные 55–60 FPS на mid-Android; исчезновение фризов при розыгрыше карты.

### Долгосрочная архитектурная перестройка (при необходимости)

Условие, когда она оправдана: если после шагов 1–18 нужен 4-игровой режим
(16 зон / 32 карты / ~350 draw calls) или поддержка слабых устройств (Android Go).

1. **Модель ↔ представление.** `useBoardModel(game)` отдаёт плоскую структуру
   `slots: Array<{ slotId, cardId, landType, stats, flags }>` с версионированием.
   React рендерит **только каркас** (8/16 зон), содержимое слотов обновляется императивно
   через `useGameStore.subscribe` → запись в инстанс-атрибуты.
   WS-push больше не вызывает React-ре-рендер поля вообще.
2. **Один `instancedMesh` на все лица карт** с атласом (2048×2848, 64 карты) и UV-offset
   в инстанс-атрибуте. Все карты = **1 draw call**.
3. **Атлас иконок/цифр** 512×512 — все индикаторы = 1 draw call.
4. **Императивная анимация** (урон, вспышки, подброс) через единый `AnimationDriver` в
   одном `useFrame`, а не по подписчику на объект; `invalidate()` только когда есть живые
   анимации.
5. **WebGL2 detect + статичный fallback** (`.webp`-превью доски) для неподдерживаемых
   устройств; `onWebGLContextLost` → автоматический downgrade качества, а не «перезагрузите».
6. **CI-гейт на бюджет сцены:** e2e-тест с `renderer.info` — `drawCalls ≤ 40`,
   `programs ≤ 20`, `textures ≤ 24`, `geometries ≤ 20`, `triangles ≤ 20K`.

**Ожидаемый эффект:** 4 игрока на mid-Android — 50–60 FPS; общее число draw call'ов
не зависит от числа карт (O(1) вместо O(N)); VRAM фиксирован (~40 МБ) независимо от
длительности партии; React-ре-рендеры поля — только при структурных изменениях.

---

## Приложение: чек-лист по скиллам проекта

| Скилл | Что требует | Статус |
|---|---|---|
| `3d-web-experience` | лимит света, инстансинг, LOD, lazy-load, DPR на мобильных, fallback без WebGL, индикатор загрузки | ❌ инстансинга нет; ❌ DPR не адаптирован; ❌ нет WebGL-fallback; ❌ `<Suspense fallback={null}>` вместо индикатора |
| `react-performance` | мемоизация, стабильные пропсы, батчинг слушателей, `useRef` для частых значений, динамические чанки | ❌ `memo` не работает из-за нестабильных пропсов; ⚠️ чанки частично; ✅ lazy-load экранов |
| `vite-patterns` | `manualChunks` по назначению, visualizer, `optimizeDeps` | ⚠️ один «three-vendor» на всё; ❌ нет визуализатора |
| `frontend-patterns` | memo для чистых компонентов, виртуализация, code splitting | ⚠️ `memo` есть, но неэффективен |
| `threejs-*` (materials/textures/scenes) | shared materials, texture atlases, dispose, PMREM-кэш, инстансинг | ❌ ничего из перечисленного не применяется |
