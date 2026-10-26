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

function presetDecks(): SavedDeck[] {
  return deckPresets.map((preset) => ({
    id: preset.id,
    name: `Колода ${heroById.get(preset.heroId)?.name ?? preset.id}`,
    heroId: preset.heroId,
    lands: [...preset.lands],
    cards: [...preset.deck],
  }));
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
        const decks = parsed.map(normalizeDeck).filter((d): d is SavedDeck => d !== null);
        if (decks.length > 0) return decks;
      }
    }
  } catch {
    // fall through to presets
  }
  const seeded = presetDecks();
  saveDecks(seeded);
  return seeded;
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
  const payload = JSON.stringify({
    v: 1,
    h: deck.heroId,
    l: deck.lands,
    c: deck.cards,
  });
  const crc = crc32(payload).toString(16).padStart(8, '0');
  return `${base64UrlEncode(payload)}.${crc}`;
}

export type DeckCodeResult = { ok: true; deck: SavedDeck } | { ok: false; error: string };

export function decodeDeckCode(code: string): DeckCodeResult {
  const trimmed = code.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0) return { ok: false, error: 'Некорректный код колоды' };
  const payload = base64UrlDecode(trimmed.slice(0, dot));
  const expected = crc32(payload).toString(16).padStart(8, '0');
  if (expected !== trimmed.slice(dot + 1).toLowerCase()) {
    return { ok: false, error: 'Код колоды повреждён (контрольная сумма)' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, error: 'Некорректный код колоды' };
  }
  const data = parsed as { v?: unknown; h?: unknown; l?: unknown; c?: unknown };
  if (data.v !== 1 || typeof data.h !== 'string' || !Array.isArray(data.l) || !Array.isArray(data.c)) {
    return { ok: false, error: 'Некорректный формат кода колоды' };
  }
  if (!data.l.every((l): l is string => typeof l === 'string' && isLandType(l))) {
    return { ok: false, error: 'В коде колоды неверные земли' };
  }
  if (!data.c.every((c): c is string => typeof c === 'string')) {
    return { ok: false, error: 'В коде колоды неверные карты' };
  }
  const deck: SavedDeck = {
    id: `deck-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: 'Импортированная колода',
    heroId: data.h,
    lands: data.l as LandType[],
    cards: [...data.c],
  };
  const errors = validateSavedDeck(deck);
  if (errors.length > 0) return { ok: false, error: errors[0]! };
  return { ok: true, deck };
}
