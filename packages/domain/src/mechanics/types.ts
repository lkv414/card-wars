// Mechanics v2 data model (docs/MECHANICS-V2.md). Pure data: abilities arrive
// from the catalog (content/cards/mechanics + content/heroes/mechanics), never
// hardcoded; handlers are mechanic-level, not card-level.

import type { LandType } from '../types';

export type PlayerId = string;

/** When a passive ability fires (docs/MECHANICS-V2.md §2Б). */
export type Trigger =
  | 'on_cast'
  | 'on_enters_play'
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
  targetInstanceId?: string;
  targetPlayer?: PlayerId;
  amount?: number;
  count?: number;
  cost?: number;
  zone?: number;
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
  | 'landscape'
  | 'own_hand_card';

export interface TargetAsk {
  kind: TargetAskKind;
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
  | { kind: 'this_lane_creature' }
  | { kind: 'this_lane_opponent_creature' }
  | { kind: 'adjacent_creatures' }
  | { kind: 'each_creature_yours' }
  | { kind: 'each_creature_opponent' }
  | { kind: 'each_creature' }
  | { kind: 'each_building_yours' }
  | { kind: 'each_player' }
  | { kind: 'each_opponent_player' }
  | { kind: 'self_player' };

export type StatKey = 'attack' | 'defense';

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
  /** Match by the target's ZONE land type instead of the card (гномы). */
  zoneLandType?: LandType;
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
      where: 'own' | 'all' | 'adjacent';
      landType?: LandType;
      empty?: boolean;
      flipped?: boolean;
      amount: number;
    }
  | {
      kind: 'per_target';
      target: TargetRef;
      amount: number;
      excludeSelf?: boolean;
      filter?: TargetFilter;
    };

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
  | { kind: 'while_no_other_creatures' }
  | { kind: 'while_empty_lands'; min: number }
  | { kind: 'while_on_flipped_land'; scope: 'self' | 'target' }
  /** Source sits on a land of this type (Крок-эколог на Ледяной земле). */
  | { kind: 'while_on_land_type'; landType: LandType }
  /** At least min distinct land types under control (Лимонное желе). */
  | { kind: 'while_distinct_lands'; min?: number; max?: number }
  /** Land count of a type under control within [min..max] (Кукурузный пес). */
  | { kind: 'while_land_count'; landType: LandType; min?: number; max?: number }
  /** Own building in the source's zone (Кукурузный чемпион). */
  | { kind: 'while_zone_has_building' };

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
    }
  | { op: 'gain_shield'; target: TargetRef; amount: number }
  | { op: 'gain_actions'; amount: number }
  /** Turn a land face up (Бигфут) or face down (Воронка, Червь шелухи). */
  | { op: 'flip_land'; target: TargetRef; down: boolean }
  /** Win check (герой Билли): all opponents' decks are empty at the trigger point. */
  | { op: 'win_if_opponents_deck_empty' }
  /** Cost modifier scanned at payment time (Остролист, Домик из разного дерева). */
  | { op: 'cost_mod'; self: true; amount: StatAmount }
  /** «Считается за дополнительную землю» (Ферма). */
  | { op: 'land_count_mod'; landType?: LandType; amount: number };

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
  effect?: EffectSpec;
  mechanic?: string;
  params?: Record<string, unknown>;
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
  payload?: TriggerPayload;
}

/** A paused transition waiting for one player's decision (docs/MECHANICS-V2.md §6). */
export interface PendingChoice {
  player: PlayerId;
  ask:
    | { kind: 'optional' }
    | { kind: 'target'; askIndex: number; collected: TargetChoice[] };
  current: QueuedAbility;
  /** Remaining queued abilities to run after this one resolves. */
  queue: QueuedAbility[];
}

/** Raised when an ability needs the owning player's input mid-transition. */
export class ChoiceRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChoiceRequired';
  }
}
