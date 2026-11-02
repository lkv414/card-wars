import { produce } from 'immer';
import type {
  CardCatalog,
  CardData,
  GameConfig,
  HeroData,
  LandType,
  MatchState,
  PlayerSetup,
} from '../index';

// Test fixtures only — the real catalog lives in content/ (packages/content).
// Ability-less cards: the mechanics v2 system (docs/TECH.md № 2) will bring its
// own fixtures; these cover the core engine (play, combat, turns, teams).

export const P1 = 'p1';
export const P2 = 'p2';

export const defaultConfig: GameConfig = {
  startingLives: 25,
  teamStartingLives: 50,
  teamSize: 2,
  minPlayers: 2,
  maxPlayers: 4,
  deckSize: 40,
  startingHandSize: 5,
  mulliganCount: 1,
  actionsPerTurn: 2,
  landsPerPlayer: 4,
  landRequirementPerCard: 1,
  freeDrawsPerTurn: 1,
  extraDrawCost: 1,
  companionMaxInPlay: 1,
  copyLimit: 4,
};

function card(partial: Partial<CardData> & Pick<CardData, 'id' | 'type' | 'cost' | 'landType'>): CardData {
  return { name: partial.id, attack: undefined, defense: undefined, ...partial };
}

export const cards: CardData[] = [
  card({ id: 'vanilla-swamp', type: 'creature', cost: 1, landType: 'swamp', attack: 2, defense: 6 }),
  card({ id: 'vanilla-corn', type: 'creature', cost: 1, landType: 'corn', attack: 3, defense: 7 }),
  card({ id: 'cheap-rainbow', type: 'creature', cost: 0, landType: 'rainbow', attack: 1, defense: 5 }),
  card({ id: 'big-swamp', type: 'creature', cost: 2, landType: 'swamp', attack: 5, defense: 10 }),
  card({ id: 'vanilla-good', type: 'creature', cost: 1, landType: 'good', attack: 2, defense: 7 }),
  card({ id: 'vanilla-blue', type: 'creature', cost: 1, landType: 'blue', attack: 2, defense: 8 }),
  card({ id: 'vanilla-ice', type: 'creature', cost: 1, landType: 'ice', attack: 1, defense: 9 }),
  card({ id: 'vanilla-sand', type: 'creature', cost: 1, landType: 'sand', attack: 4, defense: 4 }),
  card({ id: 'plain-fortress', type: 'building', cost: 1, landType: 'swamp', description: 'Строение без способностей' }),
  card({ id: 'spell-plain', type: 'spell', cost: 1, landType: 'swamp', description: 'Заклинание без способностей' }),
  card({
    id: 'companion-pair',
    type: 'companion',
    cost: 1,
    landType: 'rainbow',
    description: 'Парная карта (фикстура для проверки запрета в 1 на 1)',
  }),
];

export const heroes: HeroData[] = [
  {
    id: 'hero-bimo',
    name: 'Бимо',
    text: 'Дополнительный бесплатный добор в начале хода',
  },
  {
    id: 'hero-billy',
    name: 'Билли',
    text: 'Если к началу твоего хода колода каждого противника опустела — победа',
  },
];

export const catalog: CardCatalog = {
  getCard: (id) => cards.find((c) => c.id === id),
  getHero: (id) => heroes.find((h) => h.id === id),
};

/** 40-card deck: 10 distinct cards × 4 copies (copyLimit), deterministic order. */
export function buildDeck(pool: string[]): string[] {
  if (pool.length !== defaultConfig.deckSize / defaultConfig.copyLimit) {
    throw new Error(`pool must have ${defaultConfig.deckSize / defaultConfig.copyLimit} distinct cards`);
  }
  const deck: string[] = [];
  for (let copy = 0; copy < defaultConfig.copyLimit; copy++) {
    for (const cardId of pool) deck.push(cardId);
  }
  return deck;
}

/** 10 distinct cards per player so decks respect the copy limit. */
export const P1_POOL = [
  'vanilla-swamp',
  'vanilla-corn',
  'cheap-rainbow',
  'big-swamp',
  'vanilla-good',
  'vanilla-blue',
  'vanilla-ice',
  'vanilla-sand',
  'plain-fortress',
  'spell-plain',
];

export const P2_POOL = [
  'vanilla-corn',
  'vanilla-swamp',
  'cheap-rainbow',
  'big-swamp',
  'vanilla-good',
  'vanilla-blue',
  'vanilla-ice',
  'vanilla-sand',
  'spell-plain',
  'plain-fortress',
];

export function makeSetup(options?: {
  p1Deck?: string[];
  p2Deck?: string[];
  p1Lands?: LandType[];
  p2Lands?: LandType[];
  p1Hero?: string;
  p2Hero?: string;
  seed?: number;
}): { players: PlayerSetup[]; seed: number } {
  return {
    players: [
      {
        id: P1,
        nickname: 'Игрок 1',
        heroId: options?.p1Hero ?? 'hero-billy',
        deck: options?.p1Deck ?? buildDeck(P1_POOL),
        lands: options?.p1Lands ?? ['swamp', 'swamp', 'swamp', 'rainbow'],
      },
      {
        id: P2,
        nickname: 'Игрок 2',
        heroId: options?.p2Hero ?? 'hero-billy',
        deck: options?.p2Deck ?? buildDeck(P2_POOL),
        lands: options?.p2Lands ?? ['corn', 'corn', 'good', 'swamp'],
      },
    ],
    seed: options?.seed ?? 12345,
  };
}

/** Find the first instance of a card in a player's hand. */
export function handCardId(state: MatchState, playerId: string, cardId: string): string {
  const id = state.players[playerId]!.hand.find((i) => state.instances[i]!.cardId === cardId);
  if (!id) throw new Error(`no ${cardId} in hand of ${playerId}`);
  return id;
}

/** Unwrap a successful ApplyResult or throw with the rejection reason. */
export function mustOk(res: { ok: true; state: MatchState } | { ok: false; rejected: { code: string; message: string } }): MatchState {
  if (!res.ok) throw new Error(`${res.rejected.code}: ${res.rejected.message}`);
  return res.state;
}

/** Test helper: restore the player's action pool (some scenarios deploy 3+ cards per turn). */
export function refillActions(state: MatchState, playerId: string): MatchState {
  return produce(state, (d) => {
    d.players[playerId]!.actions = defaultConfig.actionsPerTurn;
  });
}

/**
 * Test helper: swap a hand card for a deck card with the wanted cardId,
 * substituting the cardId when the deck has no such copy. This keeps unit
 * tests independent of which fixture cards happened to be shuffled where.
 */
export function forceToHand(state: MatchState, playerId: string, cardId: string): MatchState {
  return produce(state, (draft) => {
    const p = draft.players[playerId]!;
    const inHand = p.hand.some((i) => draft.instances[i]!.cardId === cardId);
    if (inHand) return;
    const deckId = p.deck[0];
    if (!deckId) throw new Error(`deck of ${playerId} is empty`);
    const handId = p.hand[0];
    if (!handId) throw new Error(`hand of ${playerId} is empty`);
    p.deck.splice(0, 1);
    p.hand.splice(p.hand.indexOf(handId), 1);
    p.deck.push(handId);
    p.hand.push(deckId);
    draft.instances[handId]!.location = 'deck';
    const target = draft.instances[deckId]!;
    target.location = 'hand';
    target.cardId = cardId;
  });
}
