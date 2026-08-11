import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { DECK_LIMITS } from '../../constants/game'
import { normalizeDeckEntryId } from '../../utils/deckState'

const { cards: CARD_LIMITS, lands: LAND_LIMITS } = DECK_LIMITS
const ZOOM_SCALE = 2.85
const ZOOM_SCALE_COMPACT = 3.1
const EDGE_PAD = 4

function getZoomBounds(el) {
  const library = el.closest('.deck-library')
  const pad = EDGE_PAD

  if (!library) {
    const grid = el.closest('.cards-grid')
    if (!grid) return null
    const r = grid.getBoundingClientRect()
    return { left: r.left + pad, right: r.right - pad, top: r.top + pad, bottom: r.bottom - pad }
  }

  const lib = library.getBoundingClientRect()
  const toolbar = library.querySelector('.library-toolbar')
  const dock = el.closest('.deck-builder')?.querySelector('.deck-dock')

  let top = lib.top + pad
  if (toolbar) {
    top = Math.max(top, toolbar.getBoundingClientRect().bottom + pad)
  }

  let bottom = lib.bottom - pad
  if (dock) {
    const dockTop = dock.getBoundingClientRect().top
    if (Number.isFinite(dockTop)) {
      bottom = Math.min(bottom, dockTop - pad)
    }
  }

  return {
    left: lib.left + pad,
    right: lib.right - pad,
    top,
    bottom,
  }
}

function clampOrigin(min, max, preferred = 0.5) {
  if (min <= max) return Math.max(min, Math.min(max, preferred))
  // Не хватает места с обеих сторон — прижимаем к ближайшему краю
  return Math.abs(min - preferred) <= Math.abs(max - preferred) ? min : max
}

/** Смещает origin при полном zoom, чтобы карта целиком влезала в контейнер библиотеки */
function computeZoomOrigin(el, scale) {
  const r = el.getBoundingClientRect()
  const bounds = getZoomBounds(el)
  if (!bounds || scale <= 1) return '50% 50%'

  const W = r.width
  const H = r.height
  const denomX = W * (1 - scale)
  const denomY = H * (1 - scale)

  let ox = 0.5
  let oy = 0.5

  if (denomX !== 0) {
    const oxMin = (bounds.right - r.left - W * scale) / denomX
    const oxMax = (bounds.left - r.left) / denomX
    ox = clampOrigin(oxMin, oxMax, 0.5)
    ox = Math.max(0, Math.min(1, ox))
  }

  if (denomY !== 0) {
    const oyMin = (bounds.bottom - r.top - H * scale) / denomY
    const oyMax = (bounds.top - r.top) / denomY
    oy = clampOrigin(oyMin, oyMax, 0.5)
    oy = Math.max(0, Math.min(1, oy))
  }

  return `${ox * 100}% ${oy * 100}%`
}

const ZONE_RATIO = 0.30

export const CardTile = memo(function CardTile({
  item,
  isLand = false,
  onClick,
  selectedCards,
  addCard,
  removeCard,
  cardTotal,
  showControls = true,
  onBlockedAdd,
  compact = false,
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const [zoomOrigin, setZoomOrigin] = useState('50% 50%')
  const tileRef = useRef(null)
  const scrollCleanupRef = useRef(null)

  const normalizedId = normalizeDeckEntryId(item.id)
  const quantity = selectedCards
    ? selectedCards[item.id] || selectedCards[normalizedId] || 0
    : 0

  const isLandCard = isLand || (!!item.name && !item.card_type)
  const hasImage = item.image_url && !imageFailed
  const artOnly = hasImage && !isLandCard
  const zoomScale = compact ? ZOOM_SCALE_COMPACT : ZOOM_SCALE

  const updateZoomOrigin = useCallback(() => {
    if (!tileRef.current || !artOnly) return
    setZoomOrigin(computeZoomOrigin(tileRef.current, zoomScale))
  }, [artOnly, zoomScale])

  useEffect(
    () => () => {
      scrollCleanupRef.current?.()
    },
    []
  )

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

  const releaseFocus = (el) => {
    if (el && typeof el.blur === 'function') el.blur()
  }

  const handleMouseEnter = () => {
    if (!artOnly || !tileRef.current) return
    updateZoomOrigin()

    scrollCleanupRef.current?.()
    const library = tileRef.current.closest('.deck-library')
    if (!library) return

    const onScroll = () => updateZoomOrigin()
    library.addEventListener('scroll', onScroll, { passive: true })
    scrollCleanupRef.current = () => library.removeEventListener('scroll', onScroll)
  }

  const handleMouseLeave = () => {
    scrollCleanupRef.current?.()
    scrollCleanupRef.current = null
  }

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
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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
            src={item.image_url}
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
        <>
          {hasImage ? (
            <img
              src={item.image_url}
              alt=""
              className="card-tile-img"
              loading="lazy"
              decoding="async"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="card-tile-fallback" aria-hidden="true" />
          )}
        </>
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
          <div className="card-tile-top">
            <h4 className="card-tile-name">{item.name}</h4>
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

          {legacyControls}
        </div>
      )}
    </article>
  )
})
