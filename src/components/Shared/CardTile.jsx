import { memo, useState } from 'react'
import { DECK_LIMITS } from '../../constants/game'
import { normalizeDeckEntryId } from '../../utils/deckState'

const { cards: CARD_LIMITS, lands: LAND_LIMITS } = DECK_LIMITS

export const CardTile = memo(function CardTile({
  item,
  isLand = false,
  onClick,
  selectedCards,
  addCard,
  removeCard,
  cardTotal,
  showControls = true,
  onPreview,
  onBlockedAdd,
  compact = false,
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const normalizedId = normalizeDeckEntryId(item.id)
  const quantity = selectedCards
    ? selectedCards[item.id] || selectedCards[normalizedId] || 0
    : 0

  const isLandCard = isLand || (!!item.name && !item.card_type)
  const hasImage = item.image_url && !imageFailed

  const blockReason = (() => {
    if (isLandCard) {
      if (cardTotal >= LAND_LIMITS.maxTotal) return `В колоде уже ${LAND_LIMITS.maxTotal} земли`
      return null
    }
    if (quantity >= CARD_LIMITS.maxPerEntry) return `Максимум ${CARD_LIMITS.maxPerEntry} копии этой карты`
    if (cardTotal >= CARD_LIMITS.maxTotal) return `Колода полна (${CARD_LIMITS.maxTotal} карт)`
    return null
  })()

  const disabled = Boolean(blockReason)

  const tryAdd = () => {
    if (disabled) {
      onBlockedAdd?.(blockReason)
      return
    }
    addCard?.(item.id)
  }

  const handleTileActivate = (event) => {
    if (event.target.closest('button')) return
    if (onClick) {
      onClick(item)
      return
    }
    if (addCard) tryAdd()
  }

  const handleKeyDown = (event) => {
    if (event.target.closest('button')) return

    if (event.key === 'Enter' || event.key === '+') {
      event.preventDefault()
      if (onClick) onClick(item)
      else if (addCard) tryAdd()
      return
    }

    if ((event.key === '-' || event.key === '_') && quantity > 0) {
      event.preventDefault()
      removeCard?.(item.id)
      return
    }

    if (event.key === 'i' || event.key === 'I' || event.key === ' ') {
      if (event.key === ' ') event.preventDefault()
      onPreview?.(item, isLandCard)
    }
  }

  const handleAdd = (event) => {
    event.stopPropagation()
    tryAdd()
  }

  const handleRemove = (event) => {
    event.stopPropagation()
    removeCard?.(item.id)
  }

  const handlePreview = (event) => {
    event.stopPropagation()
    onPreview?.(item, isLandCard)
  }

  return (
    <article
      className={[
        'card-tile',
        addCard || onClick ? 'card-tile-clickable' : '',
        quantity > 0 ? 'card-tile-selected' : '',
        compact ? 'card-tile-compact' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={hasImage ? { backgroundImage: `url("${item.image_url}")` } : undefined}
      onClick={handleTileActivate}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`${item.name}${quantity ? `, в колоде ×${quantity}` : ''}. Enter — добавить, − — убрать, I — превью`}
    >
      {hasImage && (
        <img
          src={item.image_url}
          alt=""
          className="card-tile-preload"
          onError={() => setImageFailed(true)}
        />
      )}

      {onPreview && (
        <button
          type="button"
          className="card-preview-btn"
          title="Превью"
          aria-label={`Превью: ${item.name}`}
          onClick={handlePreview}
        >
          ℹ
        </button>
      )}

      <div className="card-tile-overlay">
        <div className="card-tile-top">
          <h4 className="card-tile-name">{item.name}</h4>
          {!isLandCard && !compact && (
            <span className="card-tile-number">#{item.card_number}</span>
          )}
        </div>

        {!isLandCard && (
          <div className="card-tile-stats">
            <span>💧 {item.cost}</span>
            {item.card_type === 'creature' && (
              <span>
                · ⚔️ {item.attack} · ❤️ {item.health}
              </span>
            )}
          </div>
        )}

        {showControls && addCard && removeCard && (
          <div className="card-tile-buttons">
            {quantity > 0 && (
              <>
                <button
                  type="button"
                  className="card-remove-btn"
                  title="Убрать карту"
                  aria-label="Убрать карту"
                  onClick={handleRemove}
                >
                  −
                </button>
                <span className="card-qty">×{quantity}</span>
              </>
            )}
            <button
              type="button"
              className="card-add-btn"
              title={disabled ? blockReason : 'Добавить'}
              aria-label={disabled ? blockReason : 'Добавить карту'}
              aria-disabled={disabled}
              onClick={handleAdd}
            >
              ＋
            </button>
          </div>
        )}
      </div>
    </article>
  )
})
