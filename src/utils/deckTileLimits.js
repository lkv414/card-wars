import { DECK_LIMITS } from '../constants/game.js'

const { cards: CARD_LIMITS, lands: LAND_LIMITS } = DECK_LIMITS

export function getDeckTileBlockReason({ isLandCard, quantity, selectionTotal }) {
  if (isLandCard) {
    if (selectionTotal >= LAND_LIMITS.maxTotal) {
      return `В колоде уже ${LAND_LIMITS.maxTotal} земли`
    }
    return null
  }
  if (quantity >= CARD_LIMITS.maxPerEntry) {
    return `Максимум ${CARD_LIMITS.maxPerEntry} копии этой карты`
  }
  if (selectionTotal >= CARD_LIMITS.maxTotal) {
    return `Колода полна (${CARD_LIMITS.maxTotal} карт)`
  }
  return null
}
