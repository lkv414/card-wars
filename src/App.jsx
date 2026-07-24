import { Routes, Route, Navigate } from 'react-router-dom'
import { useCards } from './hooks/useCards'
import { useLands } from './hooks/useLands'
import { useToasts } from './hooks/useToasts'
import './App.css'

import { MainMenu } from './components/MainMenu'
import { DeckBuilder } from './components/DeckBuilder'
import { AdminPanel } from './components/AdminPanel'
import { LobbyScreen } from './components/Lobby/LobbyScreen'
import { Toasts } from './components/Shared/Toasts'

function App() {
  const {
    cards,
    loading: loadingCards,
    error: cardsError,
    createCard,
    updateCard,
    deleteCard,
    findSimilarCards,
  } = useCards()
  const { lands, loading: loadingLands, error: landsError } = useLands()

  const loadingLibrary = loadingCards || loadingLands
  const libraryError = cardsError || landsError || ''

  const { toasts, toast, dismissToast } = useToasts()

  return (
    <>
      <Routes>
        <Route path="/" element={<MainMenu toast={toast} />} />

        <Route
          path="/deck"
          element={
            <DeckBuilder
              cards={cards}
              lands={lands}
              loadingLibrary={loadingLibrary}
              libraryError={libraryError}
              toast={toast}
            />
          }
        />

        <Route
          path="/admin"
          element={
            <AdminPanel
              cards={cards}
              toast={toast}
              createCard={createCard}
              updateCard={updateCard}
              deleteCard={deleteCard}
              findSimilarCards={findSimilarCards}
            />
          }
        />

        <Route
          path="/lobby"
          element={<LobbyScreen toast={toast} />}
        />

        <Route
          path="/lobby/:code"
          element={<LobbyScreen toast={toast} />}
        />

        {/* Неизвестный маршрут — на главную */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}

export default App
