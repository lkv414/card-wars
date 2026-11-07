// Mechanics v2 data model (docs/MECHANICS-V2.md). Pure data: abilities arrive
// from the catalog (content/cards/mechanics + content/heroes/mechanics), never
// hardcoded; handlers are mechanic-level, not card-level.

import type { CardType, LandType } from '../types';

export type PlayerId = string;

/** When a passive ability fires (docs/MECHANICS-V2.md §2Б). */
export type Trigger =
  | 'on_cast'
  | 'on_enters_play'
  | 'on_leave_play'
  | 'on_death'
  | 'start_of_turn'
  | 'start_of_next_turn'
  | 'on_creature_attacks'
  | 'on_damage_dealt'
  | 'on_line_change'
  | 'on_flip'
  | 'on_draw'
  | 'on_spell_cast'
  | 'on_card_played'
  | 'start_of_battle_phase'
  | 'on_companion_event'
  | 'on_freeze'
  /** A card returned to its owner's hand (Леди Ливнерог, docs §H7). */
  | 'on_return_to_hand'
  /** Any card hit a discard pile (Марселина: «когда враг сбрасывает карту», docs §H12). */
  | 'on_card_discarded';

/** What a triggered ability observes (queued with the ability). */
export interface TriggerPayload {
  /** Scope hint: turn-scoped triggers (start_of_turn, on_draw) fire only for this player. */
  player?: PlayerId;
  instanceId?: string;
  cardId?: string;
  /** on_enters_play: the card replaced another card in its zone. */
  replaced?: boolean;
  targetInstanceId?: string;
  targetPlayer?: PlayerId;
  amount?: number;
  count?: number;
  cost?: number;
  zone?: number | null;
  /** on_death: the creature that dealt the lethal damage (Карга, Духо-муха). */
  killerInstanceId?: string;
  /** on_companion_event: the wrapped partner event (docs §H16). */
  companionEvent?: Trigger;
}

/** Target asks: what the player must pick, in declared order (docs/MECHANICS-V2.md §5). */
export type TargetAskKind =
  | 'own_creature'
  | 'opponent_creature'
  | 'any_creature'
  /** Creature in the source's lane, either side (Док Смерть, Уни-рыцарь). */
  | 'lane_creature'
  /** Opponent creature in the source's lane (Острый парень, Песчаный змей). */
  | 'lane_opponent_creature'
  | 'opponent_player'
  /** Any alive player (Кристалл силы: «выбранный игрок»). */
  | 'any_player'
  /** An opponent's building (Призрачный шмяк). */
  | 'opponent_building'
  | 'landscape'
  | 'own_hand_card'
  | 'own_building'
  | 'lane_building'
  /** Own-side land, any type (Бигфут) — combine with filter.landType (Червь шелухи). */
  | 'own_landscape'
  /** One adjacent own creature (Защищенный зебрарог). */
  | 'adjacent_creature'
  /** One creature on an adjacent lane, either side (Пляжная мумия). */
  | 'adjacent_any_creature'
  /** One card of the current revealed window (Газы Огрa). */
  | 'revealed_card'
  /** One card of the owner's own discard pile (Поднятие мертвых, Лунный урожай). */
  | 'own_discard_card'
  /** One card of any player's discard pile (Последний шанс — «твоего сброса или сброса противника»). */
  | 'any_discard_card'
  /**
   * One publicly visible card — in play or in any discard pile (Громила:
   * «выбери название карты»). Discard piles are public by the rules, so the
   * choice never reveals hidden information.
   */
  | 'visible_card'
  /**
   * The player's pick between healing and dealing damage («Восстанови или
   * нанеси 1 урон» — Зелёная сахарная вата, Милая мельница).
   */
  | 'heal_or_damage'
  /** Numeric input (docs/MECHANICS-V2.md §H1): «нанеси 1 или 2 урона», damage redistribution. */
  | 'amount'
  /** Pick one of several named branches («ИЛИ», выбор типа земли). */
  | 'choose_option'
  /** One answer carrying damage values for every own creature (docs §H1). */
  | 'damage_distribution'
  /** Any building in play (lsp_card_39). */
  | 'any_building'
  /** One card of the private peek window, by position (charlie_card_22). */
  | 'peek_card';

export interface TargetAsk {
  kind: TargetAskKind;
  /** Optional constraint validated at choice time (Пси-фехтовальщик: только применённые). */
  filter?: TargetFilter;
  /** Inclusive bounds for `amount`; default 0..99. */
  min?: number;
  max?: number;
  /** Allowed values for `choose_option`. */
  options?: string[];
  /** RU label rendered by the HUD for non-board asks. */
  label?: string;
  /**
   * Only for `damage_distribution` (docs §H11): `reassign` (default) — values are
   * each creature's total damage (sum preserved, for redistribute_damage);
   * `add` — values are damage to ADD per creature (for distribute_damage).
   */
  mode?: 'reassign' | 'add';
}

/** Player's answers sent with a command (floop / hero_ability / resolve_choice). */
export type TargetChoice =
  | { kind: 'creature'; instanceId: string }
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'landscape'; player: PlayerId; zone: number }
  | { kind: 'card'; instanceId: string }
  /** «Восстанови или нанеси урон» — игрок выбирает режим. */
  | { kind: 'mode'; mode: 'heal' | 'damage' }
  /** Numeric answer to an `amount` ask. */
  | { kind: 'amount'; value: number }
  /** Named branch answer to a `choose_option` ask. */
  | { kind: 'option'; option: string }
  /** Damage values for every creature of `damage_distribution`. */
  | { kind: 'amounts'; values: number[] };

