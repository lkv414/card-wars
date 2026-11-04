# Промт для продолжения работы над механиками Card Wars v3

Скопируй текст ниже в новый чат.

---

Ты продолжаешь работу над механиками карточной игры Card Wars v3 в монорепо pnpm workspaces (`packages/{domain,application,protocol,content}` + `apps/{server,client}`). Прочитай сначала:

1. `AGENTS.md` — конвенции (чистый domain, запрет хардкода карт, doc-first, zod на границе)
2. `docs/MECHANICS-V2.md` — архитектура механик v2 (главный документ: AbilitySpec, два класса пассивок, EffectSpec + именованные механики, pendingChoice, таргетинг, дорожная карта M1–M6 + бэклог)
3. `docs/CARDS.md` — формат карт (⚠ частично устарел — abilities вернулись, механики в `content/{cards,heroes}/mechanics/`)
4. `git log --oneline -20` — история коммитов (все этапы закоммичены)

## Текущее состояние

- **Покрытие**: 385/544 карт + 22/25 героев структурированы и работают
- **Тесты**: 225 зелёных (154 domain, 47 content, 15 server, 5 application, 4 protocol)
- **Отчёт покрытия** после каждой генерации: `pnpm --filter @card-wars/content generate` печатает «mechanics: cards N/544 structured»

## Что уже реализовано в движке

