import { createRngState, shuffle } from '../rng';
import type { DomainDeps } from '../commands';
import { DomainError } from '../errors';
import type { GameEvent } from '../events';
import type { LandType, MatchState, PlayerId } from '../types';

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
}

/**
 * Create a match in the mulligan phase: decks shuffled, starting hands dealt.
 * The domain v1 supports exactly 2 players (MVP scope; 3–4 arrive in stage 5).
 */
export function createMatch(
  deps: DomainDeps,
  setup: MatchSetup,
): { state: MatchState; events: GameEvent[] } {
  const { config, catalog } = deps;
  const invalid = (msg: string): never => {
    throw new DomainError('invalid_setup', msg);
  };

  if (setup.players.length !== 2) invalid('domain v1 supports exactly 2 players');

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
    players[p.id] = {
      id: p.id,
      nickname: p.nickname,
      heroId: p.heroId,
      lives: config.startingLives,
      maxLives: config.startingLives,
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
    };
  }

  const order = setup.players.map((p) => p.id);
  const state: MatchState = {
    status: 'mulligan',
    phase: 'main',
    players,
    order,
    activePlayer: order[0]!,
    turn: 0,
    round: 1,
    rng,
    instances,
    tempBuffs: [],
    castSpells: [],
    mulliganDecisions: {},
    winners: null,
    finishReason: null,
  };

  const events: GameEvent[] = [
    {
      type: 'match_started',
      players: setup.players.map((p) => ({ id: p.id, nickname: p.nickname, heroId: p.heroId })),
      firstPlayer: order[0]!,
    },
  ];

  return { state, events };
}
