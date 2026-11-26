import { describe, expect, it } from 'vitest';
import { CONFIG } from '@card-wars/protocol';
import { cards, lands as catalogLands, type LandType } from '@card-wars/content';
import {
  decodeDeckCode,
  encodeDeckCode,
  generateRandomDeck,
  newDeck,
  validateSavedDeck,
  type SavedDeck,
} from './decks';

const cardById = new Map(cards.map((c) => [c.id, c]));

function makeCode(payloadObj: unknown): string {
  const payload = JSON.stringify(payloadObj);
  const bytes = new TextEncoder().encode(payload);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  const hex = ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
  return `${b64}.${hex}`;
}

function sampleDeck(): SavedDeck {
  const lands: LandType[] = ['corn', 'corn', 'blue', 'blue'];
  const deckCards = generateRandomDeck('bmo-f0dc351', lands);
  return {
    id: 'test-sample-deck',
    name: 'Тестовая колода',
    heroId: 'bmo-f0dc351',
    lands,
    cards: deckCards,
  };
}

describe('decodeDeckCode', () => {
  it('returns an error and does not throw for completely invalid strings', () => {
    const invalidInputs = [
      '',
      '   ',
      'not-a-code',
      '.badchecksum',
      'badpayload.',
      'invalid!base64!characters.00000000',
      '%%%==.12345678',
    ];

    for (const input of invalidInputs) {
      expect(() => {
        const result = decodeDeckCode(input);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBeTruthy();
        }
      }).not.toThrow();
    }
  });

  it('detects checksum corruption', () => {
    const preset = sampleDeck();
    const code = encodeDeckCode(preset);
    const dot = code.lastIndexOf('.');
    const payload = code.slice(0, dot);

    // Tampered checksum
    const tamperedCode = `${payload}.ffffffff`;
    const result = decodeDeckCode(tamperedCode);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('контрольная сумма');
    }
  });

  it('handles valid base64 with invalid JSON or payload', () => {
    // encode "not-json" to base64url + valid crc
    const bytes = new TextEncoder().encode('not-json');
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // calculate crc32 for 'not-json'
    let crc = 0xffffffff;
    for (const b of bytes) {
      crc ^= b;
      for (let bit = 0; bit < 8; bit++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }
    const hexCrc = ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');

    const result = decodeDeckCode(`${b64}.${hexCrc}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Неверный формат или поврежденный код колоды');
    }
  });

  it('rejects payloads with unknown versions or malformed structures', () => {
    expect(makeCode({ v: 99, h: 'bmo-f0dc351', l: ['blue', 'blue', 'blue', 'blue'], c: [] })).satisfies(
      (code: string) => !decodeDeckCode(code).ok
    );
    expect(makeCode({ v: 2, n: 'test', h: 123, l: ['blue'], c: [] })).satisfies(
      (code: string) => !decodeDeckCode(code).ok
    );
    expect(makeCode({ v: 2, n: 'test', h: 'bmo-f0dc351', l: ['not-a-land'], c: [] })).satisfies(
      (code: string) => !decodeDeckCode(code).ok
    );
    expect(makeCode({ v: 2, n: 'test', h: 'bmo-f0dc351', l: ['blue'], c: [['card-1', 'not-a-number']] })).satisfies(
      (code: string) => !decodeDeckCode(code).ok
    );
  });

  it('migrates legacy rainbow land in imported code to blue', () => {
    const preset = sampleDeck();
    const counts = new Map<string, number>();
    for (const id of preset.cards) counts.set(id, (counts.get(id) ?? 0) + 1);
    const code = makeCode({
      v: 2,
      n: 'Наследие радуги',
      h: preset.heroId,
      l: ['corn', 'rainbow', 'blue', 'rainbow'],
      c: Array.from(counts.entries()),
    });

    const result = decodeDeckCode(code);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deck.lands).toEqual(['corn', 'blue', 'blue', 'blue']);
    }
  });
});

describe('v2 RLE encode / decode round-trip', () => {
  it('encodes with v2 RLE format and preserves deck name', () => {
    const preset = sampleDeck();
    const deckToEncode: SavedDeck = {
      ...preset,
      name: 'Колода Бимо Чемпион',
    };

    const code = encodeDeckCode(deckToEncode);
    expect(typeof code).toBe('string');
    expect(code).toContain('.');

    // Inspect decoded payload directly
    const dot = code.lastIndexOf('.');
    const b64 = code.slice(0, dot);
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
    const decodedJson = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)))
    ) as { v: number; n: string; h: string; l: string[]; c: Array<[string, number]>; li?: unknown };

    expect(decodedJson.v).toBe(2);
    expect(decodedJson.n).toBe('Колода Бимо Чемпион');
    expect(decodedJson.h).toBe(deckToEncode.heroId);
    expect(decodedJson.l).toEqual(deckToEncode.lands);
    expect(decodedJson.li).toBeUndefined();
    expect(Array.isArray(decodedJson.c)).toBe(true);
    for (const entry of decodedJson.c) {
      expect(Array.isArray(entry)).toBe(true);
      expect(entry.length).toBe(2);
      expect(typeof entry[0]).toBe('string');
      expect(typeof entry[1]).toBe('number');
      expect(entry[1]).toBeGreaterThan(0);
    }

    // Decode with decodeDeckCode
    const decodeResult = decodeDeckCode(code);
    expect(decodeResult.ok).toBe(true);
    if (decodeResult.ok) {
      const decodedDeck = decodeResult.deck;
      expect(decodedDeck.name).toBe('Колода Бимо Чемпион');
      expect(decodedDeck.heroId).toBe(deckToEncode.heroId);
      expect(decodedDeck.lands).toEqual(deckToEncode.lands);
      expect(decodedDeck.cards.length).toBe(CONFIG.deckSize);

      // Verify exact card counts match
      const originalCounts = new Map<string, number>();
      for (const id of deckToEncode.cards) {
        originalCounts.set(id, (originalCounts.get(id) ?? 0) + 1);
      }
      const decodedCounts = new Map<string, number>();
      for (const id of decodedDeck.cards) {
        decodedCounts.set(id, (decodedCounts.get(id) ?? 0) + 1);
      }
      expect(decodedCounts).toEqual(originalCounts);
    }
  });

  it('preserves landIds (li) across encodeDeckCode and decodeDeckCode', () => {
    const cornArt = catalogLands.find((l) => l.landType === 'corn')!;
    const blueArt = catalogLands.find((l) => l.landType === 'blue')!;
    const preset = sampleDeck();
    const deckWithLandIds: SavedDeck = {
      ...preset,
      lands: ['corn', 'corn', 'blue', 'blue'],
      landIds: [cornArt.id, null, blueArt.id, null],
    };

    const code = encodeDeckCode(deckWithLandIds);
    const dot = code.lastIndexOf('.');
    const b64 = code.slice(0, dot);
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
    const decodedJson = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)))
    ) as { li?: (string | null)[] };

    expect(decodedJson.li).toEqual([cornArt.id, null, blueArt.id, null]);

    const result = decodeDeckCode(code);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deck.landIds).toEqual([cornArt.id, null, blueArt.id, null]);
    }
  });
});

describe('v1 legacy compatibility', () => {
  it('decodes legacy v1 deck codes without throwing', () => {
    const preset = sampleDeck();

    // Construct legacy v1 payload
    const v1Payload = JSON.stringify({
      v: 1,
      h: preset.heroId,
      l: preset.lands,
      c: preset.cards,
    });

    const bytes = new TextEncoder().encode(v1Payload);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    let crc = 0xffffffff;
    for (const b of bytes) {
      crc ^= b;
      for (let bit = 0; bit < 8; bit++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }
    const hexCrc = ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
    const v1Code = `${b64}.${hexCrc}`;

    const result = decodeDeckCode(v1Code);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deck.heroId).toBe(preset.heroId);
      expect(result.deck.lands).toEqual(preset.lands);
      expect(result.deck.cards).toEqual(preset.cards);
      expect(result.deck.name).toBe('Импортированная колода');
    }
  });
});

describe('newDeck & validateSavedDeck land rules', () => {
  it('newDeck() has no rainbow lands', () => {
    const deck = newDeck();
    expect(deck.lands).toHaveLength(CONFIG.landsPerPlayer);
    expect(deck.lands).not.toContain('rainbow');
    expect(deck.landIds).toEqual([null, null, null, null]);
  });

  it('validateSavedDeck() rejects rainbow land', () => {
    const preset = sampleDeck();
    const invalid: SavedDeck = {
      ...preset,
      lands: ['corn', 'blue', 'ice', 'rainbow'],
    };
    const errors = validateSavedDeck(invalid);
    expect(errors).toContain('Радужные земли нельзя добавлять в колоду');
  });
});

describe('generateRandomDeck', () => {
  it('produces a valid 40-card deck with correct lands and copy limits', () => {
    const lands: LandType[] = ['corn', 'blue', 'ice', 'sand'];
    const heroId = 'bmo-f0dc351';

    const deck = generateRandomDeck(heroId, lands);
    expect(deck.length).toBe(CONFIG.deckSize);

    // Validate using validateSavedDeck
    const savedDeck: SavedDeck = {
      id: 'test-random-1',
      name: 'Случайная колода',
      heroId,
      lands,
      cards: deck,
    };
    const errors = validateSavedDeck(savedDeck);
    expect(errors).toEqual([]);

    // Check card constraints
    const copyCounts = new Map<string, number>();
    const typeCounts: Record<string, number> = { creature: 0, spell: 0, building: 0 };
    const costCounts: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3+': 0 };

    for (const cardId of deck) {
      const card = cardById.get(cardId);
      expect(card).toBeDefined();
      expect(card!.type).not.toBe('companion');
      expect(lands.includes(card!.landType) || card!.landType === 'rainbow').toBe(true);

      const count = (copyCounts.get(cardId) ?? 0) + 1;
      expect(count).toBeLessThanOrEqual(CONFIG.copyLimit);
      copyCounts.set(cardId, count);

      typeCounts[card!.type] = (typeCounts[card!.type] ?? 0) + 1;
      const b = card!.cost >= 3 ? '3+' : String(Math.max(0, Math.floor(card!.cost)));
      costCounts[b] = (costCounts[b] ?? 0) + 1;
    }

    // Check balanced composition:
    // ~65-75% creatures (26-30), ~15-20% spells (6-8), ~10% buildings (3-5)
    expect(typeCounts.creature).toBeGreaterThanOrEqual(25);
    expect(typeCounts.creature).toBeLessThanOrEqual(31);
    expect(typeCounts.spell).toBeGreaterThanOrEqual(5);
    expect(typeCounts.spell).toBeLessThanOrEqual(10);
    expect(typeCounts.building).toBeGreaterThanOrEqual(2);
    expect(typeCounts.building).toBeLessThanOrEqual(6);

    // Check mana curve distribution
    expect(costCounts['0']).toBeGreaterThan(0);
    expect(costCounts['1']).toBeGreaterThan(0);
    expect(costCounts['2']).toBeGreaterThan(0);
  });

  it('smartly auto-fills an incomplete deck', () => {
    const preset = sampleDeck();
    const initialCards = preset.cards.slice(0, 15);
    expect(initialCards.length).toBe(15);

    const filledDeck = generateRandomDeck(preset.heroId, preset.lands, initialCards);
    expect(filledDeck.length).toBe(CONFIG.deckSize);

    // Initial 15 cards should be preserved at the beginning
    expect(filledDeck.slice(0, 15)).toEqual(initialCards);

    // Copy limit should be respected across existing + added cards
    const counts = new Map<string, number>();
    for (const cardId of filledDeck) {
      const count = (counts.get(cardId) ?? 0) + 1;
      expect(count).toBeLessThanOrEqual(CONFIG.copyLimit);
      counts.set(cardId, count);
    }

    // Validates cleanly
    const savedDeck: SavedDeck = {
      id: 'test-autofill',
      name: 'Автозаполненная колода',
      heroId: preset.heroId,
      lands: preset.lands,
      cards: filledDeck,
    };
    expect(validateSavedDeck(savedDeck)).toEqual([]);
  });

  it('leaves already full deck untouched', () => {
    const preset = sampleDeck();
    const filledDeck = generateRandomDeck(preset.heroId, preset.lands, preset.cards);
    expect(filledDeck.length).toBe(CONFIG.deckSize);
    expect(filledDeck).toEqual(preset.cards);
  });

  it('works with mono-lands', () => {
    const monoLands: LandType[] = ['good', 'good', 'good', 'good'];
    const deck = generateRandomDeck('billy-eebb206', monoLands);
    expect(deck.length).toBe(CONFIG.deckSize);

    for (const cardId of deck) {
      const c = cardById.get(cardId);
      expect(c).toBeDefined();
      expect(c!.landType === 'good' || c!.landType === 'rainbow').toBe(true);
    }

    const savedDeck: SavedDeck = {
      id: 'test-mono',
      name: 'Моно-земли',
      heroId: 'billy-eebb206',
      lands: monoLands,
      cards: deck,
    };
    expect(validateSavedDeck(savedDeck)).toEqual([]);
  });
});
