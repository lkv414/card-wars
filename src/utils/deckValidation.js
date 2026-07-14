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

  if (totalCards > 40) errors.push('В колоде больше 40 карт')

  for (const c of cardEntries) {
    if (c.quantity > 3) errors.push(`Карта ${c.id} встречается более 3 раз`)
  }

  return { isValid: errors.length === 0, errors, warnings, cardTotal: totalCards, landTotal: totalLands }
}
