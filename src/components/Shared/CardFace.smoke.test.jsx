import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { CardFace } from './CardFace'
import { CardDisplay } from './CardDisplay'
import { LAND_DEFS } from '../../constants/landColors.js'

const CREATURE = {
  id: 'c1',
  card_number: 42,
  name: 'Кукузебра-попрыгунья',
  card_type: 'creature',
  cost: 2,
  attack: 3,
  health: 8,
  land_type: 'corn',
  description: 'Прыгает.',
  image_url: 'art.png',
}

function modeOf(node) {
  return node.getAttribute('class').match(/card-face--(\w+)/)?.[1]
}

describe('CardFace — один рендер карты для всех мест', () => {
  it('рендерит имя, стоимость, атаку и здоровье', () => {
    render(<CardFace card={CREATURE} />)
    expect(screen.getByText('Кукузебра-попрыгунья')).toBeTruthy()
    expect(screen.getByTitle('Стоимость').textContent).toContain('2')
    expect(screen.getByTitle('Атака').textContent).toContain('3')
    expect(screen.getByTitle('Здоровье').textContent).toContain('8')
  })

  it('скрывает атаку/здоровье у строений и заклинаний', () => {
    const { rerender } = render(<CardFace card={{ ...CREATURE, card_type: 'building' }} />)
    expect(screen.queryByTitle('Атака')).toBeNull()
    rerender(<CardFace card={{ ...CREATURE, card_type: 'spell' }} />)
    expect(screen.queryByTitle('Атака')).toBeNull()
  })

  it('одинаково рендерит карту при известном и неотображённом типе земли', () => {
    const { container: known } = render(<CardFace card={{ ...CREATURE, land_type: 'corn' }} />)
    const { container: unknown } = render(<CardFace card={{ ...CREATURE, land_type: 'cute' }} />)

    // Один и тот же набор узлов карты при обоих типах земли: неизвестный тип
    // меняет только рамку и добавляет предупреждение, но не структуру лица.
    const structural = (c) =>
      c.querySelectorAll(
        '.card-face-name, .card-face-stats, .card-face-stat, .card-face-type-badge',
      ).length
    expect(structural(unknown)).toBe(structural(known))

    // но предупреждение о данных появляется только у неизвестного типа
    expect(unknown.querySelector('.card-face-warn')).not.toBeNull()
    expect(known.querySelector('.card-face-warn')).toBeNull()
  })

  it('ставит рамку из справочника земель', () => {
    const { container } = render(<CardFace card={{ ...CREATURE, land_type: 'corn' }} />)
    const root = container.querySelector('.card-face')
    expect(root.style.getPropertyValue('--card-face-land-border')).toBe(LAND_DEFS.corn.cssBorder)
  })

  it('универсальная карта (is_rainbow) получает рамку any', () => {
    const { container } = render(
      <CardFace card={{ ...CREATURE, land_type: 'rainbow', is_rainbow: true }} />,
    )
    const root = container.querySelector('.card-face')
    expect(root.style.getPropertyValue('--card-face-land-border')).toBe(LAND_DEFS.any.cssBorder)
  })

  it('показывает боевое значение при баффе от механики', () => {
    render(<CardFace card={{ ...CREATURE, attack: 3, attack_bonus: 2 }} />)
    const atk = screen.getByTitle('Атака')
    expect(atk.textContent).toContain('5')
    expect(atk.className).toContain('card-face-stat--buffed')
  })

  it('не падает на мусоре и пустой карте', () => {
    const { container } = render(<CardFace card={{}} />)
    expect(container.querySelector('.card-face')).not.toBeNull()
    expect(screen.getByText('— без названия —')).toBeTruthy()
  })

  it('перевёрнутая карта помечается', () => {
    const { container } = render(<CardFace card={{ ...CREATURE, flipped: true }} />)
    expect(container.querySelector('.card-face--flipped')).not.toBeNull()
  })

  it('mode=hand показывает только арт и стоимость', () => {
    const { container } = render(<CardFace card={CREATURE} mode="hand" />)
    const node = container.querySelector('.card-face')
    expect(modeOf(node)).toBe('hand')
    expect(node.querySelector('.card-face-cost').textContent).toBe('2')
    expect(node.querySelector('.card-face-stats')).toBeNull()
  })

  it('mode=full показывает описание, землю и флип', () => {
    render(
      <CardFace
        card={{ ...CREATURE, has_flip: true, flip_description: 'ПРИЁМ: прыгнуть' }}
        mode="full"
        showDescription
      />,
    )
    expect(screen.getByText('Прыгает.')).toBeTruthy()
    expect(screen.getByText(/ПРИЁМ: прыгнуть/)).toBeTruthy()
    // подпись земли приходит из справочника (Ф3)
    const land = document.querySelector('.card-face-land')
    expect(land.textContent).toContain(LAND_DEFS.corn.label)
  })
})

describe('CardDisplay — обёртка над CardFace', () => {
  it('рендерит ту же разметку, что и CardFace в том же режиме', () => {
    const { container: viaDisplay } = render(<CardDisplay card={CREATURE} mode="tile" />)
    const { container: viaFace } = render(<CardFace card={CREATURE} mode="tile" />)

    const shape = (c) => c.querySelectorAll('.card-face *').length
    expect(shape(viaDisplay)).toBe(shape(viaFace))
    expect(viaDisplay.querySelector('.card-face')).not.toBeNull()
    expect(modeOf(viaDisplay.querySelector('.card-face'))).toBe('tile')
  })
})