/** How an effect picks its targets: static board relations or a player choice by ask index. */
export type TargetRef =
  | { kind: 'choice'; index: number }
  | { kind: 'this_creature' }
  /** Every creature of the player chosen by choice[0] (Вафля). */
  | { kind: 'each_creature_of_choice_player' }
  /** Own lands adjacent to the source's zone (Банши: «соседняя земля»). */
  | { kind: 'adjacent_own_land' }
  | { kind: 'this_lane_creature' }
  /** Own creature in the source's lane (Школа: «твоё существо на этой линии»). */
  | { kind: 'this_lane_own_creature' }
  /**
   * The opponent's land in the source's lane — the zone facing the source
   * (Крок-зачинщик: «передвинь существо противника на линию Крок-зачинщика,
   * если она пуста»).
   */
  | { kind: 'this_lane_opponent_land' }
  | { kind: 'this_lane_opponent_creature' }
  /** Opponent buildings in the source's lane (Пес). */
  | { kind: 'this_lane_opponent_building' }
  | { kind: 'adjacent_creatures' }
  | { kind: 'each_creature_yours' }
  | { kind: 'each_creature_opponent' }
  | { kind: 'each_creature' }
  | { kind: 'this_lane_land' }
  /** Both lands of the source's lane (Ледяная снегобаба: «обе земли»). */
  | { kind: 'this_lane_lands' }
  /** Opponents currently taking their turn (Лейтенант Гриб: «этот противник»). */
  | { kind: 'active_opponent_players' }
  | { kind: 'each_building_yours' }
  /** The only other player on the source's team (2v2). */
  | { kind: 'teammate_player' }
  /** Enemy team, represented by its first alive player (team lives are shared). */
  | { kind: 'opponent_team' }
  /** Every land of every opponent (Полюс холода). */
  | { kind: 'each_opponent_land' }
  /** The land of the trigger payload's zone (Морозильник: «его земля»). */
  | { kind: 'payload_zone_land' }
  /** Creatures of the payload player standing in the payload zone (Кейк). */
  | { kind: 'payload_zone_own_creatures' }
  /** The killer of the dead creature in the payload (Духо-муха). */
  | { kind: 'payload_killer' }
  /** The player of the payload (Карга: владелец жертвы). */
  | { kind: 'payload_player' }
  /** Own creature with the lowest attack (Мозги). */
  | { kind: 'min_attack_own' }
  /** The instance the trigger payload is about (e.g. attacker). */
  | { kind: 'triggering_instance' }
  /** Partner of the player in the trigger payload (2v2). */
  | { kind: 'payload_partner' }
  | { kind: 'each_player' }
  | { kind: 'each_opponent_player' }
  | { kind: 'self_player' }
  /** Own creatures carrying damage (Заплатка, перераспределение урона). */
  | { kind: 'each_own_creature_damaged' }
  /** Every creature that changed lane this turn (Кот-панк, Запашок от носок). */
  | { kind: 'each_creature_moved_this_turn' }
  /** Own creatures that changed lane this turn (Паладин). */
  | { kind: 'each_own_creature_moved_this_turn' }
  /** All buildings in play, either side (Снижение налогов). */
  | { kind: 'each_building' }
  /** All lands in play, either side (Ледяной залп). */
  | { kind: 'each_land' }
  /** Cards attached under the source instance (Каракум, Берсеркорова). */
  | { kind: 'attached_cards' }
  /** Top card of each opponent's discard pile (Очаровательный трупоедик). */
  | { kind: 'opponent_discard_top' }
  /** Creature standing in the zone chosen by the ask answer at this index (Ультра пес). */
  | { kind: 'choice_zone_creature'; index: number }
  /** The SOURCE-side land of the chosen zone (lsp_card_39). */
  | { kind: 'choice_zone_land'; index: number }
  /** Opponent creature facing the chosen zone (lsp_card_39). */
  | { kind: 'choice_zone_opponent_creature'; index: number }
  /** Cards of the source's private peek window (charlie_card_22). */
  | { kind: 'peeked_cards' };

export type StatKey = 'attack' | 'defense';

/** Serializable turn-event counters, keyed by player/team in MatchState. */
export type TurnCounterKind =
  | 'spell_cast'
  | 'creature_entered'
  | 'creature_died'
  | 'line_change'
  | 'cards_drawn'
  | 'cards_discarded'
  | 'creature_cost_2_plus_played'
  | 'damage_dealt_to_enemy'
  | 'creature_attack'
  | 'returned_to_hand';

/** Scope used by turn-counter reads/writes. */
export type CounterScope = 'own' | 'team' | 'teammate';

