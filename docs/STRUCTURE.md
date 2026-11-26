# Структура проекта

Монорепозиторий **pnpm workspaces**, TypeScript strict везде.

```
card-wars/
├── apps/
│   ├── client/            React 19 + Vite + react-three-fiber: DOM-меню, лобби, редактор колод, 3D-стол, PWA
│   └── server/            Cloudflare Worker + Durable Object `Room` (WebSocket, alarms, боты)
├── packages/
│   ├── domain/            Чистое ядро правил (только Immer): состояние, команды, события, механики v2
│   ├── application/       `viewFor` (персональный вид), журнал
│   ├── protocol/          zod-схемы сообщений, `CONFIG`, `PROTOCOL_VERSION`
│   └── content/           Каталог: карты, герои, земли, пресеты колод
├── content/               Источник каталога: cards/, heroes/, lands/ (+ mechanics/*.json)
├── tools/                 build-catalog.mjs, bump-version.mjs
├── docs/                  Документация и аудиты
├── .github/workflows/     CI: lint, typecheck, test, build
├── start.bat / deploy.bat Локальный запуск и деплой (Windows)
└── AGENTS.md              Конвенции проекта
```

## Зависимости пакетов

```
domain  ←  application  ←  server
domain  ←  content      ←  server, client
protocol (zod, CONFIG)  ←  server, client, application
```

- `domain` зависит только от Immer; RNG и конфиг приходят через порты.
- `protocol` — единственное место zod и значений `CONFIG`.
- `client` не импортирует `domain` для принятия решений о законности ходов.

## Что внутри `domain`

| Папка/файл | Назначение |
|------------|-----------|
| `types.ts`, `commands.ts`, `events.ts`, `errors.ts` | Модель, команды, события, коды отказов |
| `match/` | `create`, `apply` (единая точка `applyCommand`), `play`, `floop`, `combat`, `turn`, `hero` |
| `mechanics/` | `types.ts` (`AbilitySpec`, `TargetAsk`…), реестр `MECHANICS`, пачки обработчиков |
| `deaths.ts`, `stats.ts`, `zones.ts`, `rng.ts` | Смерти и `afterEffects`, `computeEff`, геометрия зон, сидированный RNG |

## Что внутри `apps/client/src`

| Путь | Назначение |
|------|-----------|
| `App.tsx`, `store.ts`, `ws.ts` | Маршрутизация экранов, состояние (Zustand), WebSocket |
| `decks/` | Список колод, редактор, коды колод, выбор героя и арта земель |
| `game/lobby/` | Лобби и места игроков |
| `game/hud/` | HUD, правая боковая панель, `CardZoomModal` (ПКМ) |
| `game/scene/` | 3D: `Scene`, `TableMesh`, `PlayerBoard`, `CardMesh`, `Hand`, `AnimLayer`, `layout` |
| `sound/`, `pwa/` | Звук и сервис-воркер |

## Что внутри `apps/server/src`

`index.ts` (маршрутизация), `room.ts` (Durable Object), `timer.ts`, `deck.ts` (проверка колод), `bot.ts` (эвристика ботов), `config.ts`.
