export function Toasts({ toasts }) {
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.type}`} key={toast.id}>
          {toast.text}
        </div>
      ))}
    </div>
  )
}
