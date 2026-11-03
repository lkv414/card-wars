# Промт для продолжения работы над механиками Card Wars v3

Скопируй текст ниже в новый чат.

---

Ты продолжаешь работу над механиками карточной игры Card Wars v3 в монорепо pnpm workspaces (`packages/{domain,application,protocol,content}` + `apps/{server,client}`). Прочитай сначала:

1. `AGENTS.md` — конвенции (чистый domain, запрет хардкода карт, doc-first, zod на границе)
2. `docs/MECHANICS-V2.md` — архитектура механик v2 (главный документ: AbilitySpec, два класса пассивок, EffectSpec + именованные механики, pendingChoice, таргетинг, дорожная карта M1–M6 + бэклог)
3. `docs/CARDS.md` — формат карт (⚠ частично устарел — abilities вернулись, механики в `content/{cards,heroes}/mechanics/`)
4. `git log --oneline -20` — история коммитов (все этапы закоммичены)

## Текущее состояние

- **Покрытие**: 162/544 карт + 8/25 героев структурированы и работают
- **Тесты**: 152 зелёных (98 domain, 31 content, 15 server, 5 application, 4 protocol)
- **Отчёт покрытия** после каждой генерации: `pnpm --filter @card-wars/content generate` печатает «mechanics: cards N/544 structured»

## Что уже реализовано в движке

- Триггеры: on_cast, on_enters_play, on_leave_play, on_death, start_of_turn, start_of_next_turn, on_creature_attacks, on_damage_dealt, on_line_change, on_flip, on_draw, on_spell_cast, on_card_played, start_of_battle_phase, on_companion_event
- Операции (EffectSpec): deal_damage, heal, draw_cards, discard_top_deck, opponent_discards, stat_buff (aura/permanent/this_turn), gain_shield, gain_actions, flip_land, destroy, move_creature, freeze_land, win_if_opponents_deck_empty, cost_mod, land_count_mod, suppress, no_retaliation, damage_immunity, damage_redirect, grant_modifier, return_from_discard, discard_from_hand, grant_ability, reveal_deck_top, resolve_revealed, return_to_owner, counts_as, attack_mod
- Модификаторы: cost_mod, land_count_mod, stat_aura (с фильтрами ready/landType/sameCard/cardIds + floorDefense), damage_redirect, damage_immunity, no_retaliation, suppress (triggers/actives), counts_as, attack_mod
- Динамические величины: per_discard, per_damage, per_distinct_lands, per_lands (own/all/adjacent, empty/flipped), per_target, per_counter (spell_cast/creature_entered/creature_died/line_change), payload_damage
- Условия: if/while_discard_count, while_undamaged (self/target), while_damage_exactly/at_least (self/target), while_lane_empty_opponent, while_on_land_type, while_on_flipped_land (self/target), while_distinct_lands (min/max), while_land_count, while_zone_has_building, while_empty_lands, while_self_flipped, while_opponents_hand_empty, while_no_other_creatures (scope own/all), while_opponents_turn, if_payload_* (replacing/land_type/player_self/other/to_player/targeted_self/player_opponent)
- Цели (TargetAsk): own_creature, opponent_creature, any_creature, lane_creature, lane_opponent_creature, opponent_player, landscape, own_landscape, own_hand_card, own_building, lane_building, adjacent_creature, adjacent_any_creature, revealed_card — все с опциональными фильтрами (ready/landType)
- Цели-рефы (TargetRef): choice, this_creature, this_lane_creature, this_lane_opponent_creature, adjacent_creatures, each_creature_yours/opponent/all, each_building_yours, each_player, each_opponent_player, self_player, this_lane_land, this_lane_lands, active_opponent_players
- Именованные механики (реестр): chain_damage, move_damage, swap_lanes
- pendingChoice: optional, target (мульти-ask с отложенным сбором через effect_step), resolve_choice, таймер-дефолт (skipPending), bot-ответ time_expired
- Кура данных: content/cards/mechanics/*.json + content/heroes/mechanics/*.json → build-catalog.mjs валидирует (ops, triggers, asks, refs, amounts, conditions, фильтры, choice-vs-targets) и печатает отчёт покрытия

## Клиент (C14 готов)

- targeting.ts — валидные цели по ask'у из view, режимы active/pending
- Hud — баннер с отменой, кнопки-цели для player/revealed, кнопка «Герой»
- CardMesh/Land/Hand — клик по подсвеченной цели отдаёт её таргетингу

## Бэклог (373 карты + 17 героев) — по убыванию приоритета

1. **Связь** (charlie_card_4, компаньон 2v2) — копирование заклинания с новой целью. Нужен named mechanic `copy_spell` + взаимодействие с on_spell_cast.
2. **A6 — замены способностей**: Школа («теряет все способности, получает Приём случайного существа из сброса»), Пес («строения противника без текста»). Требует R2-full: перманентные баффы с sourceInstanceId + возможность снять/подменить способности инстанса.
3. **Ледяные жетоны** (~10 карт Гантера/Айс Кинга): LandState += iceTokens; ops add/remove/transfer_token; карты Ледяной банк, Мороженник, Ослепительная Люси, Перенос жетона (Коктейль), Усталый библиотекарь/воин (подготовка при смене линии — on_line_change уже есть).
4. **Боевые ауры защитника**: «+2 АТК пока защищается от существ на X земле» (Привидение, Дух ведьмы/дерева) — при условии «защищается от» нужен defenderZone-контекст для retaliation-аур.
5. **Ауры на базовые статы противника** (Угнетающая пирамида −2 DEF уже есть), «−1 ATK всем существам противника в этом ходу» (Мастер маскировки).
6. **Игровые ходы-состояния** — «следующее заклинание стоит на 2 меньше» (Призрак Джинни), «нельзя играть заклинания в следующий ход» (Дух ниндзя), «не может быть атаковано/выбрано до следующего хода» (Пещера одиночества) — статусы с длительностью, нужен R2-full (идентичность перманентных баффов).
7. **Поиск/peek** (Вырубка леса, Гидромансер, Любопытный чувачок, Смотритель небес — последний уже сделан) — reveal-окно уже есть, нужен play_from_reveal.
8. **Hero уникальные** — Охотница-волшебница (слово в названии), Рикардио (плата жизнями), Моника («повернуть применённое»), tree_trunks (слово «Пирог»), strong_susan (урон = стоимость жертвы), bubblegum («раз за ход урон своему существу → +1 ATK»).

## Правила работы

- **Doc-first**: изменения контракта → сначала docs/MECHANICS-V2.md, потом код
- **Никаких имён карт в коде правил** — только в data (content/cards/mechanics/)
- **Константы — из CONFIG** (docs/CONFIG.md)
- **Тесты**: golden на представителя каждой механики в packages/content/src/golden.test.ts (реальный каталог), юнит-тесты в packages/domain/src/tests/mechanics.test.ts (фикстуры)
- **Валидация**: build-catalog.mjs валидирует все новые ops/asks/conditions — не забудь добавить новые в множества
- **git commit после каждого завершённого блока**

## Начни с

`git log --oneline -5` + `pnpm -r test` — убедись, что всё зелёное, потом продолжай бэклог сверху вниз. После каждого блока карт — `pnpm --filter @card-wars/content generate && pnpm -r test`.
