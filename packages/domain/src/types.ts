// Canonical data and state types (docs/CARDS.md, docs/RULES.md, docs/COMMANDS.md).

export type PlayerId = string;

export type LandType = 'corn' | 'blue' | 'good' | 'ice' | 'sand' | 'swamp' | 'rainbow' | 'ghost';

export type CardType = 'creature' | 'building' | 'spell' | 'companion';

export type StatKey = 'attack' | 'defense';

/** When an ability runs (docs/MECHANICS.md «Триггеры», v1 subset). */
export type TriggerKind =
  | 'floop'
  | 'persistent'
  | 'on_enters_play'
  | 'on_death'
  | 'start_of_turn';

/** Effect targets (docs/MECHANICS.md «Цели», v1 subset). */
export type TargetSpec =
  | { kind: 'this_creature' }
  | { kind: 'this_lane_creature' }
  | { kind: 'this_lane_opponent_creature' }
  | { kind: 'adjacent_creature' }
  | { kind: 'each_creature_yours' }
  | { kind: 'each_creature_opponent' }
  | { kind: 'each_creature' }
  | { kind: 'chosen_creature' }
  | { kind: 'chosen_opponent_creature' }
  | { kind: 'chosen_opponent' }
  | { kind: 'chosen_landscape' }
  | { kind: 'self' };

/** Dynamic stat amount: «±N за каждые K карт в стопке сброса контролёра». */
export interface DynamicAmount {
  perDiscardEvery: number;
  amount: number;
}

export type StatAmount = number | DynamicAmount;

/** Operations (docs/MECHANICS.md «Операции», v1 subset). */
export type EffectSpec =
  | { op: 'deal_damage'; target: TargetSpec; amount: number; pierce?: boolean }
  | { op: 'heal'; target: TargetSpec; amount: number }
  | { op: 'draw_cards'; count: number }
  | { op: 'discard_top'; count: number }
  | { op: 'opponent_discards'; target: TargetSpec; count: number }
  | {
      op: 'return_from_discard';
      filter?: { type?: CardType; landType?: LandType };
      random?: boolean;
    }
  | { op: 'destroy'; target: TargetSpec }
  | {
      op: 'stat_buff';
      target: TargetSpec;
      stat: StatKey;
      amount: StatAmount;
      /** Optional: persistent auras are permanent by definition. */
      duration?: 'permanent' | 'this_turn';
    }
  | { op: 'gain_actions'; amount: number }
  | { op: 'gain_shield'; target: TargetSpec; amount: number }
  | { op: 'freeze_landscape'; target: TargetSpec }
  /** Win condition (e.g. hero Billy): all opponents' decks are empty at the check point. */
  | { op: 'win_if_opponents_deck_empty' };

/** Conditions (docs/MECHANICS.md «Условия», v1 subset). */
export type ConditionSpec = { kind: 'if_discard_count'; min: number };

export interface AbilityData {
  kind: 'passive' | 'floop';
  /** For passives; floop abilities may omit it. */
  trigger?: TriggerKind;
  /** Floop cost in actions; 0 or omitted = free (docs/CARDS.md). */
  floopCost?: number;
  effect?: EffectSpec;
  conditions?: ConditionSpec[];
  text: string;
}

export interface CardData {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  landType: LandType;
  /** Creatures only. */
  attack?: number;
  defense?: number;
  image?: string;
  description?: string;
  abilities: AbilityData[];
  deckSet?: string;
}

export interface HeroData {
  id: string;
  name: string;
  image?: string;
  ability: AbilityData;
  text: string;
}

// --- Match state ---

export type MatchStatus = 'mulligan' | 'running' | 'finished';

export type Phase = 'draw' | 'main' | 'combat';

/** FFA 2–4 or two teams of two (docs/RULES.md «Зоны»). */
export type MatchMode = 'ffa' | 'teams';

/** 2v2 seating variant: allies sit opposite or next to each other. */
export type TeamVariant = 'neighbors' | 'wall';

export type Location = 'deck' | 'hand' | 'field' | 'discard' | 'companion' | 'removed';

export type FinishReason = 'elimination' | 'surrender' | 'disconnect';

export interface LandState {
  type: LandType;
  frozen: boolean;
  flipped: boolean;
}

export interface ZoneState {
  creature: string | null;
  building: string | null;
}

export interface CardInstance {
  id: string;
  cardId: string;
  controller: PlayerId;
  location: Location;
  /** Zone index for field cards; null otherwise. */
  zone: number | null;
  slot: 'creature' | 'building' | null;
  /** Floop state: flipped card does not attack until its controller's next turn start. */
  flipped: boolean;
  /** Accumulated damage (destroyed when damage >= effective defense). */
  damage: number;
  shield: number;
  bonusAttack: number;
  bonusDefense: number;
  playedTurn: number | null;
}

export interface PlayerState {
  id: PlayerId;
  nickname: string;
  heroId: string;
  /** In team mode both allies carry the team's shared lives (docs/RULES.md «2 на 2»). */
  lives: number;
  maxLives: number;
  deck: string[];
  hand: string[];
  discard: string[];
  lands: LandState[];
  zones: ZoneState[];
  companion: string | null;
  actions: number;
  mulligansUsed: number;
  surrendered: boolean;
  eliminated: boolean;
  teamId: string | null;
  /** 2v2 team turn: this ally has pressed «В бой» or their timer expired. */
  battleReady: boolean;
}

export interface TeamState {
  id: string;
  /** Seating order within the team (determines the half of the wall row). */
  playerIds: PlayerId[];
  lives: number;
  maxLives: number;
  eliminated: boolean;
}

export interface TempBuff {
  instanceId: string;
  stat: StatKey;
  amount: number;
  grantedOnTurn: number;
}

export interface MatchState {
  status: MatchStatus;
  phase: Phase;
  mode: MatchMode;
  teamVariant: TeamVariant | null;
  teams: Record<string, TeamState> | null;
  players: Record<PlayerId, PlayerState>;
  /** Seating order; also the turn order. */
  order: PlayerId[];
  /** Players acting in the current turn: one in FFA, both allies in 2v2. */
  activePlayers: PlayerId[];
  /** First active player (display/backward-compatible; use activePlayers for legality). */
  activePlayer: PlayerId;
  turn: number;
  round: number;
  rng: { s: number };
  instances: Record<string, CardInstance>;
  tempBuffs: TempBuff[];
  /** Spells cast during the current turn (visual "above lands until end of turn"). */
  castSpells: string[];
  mulliganDecisions: Record<PlayerId, 'keep' | 'mulligan' | undefined>;
  winners: PlayerId[] | null;
  finishReason: FinishReason | null;
}
