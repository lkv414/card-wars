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

// Test fixtures only — the real catalog arrives in stage 3 (docs/data/cards_test_v1.json).
// No rule code may reference these cards; they exercise the data-driven ability format.

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
  return { name: partial.id, attack: undefined, defense: undefined, abilities: [], ...partial };
}

export const cards: CardData[] = [
  card({ id: 'vanilla-swamp', type: 'creature', cost: 1, landType: 'swamp', attack: 2, defense: 6 }),
  card({ id: 'vanilla-corn', type: 'creature', cost: 1, landType: 'corn', attack: 3, defense: 7 }),
  card({ id: 'cheap-rainbow', type: 'creature', cost: 0, landType: 'rainbow', attack: 1, defense: 5 }),
  card({ id: 'big-swamp', type: 'creature', cost: 2, landType: 'swamp', attack: 5, defense: 10 }),
  card({
    id: 'floop-draw',
    type: 'creature',
    cost: 1,
    landType: 'swamp',
    attack: 1,
    defense: 6,
    abilities: [{ kind: 'floop', effect: { op: 'draw_cards', count: 1 }, text: 'ПРИЁМ >>> тяни карту' }],
  }),
  card({
    id: 'floop-paid-damage',
    type: 'creature',
    cost: 1,
    landType: 'swamp',
    attack: 1,
    defense: 6,
    abilities: [
      {
        kind: 'floop',
        floopCost: 1,
        effect: { op: 'deal_damage', target: { kind: 'chosen_opponent_creature' }, amount: 2 },
        text: 'Потрать 1 действие, ПРИЁМ >>> 2 урона существу противника',
      },
    ],
  }),
  card({
    id: 'floop-shield',
    type: 'creature',
    cost: 1,
    landType: 'swamp',
    attack: 1,
    defense: 6,
    abilities: [
      { kind: 'floop', effect: { op: 'gain_shield', target: { kind: 'this_creature' }, amount: 2 }, text: 'ПРИЁМ >>> щит 2' },
    ],
  }),
  card({
    id: 'healer',
    type: 'creature',
    cost: 1,
    landType: 'good',
    attack: 2,
    defense: 7,
    abilities: [
      {
        kind: 'passive',
        trigger: 'on_enters_play',
        effect: { op: 'heal', target: { kind: 'adjacent_creature' }, amount: 1 },
        text: 'При входе в игру лечит соседей на 1',
      },
    ],
  }),
  card({
    id: 'bomber',
    type: 'creature',
    cost: 1,
    landType: 'swamp',
    attack: 1,
    defense: 1,
    abilities: [
      {
        kind: 'passive',
        trigger: 'on_death',
        effect: { op: 'deal_damage', target: { kind: 'each_creature_opponent' }, amount: 1 },
        text: 'При смерти — 1 урон всем существам противника',
      },
    ],
  }),
  card({
    id: 'death-pick',
    type: 'creature',
    cost: 1,
    landType: 'swamp',
    attack: 1,
    defense: 1,
    abilities: [
      {
        kind: 'passive',
        trigger: 'on_death',
        effect: { op: 'deal_damage', target: { kind: 'chosen_creature' }, amount: 1 },
        text: 'При смерти — 1 урон выбранному существу',
      },
    ],
  }),
  card({
    id: 'discard-counter',
    type: 'creature',
    cost: 1,
    landType: 'swamp',
    attack: 1,
    defense: 6,
    abilities: [
      {
        kind: 'passive',
        trigger: 'persistent',
        effect: {
          op: 'stat_buff',
          target: { kind: 'this_creature' },
          stat: 'attack',
          amount: { perDiscardEvery: 5, amount: 1 },
        },
        text: '+1 АТК за каждые 5 карт в сбросе',
      },
    ],
  }),
  card({
    id: 'start-of-turn-mill',
    type: 'creature',
    cost: 1,
    landType: 'swamp',
    attack: 1,
    defense: 10,
    abilities: [
      {
        kind: 'passive',
        trigger: 'start_of_turn',
        effect: { op: 'discard_top', count: 1 },
        text: 'В начале хода — верхняя карта колоды в сброс',
      },
    ],
  }),
  card({
    id: 'blood-fortress',
    type: 'building',
    cost: 1,
    landType: 'swamp',
    abilities: [
      {
        kind: 'passive',
        trigger: 'persistent',
        effect: { op: 'stat_buff', target: { kind: 'this_lane_creature' }, stat: 'attack', amount: 1 },
        text: 'Твоё существо на этой линии: +1 АТК',
      },
    ],
  }),
  card({
    id: 'grand-fortress',
    type: 'building',
    cost: 1,
    landType: 'swamp',
    abilities: [
      {
        kind: 'passive',
        trigger: 'persistent',
        effect: { op: 'stat_buff', target: { kind: 'this_lane_opponent_creature' }, stat: 'defense', amount: -2 },
        text: 'Существо противника на этой линии: −2 ЗАЩ',
      },
    ],
  }),
  card({
    id: 'freezer',
    type: 'building',
    cost: 1,
    landType: 'swamp',
    abilities: [
      {
        kind: 'floop',
        floopCost: 0,
        effect: { op: 'freeze_landscape', target: { kind: 'chosen_landscape' } },
        text: 'ПРИЁМ >>> заморозь землю',
      },
    ],
  }),
  card({
    id: 'floop-buff-turn',
    type: 'creature',
    cost: 1,
    landType: 'swamp',
    attack: 1,
    defense: 6,
    abilities: [
      {
        kind: 'floop',
        effect: { op: 'stat_buff', target: { kind: 'this_creature' }, stat: 'attack', amount: 3, duration: 'this_turn' },
        text: 'ПРИЁМ >>> +3 АТК в этот ход',
      },
    ],
  }),
  card({
    id: 'spell-destroy',
    type: 'spell',
    cost: 2,
    landType: 'swamp',
    abilities: [
      { kind: 'passive', trigger: 'floop', effect: { op: 'destroy', target: { kind: 'chosen_creature' } }, text: 'Уничтожь выбранное существо' },
    ],
  }),
  card({
    id: 'floop-return',
    type: 'creature',
    cost: 1,
    landType: 'swamp',
    attack: 1,
    defense: 6,
    abilities: [
      {
        kind: 'floop',
        effect: { op: 'return_from_discard', filter: { type: 'creature' }, random: true },
        text: 'ПРИЁМ >>> верни случайное существо из сброса в руку',
      },
    ],
  }),
  card({
    id: 'companion-pair',
    type: 'companion',
    cost: 1,
    landType: 'rainbow',
    description: 'Парная карта (фикстура для проверки запрета в 1 на 1)',
  }),
  card({
    id: 'spell-damage',
    type: 'spell',
    cost: 1,
    landType: 'swamp',
    abilities: [
      {
        kind: 'passive',
        trigger: 'floop',
        effect: { op: 'deal_damage', target: { kind: 'chosen_creature' }, amount: 3 },
        text: 'Нанеси 3 урона выбранному существу',
      },
    ],
  }),
  card({
    id: 'spell-heal-face',
    type: 'spell',
    cost: 1,
    landType: 'good',
    abilities: [
      { kind: 'passive', trigger: 'floop', effect: { op: 'heal', target: { kind: 'self' }, amount: 3 }, text: 'Восстанови 3' },
    ],
  }),
  card({
    id: 'spell-discard',
    type: 'spell',
    cost: 1,
    landType: 'swamp',
    abilities: [
      {
        kind: 'passive',
        trigger: 'floop',
        effect: { op: 'opponent_discards', target: { kind: 'chosen_opponent' }, count: 1 },
        text: 'Выбранный противник сбрасывает карту',
      },
    ],
  }),
];

export const heroes: HeroData[] = [
  {
    id: 'hero-bimo',
    name: 'Бимо',
    ability: {
      kind: 'passive',
      trigger: 'start_of_turn',
      effect: { op: 'draw_cards', count: 1 },
      text: 'Дополнительный бесплатный добор в начале хода',
    },
    text: 'Дополнительный бесплатный добор в начале хода',
  },
  {
    id: 'hero-billy',
    name: 'Билли',
    ability: {
      kind: 'passive',
      trigger: 'start_of_turn',
      effect: { op: 'win_if_opponents_deck_empty' },
      text: 'Если к началу твоего хода колода каждого противника опустела — победа',
    },
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
  'cheap-rainbow',
  'big-swamp',
  'floop-draw',
  'spell-damage',
  'floop-shield',
  'discard-counter',
  'start-of-turn-mill',
  'blood-fortress',
  'spell-discard',
];

export const P2_POOL = [
  'vanilla-corn',
  'cheap-rainbow',
  'vanilla-swamp',
  'spell-heal-face',
  'floop-shield',
  'healer',
  'bomber',
  'grand-fortress',
  'freezer',
  'floop-paid-damage',
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

