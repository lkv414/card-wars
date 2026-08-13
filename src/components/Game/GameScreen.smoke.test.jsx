import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mockRpc = vi.fn()

vi.mock('../../utils/supabase', () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { version: 1 }, error: null }),
    })),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}))

vi.mock('../../utils/guestId', () => ({
  getGuestId: () => 'guest-test',
}))

vi.mock('../../utils/guestSession', () => ({
  ensureGuestId: vi.fn(async () => {}),
}))

vi.mock('../../hooks/useLands', () => ({
  useLands: () => ({ lands: [] }),
}))

vi.mock('../../hooks/useCards', () => ({
  useCards: () => ({ cards: [], loading: false }),
}))

vi.mock('../../hooks/useAblyChannel', () => ({
  useAblyChannel: () => 'connected',
}))

vi.mock('../../hooks/useGameTransport', () => ({
  useGameTransport: () => ({
    enabled: false,
    status: 'disabled',
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
    mockRpc.mockReset()
  })

  it('shows loading while game fetch is in flight', async () => {
    mockRpc.mockReturnValue(new Promise(() => {}))

    renderGame()
    expect(screen.getByRole('status')).toHaveTextContent(/загружаем игру/i)
  })

  it('shows error when game fetch fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB down' } })

    renderGame()
    await waitFor(() => {
      expect(screen.getByRole('main')).toHaveTextContent('DB down')
    })
  })
})