- Триггеры: on_cast, on_enters_play, on_leave_play, on_death, start_of_turn, start_of_next_turn, on_creature_attacks, on_damage_dealt, on_line_change, on_flip, on_draw, on_spell_cast, on_card_played, start_of_battle_phase, on_companion_event
- Операции (EffectSpec): deal_damage, heal, draw_cards, discard_top_deck, opponent_discards, stat_buff (aura/permanent/this_turn), gain_shield, gain_actions, flip_land, destroy, move_creature, freeze_land, win_if_opponents_deck_empty, cost_mod, land_count_mod, suppress, no_retaliation, damage_immunity, damage_redirect, grant_modifier, return_from_discard, discard_from_hand, grant_ability, reveal_deck_top, resolve_revealed, return_to_owner, counts_as, attack_mod, play_from_hand, play_from_discard
- Условия на уровне эффекта: `EffectSpec.conditions` — общий механизм для всех операций (шаг выполняется, только если условия выполнены); у `stat_buff` проверяются per-target
- Модификаторы: cost_mod, land_count_mod, stat_aura (с фильтрами ready/landType/sameCard/cardIds + floorDefense), damage_redirect, damage_immunity, no_retaliation, suppress (triggers/actives), counts_as, attack_mod
- Динамические величины: per_discard, per_damage, per_distinct_lands, per_lands (own/all/adjacent, empty/flipped), per_target, per_counter (spell_cast/creature_entered/creature_died/line_change), payload_damage
- Условия: if/while_discard_count, while_undamaged (self/target), while_damage_exactly/at_least (self/target), while_lane_empty_opponent, while_on_land_type, while_on_flipped_land (self/target), while_distinct_lands (min/max), while_land_count, while_zone_has_building, while_empty_lands, while_self_flipped, while_opponents_hand_empty, while_no_other_creatures (scope own/all), while_opponents_turn, if_payload_* (replacing/land_type/player_self/other/to_player/targeted_self/player_opponent)
- Цели (TargetAsk): own_creature, opponent_creature, any_creature, lane_creature, lane_opponent_creature, opponent_player, landscape, own_landscape, own_hand_card, own_building, lane_building, adjacent_creature, adjacent_any_creature, revealed_card, own_discard_card, any_discard_card — все с опциональными фильтрами (ready/landType/flipped/undamaged/cardType/maxCost/cardIds)
- Цели-рефы (TargetRef): choice, this_creature, this_lane_creature, this_lane_opponent_creature, adjacent_creatures, each_creature_yours/opponent/all, each_building_yours, each_player, each_opponent_player, self_player, this_lane_land, this_lane_lands, active_opponent_players
- Именованные механики (реестр): chain_damage, move_damage, swap_lanes, copy_spell (Связь: копия заклинания партнёром, цели по targets оригинала; MechanicHandler получает payload и beneficiary), grant_random_discard_active (Школа: suppress-all + выданный приём из сброса через turnModifiers)
- suppress с флагом all («без текста»): фильтр в forSource — заглушённые инстансы не отдают способностей/модификаторов; флюп-гейт разрешает флюп выданной способности при подавленных своих
- AbilitySpec.oncePerGame («в первый раз…»), условие if_payload_cost; TargetRef: this_lane_own_creature, this_lane_opponent_building
- Ледяные жетоны (A7+A7.1): LandState.iceTokens (ледяные земли стартуют с 1 — docs/RULES.md), ops remove_token/transfer_token, условия while_lane_ice_token/while_own_turn/while_no_tokens_in_play/while_zone_ice_token (play-gate), per_lands.token+where:'choice', фильтр zoneToken, suppress.attacks+filter, рефы each_creature_of_choice_player/adjacent_own_land, механики token_bonus_damage, событие token_changed
- Боевой контекст защитника (A8): операция defense_mod («+N АТК пока защищается», матчинг по земле зоны атакующего, только retaliation), условие while_own_card_in_play { cardId }
- Дебаффы АТК (A9): stat_buff.floorAttack («минимум 0» — ауры и this_turn-бафы)
- Ходы-состояния (A10): grant_discount (расходуемая скидка следующего розыгрыша, MatchState.discounts), ban_spells_next_turn (Дух ниндзя: armed→active по ходам жертвы, гейт spells_banned)
- Массовые батчи A–F: op unflip, рефы each_opponent_land/payload_zone_land/payload_zone_own_creatures, ask any_player/opponent_building, StatAmount target_hand_size/per_counter.every, фильтры undamaged/flipped/zoneFlipped, условия while_zone_has_creature/while_zone_has_flipped_creature/while_lives_at_most/while_opponent_creatures_at_most/while_own_creature_on_land_type, обобщённый play-gate по conditions-only пассивкам, move_damage params.self, swap_lanes params.opponent
- pendingChoice: optional, target (мульти-ask с отложенным сбором через effect_step), resolve_choice, таймер-дефолт (skipPending), bot-ответ time_expired
- Кура данных: content/cards/mechanics/*.json + content/heroes/mechanics/*.json → build-catalog.mjs валидирует (ops, triggers, asks, refs, amounts, conditions, фильтры, choice-vs-targets) и печатает отчёт покрытия

## Клиент (C14 готов)

- targeting.ts — валидные цели по ask'у из view, режимы active/pending
- Hud — баннер с отменой, кнопки-цели для player/revealed, кнопка «Герой»
- CardMesh/Land/Hand — клик по подсвеченной цели отдаёт её таргетингу

## Бэклог — 150 карт + 3 героя, сгруппированы по требуемому механизму

Простые карты разобраны (батчи A–F + G1–G11). Остаток требует НОВЫХ механизмов:

1. **Выбор из сброса + игра оттуда** (✅ сделано: Лунный урожай, Поднятие мертвых, Древний школяр, Последний шанс; осталось: Амбар с сеном — игра конкретной карты из сброса + «уничтожь Кормежника на этой земле», Громила — удаление по названию) — ask `own_discard_card`/`any_discard_card`, op `play_from_discard`.
2. **Перераспределение урона произвольно** (Заплатка, Вместе навсегда, Браслеты, Ангел-болот Банши done, Крепость из подушек) — свободный перенос, нужен спец-UI.
3. **2v2-компаньоны** (Сотрудничество — копия заклинания той же стоимости, Выручка — фаза сражения партнёра, Поддержка — правило розыгрыша) — on_companion_event-семантики.
4. **Кража и информация** (Башня правды, Мушка-хлопушка, Просвещение — reorder ЧУЖОЙ колоды, Пакость, Близняшки, Один в один, Семейные посиделки) — steal + сравнения вскрытых карт.
5. **Слова в названии** (Охотница-волшебница, Громила, Бизнес пес done, Клон, Частичка души, Некромама) — соответствие названий на уровне правил.
6. **Боевые семантики II** (Крысолов — замена атакующего, Призрак Тэдди-крюка, Проклятый дух, Дух воплекура «ИЛИ», Разбойная тыква — повтор за земли, Куча мала, Слинять) — расширение combat-контекста.
7. **Статусы и правила розыгрыша** (поп-десанты «нельзя заменить» + автоперемещение, Ледяная база, Крепкий лесоруб — доп. строение, Няш-мяш — запрет карт стоимости 0, Мятная мороженка — иммунитет к заклинаниям, Яблочный страж — защита земли, Хата на Новый Год / Кот-панк / Паладин / Кровь Вайда — трекинг «сменивших линию», Воскресная школа — чёт HP, Хижина эльфа / Желтый маяк / Башня правосудия / Квадурай / Жучья госпожа / Тонущие / Усталые / Бордер колли / Моккомет / Музыкальный трон / Снижение налогов / Книга Кунг-фу / Запашок / Виноградная попка / Магический портал done / Магокражка done).
8. **Прочее** (Рикардио — плата жизнями, Муррризрак — воскрешение, Частичка души, Песочный замок — изгнание, Прозрачный ниндзя — кубик, Пещера-стиль для Цитадели/Облачной башни — иммунитет к заклинаниям/выбору, Плюшевый/Кольцо пушистости — ATK-зависимые величины, Бондарь — стоимость карт партнёрства, Ледяной лимонад — лечение ровно N, Кольцо третьего глаза done, Геркулез done).

## Найденные при разборе баги (уже исправлены — не откатывать)

- `stat_buff.conditions` — тип не имел поля, движок условия не читал: 18 карт работали безусловно (Мисс Пушинка, Кукурузный чемпион).
- `resolve_choice` валидировал ВЕСЬ набор ask'ов сразу, а ответы приходят по одному → multi-ask триггеры нельзя было завершить (~15 карт).
- ask-фильтры `flipped`/`undamaged` разрешались валидатором, но не проверялись доменом (Магазин для отдыха).
- Батч G10 заявил 7 карт, а записал 4 (скрипт упал на `NameError`): потеряны Деревянный рыцарь, Спасайся кто может!, Крок-зачинщик.

## Правила работы

- **Doc-first**: изменения контракта → сначала docs/MECHANICS-V2.md, потом код
- **Никаких имён карт в коде правил** — только в data (content/cards/mechanics/)
- **Константы — из CONFIG** (docs/CONFIG.md)
- **Тесты**: golden на представителя каждой механики в packages/content/src/golden.test.ts (реальный каталог), юнит-тесты в packages/domain/src/tests/mechanics.test.ts (фикстуры)
- **Валидация**: build-catalog.mjs валидирует все новые ops/asks/conditions — не забудь добавить новые в множества
- **git commit после каждого завершённого блока**

## Начни с

`git log --oneline -5` + `pnpm -r test` — убедись, что всё зелёное, потом продолжай бэклог сверху вниз. После каждого блока карт — `pnpm --filter @card-wars/content generate && pnpm -r test`.
