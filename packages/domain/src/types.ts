// Canonical data and state types (docs/CARDS.md, docs/RULES.md, docs/COMMANDS.md).

import type { AbilitySpec, PendingChoice } from './mechanics/types';

export type PlayerId = string;

export type LandType = 'corn' | 'blue' | 'good' | 'ice' | 'sand' | 'swamp' | 'rainbow' | 'ghost';

export type CardType = 'creature' | 'building' | 'spell' | 'companion';

/** Card data (docs/CARDS.md): structural fields; structured abilities arrive
 * from content mechanics (docs/MECHANICS-V2.md §4) and stay optional here. */
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
  abilities?: AbilitySpec[];
  deckSet?: string;
}

export interface HeroData {
  id: string;
  name: string;
  image?: string;
  text: string;
  ability?: AbilitySpec;
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
  /** Ice tokens (docs/RULES.md «Земли»): icy lands enter play with one. */
  iceTokens: number;
  /** Original type before a temporary `set_land_type` (docs §H2). */
  originalType?: LandType;
  typeChangedOnTurn?: number;
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
  /** Cards placed under this instance (docs §H2). */
  attached?: string[];
  /** Changed lane during the current turn (docs §H3). */
  movedThisTurn?: boolean;
  /** Entered play during the current turn. */
  enteredThisTurn?: boolean;
  /** Enters play flipped and is not readied at the owner's turn start. */
  entersTapped?: boolean;
  noReady?: boolean;
  /** «Нельзя заменить» (поп-десанты). */
  cannotReplace?: boolean;
  /** «Нельзя вернуть из сброса» (Частичка души, Муррризрак). */
  cannotReturnFromDiscard?: boolean;
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

/** A temporary land flip scheduled to revert at the owner's next turn start. */
export interface LandFlipEffect {
  owner: string;
  zone: number;
  down: boolean;
  grantedOnTurn: number;
}

/**
 * Modifier granted mid-turn by an ability (docs/MECHANICS-V2.md §2А).
 * Identity: the granting instance + the effect itself; `duration` controls
 * lifetime — `this_turn` (default) clears at end of turn, `while_flipped`
 * applies only while the granting card is tapped (Ведриния).
 */
export interface TurnModifier {
  instanceId: string;
  effect: import('./mechanics/types').EffectSpec;
  grantedOnTurn: number;
  duration: 'this_turn' | 'while_flipped';
}

export interface TurnBuff {
  instanceId: string;
  stat: 'attack' | 'defense';
  amount: number;
  grantedOnTurn: number;
  /** Attack floor for a debuff («минимум 0», Затопление). */
  floorAttack?: number;
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
  /** Spells cast during the current turn (visual "above lands until end of turn"). */
  castSpells: string[];
  /** Paused transition awaiting a player's decision (docs/MECHANICS-V2.md §6). */
  pending: PendingChoice | null;
  /** «Этот ход» stat buffs; cleared at end of turn (docs/MECHANICS-V2.md §3). */
  turnBuffs: TurnBuff[];
  /** Per-turn event counters, key `kind:player`; cleared at end of turn. */
  turnCounters: Record<string, number>;
  /** Modifiers granted by abilities this turn; cleared at end of turn. */
  turnModifiers: TurnModifier[];
  /** Last damage source per victim (killer attribution, docs/MECHANICS-V2.md §3 G9). */
  lastHits: Record<string, string | null>;
  /** CardIds played this turn (Бизнес пес, play-gates). */
  turnPlayedCardIds: string[];
  /** Protected creatures: attacks redirect to face, enemy targeting rejected (Пещера одиночества). */
  protections: Array<{ instanceId: string }>;
  /** Consumable play discounts this turn (docs/MECHANICS-V2.md §3, A10). */
  discounts: Array<{ player: PlayerId; cardType: 'spell' | 'creature' | 'building'; amount: number; grantedOnTurn: number }>;
  /** Spell-play bans armed by damage (Дух ниндзя); activated at the victim's turn start. */
  spellBansArmed: PlayerId[];
  spellBansActive: Array<{ player: PlayerId; turn: number }>;
  /** Temporary land flips (Воронка) reverted at the owner's next turn start. */
  landFlipEffects: LandFlipEffect[];
  /** Revealed deck window (Газы Огрa): card ids, public until consumed. */
  revealed: Record<string, string[]>;
  /** Once-per-turn ability usage: key `player:instanceId|hero:index` → turn of last use. */
  abilityUses: Record<string, number>;
  /** Usage count per ability this turn (docs §H2, «до N раз за ход»). */
  abilityUseCounts: Record<string, number>;
  /** Word chosen by each player at match start (Колдунья-охотница, docs §H3). */
  chosenWord: Record<PlayerId, string>;
  mulliganDecisions: Record<PlayerId, 'keep' | 'mulligan' | undefined>;
  winners: PlayerId[] | null;
  finishReason: FinishReason | null;
}
