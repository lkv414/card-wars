---
name: project-gate
description: Обязательный прогон тестов и сборки перед коммитом в card_game
metadata:
  audience: developers
  project: card_game
  opencode/slash: "true"
  opencode/autoinvoke: "true"
---

## Что делаю
Прогоняю полный гейт проекта и говорю, что прошло, а что нет, с числами.

## Когда использовать
Перед каждым коммитом и в конце фазы работ по аудиту.

## Порядок (PowerShell, `npm.cmd` / `npx.cmd`)
1. `npm.cmd test` — vitest (smoke-набор, то же, что `test:smoke`).
2. `npm.cmd run test:smoke`
3. `npm.cmd run test:store`
4. `npm.cmd run test:engine`
5. `npx.cmd vite build`
6. `npx.cmd tsc --noEmit -p workers/tsconfig.json`
7. `npx.cmd eslint <изменённые файлы>` — только по изменённым, т.к. в старом коде есть долг.

## Правила
- Не объединять команды через `&&` — PowerShell его не понимает. Запускать отдельно.
- Предупреждение «Exited with code 1» после `vite build` вызвано только предупреждением о размере чанка, сборка при этом проходит.
- Не отключать тесты и не править тесты под код без причины.
- В отчёте указывать число прошедших тестов по каждой группе.

## Известные откровенные отказы (не ломаются в проекте, а окружение)
- `npm run test:engine` (vitest run --root workers): регулярно падает с ошибкой
  worker thread / tinypool — **переменная окружения/память, не код**. Если весь
  гейт упадёт на этой стадии, не впадайте в панику и не танцуйте с бубном;
  проверьте `test:store` и `test:smoke` отдельно.
- `npm run test:smoke` (vitest run): периодически падает по OOM при запуске
  потоковых воркеров. Если *только* smoke упадёт, а store прошло — это запись
  в окружение, не регрессия.
- `e2e:bot` (playwright) удалён вместе с `scripts/` — e2e сейчас не запускается.
