import { useRef } from 'react'
import { getLandCardBorder } from '../../../constants/landColors'

export function HUDHand({
  handCards,
  isYourTurn,
  isFinished,
  isApplying,
  selectedCardIndex,
  setSelectedCardIndex,
  draggingCardIndex,
  setDraggingCardIndex,
  updatePointer,
}) {
  const dragMovedRef = useRef(false)

  return (
    <div className="hud-hand" role="list" aria-label="Ваша рука">
      {Array.isArray(handCards) && handCards.length > 0 ? (
        handCards.map((c, idx) => {
          const isSel = selectedCardIndex === idx
          const isDragging = draggingCardIndex === idx
          const landBorder = getLandCardBorder(c?.land_type)
          return (
            <button
              type="button"
              key={c?.id || c?.instanceId || idx}
              className={`hud-hand-card${isSel ? ' selected' : ''}${isDragging ? ' dragging' : ''}${isYourTurn ? '' : ' disabled'}`}
              style={{ '--card-land-border': landBorder }}
              disabled={!isYourTurn || isFinished}
              onClick={(e) => {
                e.stopPropagation()
                if (dragMovedRef.current) {
                  dragMovedRef.current = false
                  return
                }
                setSelectedCardIndex(isSel ? null : idx)
              }}
              onPointerDown={(e) => {
                if (!isYourTurn || isFinished || isApplying) return
                e.stopPropagation()
                dragMovedRef.current = false
                setDraggingCardIndex(idx)
                setSelectedCardIndex(idx)
                updatePointer?.(e.clientX, e.clientY)
              }}
              onPointerMove={(e) => {
                if (draggingCardIndex !== idx) return
                dragMovedRef.current = true
                updatePointer?.(e.clientX, e.clientY)
              }}
              onPointerUp={(e) => {
                e.stopPropagation()
                setDraggingCardIndex(null)
              }}
              aria-pressed={isSel}
              aria-label={c?.name ?? `Карта ${idx + 1}`}
              title={c?.name || `Карта ${idx + 1}`}
            >
              {c?.image_url ? (
                <img
                  src={c.image_url}
                  alt=""
                  className="hud-hand-card-img"
                  draggable={false}
                />
              ) : (
                <span className="hud-hand-card-fallback">{c?.name || `Карта ${idx + 1}`}</span>
              )}
            </button>
          )
        })
      ) : (
        <div className="hud-hand-empty">Рука пуста</div>
      )}
    </div>
  )
}
