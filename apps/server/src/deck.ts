import type { CardCatalog, GameConfig, LandType } from '@card-wars/domain';
import { LAND_TYPES, type DeckPreset } from '@card-wars/content';
import type { LobbyDeck } from '@card-wars/protocol';

export interface DeckSetup {
  heroId: string;
  lands: LandType[];
  cards: string[];
}

export type DeckValidation = { ok: true; deck: DeckSetup } | { ok: false; error: string };

/** Validate a lobby deck against the catalog and CONFIG (docs/CARDS.md «Формат колоды»). */
export function validateDeck(
  deck: LobbyDeck,
  deps: { config: GameConfig; catalog: CardCatalog },
): DeckValidation {
  const { config, catalog } = deps;
  if (!catalog.getHero(deck.heroId)) return { ok: false, error: 'Неизвестный герой' };

  if (deck.lands.length !== config.landsPerPlayer) {
    return { ok: false, error: `Нужно ровно ${config.landsPerPlayer} земли` };
  }
  const lands = deck.lands as LandType[];
  for (const land of lands) {
    if (!LAND_TYPES.includes(land)) return { ok: false, error: `Неизвестный тип земли: ${land}` };
  }

  if (deck.cards.length !== config.deckSize) {
    return { ok: false, error: `В колоде ${deck.cards.length} карт, нужно ${config.deckSize}` };
  }
  const copies = new Map<string, number>();
  for (const cardId of deck.cards) {
    if (!catalog.getCard(cardId)) return { ok: false, error: `Неизвестная карта: ${cardId}` };
    const n = (copies.get(cardId) ?? 0) + 1;
    if (n > config.copyLimit) {
      return { ok: false, error: `Больше ${config.copyLimit} копий карты ${cardId}` };
    }
    copies.set(cardId, n);
  }

  return { ok: true, deck: { heroId: deck.heroId, lands: [...lands], cards: [...deck.cards] } };
}

export function presetDeck(preset: DeckPreset): DeckSetup {
  return {
    heroId: preset.heroId,
    lands: [...preset.lands],
    cards: [...preset.deck],
  };
}
