---
name: card-wars-rules
description: Правила рантайма механик и земель Card Wars — что исполняется, что нет, и как проверять эффект карты
metadata:
  audience: developers
  project: card_game
  opencode/autoinvoke: "true"
---

## Что делаю
Помогаю менять игровые правила карт без нарушения согласованного контракта
механик, земель и боя.

## Когда использовать
Любая правка в `workers/src/game-engine/mechanics-runtime.ts`, `validation.ts`,
`src/utils/cardFields.ts`, `src/constants/landColors.js`, а также вопросы
«почему карта не срабатывает».

## Правила (не нарушать)
- Исполняется только `mechanics_status === 'implemented'`. Отсутствующий статус — `unreviewed`.
- `text_only` не исполняется никогда.
- Поле `mechanics_status` берётся из каталога, руками не править.
- Неоднозначные земли `cute`, `cotton`, `plain`, `plains` не сопоставлять
  молча: они помечаются `hasUnknownLandType` и трактуются как универсальные.
  Однозначные псевдонимы: `sandy`/`desert` → `sand`, `rainbow` → `any`.
- Механика `implemented` принимается только с тестом «механика → состояние».
- Правила боя не менять ради картинки.
- `individual_cards/*.json` не править руками — только через скрипты.

## Как проверять
1. Тест в `workers/src/game-engine/mechanics-runtime.test.ts` (фикстура с `mechanics_status: 'implemented'`).
2. `npm run test:engine`.
3. Для `applyAction` проверять поля `applied` и `reason`, а не только отсутствие ошибки.
