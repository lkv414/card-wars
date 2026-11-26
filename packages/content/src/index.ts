import type { CardCatalog, CardData, HeroData, LandType } from '@card-wars/domain';
import generatedCards from './generated/cards.json' with { type: 'json' };
import generatedHeroes from './generated/heroes.json' with { type: 'json' };
import generatedLands from './generated/lands.json' with { type: 'json' };
import { buildPreset } from './presets.ts';

// Canonical catalog: content/ is the source of truth (853 cards, 74 heroes, 44 lands).
// Regenerate the bundle with `pnpm --filter @card-wars/content generate`
// (tools/build-catalog.mjs); manual edits to generated JSON are overwritten.

export interface LandData {
  id: string;
  name: string;
  landType: Exclude<LandType, 'rainbow'>;
  image: string;
}

export const cards = generatedCards as unknown as CardData[];
export const heroes = generatedHeroes as unknown as HeroData[];
export const lands = generatedLands as unknown as LandData[];

const cardsById = new Map<string, CardData>();
for (const card of cards) {
  cardsById.set(card.id, card);
}

const heroesById = new Map<string, HeroData>();
for (const hero of heroes) {
  heroesById.set(hero.id, hero);
}

const landsById = new Map<string, LandData>();
for (const land of lands) {
  landsById.set(land.id, land);
}

/** Canonical land types (docs/RULES.md «Земли»). */
export const LAND_TYPES: LandType[] = ['corn', 'blue', 'good', 'ice', 'sand', 'swamp', 'rainbow', 'lava'];

/** Physical land tile types selectable in deck building (7 types, excluding rainbow). */
export const PLAYABLE_LAND_TYPES: Exclude<LandType, 'rainbow'>[] = [
  'corn',
  'blue',
  'good',
  'ice',
  'sand',
  'swamp',
  'lava',
];

export function getLand(id: string): LandData | undefined {
  return landsById.get(id);
}

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
