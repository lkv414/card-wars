import { DECK_LIMITS } from '../constants/game.js'

export function validateDeck(cards, lands) {
  const toEntries = (value) => {
    if (!value) return []
    if (Array.isArray(value)) return value.map((v) => ({ id: v.card_id || v.id, quantity: v.quantity || 0 }))
    if (typeof value === 'object') {
      return Object.entries(value).map(([id, quantity]) => ({ id, quantity: Number(quantity) || 0 }))
    }
    return []
  }

  const cardEntries = toEntries(cards)
  const landEntries = toEntries(lands)

  const errors = []
  const warnings = []

  const totalCards = cardEntries.reduce((sum, c) => sum + (c.quantity || 0), 0)
  const totalLands = landEntries.reduce((sum, l) => sum + (l.quantity || 0), 0)

  if (totalCards > DECK_LIMITS.cards.maxTotal) {
    errors.push(`В колоде больше ${DECK_LIMITS.cards.maxTotal} карт`)
  }

  for (const c of cardEntries) {
    if (c.quantity > DECK_LIMITS.cards.maxPerEntry) {
      errors.push(`Карта ${c.id} встречается более ${DECK_LIMITS.cards.maxPerEntry} раз`)
    }
  }

  if (totalLands > DECK_LIMITS.lands.maxTotal) {
    errors.push(`В колоде больше ${DECK_LIMITS.lands.maxTotal} земель`)
  }

  for (const l of landEntries) {
    if (l.quantity > DECK_LIMITS.lands.maxPerEntry) {
      errors.push(`Земля ${l.id} встречается более ${DECK_LIMITS.lands.maxPerEntry} раз`)
    }
  }

  return { isValid: errors.length === 0, errors, warnings, cardTotal: totalCards, landTotal: totalLands }
}
