import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../context/AdminAuthContext', () => ({
  useAdminAuth: () => ({ signOut: vi.fn() }),
}))

vi.mock('../hooks/useCardArt', () => ({
  useCardArt: () => ({
    rows: [],
    loading: false,
    addArt: vi.fn(),
    setPrimary: vi.fn(),
    removeArt: vi.fn(),
  }),
}))

import { AdminPanel } from './AdminPanel.jsx'

const sampleCards = [
  {
    id: '1',
    card_number: 1,
    name: 'Test Creature',
    card_type: 'creature',
    cost: 2,
    attack: 3,
    health: 4,
    image_url: '',
    land_type: 'corn',
    has_flip: false,
    mechanics: [],
  },
  {
    id: '2',
    card_number: 2,
    name: 'Rainbow Land',
    card_type: 'land',
    cost: 0,
    land_type: 'any',
    is_rainbow: true,
    image_url: '',
    has_flip: false,
    mechanics: [],
  },
]

function renderAdmin(cards = sampleCards) {
  const toast = vi.fn()
  return {
    toast,
    ...render(
      <MemoryRouter>
        <AdminPanel
          cards={cards}
          toast={toast}
          createCard={vi.fn()}
          updateCard={vi.fn()}
          deleteCard={vi.fn()}
          findSimilarCards={vi.fn(async () => [])}
        />
      </MemoryRouter>,
    ),
  }
}

describe('AdminPanel smoke', () => {
  it('renders catalog header and card count', () => {
    renderAdmin()
    expect(screen.getByRole('heading', { name: /каталог карт/i })).toBeInTheDocument()
    expect(screen.getByText('2 карт')).toBeInTheDocument()
  })

  it('filters cards by search query', () => {
    renderAdmin()
    fireEvent.click(screen.getByRole('button', { name: /фильтры/i }))
    fireEvent.change(screen.getByLabelText(/поиск/i), { target: { value: 'Rainbow' } })
    expect(screen.getByText('Rainbow Land')).toBeInTheDocument()
    expect(screen.queryByText('Test Creature')).not.toBeInTheDocument()
  })
})
