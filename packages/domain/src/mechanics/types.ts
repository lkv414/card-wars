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
  | 'on_companion_event';

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
  | 'revealed_card';

export interface TargetAsk {
  kind: TargetAskKind;
  /** Optional constraint validated at choice time (Пси-фехтовальщик: только применённые). */
  filter?: TargetFilter;
}

/** Player's answers sent with a command (floop / hero_ability / resolve_choice). */
export type TargetChoice =
  | { kind: 'creature'; instanceId: string }
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'landscape'; player: PlayerId; zone: number }
  | { kind: 'card'; instanceId: string };

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
  /** The instance the trigger payload is about (e.g. attacker). */
  | { kind: 'triggering_instance' }
  /** Partner of the player in the trigger payload (2v2). */
  | { kind: 'payload_partner' }
  | { kind: 'each_player' }
  | { kind: 'each_opponent_player' }
  | { kind: 'self_player' };

export type StatKey = 'attack' | 'defense';

/** Serializable turn-event counters, keyed by player/team in MatchState. */
export type TurnCounterKind =
  | 'spell_cast'
  | 'creature_entered'
  | 'creature_died'
  | 'line_change'
  | 'cards_drawn'
  | 'creature_cost_2_plus_played'
  | 'damage_dealt_to_enemy'
  | 'creature_attack';

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
  /** Invert the match (Капитан Тако: не на кукурузной земле). */
  negate?: boolean;
}

/** Dynamic stat amounts (docs/MECHANICS-V2.md §3). */
export type StatAmount =
  | number
  | { kind: 'per_discard'; every: number; amount: number }
  | { kind: 'per_damage'; amount: number }
  /** «за каждый различный тип земли под твоим контролем». */
  | { kind: 'per_distinct_lands'; amount: number }
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
  /** Players controlling at least one land with an ice token (Капитан мороженка). */
  | { kind: 'per_token_players'; amount: number }
  /** Inside a damage trigger: the dealt amount (Лорд Вампиров, Мятный змей). */
  | { kind: 'payload_damage' };

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
  | { kind: 'while_own_card_in_play'; cardId: string }
  /** Own building in the source's zone (Кукурузный чемпион). */
  | { kind: 'while_zone_has_building' }
  /** Own creature in the source's zone (Теневая пирамида). */
  | { kind: 'while_zone_has_creature' };

/** Mandatory additional cost printed before «ПРИЕМ/>>>» (docs/MECHANICS-V2.md §1). */
export interface AdditionalCost {
  /** Discard n cards from own hand (Бимо: «Сбрось карту с руки >>> …»). */
  discardFromHand?: number;
  /** Sacrifice n own creatures (Док Смерть, Заводской убийца). */
  destroyOwnCreature?: number;
  /** Sacrifice n own buildings (Стрелец Дэника). */
  destroyOwnBuilding?: number;
}

/**
 * Declarative operations (docs/MECHANICS-V2.md §3). The union grows per
 * milestone; unimplemented ops are rejected by the interpreter until coded.
 */
export type EffectSpec =
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
      duration: 'permanent' | 'aura' | 'this_turn';
      /** Aura target filter (Фея Шепард: только милые существа). */
      filter?: TargetFilter;
      /** Defense floor for the affected creature (Угнетающая пирамида: не ниже 1). */
      floorDefense?: number;
      /** Attack floor: «минимум 0» у дебаффов (Затопление, Аванпост попугаев). */
      floorAttack?: number;
    }
  | { op: 'gain_shield'; target: TargetRef; amount: number }
  | { op: 'gain_actions'; amount: number }
  /** Turn a land face up (Бигфут) or face down (Червь шелухи); `until` reverts it automatically. */
  | { op: 'flip_land'; target: TargetRef; down: boolean; until?: 'next_own_turn' }
  | { op: 'destroy'; target: TargetRef }
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
  | { op: 'suppress'; target: TargetRef; actives?: boolean; triggers?: Trigger[]; all?: boolean; attacks?: boolean; filter?: TargetFilter }
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
    }
  /** Un-flip a flipped (applied) own creature (Архитектор разума, Моника). */
  | { op: 'unflip'; target: TargetRef }
  /** Reveal the top N cards of own deck (public, docs/MECHANICS-V2.md §8). */
  | { op: 'reveal_deck_top'; count: number }
  /**
   * Consume the revealed window (Газы Огрa): one revealed card via ask,
   * destination per `to`; the rest of the window per `rest`.
   */
  | { op: 'resolve_revealed'; target: TargetRef; to: 'deck_bottom' | 'hand'; rest?: 'discard' };

export interface AbilitySpec {
  kind: 'passive' | 'active';
  /** Passive only. `on_cast` = spell's own effects; undefined = modifier (ауры, «пока…»). */
  trigger?: Trigger;
  /** Active only: action cost, 0/undefined = free floop. */
  cost?: number;
  additionalCost?: AdditionalCost;
  oncePerTurn?: boolean;
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
