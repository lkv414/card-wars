import { describe, expect, it } from 'vitest';
import { catalog, deckPresets } from '@card-wars/content';
import { config } from './config';
import { presetDeck, validateDeck } from './deck';

const deps = { config, catalog };
const valid = presetDeck(deckPresets[0]!);

function asLobbyDeck(deck: typeof valid) {
  return { heroId: deck.heroId, lands: [...deck.lands] as string[], cards: [...deck.cards] };
}

describe('validateDeck', () => {
  it('принимает пресет колоды', () => {
    const res = validateDeck(asLobbyDeck(valid), deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.deck.cards).toHaveLength(config.deckSize);
    expect(res.deck.lands).toHaveLength(config.landsPerPlayer);
  });

  it('отклоняет неверный размер колоды', () => {
    const deck = asLobbyDeck(valid);
    deck.cards = deck.cards.slice(0, 39);
    expect(validateDeck(deck, deps)).toEqual({ ok: false, error: `В колоде 39 карт, нужно 40` });
  });

  it('отклоняет неизвестную карту и героя', () => {
    const deck = asLobbyDeck(valid);
    deck.cards[0] = 'unknown-card';
    expect(validateDeck(deck, deps).ok).toBe(false);

    const badHero = asLobbyDeck(valid);
    badHero.heroId = 'unknown-hero';
    expect(validateDeck(badHero, deps).ok).toBe(false);
  });

  it('отклоняет превышение лимита копий', () => {
    const deck = asLobbyDeck(valid);
    const cardId = deck.cards[0]!;
    const otherIndex = deck.cards.findIndex((id) => id !== cardId);
    deck.cards[otherIndex] = cardId; // 5 копий одной карты при том же размере колоды
    const res = validateDeck(deck, deps);
    expect(res.ok).toBe(false);
  });

  it('отклоняет неверные земли', () => {
    const shortLands = asLobbyDeck(valid);
    shortLands.lands = shortLands.lands.slice(0, 3);
    expect(validateDeck(shortLands, deps).ok).toBe(false);

    const badLand = asLobbyDeck(valid);
    badLand.lands = ['lava', ...badLand.lands.slice(1)] as string[];
    expect(validateDeck(badLand, deps).ok).toBe(false);
  });
});