/** Filters for per-target dynamic amounts and aura targets (docs/MECHANICS-V2.md §3). */
export interface TargetFilter {
  /** Only ready (not flipped) cards: «за каждое применённое существо». */
  ready?: boolean;
  /** Only cards of this land type (Матриарх Вайда: Радужные существа). */
  landType?: LandType;
  /** Only cards sharing the source's cardId (Бочка, Нефтяная Вышка). */
  sameCard?: boolean;
  /** Only these cards (Мамуля камнепух counts Малышей — data-level cross-reference). */
  cardIds?: string[];
  /** Only cards of this type (выбор строения из сброса — Лунный урожай). */
  cardType?: CardType;
  /** Only cards costing at most this much (Поднятие мертвых: «стоимостью 2 или менее»). */
  maxCost?: number;
  /** Only creatures without damage (Пирогошторм). */
  undamaged?: boolean;
  /** Only flipped («неактивные») creatures (Лапа пумы). */
  flipped?: boolean;
  /** Match by the target's ZONE land type instead of the card (гномы). */
  zoneLandType?: LandType;
  /** Match creatures standing on a face-down land (герой Джейк). */
  zoneFlipped?: boolean;
  /** Match creatures standing on a land with ice tokens (Пингвин, Мороженник, Гантер). */
  zoneToken?: boolean;
  /** Match creatures whose zone has a building (Деревянный ритм). */
  zoneBuilding?: boolean;
  /** Invert the match (Капитан Тако: не на кукурузной земле). */
  negate?: boolean;
  /** Only creatures that changed lane this turn (docs/MECHANICS-V2.md §H3). */
  movedThisTurn?: boolean;
  /** Only creatures that entered play this turn. */
  enteredThisTurn?: boolean;
}

/** Dynamic stat amounts (docs/MECHANICS-V2.md §3). */
export type StatAmount =
  | number
  | { kind: 'per_discard'; every: number; amount: number }
  | { kind: 'per_damage'; amount: number }
  /** «за каждый различный тип земли под твоим контролем». */
  | { kind: 'per_distinct_lands'; amount: number }
  /** Distinct land types controlled by the opponents (Ожерелье черных дыр). */
  | { kind: 'per_opponent_distinct_lands'; amount: number }
  /** Lands by scope; filters: only empty zones (Пескозавр рекс), only face-down (Смещатель земли). */
  | {
      kind: 'per_lands';
      where: 'own' | 'all' | 'adjacent' | 'choice';
      landType?: LandType;
      empty?: boolean;
      flipped?: boolean;
      /** Only lands carrying ice tokens (Ледяной диверсант, Ослепительная Люси). */
      token?: boolean;
      amount: number;
    }
  | {
      kind: 'per_target';
      target: TargetRef;
      amount: number;
      excludeSelf?: boolean;
      filter?: TargetFilter;
    }
  /** Turn counters (docs/MECHANICS-V2.md §3): spells cast, creatures entered/died, line changes, team/ally events. */
  | { kind: 'per_counter'; counter: TurnCounterKind; scope: 'own' | 'all' | 'team' | 'teammate'; amount: number; every?: number }
  /** Hand size of the player chosen by choice[0] (Поля кошмаров, Фермер-кочевник). */
  | { kind: 'target_hand_size'; amount: number }
  /** Cards played this turn whose name contains any matcher (Бизнес пес). */
  | { kind: 'per_played_name'; matchers: string[]; amount: number }
  /** The dead creature's printed cost inside an on_death payload (Карга). */
  | { kind: 'payload_cost'; amount: number }
  /** Players controlling at least one land with an ice token (Капитан мороженка). */
  | { kind: 'per_token_players'; amount: number }
  /** Inside a damage trigger: the dealt amount (Лорд Вампиров, Мятный змей). */
  | { kind: 'payload_damage' }
  /** A number chosen by the player via an `amount` ask (docs/MECHANICS-V2.md §H1). */
  | { kind: 'chosen_amount'; index: number }
  /** Current damage counters on a target creature. */
  | { kind: 'target_damage'; target: TargetRef }
  /** Effective attack of a target creature (Плюшевый). */
  | { kind: 'target_attack'; target: TargetRef }
  /** Number of cards attached under an instance (Каракум). */
  | { kind: 'attached_count'; target: TargetRef }
  /** Printed cost of the card picked by the ask answer at this index (Марселина, docs §H12). */
  | { kind: 'chosen_card_cost'; index: number }
  /** Sum of the source team's companion card costs (grand_prix_card_7, docs §H16). */
  | { kind: 'team_companion_cost' }
  /** Ladder on the owner's life total (tree_trunks_card_39, docs §H16). */
  | { kind: 'lives_ladder'; threshold: number; high: number; low: number };

/**
 * Conditions (docs/MECHANICS-V2.md §7). `if_*` — one-shot at run time,
 * `while_*` — checked on every modifier scan. Board-scoped conditions take
 * the context instance (self / aura target) via the scan.
 */
