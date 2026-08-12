import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useToasts } from './hooks/useToasts'
import { ensureGuestId } from './utils/guestSession'
import { isSupabaseConfigured } from './utils/supabase'
import { LibraryProvider } from './context/LibraryContext'
import { AdminAuthProvider } from './context/AdminAuthContext'
import { DeckBuilderPage, AdminPanelPage } from './pages/LibraryPages'
import { AdminRoute } from './components/admin/AdminRoute'
import { AdminLogin } from './components/admin/AdminLogin'
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

function SupabaseConfigMissing() {
  return (
    <div className="game-loading" role="alert">
      <h1>Card Wars</h1>
      <p>
        Не заданы переменные <code>VITE_SUPABASE_URL</code> и{' '}
        <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> для production-сборки.
      </p>
      <p>
        Добавьте их в Cloudflare Pages → Settings → Environment variables (Production) или
        закоммитьте <code>.env.production</code> с publishable key.
      </p>
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

  if (!isSupabaseConfigured) {
    return <SupabaseConfigMissing />
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<MainMenu />} />

        <Route path="/decks" element={<DeckList />} />

        <Route element={<LibraryProvider><Outlet /></LibraryProvider>}>
          <Route path="/deck" element={<DeckBuilderPage toast={toast} />} />
        </Route>

        <Route element={<AdminAuthProvider><Outlet /></AdminAuthProvider>}>
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route element={<AdminRoute />}>
            <Route
              path="/admin"
              element={
                <LibraryProvider>
                  <AdminPanelPage toast={toast} />
                </LibraryProvider>
              }
            />
          </Route>
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
