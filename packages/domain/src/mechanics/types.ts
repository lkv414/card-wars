// Mechanics v2 data model (docs/MECHANICS-V2.md). Pure data: abilities arrive
// from the catalog (content/cards/mechanics + content/heroes/mechanics), never
// hardcoded; handlers are mechanic-level, not card-level.

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
  | { kind: 'self_player' };

export type StatKey = 'attack' | 'defense';

/**
 * Conditions (docs/MECHANICS-V2.md §7). `if_*` — one-shot at run time,
 * `while_*` — checked on every modifier scan.
 */
export type ConditionSpec =
  | { kind: 'if_discard_count'; min: number }
  | { kind: 'while_discard_count'; min: number };

/** Mandatory additional cost printed before «ПРИЕМ/>>>» (docs/MECHANICS-V2.md §1). */
export interface AdditionalCost {
  /** Discard n cards from own hand (Бимо: «Сбрось карту с руки >>> …»). */
  discardFromHand?: number;
}

/**
 * Declarative operations (docs/MECHANICS-V2.md §3). The union grows per
 * milestone; unimplemented ops are rejected by the interpreter until coded.
 */
export type EffectSpec =
  | { op: 'deal_damage'; target: TargetRef; amount: number; pierce?: boolean }
  | { op: 'draw_cards'; count: number }
  | { op: 'stat_buff'; target: TargetRef; stat: StatKey; amount: number; duration: 'permanent' | 'aura' }
  | { op: 'gain_shield'; target: TargetRef; amount: number }
  | { op: 'gain_actions'; amount: number };

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
