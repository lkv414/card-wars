import { useEffect } from 'react'

export function Modal({ children, onClose, stacked = false }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  
  return (
    <div className={`modal-overlay ${stacked ? 'modal-overlay-stacked' : ''}`} onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
