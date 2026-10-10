/**
 * CardDisplay — универсальный компонент для отображения карты.
 *
 * Используется в:
 * - Редакторе колод (DeckBuilder, DeckModal)
 * - Админке (AdminPanel)
 * - Игре (CardPreviewModal, HUDHand)
 *
 * Режимы отображения:
 * - 'tile' — компактная плитка для сетки
 * - 'full' — полный предпросмотр с описанием
 * - 'hand' — карта в руке (только изображение + стоимость)
 */
import { memo, useState } from 'react'
import { getCardCost, getCardAttack, getCardHealth } from '../../utils/cardFields.ts'
import { CARD_TYPES, LAND_TYPES } from '../../constants/game'

const TYPE_CLASS = {
  creature: 'badge-creature',
  building: 'badge-building',
  spell: 'badge-spell',
}

export const CardDisplay = memo(function CardDisplay({
  card,
  mode = 'tile',
  onClick,
  selected = false,
  showDescription = false,
  imageFailed: externalImageFailed,
  onImageError,
}) {
  const [internalImageFailed, setInternalImageFailed] = useState(false)
  const imageFailed = externalImageFailed ?? internalImageFailed

  const cost = getCardCost(card)
  const attack = getCardAttack(card)
  const health = getCardHealth(card)
  const hasImage = card.image_url && !imageFailed
  const land = LAND_TYPES[card.land_type] || LAND_TYPES.any

  const handleImageError = () => {
    setInternalImageFailed(true)
    onImageError?.()
  }

  // Режим 'hand' — только изображение + стоимость
  if (mode === 'hand') {
    return (
      <div
        className={`card-display card-display--hand${selected ? ' card-display--selected' : ''}${onClick ? ' card-display--clickable' : ''}`}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        {hasImage ? (
          <img
            src={card.image_url}
            alt=""
            className="card-display-img"
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={handleImageError}
          />
        ) : (
          <div className="card-display-fallback">
            <span>{card.name || 'Карта'}</span>
          </div>
        )}
        <span className="card-display-cost">{cost}</span>
      </div>
    )
  }

  // Режим 'tile' — компактная плитка
  if (mode === 'tile') {
    return (
      <div
        className={`card-display card-display--tile${selected ? ' card-display--selected' : ''}${onClick ? ' card-display--clickable' : ''}`}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        <div className="card-display-visual">
          {hasImage ? (
            <img
              src={card.image_url}
              alt=""
              className="card-display-img"
              loading="lazy"
              decoding="async"
              onError={handleImageError}
            />
          ) : (
            <div className="card-display-fallback">
              <span>{land.icon}</span>
            </div>
          )}
          <span className="card-display-type">{CARD_TYPES[card.card_type] || card.card_type}</span>
        </div>
        <div className="card-display-info">
          <h4 className="card-display-name">{card.name || '— без названия —'}</h4>
          <div className="card-display-stats">
            <span>💧 {cost}</span>
            {card.card_type === 'creature' && (
              <>
                <span>⚔️ {attack ?? '—'}</span>
                <span>❤️ {health ?? '—'}</span>
              </>
            )}
          </div>
          {showDescription && card.description && (
            <p className="card-display-desc">{card.description}</p>
          )}
        </div>
      </div>
    )
  }

  // Режим 'full' — полный предпросмотр
  return (
    <div className={`card-display card-display--full${onClick ? ' card-display--clickable' : ''}`}>
      <div className="card-display-full">
        <div className="card-display-full-img">
          {hasImage ? (
            <img
              src={card.image_url}
              alt=""
              className="card-display-img"
              loading="lazy"
              decoding="async"
              onError={handleImageError}
            />
          ) : (
            <div className="card-display-fallback">
              <span>{land.icon}</span>
            </div>
          )}
        </div>
        <div className="card-display-full-info">
          <h3 className="card-display-name">{card.name || '— без названия —'}</h3>
          <div className="card-display-stats">
            <span>💧 {cost}</span>
            {card.card_type === 'creature' && (
              <>
                <span>⚔️ {attack ?? '—'}</span>
                <span>❤️ {health ?? '—'}</span>
              </>
            )}
          </div>
          <div className="card-display-meta">
            <span className={`badge ${TYPE_CLASS[card.card_type] || ''}`}>
              {CARD_TYPES[card.card_type] || card.card_type}
            </span>
            <span className="card-display-land">
              {land.icon} {land.label}
            </span>
          </div>
          {card.description && (
            <p className="card-display-desc">{card.description}</p>
          )}
          {card.flip_description && (
            <p className="card-display-flip">
              <strong>Флюп:</strong> {card.flip_description}
            </p>
          )}
        </div>
      </div>
    </div>
  )
})
