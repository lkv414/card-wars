import { DeckBuilder } from '../components/DeckBuilder'
import { AdminPanel } from '../components/AdminPanel'
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

export function AdminPanelPage({ toast }) {
  const { cards, createCard, updateCard, deleteCard, findSimilarCards } = useLibrary()
  return (
    <AdminPanel
      cards={cards}
      toast={toast}
      createCard={createCard}
      updateCard={updateCard}
      deleteCard={deleteCard}
      findSimilarCards={findSimilarCards}
    />
  )
}
