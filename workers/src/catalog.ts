/**
 * Catalog access layer — источник каталога для Worker.
 *
 * Этап 5 плана v2: KV больше нет. Каталог карт приходит из того же файла,
 * что читает клиент (`individual_cards/cards.json`), и собирается в бандл
 * Worker на этапе сборки. Земли — справочник типов, зеркало
 * `LAND_DEFS` из `src/constants/landColors.js` (id земли = её тип).
 */
import cardsJson from '../../individual_cards/cards.json'

export type Card = Record<string, unknown>
export type Land = { id: string; land_type: string }

const CARDS: ReadonlyArray<Card> = cardsJson

/** Канонические типы земель. Держать в синхроне с LAND_DEFS клиента. */
export const LAND_TYPE_IDS: readonly string[] = [
  'corn',
  'ice',
  'good',
  'swamp',
  'sand',
  'blue',
]

/** Read the full cards catalog. */
export function getCards(): ReadonlyArray<Card> {
  return CARDS
}

/** Read the full lands catalog. */
export function getLands(): ReadonlyArray<Land> {
  return LAND_TYPE_IDS.map((id) => ({ id, land_type: id }))
}

/**
 * Build a `{id → row}` index for the cards catalog. Worker code uses this when
 * it needs to enrich a card referenced inside a saved game state.
 */
export function getCardIndex(): Map<string, Card> {
  const idx = new Map<string, Card>()
  for (const card of CARDS) {
    const id = (card as { id?: unknown }).id
    if (typeof id === 'string') idx.set(id, card)
  }
  return idx
}
