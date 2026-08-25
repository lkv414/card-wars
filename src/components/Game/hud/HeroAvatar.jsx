/**
 * HeroAvatar — аватарка героя с hover-эффектом:
 *   - scale 1.0 → 1.08 на hover
 *   - затемнение оверлеем
 *   - всплывающий текст (имя + описание) снизу/сбоку
 *
 * Используется:
 *   - в HUDOverlay игрового экрана (левый нижний угол)
 *   - в DeckList / DeckModal (мелкий бейдж с tooltip)
 */

import { useState } from 'react'

export function HeroAvatar({
  hero,
  size = 96,
  position = 'bottom-left',
  className = '',
}) {
  const [hovered, setHovered] = useState(false)

  if (!hero) return null

  const name = hero.name || 'Герой'
  const description = hero.description || ''

  // Контейнер позиционирования в углу + размер по умолчанию (прямоугольник 220x140)
  const isBottomLeft = position === 'bottom-left'
  const positionStyle = isBottomLeft
    ? { position: 'absolute', left: 16, bottom: 16, zIndex: 55 }
    : {}
  const finalSize = isBottomLeft
    ? { width: size === 96 ? 220 : size, height: size === 96 ? 140 : size }
    : { width: size, height: size }

  return (
    <div
      className={`hero-avatar hero-avatar--${position} ${className}`}
      style={{
        ...positionStyle,
        ...finalSize,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      tabIndex={0}
      role="img"
      aria-label={`Герой: ${name}`}
    >
      <div className={`hero-avatar-frame ${hovered ? 'is-hovered' : ''}`}>
        <div className="hero-avatar-placeholder-rect">
          <span className="hero-avatar-placeholder-name">{name}</span>
          {description && hovered && (
            <span className="hero-avatar-placeholder-desc">{description}</span>
          )}
        </div>
        <div className="hero-avatar-overlay" aria-hidden />
        <div className="hero-avatar-name">{name}</div>
      </div>
    </div>
  )
}