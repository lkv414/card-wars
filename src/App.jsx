import { useEffect } from 'react'
import { useCards } from './hooks/useCards'
import { useLands } from './hooks/useLands'
import { useToasts } from './hooks/useToasts'
import { usePathname, navigate, ROUTES } from './router'
import './App.css'

import { MainMenu } from './components/MainMenu'
import { DeckBuilder } from './components/DeckBuilder'
import { AdminPanel } from './components/AdminPanel'
import { LobbyScreen } from './components/Lobby/LobbyScreen'
import { Toasts } from './components/Shared/Toasts'

const KNOWN_ROUTES = new Set([ROUTES.menu, ROUTES.deck, ROUTES.admin, ROUTES.lobby])

function App() {
  const pathname = usePathname()

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

  useEffect(() => {
    if (!KNOWN_ROUTES.has(pathname)) {
      navigate(ROUTES.menu, { replace: true })
    }
  }, [pathname])

  const handleJoinGame = () => {
    navigate(ROUTES.lobby)
  }

  return (
    <>
      {pathname === ROUTES.menu && <MainMenu onJoin={handleJoinGame} toast={toast} />}

      {pathname === ROUTES.lobby && <LobbyScreen toast={toast} />}

      {pathname === ROUTES.deck && (
        <DeckBuilder
          cards={cards}
          lands={lands}
          loadingLibrary={loadingLibrary}
          libraryError={libraryError}
          toast={toast}
        />
      )}

      {pathname === ROUTES.admin && (
        <AdminPanel
          cards={cards}
          toast={toast}
          createCard={createCard}
          updateCard={updateCard}
          deleteCard={deleteCard}
          findSimilarCards={findSimilarCards}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}

export default App
