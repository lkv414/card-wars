import { useCallback, useState } from 'react'

export function useToasts() {
  const [toasts, setToasts] = useState([])

  const toast = useCallback((type, text) => {
    const id = crypto.randomUUID()
    setToasts((p) => [...p, { id, type, text }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000)
  }, [])

  return { toasts, toast }
}

