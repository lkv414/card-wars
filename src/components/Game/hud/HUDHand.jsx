import { useMemo, useRef } from 'react'
import { getLandCardBorder } from '../../../constants/landColors'
import { getCardCost } from '../../../utils/cardFields.ts'

/**
 * HUDHand — карты в руке игрока (внизу экрана, вне Canvas).
 * Дедупликация по instanceId/id защищает от duplicate-key warnings
 * когда WS-push и после-оптимистичный reload временно дублируют карту.
 */
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
  onPreviewCard,
  onDiscardToTrash,
  trashActive = false,
}) {
  const dragMovedRef = useRef(false)

  // Дедупликация: у каждой карты в руке должен быть уникальный instanceId.
  // Если Supabase WS-push принёс дубль — оставляем только первое вхождение.
  const uniqueHand = useMemo(() => {
    if (!Array.isArray(handCards)) return []
    const seen = new Set()
    const out = []
    for (const c of handCards) {
      if (!c) continue
      const id = c.instanceId || c.id
      if (id && seen.has(id)) continue
      if (id) seen.add(id)
      out.push(c)
    }
    return out
  }, [handCards])

  return (
    <div className="hud-hand-row">
      <div className="hud-hand" role="list" aria-label="Ваша рука">
        {uniqueHand.length > 0 ? (
          uniqueHand.map((c, idx) => {
            const isSel = selectedCardIndex === idx
            const isDragging = draggingCardIndex === idx
            const landBorder = getLandCardBorder(c?.land_type)
            const cost = getCardCost(c)
            const key = c?.instanceId || c?.id || `hand-${idx}`
            return (
              <button
                type="button"
                key={key}
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
                onContextMenu={(e) => {
                  e.preventDefault()
                  onPreviewCard?.(c)
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  onPreviewCard?.(c)
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
                aria-label={`${c?.name ?? `Карта ${idx + 1}`}, стоимость ${cost}`}
                title={`${c?.name || `Карта ${idx + 1}`} · ⚡${cost} · двойной клик — описание`}
              >
                <span className="hud-hand-card-cost" aria-hidden>⚡{cost}</span>
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

      <button
        type="button"
        className={`hud-hand-trash${trashActive ? ' active' : ''}`}
        disabled={!isYourTurn || isFinished || selectedCardIndex == null || isApplying}
        onClick={() => {
          if (selectedCardIndex != null) onDiscardToTrash?.(selectedCardIndex)
        }}
        onPointerUp={(e) => {
          if (draggingCardIndex != null && trashActive) {
            e.stopPropagation()
            onDiscardToTrash?.(draggingCardIndex)
            setDraggingCardIndex?.(null)
            setSelectedCardIndex?.(null)
          }
        }}
        title="Сбросить выбранную карту из руки"
        aria-label="Сброс карт из руки"
      >
        <span className="hud-hand-trash-icon" aria-hidden>🗑️</span>
        <span className="hud-hand-trash-label">Сброс</span>
      </button>
    </div>
  )
}