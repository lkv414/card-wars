import { memo, useCallback, useState } from 'react'
import { useArtTileZoom } from '../../hooks/useArtTileZoom'
import { CARD_ZOOM_SCALE, CARD_ZOOM_SCALE_COMPACT } from '../../utils/cardZoom'
import { getDeckTileBlockReason } from '../../utils/deckTileLimits'
import { normalizeDeckEntryId } from '../../utils/deckState'
import { getCardType, getCardImageUrl, getCardCost, getCardAttack, getCardHealth } from '../../utils/cardFields.ts'
import { STAT_ICONS } from '../../utils/cardFaceModel.js'
import { CardFace } from './CardFace'

const ZONE_RATIO = 0.30

function releaseFocus(el) {
  el?.blur?.()
}

export const CardTile = memo(function CardTile({
  item,
  isLand = false,
  onClick,
  selectedCards,
  addCard,
  removeCard,
  selectionTotal,
  showControls = true,
  onBlockedAdd,
  compact = false,
}) {
  const [imageFailed, setImageFailed] = useState(false)

  const normalizedId = normalizeDeckEntryId(item.id)
  const quantity = selectedCards
    ? selectedCards[item.id] || selectedCards[normalizedId] || 0
    : 0

  // Тип карты, арт и статы — только через нормализацию (cardFields), иначе
  // плитка колоды отличалась бы от той же карты в руке и в админке.
  const isLandCard = isLand || (!!item.name && !getCardType(item))
  const imageUrl = getCardImageUrl(item)
  const hasImage = Boolean(imageUrl) && !imageFailed
  const artOnly = hasImage && !isLandCard
  const zoomScale = compact ? CARD_ZOOM_SCALE_COMPACT : CARD_ZOOM_SCALE

  const { tileRef, zoomOrigin, onMouseEnter, onMouseLeave } = useArtTileZoom(artOnly, zoomScale)

  const blockReason = getDeckTileBlockReason({ isLandCard, quantity, selectionTotal })
  const disabled = Boolean(blockReason)

  const tryAdd = useCallback(() => {
    if (disabled) {
      onBlockedAdd?.(blockReason)
      return
    }
    addCard?.(item.id)
  }, [addCard, blockReason, disabled, item.id, onBlockedAdd])

  const tryRemove = useCallback(() => {
    if (quantity > 0) removeCard?.(item.id)
  }, [item.id, quantity, removeCard])

  const handleArtClick = (event) => {
    const tile = event.currentTarget
    const rect = tile.getBoundingClientRect()
    const yRatio = (event.clientY - rect.top) / rect.height

    if (quantity > 0 && yRatio <= ZONE_RATIO) {
      tryRemove()
      releaseFocus(tile)
      return
    }

    if (onClick) {
      onClick(item)
      releaseFocus(tile)
      return
    }

    if (addCard) tryAdd()
    releaseFocus(tile)
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === '+') {
      event.preventDefault()
      if (onClick) onClick(item)
      else if (addCard) tryAdd()
      releaseFocus(event.currentTarget)
      return
    }

    if ((event.key === '-' || event.key === '_') && quantity > 0) {
      event.preventDefault()
      tryRemove()
      releaseFocus(event.currentTarget)
    }
  }

  const legacyControls =
    showControls && addCard && removeCard && !artOnly ? (
      <div className="card-tile-buttons">
        {quantity > 0 && (
          <>
            <button
              type="button"
              className="card-remove-btn"
              title="Убрать карту"
              aria-label="Убрать карту"
              onClick={(e) => {
                e.stopPropagation()
                tryRemove()
              }}
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
          onClick={(e) => {
            e.stopPropagation()
            tryAdd()
          }}
        >
          ＋
        </button>
      </div>
    ) : null

  return (
    <article
      ref={tileRef}
      className={[
        'card-tile',
        addCard || onClick ? 'card-tile-clickable' : '',
        quantity > 0 ? 'card-tile-selected' : '',
        compact ? 'card-tile-compact' : '',
        hasImage ? 'card-tile-has-art' : '',
        artOnly ? 'card-tile-art-only' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={artOnly ? (e) => e.preventDefault() : undefined}
      onClick={artOnly ? handleArtClick : undefined}
      onKeyDown={handleKeyDown}
      tabIndex={artOnly ? -1 : 0}
      role="button"
      aria-label={`${item.name}${quantity ? `, в колоде ×${quantity}` : ''}. Клик — добавить, верх — убрать`}
    >
      {artOnly ? (
        <div
          className="card-tile-visual"
          style={{
            '--card-zoom-scale': zoomScale,
            '--card-zoom-origin': zoomOrigin,
          }}
        >
          <img
            src={imageUrl}
            alt=""
            className="card-tile-img"
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
          {quantity > 0 && (
            <div className="card-tile-zone card-tile-zone--remove" aria-hidden="true" />
          )}
          <div className="card-tile-zone card-tile-zone--add" aria-hidden="true" />
          {quantity > 0 && (
            <span className="card-tile-qty-badge" aria-hidden="true">
              ×{quantity}
            </span>
          )}
        </div>
      ) : (
        // Единый рендер карты: имя, стоимость, атака и здоровье берутся
        // из resolveCardFace, а не из сырых полей item (аудит §2.2).
        <CardFace
          card={item}
          mode="tile"
          cardNumber={item.card_number ?? null}
          showDescription={false}
        />
      )}

      {!artOnly && (
        <div
          className="card-tile-overlay"
          onClick={(event) => {
            if (event.target.closest('button')) return
            if (onClick) onClick(item)
            else if (addCard) tryAdd()
          }}
        >
          {legacyControls}
        </div>
      )}

      {/* Всплывающая подсказка: те же значения лица, тот же набор полей. */}
      <div className="card-tile-info" aria-hidden="true">
        <div className="card-tile-info__head">
          <span className="card-tile-info__name">{item.name}</span>
          {!isLandCard && (
            <span className="card-tile-info__cost">
              {STAT_ICONS.cost} {getCardCost(item)}
            </span>
          )}
        </div>
        {item.description && <p className="card-tile-info__desc">{item.description}</p>}
        {!isLandCard && getCardType(item) === 'creature' && (
          <div className="card-tile-info__stats">
            <span>{STAT_ICONS.attack} {getCardAttack(item) ?? '—'}</span>
            <span>{STAT_ICONS.health} {getCardHealth(item) ?? '—'}</span>
          </div>
        )}
      </div>
    </article>
  )
})
