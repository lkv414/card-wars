import { useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import {
  computeBoardCameraDistance,
  calculateCameraPosition,
  getBoardLookAtTarget,
  PLAY_FIELD_Y,
} from './layout'

export const CAMERA_FOV = 42

/**
 * Подгоняет камеру под размер viewport — поле всегда по центру и в кадре.
 */
export function AdaptiveBoardCamera({ playerIndex, playerCount, controlsRef }) {
  const { camera, size } = useThree()

  useLayoutEffect(() => {
    const aspect = size.width / Math.max(size.height, 1)
    const dist = computeBoardCameraDistance(aspect, CAMERA_FOV, 1.12)
    const [tx, ty, tz] = getBoardLookAtTarget()

    if (playerCount === 2 && playerIndex >= 0) {
      const zSign = playerIndex === 0 ? 1 : -1
      camera.position.set(tx, ty + dist * 0.74, tz + zSign * dist * 0.58)
    } else if (playerIndex >= 0 && playerCount >= 3) {
      const [cx, cy, cz] = calculateCameraPosition(playerIndex, playerCount, aspect, CAMERA_FOV)
      camera.position.set(cx, cy, cz)
    } else {
      camera.position.set(tx, ty + dist * 0.8, tz + dist * 0.65)
    }

    camera.lookAt(tx, ty, tz)
    camera.fov = CAMERA_FOV
    camera.near = 0.1
    camera.far = Math.max(80, dist * 4)
    camera.updateProjectionMatrix()

    const controls = controlsRef?.current
    if (controls) {
      controls.target.set(tx, ty, tz)
      controls.minDistance = dist * 0.55
      controls.maxDistance = dist * 1.45
      controls.update()
    }
  }, [camera, size.width, size.height, playerIndex, playerCount, controlsRef])

  return null
}

export { PLAY_FIELD_Y }
