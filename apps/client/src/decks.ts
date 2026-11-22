import { CONFIG, type LobbyDeck } from '@card-wars/protocol';
import { LAND_TYPES, cards, deckPresets, heroes, type LandType } from '@card-wars/content';

// Player decks live in localStorage (docs/TECH.md «Клиент»); a deck code is
// `{v, h, l, c}` → base64url + crc32 for moving a deck between devices.

export interface SavedDeck {
  id: string;
  name: string;
  heroId: string;
  lands: LandType[];
  cards: string[];
}

const DECKS_KEY = 'cw-decks-v1';
const FAVORITES_KEY = 'cw-favorites-v1';
const SELECTED_KEY = 'cw-selected-deck';

const heroById = new Map(heroes.map((h) => [h.id, h]));
const cardById = new Map(cards.map((c) => [c.id, c]));

export function presetDecks(): SavedDeck[] {
  return [];
}

export function restorePresets(): SavedDeck[] {
  return [];
}

function isLandType(value: string): value is LandType {
  return (LAND_TYPES as string[]).includes(value);
}

function normalizeDeck(raw: unknown): SavedDeck | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<SavedDeck>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return null;
  if (typeof candidate.heroId !== 'string') return null;
  if (!Array.isArray(candidate.lands) || !candidate.lands.every((l) => typeof l === 'string' && isLandType(l))) return null;
  if (!Array.isArray(candidate.cards) || !candidate.cards.every((c) => typeof c === 'string')) return null;
  return {
    id: candidate.id,
    name: candidate.name,
    heroId: candidate.heroId,
    lands: candidate.lands as LandType[],
    cards: [...candidate.cards],
  };
}

export function loadDecks(): SavedDeck[] {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const decks = parsed
          .map(normalizeDeck)
          .filter((d): d is SavedDeck => d !== null)
          // Filter out default BMO and Billy preset decks
          .filter(
            (d) =>
              d.id !== 'preset-bmo' &&
              d.id !== 'preset-billy' &&
              !d.name.toLowerCase().includes('бимо') &&
              !d.name.toLowerCase().includes('билли'),
          );
        saveDecks(decks);
        return decks;
      }
    }
  } catch {
    // return empty
  }
  return [];
}

export function saveDecks(decks: SavedDeck[]): void {
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
  } catch {
    // storage may be unavailable; the session still works in memory
  }
}