export type ConditionSpec =
  | { kind: 'if_discard_count'; min: number }
  | { kind: 'while_discard_count'; min: number }
  | { kind: 'while_undamaged'; scope: 'self' | 'target' }
  | { kind: 'while_damage_exactly'; amount: number; scope: 'self' | 'target' }
  | { kind: 'while_damage_at_least'; amount: number; scope: 'self' | 'target' }
  | { kind: 'while_damage_at_most'; amount: number; scope: 'self' | 'target' }
  | { kind: 'while_lane_empty_opponent' }
  | { kind: 'while_self_flipped' }
  | { kind: 'while_opponents_hand_empty' }
  | { kind: 'while_no_other_creatures'; scope?: 'own' | 'all' }
  | { kind: 'while_empty_lands'; min: number }
  | { kind: 'while_on_flipped_land'; scope: 'self' | 'target' }
  // Payload conditions: meaningful only inside a trigger (aura scans fail them).
  | { kind: 'if_payload_replacing' }
  | { kind: 'if_payload_land_type'; landType: LandType }
  /** The event card's printed cost lies within [min..max] (Связь: «стоимостью 0»). */
  | { kind: 'if_payload_cost'; min?: number; max?: number }
  | { kind: 'if_payload_player_self' }
  | { kind: 'if_payload_other' }
  /** Current match phase. */
  | { kind: 'while_phase'; phase: 'draw' | 'main' | 'combat' }
  /** on_damage_dealt/on_creature_enters: payload instance is a creature. */
  | { kind: 'if_payload_creature' }
  /** on_enters_play: the entered card is a building (Кейк). */
  | { kind: 'if_payload_building' }
  /** on_damage_dealt: the payload instance belongs to an enemy team and is a creature. */
  | { kind: 'if_payload_enemy_creature' }
  /** on_damage_dealt/on_creature_attacks: the payload has a damaged creature target. */
  | { kind: 'if_payload_targets_creature' }
  /** on_damage_dealt: the damage went to a player (Мятный змей: «урон противнику»). */
  | { kind: 'if_payload_to_player' }
  /** Payload target belongs to an enemy team (on_damage_dealt/on_spell_cast). */
  | { kind: 'if_payload_opponent_target' }
  /** on_spell_cast: this creature was the spell's target (Привлекательный слон). */
  | { kind: 'if_payload_targeted_self' }
  /** on_leave_play: the card that left belonged to an opponent. */
  | { kind: 'if_payload_player_opponent' }
  /** on_damage_dealt: the damaging source is the source owner's teammate. */
  /** Payload source belongs to the same team as the source (ally, including self). */
  | { kind: 'if_payload_ally' }
  /** Payload target belongs to the source's team (self or ally). */
  | { kind: 'if_payload_team_target' }
  | { kind: 'if_payload_teammate' }
  /** Team/own turn-event counter is above threshold. */
  | { kind: 'while_counter_at_least'; counter: TurnCounterKind; min: number; scope?: CounterScope }
  /** Team/own turn-event counter is at most threshold («ничего не сыграно»). */
  | { kind: 'while_counter_at_most'; counter: TurnCounterKind; max: number; scope?: CounterScope }
  /** Current turn belongs to an opponent (Лейтенант Гриб: «во время хода противника»). */
  | { kind: 'while_opponents_turn' }
  /** Source sits on a land of this type (Крок-эколог на Ледяной земле). */
  | { kind: 'while_on_land_type'; landType: LandType }
  /** At least min distinct land types under control (Лимонное желе). */
  | { kind: 'while_distinct_lands'; min?: number; max?: number }
  /** Land count of a type under control within [min..max] (Кукурузный пес). */
  | { kind: 'while_land_count'; landType: LandType; min?: number; max?: number }
  /** The source's lane has at least `min` lands with ice tokens (Ледяной гонщик). */
  | { kind: 'while_lane_ice_token'; min: number }
  /** No ice tokens anywhere in play (Снежная полоса препятствий). */
  | { kind: 'while_no_tokens_in_play' }
  /** The zone this card ENTERS PLAY on carries an ice token (Ледяной душегуб, play-gate). */
  | { kind: 'while_zone_ice_token' }
  /** It is the source owner's turn (Плавучий Дворец Льда). */
  | { kind: 'while_own_turn' }
  /** An own creature stands on a land of this type (Костяная палочка, play-gate). */
  | { kind: 'while_own_creature_on_land_type'; landType: LandType }
  /** Own field card with this id is in play (Малыш камнепух при своей Мамуле). */
  | { kind: 'while_own_card_in_play'; cardId: string; minDamage?: number }
  /** The damage killer is this very source (Карга, Песочный шакал). */
  | { kind: 'if_payload_killer_self' }
  /** The dead creature was on the source's lane (Фонтан милашности). */
  | { kind: 'if_payload_zone_matches_self' }
  /** The payload card's landing zone land type (Бриллиантовый Дэн). */
  | { kind: 'if_payload_zone_land_type'; landType: LandType }
  /** A card of this land type was played this turn (Младший школяр). */
  | { kind: 'while_played_land_type'; landType: LandType }
  /** Own building in the source's zone (Кукурузный чемпион). */
  | { kind: 'while_zone_has_building' }
  /** The source's zone holds NO creature (Амбар с сеном: «если эта земля пустует»). */
  | { kind: 'while_zone_has_no_creature' }
  /** Own creature in the source's zone (Теневая пирамида). */
  | { kind: 'while_zone_has_creature' }
  /** Own flipped creature in the source's zone (Заманчивое Спа). */
  | { kind: 'while_zone_has_flipped_creature' }
  /** Owner's lives at most N (Магокражка). */
  | { kind: 'while_lives_at_most'; max: number }
  /** Opponents control at most N creatures (Зомбанан). */
  | { kind: 'while_opponent_creatures_at_most'; max: number }
  /** Effective DEF (base + bonuses − damage) is at most N (Хлопковый Великан). */
  | { kind: 'while_effective_def_at_most'; max: number; scope?: 'self' | 'target' }
  /** Owner's lives at least N (Милая сладюшка). */
  | { kind: 'while_lives_at_least'; min: number }
  /** At least N cards attached under this instance. */
  | { kind: 'while_attached_at_least'; min: number }
  /** A card whose printed name contains `word` was played (Колдунья-охотница). */
  | { kind: 'while_card_name_contains'; word: string }
  /** A card of this type was played this turn. */
  | { kind: 'while_played_card_type'; type: import('../types').CardType }
  /** No spells were played this turn (Виноградная попка: «не-кукурузные карты»). */
  | { kind: 'while_no_spells_played' }
  /** No card of this land type was played this turn (Виноградная попка). */
  | { kind: 'while_no_land_type_played'; landType: import('../types').LandType }
  /** The owner's life total is even (Воскресная школа). */
  | { kind: 'while_lives_even' }
  /** The aura candidate changed lane this turn (Хата на Новый Год). */
  | { kind: 'while_target_moved_this_turn' }
  /** The trigger payload is about this very instance (Усталый библиотекарь). */
  | { kind: 'if_payload_instance_self' }
  /** Any opponent holds at least N cards (ftg_card_64-style start-of-turn damage). */
  | { kind: 'while_opponents_hand_at_least'; min: number }
  /** The event happened in a zone adjacent to the source's own (Песочный краб рубака, docs §H14). */
  | { kind: 'if_payload_zone_adjacent' }
  /** Own or teammate creatures stand on lands with ice tokens (monika_card_24, docs §H16). */
  | { kind: 'while_team_creature_on_token_land' }
  /** Both lanes adjacent to the source have no creatures (Мятная мороженка, docs §H16). */
  | { kind: 'while_adjacent_lanes_empty' }
  /** An opponent controls one of the source owner's creatures (Ска-пион, docs §H16). */
  | { kind: 'while_opponent_controls_own_creature' }
  /** Own field creatures count ≤ max (Магокражка, аудит 2026-11-07). */
  | { kind: 'while_own_creatures_at_most'; max: number }
  /**
   * Effect-array branch gate on a `choose_option` answer (docs §6 «Ветвление»).
   * Checked in runSteps BEFORE counting the step's choices; inside
   * conditionsHold it is always satisfied by construction.
   */
  | { kind: 'if_option'; index: number; option?: string; options?: string[] }
  /** The played card's name contains the player's chosen word (Колдунья-охотница). */
  | { kind: 'if_payload_name_contains' };

