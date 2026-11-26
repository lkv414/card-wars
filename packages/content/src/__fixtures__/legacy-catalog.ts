import type { CardCatalog, CardData, HeroData } from '@card-wars/domain';
import { catalog } from '../index.ts';
import legacyCards from './legacy-cards.json' with { type: 'json' };
import legacyHeroes from './legacy-heroes.json' with { type: 'json' };

const legacyCardsById = new Map<string, CardData>();
for (const card of legacyCards as unknown as CardData[]) {
  legacyCardsById.set(card.id, card);
}

const legacyHeroesById = new Map<string, HeroData>();
for (const hero of legacyHeroes as unknown as HeroData[]) {
  legacyHeroesById.set(hero.id, hero);
}

/** Test-only catalog combining canonical entries with legacy ID fixtures for golden/h1 tests. */
export const legacyCatalog: CardCatalog = {
  getCard: (id) => catalog.getCard(id) ?? legacyCardsById.get(id),
  getHero: (id) => catalog.getHero(id) ?? legacyHeroesById.get(id),
};
