export function normalizeDeckEntryId(value) {
  return String(value ?? '').trim().toLowerCase()
}

export const DECK_SELECTION_STORAGE_KEY = 'deckSelection'

export function loadDeckSelection() {
  try {
    const raw = localStorage.getItem(DECK_SELECTION_STORAGE_KEY)
    if (!raw) return { selectedCards: {}, selectedLands: {}, heroId: null, editingDeckId: null }
    const parsed = JSON.parse(raw)
    return {
      selectedCards: parsed.selectedCards || {},
      selectedLands: parsed.selectedLands || {},
      heroId: parsed.heroId ?? null,
      editingDeckId: parsed.editingDeckId ?? null,
    }
  } catch {
    return { selectedCards: {}, selectedLands: {}, heroId: null, editingDeckId: null }
  }
}

/**
 * Сохраняет текущий выбор карт/земель + метаданные (герой, редактируемая колода).
 * meta-поля при отсутствии в аргументах сохраняют прежние значения из хранилища.
 */
export function saveDeckSelection(selectedCards, selectedLands, meta = {}) {
  const previous = readStoredSelection()
  localStorage.setItem(
    DECK_SELECTION_STORAGE_KEY,
    JSON.stringify({
      selectedCards,
      selectedLands,
      heroId: meta.heroId !== undefined ? meta.heroId : previous.heroId ?? null,
      editingDeckId:
        meta.editingDeckId !== undefined ? meta.editingDeckId : previous.editingDeckId ?? null,
    })
  )
}

function readStoredSelection() {
  try {
    return JSON.parse(localStorage.getItem(DECK_SELECTION_STORAGE_KEY)) || {}
  } catch {
    return {}
  }
}

export function sumDeckQuantities(entries) {
  if (!entries || typeof entries !== 'object') return 0
  return Object.values(entries).reduce((sum, qty) => sum + (Number(qty) || 0), 0)
}

export function findByDeckEntryId(list, id) {
  const normalized = normalizeDeckEntryId(id)
  return list?.find((item) => normalizeDeckEntryId(item.id) === normalized)
}

export function applyDeckEntries(existingEntries = {}, incomingEntries = {}, options = {}) {
  const { maxPerEntry = 3, maxTotal = 40 } = options
  const normalizedExisting = Object.entries(existingEntries || {}).reduce((acc, [id, quantity]) => {
    const normalizedId = normalizeDeckEntryId(id)
    const safeQuantity = Number(quantity) || 0
    if (!normalizedId || safeQuantity <= 0) return acc
    acc[normalizedId] = Number(acc[normalizedId] || 0) + safeQuantity
    return acc
  }, {})

  const normalizedIncoming = Object.entries(incomingEntries || {}).reduce((acc, [id, quantity]) => {
    const normalizedId = normalizeDeckEntryId(id)
    const safeQuantity = Number(quantity) || 0
    if (!normalizedId || safeQuantity <= 0) return acc
    acc[normalizedId] = Number(acc[normalizedId] || 0) + safeQuantity
    return acc
  }, {})

  const nextEntries = { ...normalizedExisting }
  let totalQuantity = Object.values(nextEntries).reduce((sum, quantity) => sum + Number(quantity || 0), 0)
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.debug('[deckState] applyDeckEntries', {
      existingEntriesJson: JSON.stringify(existingEntries),
      normalizedExisting,
      incomingEntriesJson: JSON.stringify(incomingEntries),
      normalizedIncoming,
      maxPerEntry,
      maxTotal,
    })
  }

  for (const [entryId, quantity] of Object.entries(normalizedIncoming)) {
    const safeQuantity = Number(quantity) || 0
    if (safeQuantity <= 0) continue

    const currentQuantity = Number(nextEntries[entryId] || 0)
    const remainingPerEntry = Math.max(0, maxPerEntry - currentQuantity)
    const remainingTotal = Math.max(0, maxTotal - totalQuantity)
    const toAdd = Math.min(safeQuantity, remainingPerEntry, remainingTotal)

    if (toAdd > 0) {
      nextEntries[entryId] = currentQuantity + toAdd
      totalQuantity += toAdd
    }
  }

  const result = Object.fromEntries(Object.entries(nextEntries).filter(([, quantity]) => Number(quantity) > 0))
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    try {
      console.debug('[deckState] applyDeckEntries result', {
        resultJson: JSON.stringify(result),
        totalQuantity,
      })
    } catch {
      console.debug('[deckState] applyDeckEntries result (non-serializable)', { totalQuantity })
    }
  }

  return result
}
