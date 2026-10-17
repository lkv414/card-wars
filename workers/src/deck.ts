/**
 * deck.ts — сборка колоды из локального каталога (`individual_cards/cards.json`).
 *
 * Пресеты колод удалены вместе с Supabase (Этап 5), поэтому колоду приходится
 * собирать на месте. Это нужно двум потребителям:
 *   - бот (см. `bot.ts`) — псевдо-игрок внутри GameRoom;
 *   - локальная тестовая партия (`local-*` комната без лобби).
 *
 * Колода одноземельная: выбирается доминирующий тип земли каталога, в колоду
 * попадают карты этой земли и радужные (`is_rainbow`), а все четыре зоны
 * получают эту же землю. Так правило размещения (`landPlacementRule: strict`)
 * выполняется всегда, и карта не «застрянет» в руке.
 *
 * Никакого I/O и времени: перемешивание — Fisher–Yates на переданном rng
 * (по умолчанию `Math.random`), в тестах подменяется сидом.
 */
import { getCards } from './catalog'
import type { Card, PlayerState, Zone } from './game-engine/types'

export const DECK_SIZE = 20
export const STARTING_HAND_SIZE = 5

export type Rng = () => number

export interface BuiltDeck {
  hand: Card[]
  deck: Card[]
  /** Тип земли, под который собрана колода. */
  landType: string
}

interface CatalogCard {
  id: string
  card_type?: string
  land_type?: string
  is_rainbow?: boolean
}

/** Read one catalog row defensively — the JSON is data, not a typed record. */
function asCatalogCard(raw: Record<string, unknown>): CatalogCard | null {
  const id = raw.id
  if (typeof id !== 'string' || !id) return null
  return {
    id,
    card_type: typeof raw.card_type === 'string' ? raw.card_type : undefined,
    land_type: typeof raw.land_type === 'string' ? raw.land_type : undefined,
    is_rainbow: raw.is_rainbow === true,
  }
}

/** Cards a deck builder may place on a lane. Spells need targets — skipped. */
function isPlayable(card: CatalogCard): boolean {
  return card.card_type === 'creature' || card.card_type === 'building'
}

/** Dominant non-rainbow land type in the catalog (deterministic tie-break). */
function dominantLandType(cards: CatalogCard[]): string {
  const counts = new Map<string, number>()
  for (const card of cards) {
    const land = card.land_type
    if (!land || land === 'any') continue
    counts.set(land, (counts.get(land) ?? 0) + 1)
  }
  let best = 'corn'
  let bestCount = 0
  for (const [land, count] of counts) {
    if (count > bestCount) {
      best = land
      bestCount = count
    }
  }
  return best
}

function shuffled<T>(items: T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const a = out[i]
    const b = out[j]
    out[i] = b as T
    out[j] = a as T
  }
  return out
}

/**
 * Build a fresh deck from the bundled catalog: 5 cards in hand, 15 in the pile.
 * Returns catalog rows verbatim plus a stable per-instance id, so the client can
 * render art for its own cards without any extra lookup.
 */
export function buildCatalogDeck(rng: Rng = Math.random): BuiltDeck {
  const all = getCards()
    .map(asCatalogCard)
    .filter((card): card is CatalogCard => card !== null)
  const playable = all.filter(isPlayable)
  const landType = dominantLandType(playable)
  const pool = playable.filter((card) => {
    if (card.is_rainbow) return true
    const land = card.land_type
    // Карта без земли (или «any») кладётся куда угодно — берём её тоже.
    if (!land || land === 'any') return true
    return land === landType
  })

  const picked = shuffled(pool, rng).slice(0, DECK_SIZE)
  const instances: Card[] = picked.map((card, index) => ({
    ...(card as unknown as Card),
    instanceId: `${card.id}-${index}`,
  }))

  return {
    hand: instances.slice(0, STARTING_HAND_SIZE),
    deck: instances.slice(STARTING_HAND_SIZE),
    landType,
  }
}

/** True when a seat has no cards at all — i.e. still needs a deck. */
export function needsDeck(player: PlayerState): boolean {
  return player.hand.length === 0 && player.deck_pile.length === 0
}

/**
 * Fill a seat with a catalog deck and bind every zone to that deck's land.
 * Existing zones (and their land bindings) are kept; only missing pieces are added.
 *
 * Зона без земли и зона с заглушкой `any` (так LobbyRoom описывает место, у
 * которого не было колоды — например, бота) получают землю этой колоды, иначе
 * правило размещения заблокирует карты в руке.
 */
export function fillSeatWithCatalogDeck(player: PlayerState, rng: Rng = Math.random): PlayerState {
  const built = buildCatalogDeck(rng)
  const zones: Zone[] = player.zones.length
    ? player.zones
    : [1, 2, 3, 4].map((position) => ({ zone_position: position, cards: [] }))
  return {
    ...player,
    hand: built.hand,
    deck_pile: built.deck,
    deck_remaining: built.deck.length,
    discard_pile: [],
    zones: zones.map((zone) => {
      const existing = typeof zone.land_type === 'string' && zone.land_type !== 'any'
        ? zone.land_type
        : null
      const landType = existing ?? built.landType
      return {
        ...zone,
        cards: zone.cards ?? [],
        land_id: existing ? (zone.land_id ?? landType) : landType,
        land_type: landType,
      }
    }),
  }
}
