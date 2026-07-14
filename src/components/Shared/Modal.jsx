import { useEffect, useRef } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

export function Modal({ children, onClose, stacked = false }) {
  const dialogRef = useRef(null)
  useFocusTrap(true, dialogRef)

  useEffect(() => {
    // Bubble phase so nested overlays (Confirm/Preview) can handle Esc first in capture.
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={`modal-overlay ${stacked ? 'modal-overlay-stacked' : ''}`}
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
