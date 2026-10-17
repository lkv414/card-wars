/**
 * GameExperience — слой «атмосферы» 3D-сцены: свет, туман, стол, камера.
 *
 * Что изменилось по PERFORMANCE_AUDIT_3D.md (🔴 Критично):
 *
 *  1. Убран `<Environment preset="city" />`. Он тащил potsdamer_platz_1k.hdr
 *     (~1.7 МБ) с внешнего CDN `raw.githack.com`, а так как внутри useLoader —
 *     подвешивал Suspense, чей `fallback={null}` в GameCanvas размонтировал
 *     ВСЮ сцену на время загрузки (в сетях без доступа к CDN — навсегда).
 *     Сцена плоская и почти вся матовая (metalness ≤ 0.1), поэтому IBL давал
 *     визуально мало. Заменён на связку ambient + hemisphere + directional,
 *     которая не требует ни сети, ни PMREM.
 *
 *  2. Убран `castShadow` — в проекте нет ни одного объекта, отбрасывающего
 *     тень, так что shadow pass был чистым расходом.
 *
 *  3. Туман сдвинут так, чтобы он реально работал: камера стоит в ~6.6 юнитах
 *     от центра, игровое поле — в диапазоне 6.2–8.8, дальний край стола —
 *     ~13.6. Прежние near=18/far=40 не затуманивали вообще ничего, но
 *     компилировали USE_FOG во все материалы. Теперь near=10/far=24: поле
 *     не тронуто, край стола мягко уходит в фон (skills/threejs-scenes:
 *     «fog color should harmonize with background»).
 *
 *  4. AdaptiveCamera дёргает invalidate() — в frameloop="demand" прямая
 *     мутация камеры минует R3F-реконсилятор и сама по себе не вызывает рендер.
 */
/* eslint-disable react-hooks/immutability -- camera/controls mutations are standard R3F practice */
import { useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'

import {
  computeBoardCameraDistance,
  getBoardCenter,
} from '../../../utils/gameObjectPlacement'
import { TableDecor } from './TableDecor'
import { PostProcessing } from './PostProcessing'

const FOG_COLOR = '#3d4f5f'
const FOG_NEAR = 10
const FOG_FAR = 24

/** Стабильная цель OrbitControls — новый массив в пропсах ломает memo. */
const ORBIT_TARGET = getBoardCenter()

/**
 * Подгоняет камеру под размер viewport — поле всегда по центру и в кадре.
 */
function AdaptiveCamera({ playerIndex, playerCount, controlsRef }) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)

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
    const newFar = Math.max(60, dist * 4)
    if (camera.far !== newFar) camera.far = newFar
    camera.updateProjectionMatrix()

    const controls = controlsRef?.current
    if (controls) {
      controls.target.set(tx, ty, tz)
      controls.minDistance = dist * 0.55
      controls.maxDistance = dist * 1.45
      controls.update()
    }

    // Мутация камеры в обход реконсилятора — будим рендер вручную.
    invalidate?.()
  }, [camera, size.width, size.height, playerIndex, playerCount, controlsRef, invalidate])

  return null
}

/**
 * GameExperience — корневой 3D-контент внутри Canvas.
 */
export function GameExperience({ playerIndex, playerCount, controlsRef, children }) {
  return (
    <>
      <color attach="background" args={['#2d5a27']} />

      {/* Освещение без IBL: ambient + hemisphere как «заполняющий» свет,
          один directional как ключевой. Никакой сети и никакого PMREM. */}
      <ambientLight intensity={0.7} />
      <hemisphereLight args={['#e8eef2', '#4a3728', 0.75]} />
      <directionalLight position={[4, 6, 3]} intensity={1.6} />
      <pointLight position={[0, 5, 2]} intensity={0.3} color="#fff5e6" distance={14} decay={2} />

      <TableDecor playerCount={playerCount} />

      <AdaptiveCamera
        playerIndex={playerIndex}
        playerCount={playerCount}
        controlsRef={controlsRef}
      />

      <OrbitControls
        ref={controlsRef}
        target={ORBIT_TARGET}
        enablePan={false}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={Math.PI / 2.05}
      />

      {children}

      {/* Пост-обработка: Bloom + Vignette + ToneMapping */}
      <PostProcessing />
    </>
  )
}

export default GameExperience
