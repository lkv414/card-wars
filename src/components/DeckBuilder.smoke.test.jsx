import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../hooks/useHeroes', () => ({
  useHeroes: () => ({ heroes: [], loading: false }),
}))

vi.mock('../hooks/useDecks', () => ({
  useDecks: () => ({
    addDeck: vi.fn(),
    updateDeckContents: vi.fn(),
    getDeckById: vi.fn(() => null),
  }),
}))

vi.mock('../hooks/useDeckSave', () => ({
  useDeckSave: () => ({
    saveDialogOpen: false,
    saveStep: 'form',
    saveName: '',
    setSaveName: vi.fn(),
    savedDeck: null,
    codeCopied: false,
    updateExisting: false,
    setUpdateExisting: vi.fn(),
    closeSaveDialog: vi.fn(),
    handleSaveDeck: vi.fn(),
    handleConfirmSave: vi.fn(),
    handleCopySavedCode: vi.fn(),
  }),
}))

import { DeckBuilder } from './DeckBuilder.jsx'

const cards = [
  {
    id: 'c1',
    card_number: 1,
    name: 'Тестовое существо',
    card_type: 'creature',
    cost: 2,
    attack: 3,
    health: 4,
    land_type: 'corn',
    image_url: '',
    has_flip: false,
    mechanics: [],
  },
]

const lands = []

function renderBuilder(props = {}) {
  const toast = vi.fn()
  return {
    toast,
    ...render(
      <MemoryRouter>
        <DeckBuilder
          cards={cards}
          lands={lands}
          loadingLibrary={false}
          libraryError={null}
          toast={toast}
          {...props}
        />
      </MemoryRouter>,
    ),
  }
}

describe('DeckBuilder smoke', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('рендерит заголовок и библиотеку карт', () => {
    renderBuilder()
    expect(screen.getByRole('heading', { name: /редактор колод/i })).toBeInTheDocument()
    expect(screen.getAllByText('Тестовое существо').length).toBeGreaterThan(0)
  })

  it('показывает счётчики карт и земель', () => {
    renderBuilder()
    const stats = screen.getByLabelText('Прогресс колоды')
    expect(within(stats).getByText('Карты')).toBeInTheDocument()
    expect(within(stats).getByText('Земли')).toBeInTheDocument()
  })

  it('переключает раздел библиотеки на земли', () => {
    renderBuilder()
    fireEvent.click(screen.getByRole('tab', { name: 'Земли' }))
    expect(screen.getByRole('tab', { name: 'Земли' })).toHaveAttribute('aria-selected', 'true')
  })

  it('док действий скрыт, пока колода пустая', () => {
    renderBuilder()
    expect(screen.queryByRole('toolbar', { name: /действия с колодой/i })).toBeNull()
  })
})
