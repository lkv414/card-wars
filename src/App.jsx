import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { useToasts } from './hooks/useToasts'
import { ensureGuestId } from './utils/guestSession'
import { LibraryProvider } from './context/LibraryContext'
import { DeckBuilderPage, AdminPanelPage } from './pages/LibraryPages'
import { ErrorBoundary } from './components/Shared/ErrorBoundary'
import './App.css'

import { MainMenu } from './components/MainMenu'
import { DeckList } from './components/DeckList'
import { LobbyScreen } from './components/Lobby/LobbyScreen'
import { Toasts } from './components/Shared/Toasts'

const GameScreen = lazy(() =>
  import('./components/Game/GameScreen').then((m) => ({ default: m.GameScreen })),
)

function GameLoadingFallback({ message = 'Загружаем игру...' }) {
  return (
    <div className="game-loading" role="status" aria-live="polite">
      {message}
    </div>
  )
}

function GameRoute() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<GameLoadingFallback />}>
        <GameScreen />
      </Suspense>
    </ErrorBoundary>
  )
}

function App() {
  const { toasts, toast, dismissToast } = useToasts()

  useEffect(() => {
    ensureGuestId()
  }, [])

  return (
    <>
      <Routes>
        <Route path="/" element={<MainMenu />} />

        <Route path="/decks" element={<DeckList />} />

        <Route element={<LibraryProvider><Outlet /></LibraryProvider>}>
          <Route path="/deck" element={<DeckBuilderPage toast={toast} />} />
          <Route path="/admin" element={<AdminPanelPage toast={toast} />} />
        </Route>

        <Route path="/lobby" element={<LobbyScreen toast={toast} />} />
        <Route path="/lobby/:code" element={<LobbyScreen toast={toast} />} />

        <Route path="/game/:gameId" element={<GameRoute />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}

export default App
