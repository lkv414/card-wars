import type { CardCatalog, CardData, HeroData, LandType } from '@card-wars/domain';
import generatedCards from './generated/cards.json' with { type: 'json' };
import generatedHeroes from './generated/heroes.json' with { type: 'json' };
import { buildPreset } from './presets.ts';

// Canonical catalog: content/ is the source of truth, searchable per card.
// Regenerate the bundle with `pnpm --filter @card-wars/content generate`
// (tools/build-catalog.mjs); manual edits to generated JSON are overwritten.

export const cards = generatedCards as unknown as CardData[];
export const heroes = generatedHeroes as unknown as HeroData[];

const cardsById = new Map(cards.map((card) => [card.id, card]));
const heroesById = new Map(heroes.map((hero) => [hero.id, hero]));

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
  buildPreset(cards, 'preset-bimo', 'hero_bmo', 'blue'),
  buildPreset(cards, 'preset-billy', 'hero_billy', 'good'),
];

export { buildPreset };
export type { CardData, HeroData, LandType };
