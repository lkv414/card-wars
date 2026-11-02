import { describe, expect, it } from 'vitest';
import { LAND_TYPES, cards, catalog, deckPresets, heroes } from './index.ts';

describe('canonical catalog', () => {
  it('loads cards and heroes', () => {
    expect(cards.length).toBeGreaterThan(500);
    expect(heroes.length).toBeGreaterThan(20);
  });

  it('has unique ids', () => {
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
    expect(new Set(heroes.map((hero) => hero.id)).size).toBe(heroes.length);
  });

  it('every card fits the domain schema', () => {
    for (const card of cards) {
      expect(LAND_TYPES, card.id).toContain(card.landType);
      expect(['creature', 'building', 'spell', 'companion'], card.id).toContain(card.type);
      expect(Number.isInteger(card.cost), card.id).toBe(true);
      if (card.type === 'creature') {
        expect(typeof card.attack, card.id).toBe('number');
        expect(typeof card.defense, card.id).toBe('number');
      } else {
        expect(card.attack, card.id).toBeUndefined();
        expect(card.defense, card.id).toBeUndefined();
      }
    }
  });

  it('every hero has display text', () => {
    for (const hero of heroes) {
      expect(hero.name.length, hero.id).toBeGreaterThan(0);
      expect(hero.text.length, hero.id).toBeGreaterThan(0);
    }
  });

  it('deck presets resolve to catalog entries', () => {
    for (const preset of deckPresets) {
      expect(preset.deck).toHaveLength(40);
      expect(preset.lands).toHaveLength(4);
      expect(catalog.getHero(preset.heroId)).toBeDefined();
      for (const cardId of preset.deck) expect(catalog.getCard(cardId), cardId).toBeDefined();
    }
  });
});
