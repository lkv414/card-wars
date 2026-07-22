import { useMemo, useState, useEffect, useCallback } from 'react'
import { DECK_LIMITS } from '../constants/game'
import { applyDeckEntries, normalizeDeckEntryId } from '../utils/deckState'
import { validateDeck } from '../utils/deckValidation'

const STORAGE_KEY = 'deckSelection'

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { selectedCards: {}, selectedLands: {} }
    return JSON.parse(raw)
  } catch {
    return { selectedCards: {}, selectedLands: {} }
  }
}

function saveToStorage(selectedCards, selectedLands) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedCards, selectedLands }))
}

export function useDeckSelection() {
  const initial = useMemo(loadFromStorage, [])
  const [selectedCards, setSelectedCards] = useState(initial.selectedCards)
  const [selectedLands, setSelectedLands] = useState(initial.selectedLands)

  // Сохранять в localStorage при каждом изменении
  useEffect(() => {
    saveToStorage(selectedCards, selectedLands)
  }, [selectedCards, selectedLands])

  const { cardTotal, landTotal, errors, warnings } = useMemo(
    () => validateDeck(selectedCards, selectedLands),
    [selectedCards, selectedLands]
  )

  const addCard = useCallback((id) =>
    setSelectedCards((p) => applyDeckEntries(p, { [id]: 1 }, DECK_LIMITS.cards)), [])

  const removeCard = useCallback((id) => {
    const normalizedId = normalizeDeckEntryId(id)
    setSelectedCards((p) => {
      const next = { ...p }
      const current = Number(next[normalizedId] || 0)
      const updated = current - 1
      if (updated <= 0) delete next[normalizedId]
      else next[normalizedId] = updated
      return next
    })
  }, [])

  const addLand = useCallback((id) =>
    setSelectedLands((p) => applyDeckEntries(p, { [id]: 1 }, DECK_LIMITS.lands)), [])

  const removeLand = useCallback((id) => {
    const normalizedId = normalizeDeckEntryId(id)
    setSelectedLands((p) => {
      const next = { ...p }
      const current = Number(next[normalizedId] || 0)
      const updated = current - 1
      if (updated <= 0) delete next[normalizedId]
      else next[normalizedId] = updated
      return next
    })
  }, [])

  const clearDeck = useCallback(() => {
    setSelectedCards({})
    setSelectedLands({})
  }, [])

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
