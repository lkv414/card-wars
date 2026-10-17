import { createContext, useContext, useMemo } from 'react'
import { useCatalog } from '../hooks/useCatalog'

const LibraryContext = createContext(null)

export function LibraryProvider({ children }) {
  const { rows: cards, loading: loadingCards, error: cardsError } = useCatalog('cards')
  const { rows: lands, loading: loadingLands, error: landsError } = useCatalog('lands')

  const value = useMemo(
    () => ({
      cards,
      lands,
      loadingLibrary: loadingCards || loadingLands,
      libraryError: cardsError || landsError || '',
    }),
    [cards, lands, loadingCards, loadingLands, cardsError, landsError],
  )

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

// Hook lives with provider — shared context module
// eslint-disable-next-line react-refresh/only-export-components
export function useLibrary() {
  const ctx = useContext(LibraryContext)
  if (!ctx) {
    throw new Error('useLibrary must be used within LibraryProvider')
  }
  return ctx
}