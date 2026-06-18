export function validateDeck(cards, lands) {
  const errors = []
  const warnings = []

  const totalCards = cards.reduce((sum, c) => sum + (c.quantity || 0), 0)
  const totalLands = lands.reduce((sum, l) => sum + (l.quantity || 0), 0)

  if (totalCards < 40) warnings.push('В колоде меньше 40 карт (рекомендуется минимум 40)')
  if (totalCards > 40) errors.push('В колоде больше 40 карт')
  if (totalLands !== 4) errors.push('Должно быть ровно 4 земли')

  for (const c of cards) {
    if (c.quantity > 3) errors.push(`Карта ${c.card_id} встречается более 3 раз`)
  }

  return { isValid: errors.length === 0, errors, warnings, totalCards, totalLands }
}
