# Документация Card Wars v3

Card Wars v3 — рабочая онлайн-реализация настольной игры **Card Wars** (Adventure Time) на 2–4 игроков: 3D-стол в браузере, авторитетный сервер на Cloudflare, 853 карты, 74 героя, 44 арта земель. Код написан заново (clean-room) по этой документации.

Документация — источник правды: сначала правится документ, потом код (`AGENTS.md`). Актуальность документов подтверждена аудитом от 2026-11-26 — [audits/README.md](./audits/README.md).

## Карта документов

### Игра
| Документ | О чём |
|----------|-------|
| [PROJECT.md](./PROJECT.md) | Видение, объём, ключевые сущности |
| [GAME_OVERVIEW.md](./GAME_OVERVIEW.md) | Общее описание игры для новичка |
| [RULES.md](./RULES.md) | Точные правила матча |
| [CARDS.md](./CARDS.md) | Формат каталога: карты, герои, земли |
| [MECHANICS.md](./MECHANICS.md) | Справочник механик оригинала |
| [MECHANICS-V2.md](./MECHANICS-V2.md) | Архитектура способностей (`AbilitySpec`, триггеры, `pendingChoice`) и журнал решений |
| [GLOSSARY.md](./GLOSSARY.md) | Термины оригинала → термины v3 |
| [CONFIG.md](./CONFIG.md) | Все параметры правил и их значения |

### Техника
| Документ | О чём |
|----------|-------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Слои и принципы |
| [STRUCTURE.md](./STRUCTURE.md) | Реальная структура монорепозитория |
| [TECH.md](./TECH.md) | Стек, инфраструктура, протокол, решения |
| [NETWORK.md](./NETWORK.md) | Авторитетный сервер, скрытие информации, таймеры, боты |
| [COMMANDS.md](./COMMANDS.md) | Команды и события |

### Интерфейс
| Документ | О чём |
|----------|-------|
| [UI.md](./UI.md) | Экраны DOM: меню, колоды, редактор, лобби, HUD |
| [UI-3D.md](./UI-3D.md) | 3D-стол: размеры, раскладки, камера, анимации |
| [AUDIT-KIBERBUS-UIUX.md](./AUDIT-KIBERBUS-UIUX.md) | Эталон стиля «войлок + бумага» |

### Аудиты (2026-11-26)
[Сводка](./audits/README.md) · [Дизайн](./audits/01-design.md) · [Архитектура](./audits/02-architecture.md) · [Работоспособность](./audits/03-operability.md) · [Производительность](./audits/04-performance.md) · [3D-сцена](./audits/05-3d-scene.md)

### История и планирование
[MVP.md](./MVP.md) (что вошло в первую версию) · [OPEN_QUESTIONS.md](./OPEN_QUESTIONS.md) · [SWERKA-OCR-STATUS.md](./SWERKA-OCR-STATUS.md) · [CONTINUE_PROMPT.md](./CONTINUE_PROMPT.md) · [AUDIT-EGM-UIUX.md](./AUDIT-EGM-UIUX.md) · [UI-OVERHAUL-LOBBY-EDITOR.md](./UI-OVERHAUL-LOBBY-EDITOR.md) · [figma-ui-prompt.md](./figma-ui-prompt.md) · [journal/](./journal) · [reports/](./reports)

## Принципы работы с документацией

1. Документация — источник правды.
2. Меняется правило — сначала документ, потом код.
3. Нельзя «подглядывать» в старые ветки и архив ради структуры или решений (clean-room).
4. Новый параметр правил — сначала строка в [CONFIG.md](./CONFIG.md).
5. Технологические решения фиксируются в [TECH.md](./TECH.md).
