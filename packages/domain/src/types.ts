// Canonical data and state types (docs/CARDS.md, docs/RULES.md, docs/COMMANDS.md).

export type PlayerId = string;

export type LandType = 'corn' | 'blue' | 'good' | 'ice' | 'sand' | 'swamp' | 'rainbow' | 'ghost';

export type CardType = 'creature' | 'building' | 'spell' | 'companion';

/** Card data (docs/CARDS.md): structural fields only; ability texts live in `description`. */
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
  deckSet?: string;
}

export interface HeroData {
  id: string;
  name: string;
  image?: string;
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
  mulliganDecisions: Record<PlayerId, 'keep' | 'mulligan' | undefined>;
  winners: PlayerId[] | null;
  finishReason: FinishReason | null;
}
