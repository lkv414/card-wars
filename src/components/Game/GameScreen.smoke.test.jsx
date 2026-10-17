import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const isGameWsConfigured = vi.fn(() => true)

vi.mock('../../utils/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { version: 1 }, error: null }),
    })),
  },
}))

vi.mock('../../utils/guestId', () => ({
  getGuestId: () => 'guest-test',
}))

vi.mock('../../utils/guestSession', () => ({
  ensureGuestId: vi.fn(async () => {}),
}))

vi.mock('../../utils/gameWebSocket', () => ({
  isGameWsConfigured: () => isGameWsConfigured(),
  isGameWsEnabled: () => isGameWsConfigured(),
  getGameWsBaseUrl: () => 'http://127.0.0.1:8787',
}))

vi.mock('../../hooks/useLands', () => ({
  useLands: () => ({ lands: [] }),
}))

vi.mock('../../hooks/useCatalog', () => ({
  useCatalog: () => ({ rows: [], loading: false, error: null, source: null, reload: vi.fn() }),
}))

vi.mock('../../hooks/useGameTransport', () => ({
  useGameTransport: () => ({
    enabled: true,
    status: 'connecting',
    sendActionAsync: vi.fn(),
  }),
  wsConnectionLabel: (s) => s,
}))

vi.mock('../../hooks/game', () => ({
  useGameAction: () => ({
    playCard: vi.fn(),
    attack: vi.fn(),
    drawCard: vi.fn(),
    flipCard: vi.fn(),
    discardFromZone: vi.fn(),
    endTurn: vi.fn(),
    forfeit: vi.fn(),
    isApplying: false,
    actionError: null,
  }),
}))

vi.mock('../../hooks/game/useLandSetup', () => ({
  useLandSetup: () => ({
    reorderLands: vi.fn(),
    confirmLandSetup: vi.fn(),
  }),
}))

vi.mock('../GameBoard3D', () => ({
  default: () => <div data-testid="game-board">board</div>,
}))

import { GameScreen } from './GameScreen.jsx'

function renderGame(gameId = 'game-1') {
  return render(
    <MemoryRouter initialEntries={[`/game/${gameId}`]}>
      <Routes>
        <Route path="/game/:gameId" element={<GameScreen />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('GameScreen smoke', () => {
  beforeEach(() => {
    isGameWsConfigured.mockReturnValue(true)
  })

  it('shows loading while waiting for WS state', () => {
    renderGame()
    expect(screen.getByRole('status')).toHaveTextContent(/загружаем игру/i)
  })

  it('shows alert when VITE_GAME_WS_URL is missing', async () => {
    isGameWsConfigured.mockReturnValue(false)
    renderGame()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/VITE_GAME_WS_URL/i)
    })
  })
})
