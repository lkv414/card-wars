import { normalizeDeckEntryId } from './deckState.js'

export function normalizeDeckImportMap(obj) {
  return Object.fromEntries(
    Object.entries(obj || {})
      .map(([id, qty]) => [normalizeDeckEntryId(id), Number(qty) || 0])
      .filter(([, qty]) => qty > 0)
  )
}

export { normalizeDeckEntryId }
