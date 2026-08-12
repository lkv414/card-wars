import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'cardwars:graphics-quality'

export const GRAPHICS_QUALITY = {
  HIGH: 'high',
  LOW: 'low',
}

export function useGraphicsSettings() {
  const [quality, setQualityState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || GRAPHICS_QUALITY.HIGH
    } catch {
      return GRAPHICS_QUALITY.HIGH
    }
  })

  const setQuality = useCallback((next) => {
    setQualityState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.graphicsQuality = quality
  }, [quality])

  return {
    quality,
    setQuality,
    shadowsEnabled: quality !== GRAPHICS_QUALITY.LOW,
    textureScale: quality === GRAPHICS_QUALITY.LOW ? 0.5 : 1,
  }
}
