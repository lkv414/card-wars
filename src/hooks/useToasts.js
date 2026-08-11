import { useCallback, useEffect, useRef, useState } from 'react'

const TOAST_TTL_MS = 4000

export function useToasts() {
  const [toasts, setToasts] = useState([])
  const timeoutsRef = useRef(new Map())

  useEffect(() => {
    const timeouts = timeoutsRef.current
    return () => {
      for (const id of timeouts.keys()) {
        window.clearTimeout(timeouts.get(id))
      }
      timeouts.clear()
    }
  }, [])

  const dismissToast = useCallback((id) => {
    const timeoutId = timeoutsRef.current.get(id)
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
      timeoutsRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((type, text) => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, type, text }])
    const timeoutId = window.setTimeout(() => {
      timeoutsRef.current.delete(id)
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, TOAST_TTL_MS)
    timeoutsRef.current.set(id, timeoutId)
  }, [])

  return { toasts, toast, dismissToast }
}
