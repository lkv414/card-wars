import { DECK_LIMITS } from '../constants/game'

const { cards: CARD_LIMITS, lands: LAND_LIMITS } = DECK_LIMITS

export function getDeckTileBlockReason({ isLandCard, quantity, cardTotal }) {
  if (isLandCard) {
    if (cardTotal >= LAND_LIMITS.maxTotal) {
      return `В колоде уже ${LAND_LIMITS.maxTotal} земли`
    }
    return null
  }
  if (quantity >= CARD_LIMITS.maxPerEntry) {
    return `Максимум ${CARD_LIMITS.maxPerEntry} копии этой карты`
  }
  if (cardTotal >= CARD_LIMITS.maxTotal) {
    return `Колода полна (${CARD_LIMITS.maxTotal} карт)`
  }
  return null
}
