/**
 * GameExperience — слой «атмосферы» 3D-сцены.
 *
 * По паттерну testing_3d (Experience): освещение + fog + бесконечный пол +
 * IBL Environment (обязательно из-за metalness) + OrbitControls + AdaptiveCamera
 * (подгоняет позицию камеры под viewport).
 */
/* eslint-disable react-hooks/immutability -- camera/controls mutations are standard R3F practice */
import { useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'

import {
  computeBoardCameraDistance,
  getBoardCenter,
} from '../../../utils/gameObjectPlacement'
import { TableDecor } from './TableDecor'

const FOG_COLOR = '#4a5d6a'
const FOG_NEAR = 18
const FOG_FAR = 40

/**
 * Подгоняет камеру под размер viewport — поле всегда по центру и в кадре.
 * По паттерну testing_3d: чистый useLayoutEffect с одной ответственностью.
 */
function AdaptiveCamera({ playerIndex, playerCount, controlsRef }) {
  const { camera, size } = useThree()

  useLayoutEffect(() => {
    const aspect = size.width / Math.max(size.height, 1)
    const dist = computeBoardCameraDistance(aspect, camera.fov, 1.12)
    const [tx, ty, tz] = getBoardCenter()

    if (playerIndex >= 0 && playerCount === 2) {
      const zSign = playerIndex === 0 ? 1 : -1
      camera.position.set(tx, ty + dist * 0.74, tz + zSign * dist * 0.58)
    } else if (playerIndex >= 0 && playerCount >= 3) {
      const angleDeg =
        { 3: [180, 60, 300], 4: [180, 90, 0, 270] }[playerCount]?.[playerIndex] ?? 0
      const rad = (angleDeg * Math.PI) / 180
      camera.position.set(
        Math.cos(rad) * (3.1 + dist * 0.45),
        ty + dist * 0.72,
        Math.sin(rad) * (3.1 + dist * 0.45),
      )
    } else {
      camera.position.set(tx, ty + dist * 0.8, tz + dist * 0.65)
    }

    camera.lookAt(tx, ty, tz)
    const newFar = Math.max(80, dist * 4)
    if (camera.far !== newFar) camera.far = newFar
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

/**
 * GameExperience — корневой 3D-контент внутри Canvas.
 */
export function GameExperience({ playerIndex, playerCount, controlsRef, children }) {
  return (
    <>
      <color attach="background" args={['#3d4f5f']} />
      <fog attach="fog" args={[FOG_COLOR, FOG_NEAR, FOG_FAR]} />

      {/* IBL — обязателен из-за metalness на картах */}
      <Environment preset="city" />

      <ambientLight intensity={0.35} />
      <hemisphereLight args={['#e8eef2', '#4a3728', 0.5]} />
      <directionalLight
        position={[4, 6, 3]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={24}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.0002}
      />
      <pointLight position={[0, 5, 2]} intensity={0.25} color="#fff5e6" distance={14} decay={2} />

      {/* Бесконечный пол вместо кастомного PlayFieldGrid */}
      {/* Круглый деревянный стол + сукно (вместо бесконечного Grid) */}
      <TableDecor playerCount={playerCount} />

      <AdaptiveCamera
        playerIndex={playerIndex}
        playerCount={playerCount}
        controlsRef={controlsRef}
      />

      <OrbitControls
        ref={controlsRef}
        target={getBoardCenter()}
        enablePan={false}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={Math.PI / 2.05}
      />

      {children}
    </>
  )
}

export default GameExperience
