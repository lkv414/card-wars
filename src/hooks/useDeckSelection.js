import { useMemo, useState, useEffect, useCallback } from 'react'
import { DECK_LIMITS } from '../constants/game'
import {
  applyDeckEntries,
  loadDeckSelection,
  normalizeDeckEntryId,
  saveDeckSelection,
} from '../utils/deckState'
import { validateDeck } from '../utils/deckValidation'

function decrementEntry(setter, id) {
  const normalizedId = normalizeDeckEntryId(id)
  setter((prev) => {
    const next = { ...prev }
    const current = Number(next[normalizedId] || 0)
    const updated = current - 1
    if (updated <= 0) delete next[normalizedId]
    else next[normalizedId] = updated
    return next
  })
}

export function useDeckSelection() {
  const initial = useMemo(() => loadDeckSelection(), [])
  const [selectedCards, setSelectedCards] = useState(initial.selectedCards)
  const [selectedLands, setSelectedLands] = useState(initial.selectedLands)
  const [heroId, setHeroId] = useState(initial.heroId)
  const [editingDeckId, setEditingDeckId] = useState(initial.editingDeckId)

  useEffect(() => {
    saveDeckSelection(selectedCards, selectedLands, { heroId, editingDeckId })
  }, [selectedCards, selectedLands, heroId, editingDeckId])

  /** Сбросить признак «редактируем существующую колоду» (после сохранения) */
  const clearEditingDeck = useCallback(() => {
    setEditingDeckId(null)
  }, [])

  const { cardTotal, landTotal, errors, warnings } = useMemo(
    () => validateDeck(selectedCards, selectedLands),
    [selectedCards, selectedLands]
  )

  const addCard = useCallback(
    (id) => setSelectedCards((p) => applyDeckEntries(p, { [id]: 1 }, DECK_LIMITS.cards)),
    []
  )

  const removeCard = useCallback((id) => decrementEntry(setSelectedCards, id), [])

  const addLand = useCallback(
    (id) => setSelectedLands((p) => applyDeckEntries(p, { [id]: 1 }, DECK_LIMITS.lands)),
    []
  )

  const removeLand = useCallback((id) => decrementEntry(setSelectedLands, id), [])

  const loadSelection = useCallback((cards, lands) => {
    setSelectedCards(cards || {})
    setSelectedLands(lands || {})
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
    loadSelection,
    heroId,
    setHeroId,
    editingDeckId,
    clearEditingDeck,
    cardTotal,
    landTotal,
    errors,
    warnings,
  }
}
