import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useBackNavigation, useNavigateWithOrigin } from './useBackNavigation'

function Screen({ fallback, label, to }) {
  const back = useBackNavigation(fallback)
  const go = useNavigateWithOrigin()
  const loc = useLocation()
  return (
    <div>
      <div data-testid="path">{loc.pathname}</div>
      <button onClick={back}>назад</button>
      {to && <button onClick={() => go(to)}>{label}</button>}
    </div>
  )
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Screen label="в колоды" to="/decks" />} />
        <Route path="/decks" element={<Screen fallback="/" label="в редактор" to="/deck" />} />
        <Route path="/deck" element={<Screen fallback="/decks" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('useBackNavigation / useNavigateWithOrigin', () => {
  it('возвращает на экран, с которого пришли', () => {
    renderAt('/')
    fireEvent.click(screen.getByText('в колоды'))
    expect(screen.getByTestId('path').textContent).toBe('/decks')
    fireEvent.click(screen.getByText('назад'))
    expect(screen.getByTestId('path').textContent).toBe('/')
  })

  it('без источника уходит на запасной маршрут', () => {
    renderAt('/deck')
    fireEvent.click(screen.getByText('назад'))
    expect(screen.getByTestId('path').textContent).toBe('/decks')
  })

  it('цепочка: меню → колоды → редактор → назад → колоды → назад → меню', () => {
    renderAt('/')
    fireEvent.click(screen.getByText('в колоды'))
    fireEvent.click(screen.getByText('в редактор'))
    expect(screen.getByTestId('path').textContent).toBe('/deck')
    fireEvent.click(screen.getByText('назад'))
    expect(screen.getByTestId('path').textContent).toBe('/decks')
    fireEvent.click(screen.getByText('назад'))
    expect(screen.getByTestId('path').textContent).toBe('/')
  })
})
