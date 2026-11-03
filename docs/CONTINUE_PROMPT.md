# Промт для продолжения работы над механиками Card Wars v3

Скопируй текст ниже в новый чат.

---

Ты продолжаешь работу над механиками карточной игры Card Wars v3 в монорепо pnpm workspaces (`packages/{domain,application,protocol,content}` + `apps/{server,client}`). Прочитай сначала:

1. `AGENTS.md` — конвенции (чистый domain, запрет хардкода карт, doc-first, zod на границе)
2. `docs/MECHANICS-V2.md` — архитектура механик v2 (главный документ: AbilitySpec, два класса пассивок, EffectSpec + именованные механики, pendingChoice, таргетинг, дорожная карта M1–M6 + бэклог)
3. `docs/CARDS.md` — формат карт (⚠ частично устарел — abilities вернулись, механики в `content/{cards,heroes}/mechanics/`)
4. `git log --oneline -20` — история коммитов (все этапы закоммичены)

## Текущее состояние

- **Покрытие**: 201/544 карт + 9/25 героев структурированы и работают
- **Тесты**: 215 зелёных (150 domain, 41 content, 15 server, 5 application, 4 protocol)
- **Отчёт покрытия** после каждой генерации: `pnpm --filter @card-wars/content generate` печатает «mechanics: cards N/544 structured»

## Что уже реализовано в движке

