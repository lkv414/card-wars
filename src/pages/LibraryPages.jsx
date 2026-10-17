import { DeckBuilder } from '../components/DeckBuilder'
import { useLibrary } from '../context/LibraryContext'

export function DeckBuilderPage({ toast }) {
  const { cards, lands, loadingLibrary, libraryError } = useLibrary()
  return (
    <DeckBuilder
      cards={cards}
      lands={lands}
      loadingLibrary={loadingLibrary}
      libraryError={libraryError}
      toast={toast}
    />
  )
}
