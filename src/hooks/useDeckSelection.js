import { useMemo, useState } from 'react'
import { DECK_LIMITS } from '../constants/game'
import { applyDeckEntries, normalizeDeckEntryId } from '../utils/deckState'
import { validateDeck } from '../utils/deckValidation'

export function useDeckSelection() {
  const [selectedCards, setSelectedCards] = useState({})
  const [selectedLands, setSelectedLands] = useState({})

  const { cardTotal, landTotal, errors, warnings } = useMemo(
    () => validateDeck(selectedCards, selectedLands),
    [selectedCards, selectedLands]
  )

  const addCard = (id) =>
    setSelectedCards((p) => applyDeckEntries(p, { [id]: 1 }, DECK_LIMITS.cards))

  const removeCard = (id) => {
    const normalizedId = normalizeDeckEntryId(id)
    setSelectedCards((p) => {
      const next = { ...p }
      const current = Number(next[normalizedId] || 0)
      const updated = current - 1
      if (updated <= 0) delete next[normalizedId]
      else next[normalizedId] = updated
      return next
    })
  }

  const addLand = (id) =>
    setSelectedLands((p) => applyDeckEntries(p, { [id]: 1 }, DECK_LIMITS.lands))

  const removeLand = (id) => {
    const normalizedId = normalizeDeckEntryId(id)
    setSelectedLands((p) => {
      const next = { ...p }
      const current = Number(next[normalizedId] || 0)
      const updated = current - 1
      if (updated <= 0) delete next[normalizedId]
      else next[normalizedId] = updated
      return next
    })
  }

  const clearDeck = () => {
    setSelectedCards({})
    setSelectedLands({})
  }

  return {
    selectedCards,
    selectedLands,
    setSelectedCards,
    setSelectedLands,
    addCard,
    removeCard,
    addLand,
    removeLand,
    clearDeck,
    cardTotal,
    landTotal,
    errors,
    warnings,
  }
}

