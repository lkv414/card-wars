import { useState } from 'react'
import { normalizeDeckEntryId } from '../../utils/deckState'

export function CardTile({
  item,
  isLand = false,
  onClick,
  selectedCards,
  addCard,
  removeCard,
  cardTotal,
  showControls = true,
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const normalizedId = normalizeDeckEntryId(item.id)
  const quantity = selectedCards
    ? selectedCards[item.id] || selectedCards[normalizedId] || 0
    : 0

  const isLandCard = isLand || (!!item.name && !item.card_type)
  const hasImage = item.image_url && !imageFailed
  const disabled = isLandCard ? false : quantity >= 3 || cardTotal >= 40

  const handleClick = (event) => {
    if (event.target.closest('button')) return
    onClick?.(item)
  }

  const handleAdd = (event) => {
    event.stopPropagation()
    addCard?.(item.id)
  }

  const handleRemove = (event) => {
    event.stopPropagation()
    removeCard?.(item.id)
  }

  return (
    <article
      className={`card-tile${onClick ? ' card-tile-clickable' : ''}${quantity > 0 ? ' card-tile-selected' : ''}`}
      style={hasImage ? { backgroundImage: `url("${item.image_url}")` } : undefined}
      onClick={handleClick}
    >
      {hasImage && (
        <img
          src={item.image_url}
          alt=""
          className="card-tile-preload"
          onError={() => setImageFailed(true)}
        />
      )}

      <div className="card-tile-overlay">
        <div className="card-tile-top">
          <h4 className="card-tile-name">{item.name}</h4>
          {!isLandCard && <span className="card-tile-number">#{item.card_number}</span>}
        </div>

        {!isLandCard && item.description && (
          <p className="card-tile-description">{item.description}</p>
        )}

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
              title={disabled ? 'Максимум карт' : 'Добавить'}
              disabled={disabled}
              onClick={handleAdd}
            >
              ＋
            </button>
          </div>
        )}
      </div>
    </article>
  )
}
