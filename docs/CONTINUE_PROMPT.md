# Промт для продолжения работы над механиками Card Wars v3

Скопируй текст ниже в новый чат.

---

Ты продолжаешь работу над механиками карточной игры Card Wars v3 в монорепо pnpm workspaces (`packages/{domain,application,protocol,content}` + `apps/{server,client}`). Прочитай сначала:

1. `AGENTS.md` — конвенции (чистый domain, запрет хардкода карт, doc-first, zod на границе)
2. `docs/MECHANICS-V2.md` — архитектура механик v2 (главный документ: AbilitySpec, два класса пассивок, EffectSpec + именованные механики, pendingChoice, таргетинг, группы G и H, бэклог)
3. `docs/CARDS.md` — формат карт (⚠ частично устарел — abilities вернулись, механики в `content/{cards,heroes}/mechanics/`)
4. `git log --oneline -20` — история коммитов (все этапы закоммичены)

## Текущее состояние

- **Покрытие**: 526/544 карт + 25/25 героев структурированы и работают; осталось 5 карт (см. OPEN_QUESTIONS) + 13 flavorOnly, 9 — осознанно vanilla (`flavorOnly`, нет игрового текста).
- **Тесты**: 234 зелёных (150 domain, 60 content, 15 server, 5 application, 4 protocol).
- **Отчёт покрытия** после генерации: `pnpm --filter @card-wars/content generate` печатает «mechanics: cards N/544 structured».

## Правила работы

- **Doc-first**: изменения контракта → сначала docs/MECHANICS-V2.md, потом код
- **Никаких имён карт в коде правил** — только в data (content/cards/mechanics/)
- **Константы — из CONFIG/данных**: глобальные параметры правил — docs/CONFIG.md + GameConfig; параметры способности конкретного героя/карты — данные (`wordSetup`, `min`/`max` ask'ов)
- **Стиль кода механик — файлы-пачки** (`handlers.ts`, `handlers-h3.ts`, …), не «файл на механику» (решение владельца 2026-11-06)
- **События широковещательные**: приватные окна (`peeks`) не порождают событий; `cards_revealed` — только для публичных вскрытий (см. §H8)
- **Тесты**: golden на представителя каждой механики в packages/content/src/h1.test.ts / golden.test.ts (реальный каталог), юнит-тесты в packages/domain/src/tests/mechanics.test.ts (фикстуры)
- **Валидация**: build-catalog.mjs валидирует новые ops/triggers/asks/refs/conditions — добавляй их в множества
- **git commit после каждого завершённого блока**; после блока — `pnpm --filter @card-wars/content generate && pnpm typecheck && pnpm lint && pnpm -r test`
- Журнал работы — `docs/journal/YYYY-MM-DD.md` (формат по предыдущим дням)

## Что уже реализовано в движке (кратко; полный список — MECHANICS-V2.md)

- Триггеры: on_cast, on_enters_play, on_leave_play, on_death, start_of_turn, start_of_next_turn, on_creature_attacks, on_damage_dealt, on_line_change, on_flip, on_draw, on_spell_cast, on_card_played, start_of_battle_phase, on_companion_event, on_freeze, on_return_to_hand
- ~60 операций EffectSpec, в т.ч. все из §H2 (redistribute_damage, set_land_type, swap_field_cards, attach_card с уходом вложенных в сброс, repeat_effect, discard_chosen, pay_life, peek_deck_top + resolve_peek — приватное вскрытие, set_instance_flag, destroy_own_n)
- Условия: все `while_*`/`if_*` из §7 и §H3 + `while_effective_def_at_most` (ручной подсчёт без аур — computeEff внутри условия ауры того же инстанса даёт бесконечную рекурсию)
- Ask'и: доска/рука/сброс/число (`amount`), опции (`choose_option`), распределение урона (`damage_distribution`), до 16 ответов
- pendingChoice: optional, target, effect_step (ленивые шаги массива эффектов), таймер-дефолт
- 25/25 героев, включая choose_word (границы слова — `wordSetup` в данных героя) и приватный peek Рикардио

## Бэклог — ЗАВЕРШЁН (2026-11-07)

Все карты каталога разобраны: 526 структурировано + 13 flavorOnly + 5 в OPEN_QUESTIONS (нечитаемый OCR / переделка схемы — см. docs/OPEN_QUESTIONS.md).


## Найденные при разборе зазоры (не откатывать фикс-коммиты!)

- `resolve_choice` не вызывает `afterEffects`: смерти в докатке прерванного эффекта обрабатываются только следующей командой (предсуществующий зазор — починить отдельным коммитом с тестом).
- События всегда широковещательные — «адресные» события невозможны без доработки Room; приватное = состояние + персональный вид, не событие.

## Начни с

`git log --oneline -5` + `pnpm -r test` — убедись, что всё зелёное, потом продолжай бэклог сверху вниз. После каждого блока карт — `pnpm --filter @card-wars/content generate && pnpm typecheck && pnpm lint && pnpm -r test`.
