import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@card-wars/domain';
import { buildPreset, convertRawCards, convertRawHeroes, type RawCard, type RawHero } from './convert';
import { cards as generatedCards, catalog, deckPresets, heroes as generatedHeroes } from './index';

const config: GameConfig = {
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

const card = (partial: Partial<RawCard> & Pick<RawCard, 'id' | 'name'>): RawCard => ({
  card_type: 'creature',
  cost: 1,
  attack: 2,
  health: 3,
  land_type: 'swamp',
  description: '',
  ...partial,
});

describe('convertRawCards', () => {
  it('переводит any → rainbow, special → companion, health → defense', () => {
    const { cards: out } = convertRawCards([
      card({ id: 'a', name: 'A', land_type: 'any' }),
      card({ id: 'b', name: 'B', card_type: 'special', attack: null, health: null }),
      card({ id: 'c', name: 'C', land_type: 'corn' }),
    ]);
    expect(out[0]!.landType).toBe('rainbow');
    expect(out[1]!.type).toBe('companion');
    expect(out[2]!.defense).toBe(3);
  });

  it('бесплатный флюп из manual без условий', () => {
    const { cards: out } = convertRawCards([
      card({
        id: 'f1',
        name: 'F1',
        mechanics: [
          {
            trigger: 'manual',
            actions: [{ type: 'draw_cards', count: 1 }],
            conditions: [],
            source_text: 'ПРИЁМ >>> тяни карту',
          },
        ],
      }),
    ]);
    expect(out[0]!.abilities).toHaveLength(1);
    expect(out[0]!.abilities[0]!.kind).toBe('floop');
    expect(out[0]!.abilities[0]!.floopCost).toBe(0);
  });

  it('cost_actions задаёт платный флюп', () => {
    const { cards: out } = convertRawCards([
      card({
        id: 'f2',
        name: 'F2',
        mechanics: [
          {
            trigger: 'manual',
            actions: [{ type: 'deal_damage', target: 'chosen_opponent_creature', amount: 2 }],
            conditions: [{ type: 'cost_actions', value: 1 }],
            source_text: 'Потрать 1 действие, ПРИЁМ >>> 2 урона',
          },
        ],
      }),
    ]);
    expect(out[0]!.abilities[0]!.floopCost).toBe(1);
  });

  it('дополнительные стоимости и условия — текст остаётся, способность не собирается', () => {
    const { cards: out } = convertRawCards([
      card({
        id: 'p1',
        name: 'P1',
        description: 'Уничтожь существо под своим контролем, ПРИЁМ >>> 1 урон каждому существу противника',
        mechanics: [
          {
            trigger: 'manual',
            actions: [{ type: 'deal_damage', target: 'each_creature_opponent', amount: 1 }],
            conditions: [{ type: 'prerequisite', description: 'Уничтожь существо' }],
            source_text: 'Уничтожь существо, ПРИЁМ >>> 1 урон всем',
          },
        ],
      }),
    ]);
    expect(out[0]!.abilities).toHaveLength(0); // только текст — играет как ваниль
    expect(out[0]!.description).toContain('Уничтожь');
  });

  it('неподдерживаемые триггеры и операции не собираются', () => {
    const { cards: out } = convertRawCards([
      card({
        id: 'u1',
        name: 'U1',
        mechanics: [
          {
            trigger: 'on_damage_dealt',
            actions: [{ type: 'heal', target: 'self', amount: 1 }],
            conditions: [],
            source_text: 'Когда наносит урон...',
          },
          {
            trigger: 'manual',
            actions: [{ type: 'imperative', effect: 'нечто' }],
            conditions: [],
            source_text: 'ПРИЁМ >>> нечто сложное',
          },
        ],
      }),
    ]);
    expect(out[0]!.abilities).toHaveLength(0);
  });

  it('return_from_discard намеренно не собирается (фильтры в тексте, не в данных)', () => {
    const { cards: out } = convertRawCards([
      card({
        id: 'r1',
        name: 'R1',
        card_type: 'spell',
        attack: null,
        health: null,
        mechanics: [
          {
            trigger: 'manual',
            actions: [{ type: 'return_from_discard', target: 'chosen_discard', destination: 'hand' }],
            conditions: [],
            source_text: 'Верни случайное болотное существо из сброса в руку',
          },
        ],
      }),
    ]);
    expect(out[0]!.abilities).toHaveLength(0);
  });
});

describe('convertRawHeroes', () => {
  it('имена и тексты сохраняются, id стабильные', () => {
    const raw: RawHero[] = [
      { id: '3001', name: 'БиМО', hero_slug: 'bimo', description: 'текст' },
      { id: '3002', name: 'Билли', hero_slug: 'billy', description: 'победа при пустой колоде' },
    ];
    const heroes = convertRawHeroes(raw, {
      billy: {
        ability: { kind: 'passive', trigger: 'start_of_turn', effect: { op: 'win_if_opponents_deck_empty' }, text: '...' },
      },
    });
    expect(heroes[0]).toMatchObject({ id: 'hero-bimo', name: 'БиМО' });
    expect(heroes[0]!.ability.effect).toBeUndefined(); // без реализованного эффекта
    expect(heroes[1]!.ability.effect).toMatchObject({ op: 'win_if_opponents_deck_empty' });
  });
});

describe('сгенерированные данные', () => {
  it('504 карты, уникальные id, корректные типы', () => {
    expect(generatedCards).toHaveLength(504);
    const ids = new Set(generatedCards.map((c) => c.id));
    expect(ids.size).toBe(504);
    for (const c of generatedCards) {
      expect(['creature', 'building', 'spell', 'companion']).toContain(c.type);
      expect(c.landType).not.toBe('any');
    }
  });

  it('23 героя, Бимо и Билли реализованы', () => {
    expect(generatedHeroes).toHaveLength(23);
    const bimo = catalog.getHero('hero-bimo')!;
    const billy = catalog.getHero('hero-billy')!;
    expect(bimo.ability.effect).toMatchObject({ op: 'draw_cards' });
    expect(billy.ability.effect).toMatchObject({ op: 'win_if_opponents_deck_empty' });
  });

  it('пресеты валидны: 40 карт, лимит копий, земли, карты существуют', () => {
    expect(deckPresets).toHaveLength(2);
    for (const preset of deckPresets) {
      expect(preset.deck).toHaveLength(config.deckSize);
      expect(new Set(preset.deck).size).toBeLessThanOrEqual(config.deckSize / 1);
      const copies = new Map<string, number>();
      for (const cardId of preset.deck) {
        expect(catalog.getCard(cardId), `card ${cardId} exists`).toBeDefined();
        const n = (copies.get(cardId) ?? 0) + 1;
        expect(n).toBeLessThanOrEqual(config.copyLimit);
        copies.set(cardId, n);
      }
      expect(preset.lands).toHaveLength(config.landsPerPlayer);
      expect(catalog.getHero(preset.heroId)).toBeDefined();
    }
    // колоды различаются
    expect(deckPresets[0]!.deck).not.toEqual(deckPresets[1]!.deck);
  });

  it('buildPreset детерминирован', () => {
    const a = buildPreset(generatedCards, 'x', 'hero-bimo', 'blue');
    const b = buildPreset(generatedCards, 'x', 'hero-bimo', 'blue');
    expect(a).toEqual(b);
  });
});
