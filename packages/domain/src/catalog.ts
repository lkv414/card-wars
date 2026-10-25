import type { CardData, HeroData } from './types';

// Port: the card/hero catalog lives outside the domain (packages/content, docs/TECH.md).
// The domain must never reference concrete cards — only catalog data through this port.
export interface CardCatalog {
  getCard(cardId: string): CardData | undefined;
  getHero(heroId: string): HeroData | undefined;
}