/** Mandatory additional cost printed before «ПРИЕМ/>>>» (docs/MECHANICS-V2.md §1). */
export interface AdditionalCost {
  /** Discard n cards from own hand (Бимо: «Сбрось карту с руки >>> …»). */
  discardFromHand?: number;
  /** Floop (apply) n own ready creatures (Вырубка леса: «примени существо»). */
  floopOwnCreature?: number;
  /** Destroy this very card as the cost (Зеленая сирена: «Уничтожь сирену >>> …»). */
  destroySelf?: boolean;
  /** Discard a hand card whose name contains this word (Деревяшка: «Пирог»). */
  discardFromHandName?: string;
  /** Sacrifice n own creatures (Док Смерть, Заводской убийца). */
  destroyOwnCreature?: number;
  /** Sacrifice n own buildings (Стрелец Дэника). */
  destroyOwnBuilding?: number;
  /** Pay n lives (Рикардио, docs §H2). */
  payLife?: number;
}

/**
 * Declarative operations (docs/MECHANICS-V2.md §3). The union grows per
 * milestone; unimplemented ops are rejected by the interpreter until coded.
 *
 * Every operation may carry its own `conditions` — checked when the effect
 * runs («Верни случайную Радужную карту… Если на этой линии строение,
 * получи 1 действие» — Древний школяр). Ability-level `conditions` gate the
 * whole ability; effect-level ones gate only this step.
 */
