import { useEffect } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Traps focus inside containerRef while active, locks body scroll, restores focus on close.
 */
export function useFocusTrap(active, containerRef) {
  useEffect(() => {
    if (!active) return undefined

    const container = containerRef.current
    const previous = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const getFocusable = () =>
      container ? Array.from(container.querySelectorAll(FOCUSABLE)) : []

    requestAnimationFrame(() => {
      const items = getFocusable()
      items[0]?.focus()
    })

    const onKeyDown = (event) => {
      if (event.key !== 'Tab' || !container) return
      const items = getFocusable()
      if (items.length === 0) return

      const first = items[0]
      const last = items[items.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (previous && typeof previous.focus === 'function') {
        previous.focus()
      }
    }
  }, [active, containerRef])
}
