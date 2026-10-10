import { useMemo, useRef } from 'react'
import { getCardCost } from '../../../utils/cardFields.ts'
import { CardFace } from '../../Shared/CardFace'
// Стили карты подключаются один раз самим CardFace.

/**
 * HUDHand — карты в руке игрока (внизу экрана, вне Canvas).
 * Использует CardDisplay для единообразного отображения.
 * Дедупликация по instanceId/id защищает от duplicate-key warnings.
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
            // Рамку по земле ставит CardFace (из landColors) — раньше
            // HUDHand вычислял её сам, отдельно от остальных рендеров.
            const cost = getCardCost(c)
            const key = c?.instanceId || c?.id || `hand-${idx}`
            return (
              <div
                key={key}
                className={`hud-hand-card${isSel ? ' selected' : ''}${isDragging ? ' dragging' : ''}${isYourTurn ? '' : ' disabled'}`}
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
                role="button"
                aria-pressed={isSel}
                aria-label={`${c?.name ?? `Карта ${idx + 1}`}, стоимость ${cost}`}
                title={`${c?.name || `Карта ${idx + 1}`} · ⚡${cost} · двойной клик — описание`}
              >
                <CardFace card={c} mode="hand" />
              </div>
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