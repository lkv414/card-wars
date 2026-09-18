import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { ndcFromClient, raycastPlayableSlot } from './placementRaycast'

/**
 * На pointerup — синхронный raycast в точке курсора и постановка карты.
 */
export function PlacementPointerRelease({
  active = false,
  pointerRef,
  boardRectRef,
  cardIndexRef,
  onRelease,
}) {
  const { camera } = useThree()

  useEffect(() => {
    if (!active) return undefined

    const onUp = (e) => {
      if (e.button !== 0) return
      if (e.target?.closest?.('.hud-hand-card')) return

      const cardIdx = cardIndexRef?.current
      if (cardIdx === null || cardIdx === undefined) return

      const rect = boardRectRef?.current?.getBoundingClientRect?.()
      const ndc = ndcFromClient(e.clientX, e.clientY, rect)
      if (ndc && pointerRef) pointerRef.current = ndc

      const target = raycastPlayableSlot(camera, ndc || pointerRef?.current)
      if (!target) return

      onRelease?.(cardIdx, target)
    }

    window.addEventListener('pointerup', onUp, true)
    return () => window.removeEventListener('pointerup', onUp, true)
  }, [active, camera, pointerRef, boardRectRef, cardIndexRef, onRelease])

  return null
}
