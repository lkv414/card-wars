# Промт для продолжения работы над механиками Card Wars v3

Скопируй текст ниже в новый чат.

---

Ты продолжаешь работу над механиками карточной игры Card Wars v3 в монорепо pnpm workspaces (`packages/{domain,application,protocol,content}` + `apps/{server,client}`). Прочитай сначала:

1. `AGENTS.md` — конвенции (чистый domain, запрет хардкода карт, doc-first, zod на границе)
2. `docs/MECHANICS-V2.md` — архитектура механик v2 (главный документ: AbilitySpec, два класса пассивок, EffectSpec + именованные механики, pendingChoice, таргетинг, группы G и H, бэклог)
3. `docs/CARDS.md` — формат карт (⚠ частично устарел — abilities вернулись, механики в `content/{cards,heroes}/mechanics/`)
4. `git log --oneline -20` — история коммитов (все этапы закоммичены)

## Текущее состояние

- **Покрытие**: 471/544 карт + 25/25 героев структурированы и работают; 60 карт с текстом ещё не разобраны, 9 — осознанно vanilla (`flavorOnly`, нет игрового текста).
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

## Бэклог — 60 карт, сгруппированы по требуемому механизму

Разбор остатка (ид сверху вниз, пачками по механикам):

1. ✅ Батч H9 (2026-11-07): if_option, while_opponents_hand_at_least, Дух воплекура, Рубленный стейк, Снижение налогов, Башня свободы, Жучья госпожа, Квадурай.
2. **Реакции чужих уходов/смертей** — deaths.ts пушит on_death только самому умершему; добавить `enqueueTrigger('on_death'/'on_leave_play')`, чтобы реагировали ЧУЖИЕ карты с `if_payload_other` (+`if_payload_player_self`). Карты: Некромансер (переместиться на землю уходящего), Вязаный… подкладывание под карту (attach_card from field), Обжор (души под себя, +1 ATK/+2 DEF за каждую), Берсеркорова (+1 ATK за убитых), Питается павшими (верхняя карта чужого сброса под себя + постоянный +1 ATK — реф `opponent_discard_top`), Бездомный болот/Болотная бомба-лягушка (уходят подготовленными → эффекты).
3. **Перемещение строений** — оп `move_building` (по аналогии с move_creature): ПРИЁМ «перемести строение на землю без строения», spell «переверни землю + перемести строение», «строения соседних земель»-ауры (Центр знаний, Вязаный котёнок — aura с фильтром соседства).
4. **Распределение/сравнение вскрытий** — `distribute_damage` (восстанови до N жизней и распредели столько же урона — tree_trunks_card_21), механики сравнения стоимостей вскрытых карт (grand_prix_card_5, monika_card_1/2), peek+reorder чужой колоды (charlie_card_22), «открой 3 → сыграй партнёрство» (monika_card_32, grand_prix_card_4).
5. **Партнёрские 2v2** — триггер `on_companion_event` семантики: Сотрудничество (копия радужного заклинания), фаза сражения партнёра (charlie_card_28), игра на ледяные земли (monika_card_24), +ATK за стоимость карт партнёрства (grand_prix_card_7).
6. ✅ Батч H12 (2026-11-07): триггер on_card_discarded, banish_card, chosen_card_cost, discard_min_cost_or_damage, duration next_turn — Загробный дом, Ведьмак, Ванна крови, Белкобомбы!, Переливание крови.
7. Частично ✅ H13 (2026-11-07): attack_mod defenderType/defenderCost (Му-бык, Хлопковая гвардия), freeze_creature + choice_zone_creature (Ультра пес), Проклятый древесный дух, Косячья Девятка. Остались: Прозрачный ниндзя (dodge d6), Тэдди-крюк (соседи цели), Крысолов (replace_attacker), Ловкий песочный краб (обмен при входе), Песочный краб рубака (урон при входе на соседнюю), Куча мала.
8. **Статусы и правила розыгрыша** — запрет карт стоимости 0 (ftg_card_7 — play-restriction aura), доп. строение на земле (cake_card_18), защита земли от чужих флипов (ftg_card_43), игра на замороженную землю (monika_card_9/24), «нельзя заменить» уже есть (`cannotReplace`), Ледяная база (заморозка линии при входе).
9. **Лимиты использований** — «до 5 раз за ход» (lsp_card_4): счётчик использований приёма за ход (переиспользовать идею abilityUses, но со счётчиком).
10. **Прочее** — restricted action (lsp_card_17 — действие только на существо этой линии), смена земель из-вне игры (ftg_card_67), Воскрешение кошачьих жизней (lich_card_48), Частичка души (игра второй из колоды, связные судьбы), Некромама/Клон (соответствие названий), flavorOnly-карты без текста (lich_card_19/32, tree_trunks_card_14, lady_rainicorn_card_33 и т.п.).

## Найденные при разборе зазоры (не откатывать фикс-коммиты!)

- `resolve_choice` не вызывает `afterEffects`: смерти в докатке прерванного эффекта обрабатываются только следующей командой (предсуществующий зазор — починить отдельным коммитом с тестом).
- События всегда широковещательные — «адресные» события невозможны без доработки Room; приватное = состояние + персональный вид, не событие.

## Начни с

`git log --oneline -5` + `pnpm -r test` — убедись, что всё зелёное, потом продолжай бэклог сверху вниз. После каждого блока карт — `pnpm --filter @card-wars/content generate && pnpm typecheck && pnpm lint && pnpm -r test`.