type EffectOp =
  | { op: 'deal_damage'; target: TargetRef; amount: StatAmount; pierce?: boolean; filter?: TargetFilter }
  | { op: 'heal'; target: TargetRef; amount: StatAmount }
  | { op: 'draw_cards'; count: StatAmount; target?: TargetRef }
  | { op: 'discard_top_deck'; count: StatAmount }
  | { op: 'opponent_discards'; target: TargetRef; count: StatAmount }
  | {
      op: 'stat_buff';
      target: TargetRef;
      stat: StatKey;
      amount: StatAmount;
      duration: 'permanent' | 'aura' | 'this_turn' | 'next_turn';
      /** Aura target filter (Фея Шепард: только милые существа). */
      filter?: TargetFilter;
      /** Defense floor for the affected creature (Угнетающая пирамида: не ниже 1). */
      floorDefense?: number;
      /** Attack floor: «минимум 0» у дебаффов (Затопление, Аванпост попугаев). */
      floorAttack?: number;
      /** Multiply the resulting stat («АТК удваивается», docs §H2). */
      multiplier?: number;
    }
  | { op: 'gain_shield'; target: TargetRef; amount: number }
  | { op: 'gain_actions'; amount: number }
  /** Turn a land face up (Бигфут) or face down (Червь шелухи); `until` reverts it automatically. */
  | { op: 'flip_land'; target: TargetRef; down: boolean; until?: 'next_own_turn' }
  | { op: 'destroy'; target: TargetRef; /** Narrow the destruction (Громила: карта с этим названием). */
      filter?: TargetFilter }
  /**
   * Remove cards from the game (location `removed`) — Громила: «удали из игры
   * каждую карту с таким названием из стопки сброса выбранного игрока».
   * `name` matches the printed card name exactly; `from` selects the discard
   * pile of the chosen player.
   */
  | {
      op: 'remove_from_game';
      /** The discard pile owner (a player choice). */
      from: TargetRef;
      /** Printed card name to remove (a card choice → its catalog name). */
      name: TargetRef;
    }
  /**
   * Heal or damage a creature, as the player chooses («Восстанови или нанеси
   * 1 урон» — Зелёная сахарная вата). `mode` points at the ask that carries
   * the player's pick; the amount is the same for both branches.
   */
  | {
      op: 'heal_or_damage';
      target: TargetRef;
      /** The `heal_or_damage` ask holding the player's choice. */
      mode: TargetRef;
      amount: number;
    }
  /**
   * Hand a card from the owner's hand to the given player («передай карту в
   * руку своему партнёру» — Дай пять!, Королевский тур).
   */
  | {
      op: 'give_card';
      /** The card in hand to pass (ask own_hand_card). */
      card: TargetRef;
      /** The receiver (ask any_player). */
      to: TargetRef;
    }
  /** Move a creature to a player-chosen empty zone (Коготь дракона). */
  | { op: 'move_creature'; target: TargetRef; destination: TargetRef; side: 'own' | 'any' }
  | { op: 'freeze_land'; target: TargetRef; frozen: boolean }
  /** Next matching play this turn costs `amount` less (Призрак Джинни, Непустой гроб). */
  | { op: 'grant_discount'; cardType: 'spell' | 'creature' | 'building'; amount: number }
  /** The player damaged by this trigger cannot play spells on their next turn (Дух ниндзя). */
  | { op: 'ban_spells_next_turn' }
  /** Remove one ice token from the target land (Снежок, Ледяной банк). */
  | { op: 'remove_token'; target: TargetRef }
  /** Move one ice token between two lands (Коктейль): target → destination. */
  | { op: 'transfer_token'; target: TargetRef; destination: TargetRef }
  /** Win check (герой Билли): all opponents' decks are empty at the trigger point. */
  | { op: 'win_if_opponents_deck_empty' }
  /** Cost modifier scanned at payment time (Остролист, Домик из разного дерева). */
  | { op: 'cost_mod'; self: true; amount: StatAmount }
  /** «Считается за дополнительную землю» (Ферма). */
  | { op: 'land_count_mod'; landType?: LandType; amount: number }
  /** Suppress triggers or actives of the covered cards (Дворец Костей, Чародейка Вайда);
   *  `all` = «без текста»: actives, triggers and passive modifiers (Пес, Школа);
   *  `attacks` = «не могут атаковать» (Морозильная камера); `filter` narrows coverage. */
  | { op: 'suppress'; target: TargetRef; actives?: boolean; triggers?: Trigger[]; all?: boolean; attacks?: boolean; spells?: boolean; creatureAbilities?: boolean; filter?: TargetFilter }
  /** Attacking this creature provokes no retaliation (Призрачные бро). */
  | { op: 'no_retaliation'; target: TargetRef }
  /** Covered creature ignores the first N damage of each hit (Пушистая лиса). */
  | { op: 'damage_immunity'; target: TargetRef; amount: number; from?: 'attacks' }
  /** Damage to the covered creatures goes to the modifier source instead (Ведриния). */
  | { op: 'damage_redirect'; from: TargetRef; excludeSelf?: boolean }
  /** Grant a rule modifier for the current turn (floop Ведринии). */
  | { op: 'grant_modifier'; modifier: EffectSpec; duration?: 'this_turn' | 'while_flipped' }
  /** Return cards from own discard to hand (or deck top, lsp_card_25). */
  | {
      op: 'return_from_discard';
      count: StatAmount;
      filter?: { type?: CardType; landType?: LandType; cost?: number };
      random?: boolean;
      to?: 'hand' | 'deck_top';
    }
  /** Discard own hand cards (chosen via own_hand_card asks). */
  | { op: 'discard_from_hand'; count: number }
  /** Aura-grant of an ability to covered cards (Финн: «получают ПРИЕМ >>> …»). */
  | { op: 'grant_ability'; target: TargetRef; ability: AbilitySpec }
  /** Return a field card to its owner's hand (Пляжная мумия, желе-карты). */
  | { op: 'return_to_owner'; target: TargetRef }
  /** Covered cards also count as this land type (Кроха слон — радужным; город). */
  | { op: 'counts_as'; target: TargetRef; landType: LandType }
  /**
   * Combat modifier for the covered DEFENDER (A8): «+N АТК пока защищается» —
   * бонус к сдаче (retaliation) при совпадении земли ЗОНЫ АТАКУЮЩЕГО с
   * `landType` (Привидение, Духи). Applies only inside the combat exchange.
   */
  | { op: 'defense_mod'; target: TargetRef; landType?: LandType; atkBonus: number }
  /**
   * Combat modifier for the covered attacker (A3): тройной урон / бонус АТК
   * на удар / удар в лицо — при совпадении земли зоны атакующего (`ownZone`)
   * или защищающегося (`defenderZone`) с `landType`.
   */
  | {
      op: 'attack_mod';
      target: TargetRef;
      vs?: 'ownZone' | 'defenderZone';
      landType?: LandType;
      multiplier?: number;
      atkBonus?: number;
      face?: boolean;
      /** Bonus only while attacking an EMPTY lane (hero_ice_king). */
      emptyLane?: boolean;
      /** Bonus only against creatures of this land type (Му-бык: жёлтые = кукуруза). */
      defenderType?: LandType;
      /** Bonus only against creatures with exactly this printed cost (Хлопковая гвардия). */
      defenderCost?: number;
      /** Per enemy creature adjacent to the defender (Призрак Тэдди-крюка, docs §H14). */
      atkBonusPerAdjacentEnemy?: number;
    }
  /** Un-flip a flipped (applied) own creature (Архитектор разума, Моника). */
  | { op: 'unflip'; target: TargetRef }
  /** Protect covered creatures until the owner's next turn start (Пещера одиночества). */
  | { op: 'grant_protection'; target: TargetRef }
  /** Reveal own deck top until a matching card (or max) (Вырубка леса, Гидромансер). */
  | { op: 'reveal_until'; max: number; match?: { type?: CardType; landType?: LandType; cardIds?: string[] } }
  /** Play the last revealed card for free; the rest of the window shuffles back. */
  | { op: 'play_revealed'; destination?: TargetRef }
  /** Play a hand card for free (cost ≤ maxCost, match filter) (Краб пират, Синхронизация). */
  | {
      op: 'play_from_hand';
      /** The hand card to play (ask own_hand_card). */
      target?: TargetRef;
      maxCost?: number;
      match?: { type?: import('../types').CardType };
      destination?: TargetRef;
    }
  /**
   * Play a card from a discard pile for free (Поднятие мертвых, Лунный урожай,
   * Последний шанс). The chosen card leaves the discard pile and enters play;
   * a creature/building goes to `destination` (or the chosen landscape),
   * a spell resolves its `on_cast`, a companion takes the slot.
   */
  | {
      op: 'play_from_discard';
      /** The discard card to play (ask own_discard_card / any_discard_card). */
      target?: TargetRef;
      /** Restrict the pick (Лунный урожай — только строение). */
      match?: { type?: import('../types').CardType; maxCost?: number; cardIds?: string[] };
      /** Whose discard pile the card is taken from. */
      from?: 'own' | 'any';
      destination?: TargetRef;
    }
  /** Reveal the top N cards of own deck (public, docs/MECHANICS-V2.md §8). */
  | { op: 'reveal_deck_top'; count: number }
  /**
   * Consume the revealed window (Газы Огрa): one revealed card via ask,
   * destination per `to`; the rest of the window per `rest`.
   */
  | { op: 'resolve_revealed'; target: TargetRef; to: 'deck_bottom' | 'hand' | 'deck_top'; rest?: 'discard' | 'deck' }
  /**
   * Reassign damage counters among the chosen creatures; the total is preserved
   * (Заплатка, Вместе навсегда, docs §H2). `amounts` are indices of `amount` asks.
   */
  | { op: 'redistribute_damage'; among: TargetRef; cap?: 'defense' | 'none' }
  /** Temporarily replace a land's type (Башня свободы). */
  | { op: 'set_land_type'; target: TargetRef; landType: import('../types').LandType | 'chosen'; until: 'next_own_turn' }
  /** Exchange two field cards (Снижение налогов, Хлопковая аллея). */
  | { op: 'swap_field_cards'; a: TargetRef; b: TargetRef }
  /** Attach a card under an instance (Каракум,docs §H2). */
  | { op: 'attach_card'; card: TargetRef; to: TargetRef; from: 'discard' | 'field' | 'death' }
  /** Repeat one effect N times, consuming consecutive choices (Разбойная тыква). */
  | { op: 'repeat_effect'; times: StatAmount; effect: EffectSpec }
  /** Discard one specific card (Ванна крови: «карту стоимостью 2+»). */
  | { op: 'discard_chosen'; card: TargetRef; from?: 'own_hand' | 'any_hand' }
  /** Pay lives as part of a hero ability (Рикардио, docs §H2). */
  | { op: 'pay_life'; amount: number }
  /** Look at the deck top — PRIVATE window, owner-only view (Рикардио, docs §H7/§8). */
  | { op: 'peek_deck_top'; count: number }
  /** Close the peek window; a `discard` option answer sends the peeked cards to the discard pile. */
  | { op: 'resolve_peek' }
  /** Ready a creature (alias of `unflip`, kept for readable data). */
  | { op: 'ready_creature'; target: TargetRef }
  /** Set a per-instance status flag (docs §H3). */
  | {
      op: 'set_instance_flag';
      target: TargetRef;
      flag: 'noReady' | 'entersTapped' | 'cannotReplace' | 'cannotReturnFromDiscard';
      value?: boolean;
    }
  /** Destroy N own creatures and draw one card per creature (Милый Оверлорд). */
  | { op: 'destroy_own_n'; count: StatAmount }
  /** Relocate a building to another land's empty building slot (Помощник лесоруба, docs §H11). */
  | { op: 'move_building'; target: TargetRef; destination: TargetRef }
  /**
   * Add a total of `amount` damage, distributed by one `amounts` answer over
   * `among` (Абрака-тилиус, docs §H11). `cap: 'defense'` (default) may not kill.
   */
  | { op: 'distribute_damage'; among: TargetRef; amount: StatAmount; cap?: 'defense' | 'none' }
  /** Remove one specific card from the game (Марселина: карта из стопки сброса, docs §H12). */
  | { op: 'banish_card'; card: TargetRef }
  /** Flip a creature AND skip its next readying (Ультра пес: «заморозь существо», docs §H13). */
  | { op: 'freeze_creature'; target: TargetRef }
  /** Rule aura: creature attacks against the covered unit whiff on a d6 ≥ min (Прозрачный ниндзя, docs §H14). */
  | { op: 'dodge'; target: TargetRef; min: number }
  /** Rule aura: the covered creature's land may not be flipped DOWN by opponents (Яблочный страж, docs §H15). */
  | { op: 'land_flip_protection'; target: TargetRef }
  /** Rule aura: opponents of the source cannot play cards costing ≤ maxCost (Няш-мяш, docs §H15). */
  | { op: 'restrict_play'; who: 'opponents'; maxCost: number }
  /** Rule aura: creatures may be played onto frozen lands (Ледяная база / monika_card_24, docs §H16). */
  | { op: 'allow_frozen_play'; target: TargetRef; scope: 'own_lane' | 'all' }
  /** Rule aura: player damage at or below the threshold goes to the covered creature (Мило-страж, docs §H16). */
  | { op: 'guard_player'; target: TargetRef; threshold: number }
  /** Rule aura: creature hits against the covered unit cap at max (Подушка боли, docs §H16). */
  | { op: 'damage_cap'; target: TargetRef; max: number }
  /** Rule aura: spells deal +amount extra to the covered unit (Подушка боли, docs §H16). */
  | { op: 'damage_bonus'; target: TargetRef; amount: number }


  /** Every own creature strikes the facing enemy with its ATK (jake_2v2_card_5). */
  | { op: 'lane_strike_all' }
  /** Rule aura: this card receives the rule texts of buildings on ADJACENT own lands (Котенок/Центр, docs §H16). */
  | { op: 'inherit_adjacent_buildings'; target: TargetRef };

