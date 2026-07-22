import { useEffect } from 'react'
import { useCards } from './hooks/useCards'
import { useLands } from './hooks/useLands'
import { useToasts } from './hooks/useToasts'
import { usePathname, navigate, matchPath, ROUTES } from './router'
import './App.css'

import { MainMenu } from './components/MainMenu'
import { DeckBuilder } from './components/DeckBuilder'
import { AdminPanel } from './components/AdminPanel'
import { LobbyScreen } from './components/Lobby/LobbyScreen'
import { Toasts } from './components/Shared/Toasts'

function isKnownRoute(pathname) {
  if (pathname === ROUTES.menu) return true
  if (pathname === ROUTES.deck) return true
  if (pathname === ROUTES.admin) return true
  if (pathname === ROUTES.lobby) return true
  if (matchPath(ROUTES.lobbyRoom, pathname)) return true
  return false
}

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
    if (!isKnownRoute(pathname)) {
      navigate(ROUTES.menu, { replace: true })
    }
  }, [pathname])

  const lobbyRoomParams = matchPath(ROUTES.lobbyRoom, pathname)
  const isLobbyRoute = pathname === ROUTES.lobby || lobbyRoomParams !== null

  return (
    <>
      {pathname === ROUTES.menu && <MainMenu onJoin={() => navigate(ROUTES.lobby)} toast={toast} />}

      {isLobbyRoute && (
        <LobbyScreen
          initialCode={lobbyRoomParams?.code ?? null}
          toast={toast}
        />
      )}

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
