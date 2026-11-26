# Аудиты проекта (2026-11-26)

Состояние: Card Wars v3, ветка `v3`, клиент `3.1.148`, протокол `PROTOCOL_VERSION = 3`.
Аудиты выполнены по фактическому коду (статический разбор + запуск `typecheck`, `lint`, тестов и сборки).

| # | Аудит | Файл | Вердикт |
|---|-------|------|---------|
| 1 | Дизайн | [01-design.md](./01-design.md) | Хорошо, есть пробелы в a11y и адаптиве |
| 2 | Архитектура | [02-architecture.md](./02-architecture.md) | Здоровая, конвенции `AGENTS.md` соблюдены |
| 3 | Работоспособность | [03-operability.md](./03-operability.md) | Зелёная после правок; остаются слабые места ботов и e2e |
| 4 | Производительность | [04-performance.md](./04-performance.md) | Главные риски — размер каталога и ленивость загрузки |
| 5 | 3D-сцена | [05-3d-scene.md](./05-3d-scene.md) | Дисциплина `frameloop="demand"` соблюдена |
| 6 | Архитектура (улучшения) | [06-architecture-improvements.md](./06-architecture-improvements.md) | Подробный план рефакторинга и оптимизации слоёв |

## Что исправлено в ходе аудита

| Что | Где |
|-----|-----|
| Ошибки `tsc`: сравнения `TargetAskKind` с несуществующими значениями (5 шт.) | `apps/server/src/bot.ts` |
| Ошибка `tsc` `TS2532` (`weights[idx]`) | `apps/client/src/sound/SoundEngine.ts` |
| ESLint: неиспользуемый `amount` (теперь задаёт громкость удара по герою) | `apps/client/src/sound/SoundEngine.ts` |
| ESLint: неиспользуемый `pid` | `apps/client/src/game/scene/PlayerBoard.tsx` |
| Смоук-скрипты слали `PROTOCOL_VERSION = 2` и отклонялись сервером | `apps/server/scripts/{smoke,bots-smoke}.mjs` |

## Сводка приоритетов

**P0 (блокирующие)** — после правок отсутствуют.

**P1**
- Каталог (`cards.json` 831 КБ) целиком грузится при старте (устаревшие `legacy-cards.json` и `legacy-heroes.json` уже вынесены из рабочего бандла в тестовые фикстуры) — [04-performance.md](./04-performance.md).
- Покрытие механик: в `content/` 853 карты и 74 героя; про героев без структурированной способности см. [03-operability.md](./03-operability.md).
- Бот не передаёт цели в `play_card`/`floop` и не умеет таргетные карты — [03-operability.md](./03-operability.md).

**P2** — детали в отчётах.
