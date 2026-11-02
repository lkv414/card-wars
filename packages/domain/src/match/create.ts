import { createRngState, shuffle } from '../rng';
import type { DomainDeps } from '../commands';
import { DomainError } from '../errors';
import type { GameEvent } from '../events';
import type {
  LandType,
  MatchMode,
  MatchState,
  PlayerId,
  TeamState,
  TeamVariant,
} from '../types';

export interface PlayerSetup {
  id: PlayerId;
  nickname: string;
  heroId: string;
  /** Card ids, catalog order; length = config.deckSize. */
  deck: string[];
  lands: LandType[];
}

export interface MatchSetup {
  players: PlayerSetup[];
  seed: number;
  /** Defaults to FFA (docs/RULES.md). */
  mode?: MatchMode;
  /** Required for team mode; ignored for FFA. */
  teamVariant?: TeamVariant | null;
}

/**
 * Create a match in the mulligan phase: decks shuffled, starting hands dealt.
 * FFA supports 2–4 players; teams are exactly `teamSize × 2` players.
 * In 2v2 «соседи» allies sit opposite each other, in «стенка» — next to each other.
 */
export function createMatch(
  deps: DomainDeps,
  setup: MatchSetup,
): { state: MatchState; events: GameEvent[] } {
  const { config, catalog } = deps;
  const invalid = (msg: string): never => {
    throw new DomainError('invalid_setup', msg);
  };

  const mode: MatchMode = setup.mode ?? 'ffa';
  const teamVariant: TeamVariant | null = mode === 'teams' ? (setup.teamVariant ?? null) : null;

  if (setup.players.length < config.minPlayers || setup.players.length > config.maxPlayers) {
    invalid(`expected ${config.minPlayers}–${config.maxPlayers} players, got ${setup.players.length}`);
  }
  if (mode === 'teams') {
    if (setup.players.length !== config.teamSize * 2) {
      invalid(`team mode requires exactly ${config.teamSize * 2} players`);
    }
    if (teamVariant !== 'neighbors' && teamVariant !== 'wall') {
      invalid('team mode requires a seating variant');
    }
  }

  const ids = new Set<PlayerId>();
  for (const p of setup.players) {
    if (ids.has(p.id)) invalid(`duplicate player id ${p.id}`);
    ids.add(p.id);
    if (!catalog.getHero(p.heroId)) invalid(`unknown hero ${p.heroId}`);
    if (p.deck.length !== config.deckSize) {
      invalid(`deck of ${p.id} has ${p.deck.length} cards, expected ${config.deckSize}`);
    }
    const copies = new Map<string, number>();
    for (const cardId of p.deck) {
      if (!catalog.getCard(cardId)) invalid(`unknown card ${cardId}`);
      const n = (copies.get(cardId) ?? 0) + 1;
      if (n > config.copyLimit) invalid(`deck of ${p.id} exceeds copy limit for ${cardId}`);
      copies.set(cardId, n);
    }
    if (p.lands.length !== config.landsPerPlayer) {
      invalid(`lands of ${p.id}: ${p.lands.length}, expected ${config.landsPerPlayer}`);
    }
  }

  const order = setup.players.map((p) => p.id);

  let teams: Record<string, TeamState> | null = null;
  const teamIdByPlayer: Record<PlayerId, string> = {};
  if (mode === 'teams') {
    const groups =
      teamVariant === 'wall'
        ? [order.slice(0, config.teamSize), order.slice(config.teamSize)]
        : [
            order.filter((_, i) => i % 2 === 0),
            order.filter((_, i) => i % 2 === 1),
          ];
    teams = {};
    groups.forEach((group, i) => {
      const id = i === 0 ? 'team-a' : 'team-b';
      teams![id] = {
        id,
        playerIds: group,
        lives: config.teamStartingLives,
        maxLives: config.teamStartingLives,
        eliminated: false,
      };
      for (const pid of group) teamIdByPlayer[pid] = id;
    });
  }

  const rng = createRngState(setup.seed);
  const instances: MatchState['instances'] = {};
  const players: MatchState['players'] = {};

  for (const p of setup.players) {
    const deck: string[] = [];
    p.deck.forEach((cardId, i) => {
      const id = `${p.id}#${i}`;
      instances[id] = {
        id,
        cardId,
        controller: p.id,
        location: 'deck',
        zone: null,
        slot: null,
        flipped: false,
        damage: 0,
        shield: 0,
        bonusAttack: 0,
        bonusDefense: 0,
        playedTurn: null,
      };
      deck.push(id);
    });
    const shuffled = shuffle(rng, deck);
    const hand = shuffled.splice(0, config.startingHandSize);
    for (const id of hand) instances[id]!.location = 'hand';
    const teamId = mode === 'teams' ? teamIdByPlayer[p.id]! : null;
    players[p.id] = {
      id: p.id,
      nickname: p.nickname,
      heroId: p.heroId,
      lives: teamId ? config.teamStartingLives : config.startingLives,
      maxLives: teamId ? config.teamStartingLives : config.startingLives,
      deck: shuffled,
      hand,
      discard: [],
      lands: p.lands.map((type) => ({ type, frozen: false, flipped: false })),
      zones: Array.from({ length: config.landsPerPlayer }, () => ({ creature: null, building: null })),
      companion: null,
      actions: 0,
      mulligansUsed: 0,
      surrendered: false,
      eliminated: false,
      teamId,
      battleReady: false,
    };
  }

  const activePlayers = mode === 'teams' ? [...teams!['team-a']!.playerIds] : [order[0]!];
  const state: MatchState = {
    status: 'mulligan',
    phase: 'main',
    mode,
    teamVariant,
    teams,
    players,
    order,
    activePlayers,
    activePlayer: activePlayers[0]!,
    turn: 0,
    round: 1,
    rng,
    instances,
    castSpells: [],
    mulliganDecisions: {},
    pending: null,
    abilityUses: {},
    turnBuffs: [],
    turnCounters: {},
    turnModifiers: [],
    landFlipEffects: [],
    winners: null,
    finishReason: null,
  };

  const events: GameEvent[] = [
    {
      type: 'match_started',
      players: setup.players.map((p) => ({ id: p.id, nickname: p.nickname, heroId: p.heroId })),
      firstPlayer: activePlayers[0]!,
      mode,
      teamVariant,
      teams: teams ? Object.values(teams).map((t) => ({ id: t.id, playerIds: [...t.playerIds] })) : null,
    },
  ];

  return { state, events };
}
