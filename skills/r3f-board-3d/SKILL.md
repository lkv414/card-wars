---
name: r3f-board-3d
description: Правила 3D-доски Card Wars на React Three Fiber — производительность, единый CardFace, клики и drag
metadata:
  audience: developers
  project: card_game
  opencode/autoinvoke: "true"
---

## Что делаю
Правлю 3D-сцену (`src/components/Game/scene`, `gameBoard3D`) так, чтобы не
ломать клики, drag и производительность.

## Когда использовать
Изменения в `GameBoard3D.jsx`, `ZoneColumn.jsx`, `GameLand.jsx`, `GameObject`,
`cardCompositeTexture.js`, `sceneResources.js`.

## Правила
- Не возвращать Suspense на отдельную карту внутри Canvas.
- Лицо карты — только через `CardFace` / `cardFaceModel.js`. Текстура — кэш значений, не отдельный дизайн.
- Поля карты читать только через `cardFields.ts`.
- Цвета земель — только из `src/constants/landColors.js`.
- Уважать `useGraphicsSettings`: качество и тени зависят от настроек.
- Позиции и повороты — модульные константы (`sceneResources.js`), чтобы `memo` работал.
- Колбэки в пропсах стабильны (`useCallback` + refs). Новый inline-объект в JSX ломает `memo`.
- Ручная атака: подсветка целей через `getManualAttackTargets`, клик по `GameLand` через `onZoneAttackClick`.
- Не ломать `onPointerMissed` и `PlacementPointerRelease`.

## Проверка
- `npm run test:smoke` (рендер компонентов).
- `npx.cmd vite build` — ловит ошибки импорта.
- Визуально: `chrome-devtools` MCP, открыть игру и проверить клик и подсветку.
