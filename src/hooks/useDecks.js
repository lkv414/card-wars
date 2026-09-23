/**
 * useDecks
 * Хук для хранения списка колод в localStorage.
 * Параллельно с useDeckSelection (который держит текущую редактируемую колоду).
 *
 * Ключ localStorage: 'decks'
 * Структура:
 * [
 *   {
 *     id: 'deck-1734567890123',
 *     name: 'Моя колода',
 *     code: 'DK-abc123',
 *     selectedCards: { uuid: quantity },
 *     selectedLands: { uuid: quantity },
 *     selected: true,
 *     createdAt: 1734567890123
 *   }
 * ]
 *
 * Только одна колода может иметь selected: true — это «активная».
 */

import { useCallback, useEffect, useState } from 'react'
import { generateDeckCode } from '../utils/deckCode.js'
import { isOfflineTestMode } from '../utils/offlineMode'
import { TEST_DECK } from '../fixtures/testDeck'

const STORAGE_KEY = 'decks'

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return isOfflineTestMode
        ? { decks: [{ ...TEST_DECK, selected: true }], selectedDeckId: TEST_DECK.id }
        : { decks: [], selectedDeckId: null }
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.decks)) return { decks: [], selectedDeckId: null }
    return {
      decks: parsed.decks,
      selectedDeckId: parsed.selectedDeckId ?? null,
    }
  } catch {
    return { decks: [], selectedDeckId: null }
  }
}

function saveToStorage(decks, selectedDeckId) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ decks, selectedDeckId })
  )
}

function makeId() {
  return `deck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useDecks() {
  const initial = loadFromStorage()
  const [decks, setDecks] = useState(initial.decks)
  const [selectedDeckId, setSelectedDeckId] = useState(initial.selectedDeckId)

  // Сохранять в localStorage при каждом изменении
  useEffect(() => {
    saveToStorage(decks, selectedDeckId)
  }, [decks, selectedDeckId])

  /** Добавить новую колоду и сделать её активной */
  const addDeck = useCallback(({ name, selectedCards = {}, selectedLands = {}, heroId = null, description = null }) => {
    const newDeck = {
      id: makeId(),
      name: name?.trim() || 'Без названия',
      code: generateDeckCode(selectedCards, selectedLands),
      selectedCards: { ...selectedCards },
      selectedLands: { ...selectedLands },
      heroId: heroId ?? null,
      description: description ?? null,
      selected: true,
      createdAt: Date.now(),
    }
    setDecks((prev) => {
      const updated = prev.map((d) => ({ ...d, selected: false }))
      return [...updated, newDeck]
    })
    setSelectedDeckId(newDeck.id)
    return newDeck
  }, [])

  /** Удалить колоду */
  const removeDeck = useCallback((id) => {
    setDecks((prev) => prev.filter((d) => d.id !== id))
    setSelectedDeckId((current) => (current === id ? null : current))
  }, [])

  /** Выбрать колоду (снять выбор с остальных) */
  const selectDeck = useCallback((id) => {
    setDecks((prev) => prev.map((d) => ({ ...d, selected: d.id === id })))
    setSelectedDeckId(id)
  }, [])

  /** Переименовать колоду */
  const renameDeck = useCallback((id, name) => {
    setDecks((prev) =>
      prev.map((d) => (d.id === id ? { ...d, name: name.trim() || d.name } : d))
    )
  }, [])

  /** Обновить колоду целиком (имя, состав, герой, описание) и пересчитать код */
  const updateDeckContents = useCallback((id, { name, selectedCards, selectedLands, heroId, description }) => {
    setDecks((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d
        const nextCards = selectedCards ? { ...selectedCards } : d.selectedCards
        const nextLands = selectedLands ? { ...selectedLands } : d.selectedLands
        return {
          ...d,
          name: typeof name === 'string' && name.trim() ? name.trim() : d.name,
          selectedCards: nextCards,
          selectedLands: nextLands,
          code: generateDeckCode(nextCards, nextLands),
          heroId: heroId !== undefined ? heroId : d.heroId ?? null,
          description: description !== undefined ? description : d.description ?? null,
        }
      })
    )
  }, [])

  /** Найти колоду по id */
  const getDeckById = useCallback(
    (id) => decks.find((d) => d.id === id) ?? null,
    [decks]
  )

  /** Текущая выбранная колода или null */
  const getSelectedDeck = useCallback(() => {
    if (!selectedDeckId) return null
    return decks.find((d) => d.id === selectedDeckId) ?? null
  }, [decks, selectedDeckId])

  /** Очистить всё */
  const clearAll = useCallback(() => {
    setDecks([])
    setSelectedDeckId(null)
  }, [])

  return {
    decks,
    selectedDeckId,
    addDeck,
    removeDeck,
    selectDeck,
    renameDeck,
    updateDeckContents,
    getDeckById,
    getSelectedDeck,
    clearAll,
  }
}
