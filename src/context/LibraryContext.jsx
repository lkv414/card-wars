import { createContext, useContext, useMemo } from 'react'
import { useCards } from '../hooks/useCards'
import { useLands } from '../hooks/useLands'

const LibraryContext = createContext(null)

export function LibraryProvider({ children }) {
  const {
    cards,
    loading: loadingCards,
    error: cardsError,
    loadCards,
    createCard,
    updateCard,
    deleteCard,
    findSimilarCards,
  } = useCards()
  const {
    lands,
    loading: loadingLands,
    error: landsError,
  } = useLands()

  const value = useMemo(
    () => ({
      cards,
      lands,
      loadingLibrary: loadingCards || loadingLands,
      libraryError: cardsError || landsError || '',
      loadCards,
      createCard,
      updateCard,
      deleteCard,
      findSimilarCards,
    }),
    [
      cards,
      lands,
      loadingCards,
      loadingLands,
      cardsError,
      landsError,
      loadCards,
      createCard,
      updateCard,
      deleteCard,
      findSimilarCards,
    ],
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