/**
 * A declarative operation with its own optional conditions.
 *
 * `conditions` are checked when the effect runs and gate ONLY this step
 * («Верни случайную Радужную карту… Если на этой линии контролируешь
 * строение, получи 1 действие» — Древний школяр). Ability-level
 * `conditions` (`AbilitySpec.conditions`) gate the whole ability instead.
 */
export type EffectSpec = EffectOp & {
  /**
   * Conditions of THIS effect. For `stat_buff` they are checked per candidate
   * target (Мисс Пушинка: «пока ровно 7 урона»; Кукурузный чемпион: «если на
   * этой земле строение») — evaluated live, on every stat scan.
   */
  conditions?: ConditionSpec[];
};

export interface AbilitySpec {
  kind: 'passive' | 'active';
  /** Passive only. `on_cast` = spell's own effects; undefined = modifier (ауры, «пока…»). */
  trigger?: Trigger;
  /** Active only: action cost, 0/undefined = free floop. */
  cost?: number;
  additionalCost?: AdditionalCost;
  oncePerTurn?: boolean;
  /** «Используй до N раз за ход» (Нога дракона), docs §H2. */
  maxUsesPerTurn?: number;
  /** «можешь …»: the owning player decides (pendingChoice, docs/MECHANICS-V2.md §6). */
  optional?: boolean;
  /** «В первый раз …»: activates once per match (docs/MECHANICS-V2.md §1). */
  oncePerGame?: boolean;
  /** Declarative effect(s); an array runs sequentially (Голубой тритон: тяни, затем сбрось). */
  effect?: EffectSpec | EffectSpec[];
  mechanic?: string;
  params?: Record<string, unknown>;
  /** Player designated to receive the pendingChoice when the ability is volunteered. */
  pendingFor?: 'controller' | 'payload_partner';
  /** Player-picked targets, in order; actives take them with the command, triggers via pendingChoice. */
  targets?: TargetAsk[];
  conditions?: ConditionSpec[];
  text: string;
}

