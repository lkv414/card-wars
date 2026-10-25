import type {
  AbilityData,
  CardCatalog,
  CardData,
  EffectSpec,
  HeroData,
  LandType,
  StatKey,
  StatAmount,
  TargetSpec,
} from '@card-wars/domain';

// PROVISIONAL content for the stage-2 technical client (docs/TECH.md «Контент»).
// The real catalog arrives in stage 3 from docs/data/cards_test_v1.json via a converter.
// This file is data only — no rule code may reference concrete card ids.

function card(partial: Partial<CardData> & Pick<CardData, 'id' | 'type' | 'cost' | 'landType'>): CardData {
  return { name: partial.id, abilities: [], ...partial };
}

export const cards: CardData[] = [
  card({ id: 'vanilla-swamp', type: 'creature', cost: 1, landType: 'swamp', attack: 2, defense: 6, name: 'Болотный житель' }),
  card({ id: 'vanilla-corn', type: 'creature', cost: 1, landType: 'corn', attack: 3, defense: 7, name: 'Кукурузный страж' }),
  card({ id: 'cheap-rainbow', type: 'creature', cost: 0, landType: 'rainbow', attack: 1, defense: 5, name: 'Радужный малыш' }),
  card({ id: 'big-swamp', type: 'creature', cost: 2, landType: 'swamp', attack: 5, defense: 10, name: 'Болотный титан' }),
  card({
    id: 'floop-draw',
    type: 'creature',
    cost: 1,
    landType: 'swamp',
    attack: 1,
    defense: 6,
    name: 'Тянущий тритон',
    abilities: [{ kind: 'floop', effect: { op: 'draw_cards', count: 1 }, text: 'ПРИЁМ >>> тяни карту' }],
  }),
  card({
    id: 'floop-paid-damage',
    type: 'creature',
    cost: 1,
    landType: 'swamp',
    attack: 1,
    defense: 6,
    name: 'Кислотный плевун',
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
    name: 'ПанцирныйSlug',
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
    name: 'Добрый лекарь',
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
    name: 'Болотная бомба',
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
    id: 'discard-counter',
    type: 'creature',
    cost: 1,
    landType: 'swamp',
    attack: 1,
    defense: 6,
    name: 'Счётчик душ',
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
    name: 'Забывчивый великан',
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
    name: 'Кровавая крепость',
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
    name: 'Великая крепость',
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
    name: 'Ледяной обелиск',
    abilities: [
      {
        kind: 'floop',
        floopCost: 0,
        effect: { op: 'freeze_landscape', target: { kind: 'chosen_landscape' } },
        text: 'ПРИЁМ >>> заморозь выбранную землю',
      },
    ],
  }),
  card({
    id: 'spell-damage',
    type: 'spell',
    cost: 1,
    landType: 'swamp',
    name: 'Вспышка',
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
    name: 'Сладкий пирог',
    abilities: [
      { kind: 'passive', trigger: 'floop', effect: { op: 'heal', target: { kind: 'self' }, amount: 3 }, text: 'Восстанови 3 жизни' },
    ],
  }),
  card({
    id: 'spell-discard',
    type: 'spell',
    cost: 1,
    landType: 'swamp',
    name: 'Кошмар',
    abilities: [
      {
        kind: 'passive',
        trigger: 'floop',
        effect: { op: 'opponent_discards', target: { kind: 'chosen_opponent' }, count: 1 },
        text: 'Выбранный противник сбрасывает карту',
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
    name: 'Яростный берсерк',
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
    name: 'Вырубка',
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
    name: 'Воскриватель',
    abilities: [
      {
        kind: 'floop',
        effect: { op: 'return_from_discard', filter: { type: 'creature' }, random: true },
        text: 'ПРИЁМ >>> верни случайное существо из сброса в руку',
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
      text: 'Дополнительный бесплатный добор карты в начале хода',
    },
    text: 'Дополнительный бесплатный добор карты в начале хода',
  },
  {
    id: 'hero-billy',
    name: 'Билли',
    // PROVISIONAL: Billy's real ability comes with the stage-3 catalog.
    ability: { kind: 'passive', text: 'Способность уточняется (временные данные)' },
    text: 'Способность уточняется (временные данные)',
  },
];

export const catalog: CardCatalog = {
  getCard: (id) => cards.find((c) => c.id === id),
  getHero: (id) => heroes.find((h) => h.id === id),
};

/** MVP deck presets (docs/MVP.md): one deck per hero, 10 distinct cards × 4 copies. */
export interface DeckPreset {
  id: string;
  heroId: string;
  lands: LandType[];
  deck: string[];
}

function buildDeck(pool: string[]): string[] {
  const out: string[] = [];
  for (let copy = 0; copy < 4; copy++) {
    for (const cardId of pool) out.push(cardId);
  }
  return out;
}

export const deckPresets: DeckPreset[] = [
  {
    id: 'preset-bimo',
    heroId: 'hero-bimo',
    lands: ['swamp', 'swamp', 'swamp', 'rainbow'],
    deck: buildDeck([
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
    ]),
  },
  {
    id: 'preset-billy',
    heroId: 'hero-billy',
    lands: ['corn', 'corn', 'good', 'swamp'],
    deck: buildDeck([
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
    ]),
  },
];

// Re-export data types so tooling can build card UIs without importing domain internals.
export type { AbilityData, CardData, EffectSpec, HeroData, StatAmount, StatKey, TargetSpec };
