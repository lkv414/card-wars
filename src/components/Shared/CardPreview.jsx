import { useEffect, useRef } from 'react'

import { useFocusTrap } from '../../hooks/useFocusTrap'



export function CardPreview({ card, isLand = false, open, onClose }) {

  const dialogRef = useRef(null)

  useFocusTrap(open && !!card, dialogRef)



  useEffect(() => {

    if (!open || !card) return undefined

    const onKey = (event) => {

      if (event.key !== 'Escape') return

      event.preventDefault()

      event.stopPropagation()

      event.stopImmediatePropagation()

      onClose?.()

    }

    window.addEventListener('keydown', onKey, true)

    return () => window.removeEventListener('keydown', onKey, true)

  }, [open, card, onClose])



  if (!open || !card) return null



  return (

    <div className="preview-overlay" onMouseDown={onClose} role="presentation">

      <div

        ref={dialogRef}

        className="preview-dialog preview-dialog-art"

        role="dialog"

        aria-modal="true"

        aria-label={card.name}

        onMouseDown={(e) => e.stopPropagation()}

      >

        <button type="button" className="preview-close" onClick={onClose} aria-label="Закрыть">

          ×

        </button>



        <div className="preview-art preview-art-only">

          {card.image_url ? (

            <img

              src={card.image_url}

              alt=""

              className="preview-art-img"

              loading="lazy"

              decoding="async"

            />

          ) : (

            <div className="preview-art-fallback">

              <p className="preview-art-fallback-name">{card.name}</p>

              {!isLand && card.description && (

                <p className="preview-art-fallback-desc">{card.description}</p>

              )}

            </div>

          )}

        </div>

      </div>

    </div>

  )

}