/** A queued (source, ability) pair — serializable reference into the catalog. */
export interface QueuedAbility {
  player: PlayerId;
  /** Field instance; null = the player's hero. */
  instanceId: string | null;
  /** Catalog card id; null for heroes. */
  cardId: string | null;
  abilityIndex: number;
  trigger?: Trigger;
  /** Player designated to receive the pendingChoice (defaults to qa.player). */
  beneficiary?: PlayerId;
  /** Pre-collected command choices, carried into the trigger queue when available. */
  choices?: TargetChoice[];
  payload?: TriggerPayload;
}

/**
 * A paused transition waiting for one player's decision (docs/MECHANICS-V2.md §6).
 * `effect_step` pauses MID-effect-array: `collected` grows per step, and
 * `resumeEffects` holds the not-yet-run tail (pure data — re-run on resolve).
 */
export interface PendingChoice {
  player: PlayerId;
  ask:
    | { kind: 'optional' }
    | { kind: 'target'; askIndex: number; collected: TargetChoice[] }
    | { kind: 'effect_step'; askIndex: number; collected: TargetChoice[] };
  current: QueuedAbility;
  /** Remaining queued abilities to run after this one resolves. */
  queue: QueuedAbility[];
  /** Remaining effect steps of a paused array (mechanics v2 §6, interactive chains). */
  resumeEffects?: EffectSpec[];
}

/** Raised when an ability needs the owning player's input mid-transition. */
export class ChoiceRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChoiceRequired';
  }
}
