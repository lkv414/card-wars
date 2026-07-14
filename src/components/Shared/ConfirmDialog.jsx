import { useEffect, useRef } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
  onConfirm,
  onCancel,
}) {
  const dialogRef = useRef(null)
  useFocusTrap(open, dialogRef)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      // Topmost dialog wins over stacked modals (e.g. CardForm Modal).
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onCancel?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="confirm-overlay" onMouseDown={onCancel} role="presentation">
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        {message && (
          <p id="confirm-message" className="confirm-message">
            {message}
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'confirm-ok danger' : 'confirm-ok'}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
