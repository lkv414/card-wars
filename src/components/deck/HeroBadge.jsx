/**
 * HeroBadge — компактный бейдж героя с tooltip.
 *
 * Используется в DeckList и DeckModal: показывает имя героя
 * (или плейсхолдер с первой буквой), а при hover раскрывает
 * полное описание.
 */

import { useState } from 'react'

export function HeroBadge({ hero, label = null }) {
  const [hovered, setHovered] = useState(false)

  if (!hero) return null

  return (
    <span
      className="hero-badge-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      tabIndex={0}
      role="group"
      aria-label={`Герой: ${hero.name}`}
    >
      <span className="hero-badge">
        {hero.image_url ? (
          <img
            src={hero.image_url}
            alt=""
            className="hero-badge-img"
            draggable={false}
          />
        ) : (
          <span className="hero-badge--placeholder" aria-hidden>
            {hero.name?.slice(0, 1)?.toUpperCase() || '?'}
          </span>
        )}
        <span className="hero-badge-name">{label || hero.name}</span>
      </span>

      {hovered && hero.description && (
        <span className="hero-badge-tooltip" role="tooltip">
          <span className="hero-badge-tooltip-name">{hero.name}</span>
          {hero.description}
        </span>
      )}
    </span>
  )
}