import { useCallback, useEffect, useRef, useState } from 'react'
import { computeZoomOrigin } from '../utils/cardZoom'

/**
 * Edge-aware zoom origin for art-only deck tiles.
 * Recalculates on hover and while scrolling the library panel.
 */
export function useArtTileZoom(enabled, scale) {
  const tileRef = useRef(null)
  const scrollCleanupRef = useRef(null)
  const [zoomOrigin, setZoomOrigin] = useState('50% 50%')

  const updateZoomOrigin = useCallback(() => {
    if (!tileRef.current || !enabled) return
    setZoomOrigin(computeZoomOrigin(tileRef.current, scale))
  }, [enabled, scale])

  useEffect(
    () => () => {
      scrollCleanupRef.current?.()
    },
    []
  )

  const onMouseEnter = useCallback(() => {
    if (!enabled || !tileRef.current) return
    updateZoomOrigin()

    scrollCleanupRef.current?.()
    const library = tileRef.current.closest('.deck-library')
    if (!library) return

    const onScroll = () => updateZoomOrigin()
    library.addEventListener('scroll', onScroll, { passive: true })
    scrollCleanupRef.current = () => library.removeEventListener('scroll', onScroll)
  }, [enabled, updateZoomOrigin])

  const onMouseLeave = useCallback(() => {
    scrollCleanupRef.current?.()
    scrollCleanupRef.current = null
  }, [])

  return { tileRef, zoomOrigin, onMouseEnter, onMouseLeave }
}