- Триггеры: on_cast, on_enters_play, on_leave_play, on_death, start_of_turn, start_of_next_turn, on_creature_attacks, on_damage_dealt, on_line_change, on_flip, on_draw, on_spell_cast, on_card_played, start_of_battle_phase, on_companion_event
- Операции (EffectSpec): deal_damage, heal, draw_cards, discard_top_deck, opponent_discards, stat_buff (aura/permanent/this_turn), gain_shield, gain_actions, flip_land, destroy, move_creature, freeze_land, win_if_opponents_deck_empty, cost_mod, land_count_mod, suppress, no_retaliation, damage_immunity, damage_redirect, grant_modifier, return_from_discard, discard_from_hand, grant_ability, reveal_deck_top, resolve_revealed, return_to_owner, counts_as, attack_mod
- Модификаторы: cost_mod, land_count_mod, stat_aura (с фильтрами ready/landType/sameCard/cardIds + floorDefense), damage_redirect, damage_immunity, no_retaliation, suppress (triggers/actives), counts_as, attack_mod
- Динамические величины: per_discard, per_damage, per_distinct_lands, per_lands (own/all/adjacent, empty/flipped), per_target, per_counter (spell_cast/creature_entered/creature_died/line_change), payload_damage
- Условия: if/while_discard_count, while_undamaged (self/target), while_damage_exactly/at_least (self/target), while_lane_empty_opponent, while_on_land_type, while_on_flipped_land (self/target), while_distinct_lands (min/max), while_land_count, while_zone_has_building, while_empty_lands, while_self_flipped, while_opponents_hand_empty, while_no_other_creatures (scope own/all), while_opponents_turn, if_payload_* (replacing/land_type/player_self/other/to_player/targeted_self/player_opponent)
- Цели (TargetAsk): own_creature, opponent_creature, any_creature, lane_creature, lane_opponent_creature, opponent_player, landscape, own_landscape, own_hand_card, own_building, lane_building, adjacent_creature, adjacent_any_creature, revealed_card — все с опциональными фильтрами (ready/landType)
- Цели-рефы (TargetRef): choice, this_creature, this_lane_creature, this_lane_opponent_creature, adjacent_creatures, each_creature_yours/opponent/all, each_building_yours, each_player, each_opponent_player, self_player, this_lane_land, this_lane_lands, active_opponent_players
- Именованные механики (реестр): chain_damage, move_damage, swap_lanes, copy_spell (Связь: копия заклинания партнёром, цели по targets оригинала; MechanicHandler получает payload и beneficiary), grant_random_discard_active (Школа: suppress-all + выданный приём из сброса через turnModifiers)
- suppress с флагом all («без текста»): фильтр в forSource — заглушённые инстансы не отдают способностей/модификаторов; флюп-гейт разрешает флюп выданной способности при подавленных своих
- AbilitySpec.oncePerGame («в первый раз…»), условие if_payload_cost; TargetRef: this_lane_own_creature, this_lane_opponent_building
- Ледяные жетоны (A7+A7.1): LandState.iceTokens (ледяные земли стартуют с 1 — docs/RULES.md), ops remove_token/transfer_token, условия while_lane_ice_token/while_own_turn/while_no_tokens_in_play/while_zone_ice_token (play-gate), per_lands.token+where:'choice', фильтр zoneToken, suppress.attacks+filter, рефы each_creature_of_choice_player/adjacent_own_land, механики token_bonus_damage, событие token_changed
- Боевой контекст защитника (A8): операция defense_mod («+N АТК пока защищается», матчинг по земле зоны атакующего, только retaliation), условие while_own_card_in_play { cardId }
- Дебаффы АТК (A9): stat_buff.floorAttack («минимум 0» — ауры и this_turn-бафы)
- Ходы-состояния (A10): grant_discount (расходуемая скидка следующего розыгрыша, MatchState.discounts), ban_spells_next_turn (Дух ниндзя: armed→active по ходам жертвы, гейт spells_banned)
- pendingChoice: optional, target (мульти-ask с отложенным сбором через effect_step), resolve_choice, таймер-дефолт (skipPending), bot-ответ time_expired
- Кура данных: content/cards/mechanics/*.json + content/heroes/mechanics/*.json → build-catalog.mjs валидирует (ops, triggers, asks, refs, amounts, conditions, фильтры, choice-vs-targets) и печатает отчёт покрытия

## Клиент (C14 готов)

- targeting.ts — валидные цели по ask'у из view, режимы active/pending
- Hud — баннер с отменой, кнопки-цели для player/revealed, кнопка «Герой»
- CardMesh/Land/Hand — клик по подсвеченной цели отдаёт её таргетингу

## Бэклог (371 карта + 17 героев) — по убыванию приоритета

1. **Остатки льда (4 шт., нужны отдельные механизмы)**: Ледяной залп (мульти-перенос жетонов «любое количество»), Поддержка-компаньон (правило розыгрыша существ на жетонные земли команды), Ледяной лимонад (лечение ровно N существ), hero_ice_king (+1 АТК при первой атаке пустой линии — расширение A3 combat-контекста).
2. **Ауры на базовые статы противника** (Угнетающая пирамида −2 DEF уже есть), «−1 ATK всем существам противника в этом ходу» (Мастер маскировки).
4. **Игровые ходы-состояния** — «следующее заклинание стоит на 2 меньше» (Призрак Джинни), «нельзя играть заклинания в следующий ход» (Дух ниндзя), «не может быть атаковано/выбрано до следующего хода» (Пещера одиночества) — статусы с длительностью, нужен R2-full (идентичность перманентных баффов).
5. **Поиск/peek** (Вырубка леса, Гидромансер, Любопытный чувачок, Смотритель небес — последний уже сделан) — reveal-окно уже есть, нужен play_from_reveal.
6. **Hero уникальные** — Охотница-волшебница (слово в названии), Рикардио (плата жизнями), Моника («повернуть применённое»), tree_trunks (слово «Пирог»), strong_susan (урон = стоимость жертвы), bubblegum («раз за ход урон своему существу → +1 ATK»).

## Правила работы

- **Doc-first**: изменения контракта → сначала docs/MECHANICS-V2.md, потом код
- **Никаких имён карт в коде правил** — только в data (content/cards/mechanics/)
- **Константы — из CONFIG** (docs/CONFIG.md)
- **Тесты**: golden на представителя каждой механики в packages/content/src/golden.test.ts (реальный каталог), юнит-тесты в packages/domain/src/tests/mechanics.test.ts (фикстуры)
- **Валидация**: build-catalog.mjs валидирует все новые ops/asks/conditions — не забудь добавить новые в множества
- **git commit после каждого завершённого блока**

## Начни с

`git log --oneline -5` + `pnpm -r test` — убедись, что всё зелёное, потом продолжай бэклог сверху вниз. После каждого блока карт — `pnpm --filter @card-wars/content generate && pnpm -r test`.
