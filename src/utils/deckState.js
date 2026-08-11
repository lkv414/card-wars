export function normalizeDeckEntryId(value) {
  return String(value ?? '').trim().toLowerCase()
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
