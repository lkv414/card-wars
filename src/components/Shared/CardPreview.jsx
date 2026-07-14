import { useEffect, useRef } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { CARD_TYPES, LAND_TYPES } from '../../constants/game'

export function CardPreview({ card, isLand = false, open, onClose }) {
  const dialogRef = useRef(null)
  useFocusTrap(open && !!card, dialogRef)

  useEffect(() => {
    if (!open || !card) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      // Topmost overlay: close preview only, not the parent DeckModal/Modal.
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onClose?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, card, onClose])

  if (!open || !card) return null

  const landMeta = isLand ? null : LAND_TYPES[card.land_type]
  const typeLabel = isLand ? 'Земля' : CARD_TYPES[card.card_type] || card.card_type

  return (
    <div className="preview-overlay" onMouseDown={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={card.name}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="preview-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>

        <div className="preview-layout">
          <div
            className="preview-art"
            style={card.image_url ? { backgroundImage: `url("${card.image_url}")` } : undefined}
          >
            {!card.image_url && <span className="preview-art-fallback">Нет изображения</span>}
          </div>

          <div className="preview-meta">
            <h2 className="preview-name">{card.name}</h2>
            {!isLand && card.card_number != null && (
              <p className="preview-sub">#{card.card_number}</p>
            )}

            <div className="preview-badges">
              <span className="badge badge-preview">{typeLabel}</span>
              {!isLand && landMeta && (
                <span className="badge badge-land">
                  {landMeta.icon} {landMeta.label}
                </span>
              )}
              {!isLand && card.is_rainbow && <span className="badge badge-rainbow">Радужная</span>}
              {!isLand && card.has_flip && <span className="badge badge-flip">Флип</span>}
            </div>

            {!isLand && (
              <div className="preview-stats">
                <span>💧 {card.cost}</span>
                {card.card_type === 'creature' && (
                  <>
                    <span>⚔️ {card.attack}</span>
                    <span>❤️ {card.health}</span>
                  </>
                )}
              </div>
            )}

            {!isLand && card.description && (
              <p className="preview-description">{card.description}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