export function getSelectedDeckId(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

export function setSelectedDeckId(id: string): void {
  try {
    localStorage.setItem(SELECTED_KEY, id);
  } catch {
    // ignore
  }
}

export function newDeck(): SavedDeck {
  const heroId = heroes[0]?.id ?? '';
  return {
    id: `deck-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: 'Новая колода',
    heroId,
    lands: Array.from({ length: CONFIG.landsPerPlayer }, () => 'rainbow' as LandType),
    cards: [],
  };
}

/** Russian validation messages; an empty array means the deck is playable. */
export function validateSavedDeck(deck: SavedDeck): string[] {
  const errors: string[] = [];
  if (!deck.name.trim()) errors.push('У колоды должно быть название');
  if (!heroById.has(deck.heroId)) errors.push('Выберите героя');
  if (deck.lands.length !== CONFIG.landsPerPlayer) {
    errors.push(`Нужно ровно ${CONFIG.landsPerPlayer} земли`);
  } else if (!deck.lands.every(isLandType)) {
    errors.push('Неизвестный тип земли');
  }
  if (deck.cards.length !== CONFIG.deckSize) {
    errors.push(`В колоде ${deck.cards.length} из ${CONFIG.deckSize} карт`);
  }
  const copies = new Map<string, number>();
  for (const cardId of deck.cards) {
    if (!cardById.has(cardId)) {
      errors.push(`Неизвестная карта: ${cardId}`);
      continue;
    }
    const n = (copies.get(cardId) ?? 0) + 1;
    if (n > CONFIG.copyLimit) errors.push(`Больше ${CONFIG.copyLimit} копий одной карты`);
    copies.set(cardId, n);
  }
  return [...new Set(errors)];
}

export function toLobbyDeck(deck: SavedDeck): LobbyDeck {
  return { heroId: deck.heroId, lands: [...deck.lands], cards: [...deck.cards] };
}

export function heroName(heroId: string): string {
  return heroById.get(heroId)?.name ?? heroId;
}

export function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveFavorites(favorites: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch {
    // ignore
  }
}

// --- Deck code: base64url(JSON) + crc32 ---

function crc32(text: string): number {
  let crc = 0xffffffff;
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeDeckCode(deck: SavedDeck): string {
  const counts = new Map<string, number>();
  for (const cardId of deck.cards) {
    counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
  }
  const rleCards: [string, number][] = Array.from(counts.entries());
  const payload = JSON.stringify({
    v: 2,
    n: deck.name,
    h: deck.heroId,
    l: deck.lands,
    c: rleCards,
  });
  const crc = crc32(payload).toString(16).padStart(8, '0');
  return `${base64UrlEncode(payload)}.${crc}`;
}

export type DeckCodeResult = { ok: true; deck: SavedDeck } | { ok: false; error: string };

export function decodeDeckCode(code: string): DeckCodeResult {
  const trimmed = code.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0) {
    return { ok: false, error: 'Неверный формат или поврежденный код колоды' };
  }

  let payload: string;
  try {
    payload = base64UrlDecode(trimmed.slice(0, dot));
  } catch {
    return { ok: false, error: 'Неверный формат или поврежденный код колоды' };
  }

  const expected = crc32(payload).toString(16).padStart(8, '0');
  if (expected !== trimmed.slice(dot + 1).toLowerCase()) {
    return { ok: false, error: 'Код колоды повреждён (контрольная сумма)' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, error: 'Неверный формат или поврежденный код колоды' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Неверный формат или поврежденный код колоды' };
  }

  const data = parsed as { v?: unknown; n?: unknown; h?: unknown; l?: unknown; c?: unknown };

  if (typeof data.h !== 'string' || !Array.isArray(data.l) || !Array.isArray(data.c)) {
    return { ok: false, error: 'Неверный формат или поврежденный код колоды' };
  }

  if (!data.l.every((l): l is string => typeof l === 'string' && isLandType(l))) {
    return { ok: false, error: 'В коде колоды неверные земли' };
  }

  let cards: string[];
  let name = 'Импортированная колода';

  if (data.v === 2) {
    if (typeof data.n === 'string' && data.n.trim()) {
      name = data.n.trim();
    }
    cards = [];
    for (const item of data.c) {
      if (
        !Array.isArray(item) ||
        item.length !== 2 ||
        typeof item[0] !== 'string' ||
        typeof item[1] !== 'number' ||
        item[1] <= 0 ||
        !Number.isInteger(item[1])
      ) {
        return { ok: false, error: 'В коде колоды неверные карты' };
      }
      for (let i = 0; i < item[1]; i++) {
        cards.push(item[0]);
      }
    }
  } else if (data.v === 1) {
    if (!data.c.every((c): c is string => typeof c === 'string')) {
      return { ok: false, error: 'В коде колоды неверные карты' };
    }
    cards = [...data.c];
  } else {
    return { ok: false, error: 'Неверный формат или поврежденный код колоды' };
  }

  const deck: SavedDeck = {
    id: `deck-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name,
    heroId: data.h,
    lands: data.l as LandType[],
    cards,
  };

  const errors = validateSavedDeck(deck);
  if (errors.length > 0) return { ok: false, error: errors[0]! };
  return { ok: true, deck };
}

/**
 * Smart deck generator / auto-fill.
 * Fills up to CONFIG.deckSize (40 cards), respecting lands, copy limit (max 4),
 * balanced archetype ratios (~65-75% creatures, ~15-20% spells, ~10% buildings),
 * and a healthy mana curve (0, 1, 2, 3+ AP).
 */
export function generateRandomDeck(
  _heroId: string,
  lands: LandType[],
  existingCards: string[] = []
): string[] {
  const needed = Math.max(0, CONFIG.deckSize - existingCards.length);
  if (needed === 0) return [...existingCards];

  // Eligible cards: matching any of the deck's lands or rainbow, excluding companions
  const eligible = cards.filter((c) => {
    if (c.type === 'companion') return false;
    if (c.type !== 'creature' && c.type !== 'spell' && c.type !== 'building') return false;
    return lands.includes(c.landType) || c.landType === 'rainbow';
  });

  const pool = eligible.length > 0
    ? eligible
    : cards.filter((c) => c.type !== 'companion' && (c.type === 'creature' || c.type === 'spell' || c.type === 'building'));

  const counts = new Map<string, number>();
  for (const id of existingCards) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  // Count existing cards by type
  const curTypeCounts: Record<'creature' | 'spell' | 'building', number> = {
    creature: 0,
    spell: 0,
    building: 0,
  };
  for (const id of existingCards) {
    const c = cardById.get(id);
    if (c && (c.type === 'creature' || c.type === 'spell' || c.type === 'building')) {
      curTypeCounts[c.type]++;
    }
  }

  // Balanced composition targets for a 40-card deck:
  // ~70% creatures (28), ~20% spells (8), ~10% buildings (4)
  const targetCreatures = Math.round(CONFIG.deckSize * 0.70); // 28
  const targetSpells = Math.round(CONFIG.deckSize * 0.20);     // 8
  const targetBuildings = CONFIG.deckSize - targetCreatures - targetSpells; // 4

  let remCreatures = Math.max(0, targetCreatures - curTypeCounts.creature);
  let remSpells = Math.max(0, targetSpells - curTypeCounts.spell);
  let remBuildings = Math.max(0, targetBuildings - curTypeCounts.building);

  const desiredTypes: Array<'creature' | 'spell' | 'building'> = [];
  while (desiredTypes.length < needed) {
    const sum = remCreatures + remSpells + remBuildings;
    if (sum === 0) {
      const r = Math.random();
      if (r < 0.70) desiredTypes.push('creature');
      else if (r < 0.90) desiredTypes.push('spell');
      else desiredTypes.push('building');
    } else {
      const r = Math.random() * sum;
      if (r < remCreatures) {
        desiredTypes.push('creature');
        remCreatures--;
      } else if (r < remCreatures + remSpells) {
        desiredTypes.push('spell');
        remSpells--;
      } else {
        desiredTypes.push('building');
        remBuildings--;
      }
    }
  }

  // Mana curve bucket targets: 0 AP: 6, 1 AP: 20, 2 AP: 11, 3+ AP: 3
  const targetCost: [number, number, number, number] = [6, 20, 11, 3];
  function costBucket(cost: number): 0 | 1 | 2 | 3 {
    if (cost <= 0) return 0;
    if (cost === 1) return 1;
    if (cost === 2) return 2;
    return 3;
  }

  const curCostCounts: [number, number, number, number] = [0, 0, 0, 0];
  for (const id of existingCards) {
    const c = cardById.get(id);
    if (c) {
      const b = costBucket(c.cost);
      curCostCounts[b] = (curCostCounts[b] ?? 0) + 1;
    }
  }

  const added: string[] = [];

  for (const desiredType of desiredTypes) {
    let candidates = pool.filter(
      (c) => c.type === desiredType && (counts.get(c.id) ?? 0) < CONFIG.copyLimit
    );
    if (candidates.length === 0) {
      candidates = pool.filter((c) => (counts.get(c.id) ?? 0) < CONFIG.copyLimit);
    }
    if (candidates.length === 0) break;

    let totalWeight = 0;
    const weights = candidates.map((c) => {
      const b = costBucket(c.cost);
      const deficit = (targetCost[b] ?? 0) - (curCostCounts[b] ?? 0);
      const w = Math.max(0.1, deficit > 0 ? deficit * 2 : 0.5);
      totalWeight += w;
      return w;
    });

    let rnd = Math.random() * totalWeight;
    let chosen = candidates[0]!;
    for (let i = 0; i < candidates.length; i++) {
      rnd -= weights[i]!;
      if (rnd <= 0) {
        chosen = candidates[i]!;
        break;
      }
    }

    counts.set(chosen.id, (counts.get(chosen.id) ?? 0) + 1);
    const b = costBucket(chosen.cost);
    curCostCounts[b] = (curCostCounts[b] ?? 0) + 1;
    added.push(chosen.id);
  }

  // Fisher-Yates shuffle added cards
  for (let i = added.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = added[i]!;
    added[i] = added[j]!;
    added[j] = temp;
  }

  return [...existingCards, ...added];
}
