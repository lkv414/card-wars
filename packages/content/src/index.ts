import type { CardCatalog, CardData, HeroData, LandType } from '@card-wars/domain';
import generatedCards from './generated/cards.json' with { type: 'json' };
import generatedHeroes from './generated/heroes.json' with { type: 'json' };
import legacyCards from './generated/legacy-cards.json' with { type: 'json' };
import legacyHeroes from './generated/legacy-heroes.json' with { type: 'json' };
import { buildPreset } from './presets.ts';

// Canonical catalog: content/ is the source of truth (853 cards, 74 heroes).
// Regenerate the bundle with `pnpm --filter @card-wars/content generate`
// (tools/build-catalog.mjs); manual edits to generated JSON are overwritten.

export const cards = generatedCards as unknown as CardData[];
export const heroes = generatedHeroes as unknown as HeroData[];

const cardsById = new Map<string, CardData>();
for (const card of cards) {
  cardsById.set(card.id, card);
}
// Legacy card fallback for test suite compatibility
for (const card of legacyCards as unknown as CardData[]) {
  if (!cardsById.has(card.id)) {
    cardsById.set(card.id, card);
  }
}

const heroesById = new Map<string, HeroData>();
for (const hero of heroes) {
  heroesById.set(hero.id, hero);
}
// Legacy hero fallback for test suite compatibility
for (const hero of legacyHeroes as unknown as HeroData[]) {
  if (!heroesById.has(hero.id)) {
    heroesById.set(hero.id, hero);
  }
}

/** Canonical land types (docs/RULES.md «Земли»). */
export const LAND_TYPES: LandType[] = ['corn', 'blue', 'good', 'ice', 'sand', 'swamp', 'rainbow', 'ghost'];

export const catalog: CardCatalog = {
  getCard: (id) => cardsById.get(id),
  getHero: (id) => heroesById.get(id),
};

/** MVP deck presets (docs/MVP.md): Бимо — blue, Билли — good. */
export interface DeckPreset {
  id: string;
  heroId: string;
  lands: LandType[];
  deck: string[];
}

export const deckPresets: DeckPreset[] = [
  buildPreset(cards, 'preset-bimo', 'bmo-f0dc351', 'blue'),
  buildPreset(cards, 'preset-billy', 'billy-eebb206', 'good'),
];

export { buildPreset };
export type { CardData, HeroData, LandType };
