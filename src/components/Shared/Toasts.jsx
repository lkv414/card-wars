export function Toasts({ toasts, onDismiss }) {
  if (!toasts?.length) return null

  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions text">
      {toasts.map((toast) => (
        <div
          className={`toast toast-${toast.type}`}
          key={toast.id}
          role={toast.type === 'error' ? 'alert' : 'status'}
        >
          <span className="toast-text">{toast.text}</span>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Закрыть уведомление"
            onClick={() => onDismiss?.(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
