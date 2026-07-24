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

const STORAGE_KEY = 'decks'

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { decks: [], selectedDeckId: null }
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
  const addDeck = useCallback(({ name, selectedCards = {}, selectedLands = {} }) => {
    const newDeck = {
      id: makeId(),
      name: name?.trim() || 'Без названия',
      code: generateDeckCode(selectedCards, selectedLands),
      selectedCards: { ...selectedCards },
      selectedLands: { ...selectedLands },
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

  /** Обновить содержимое колоды (карты + земли) и пересчитать код */
  const updateDeckContents = useCallback((id, { selectedCards, selectedLands }) => {
    setDecks((prev) =>
      prev.map((d) =>
        d.id === id
          ? {
              ...d,
              selectedCards: { ...selectedCards },
              selectedLands: { ...selectedLands },
              code: generateDeckCode(selectedCards, selectedLands),
            }
          : d
      )
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
