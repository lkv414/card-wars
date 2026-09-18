/**
 * GameObject — 3D-карта на столе (land area) или в руке.
 *
 * Что изменилось по PERFORMANCE_AUDIT_3D.md (🔴 Критично K3+K4):
 *
 *  1. Геометрия больше не создаётся в JSX: используем шаренную CARD_PLANE.
 *     −~180 BufferGeometry.
 *
 *  2. Текстура — композитная CanvasTexture (art + cost/atk/hp/land/flip overlays),
 *     из `useCardCompositeTexture`. Один mesh + один материал на карту = 1 draw call.
 *     −58 troika <Text>, −3-4 mesh-индикатора на карту, −SDF-атласы (20–60 МБ VRAM).
 *
 *  3. `side={THREE.FrontSide}` на лицевой стороне. Камера всегда сверху, backface
 *     не виден — DoubleSide был чистым ×2 по fragment-стоимости.
 *
 *  4. useFrame не делает работу в покое: skip когда flatOnTable + нет
 *     hover/isSelected/isFlipped/damageFlash.
 *
 *  5. Багфикс: при выключении damageFlash группа возвращается в базовую позицию,
 *     а не остаётся со сдвигом от последнего shake-кадра.
 */
import { memo, useRef, useEffect, useState, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import { Outlines } from '@react-three/drei'
import * as THREE from 'three'

import {
  CARD_PLANE,
} from '../../../utils/sceneResources'
import { useCardCompositeTexture } from '../../../utils/cardCompositeTexture'

const PLACEHOLDER_COLOR = '#5d4e8a'
const SELECTION_COLOR = '#fbbf24'
const CARD_FACE_DOWN_COLOR = '#1a1a2e'

function getCardMatProps(texture) {
  return {
    map: texture || undefined,
    color: texture ? '#ffffff' : PLACEHOLDER_COLOR,
    roughness: 0.7,
    metalness: 0.1,
    side: THREE.FrontSide,
  }
}

/**
 * GameObject — единая 3D-карта.
 */
export const GameObject = memo(function GameObject({
  card,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  flatOnTable = false,
  tableScale = 1,
  isFaceUp = true,
  isSelected = false,
  isFlipped = false,
  showStats = false,
  showFlipOption = false,
  damageFlash = false,
  onClick,
}) {
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef(null)
  const matRef = useRef(null)
  const damageStartRef = useRef(0)

  // Композитная текстура: art + overlays статов. Один draw call вместо ~7-8.
  const compositeTexture = useCardCompositeTexture(card, {
    showStats,
    showFlipOption,
  })

  const baseX = position[0]
  const baseY = position[1]
  const baseZ = position[2]
  const baseRotZ = isFlipped ? Math.PI / 2 : rotation[2]
  const baseScale = isSelected ? tableScale * 1.04 : tableScale
  const rotX = rotation[0]
  const rotY = rotation[1]

  const handleClick = useCallback((e) => onClick?.(card, e), [onClick, card])
  const handlePointerOver = useCallback((e) => {
    e.stopPropagation()
    if (!flatOnTable) setHovered(true)
    document.body.style.cursor = onClick ? 'pointer' : 'default'
  }, [flatOnTable, onClick])
  const handlePointerOut = useCallback(() => {
    if (!flatOnTable) setHovered(false)
    document.body.style.cursor = 'default'
  }, [flatOnTable])

  // Инициализация + сброс при смене position/rotation/scale/isFlipped/isSelected.
  useEffect(() => {
    const g = groupRef.current
    if (!g) return
    g.position.set(baseX, baseY, baseZ)
    g.rotation.set(rotX, rotY, baseRotZ)
    g.scale.set(baseScale, baseScale, baseScale)
    if (matRef.current) matRef.current.emissive.setRGB(0, 0, 0)
  }, [baseX, baseY, baseZ, rotX, rotY, baseRotZ, baseScale])

  // damageFlash: фиксируем время старта. При выключении — useEffect выше сбрасывает.
  useEffect(() => {
    if (damageFlash) damageStartRef.current = performance.now()
  }, [damageFlash])

  useFrame(() => {
    const g = groupRef.current
    if (!g) return

    if (flatOnTable) {
      if (damageFlash) {
        const elapsed = performance.now() - damageStartRef.current
        const t = Math.min(elapsed / 600, 1)
        const shake = Math.sin(t * Math.PI * 4) * 0.05 * (1 - t)
        g.position.x = baseX + shake
        g.position.z = baseZ + shake * 0.5
        if (matRef.current) {
          const intensity = (1 - t) * 1.4
          matRef.current.emissive.setRGB(intensity, 0, 0)
        }
      }
      return
    }

    // Hover/bounce-ветка — зарезервирована для будущего hand-режима.
    const targetY = baseY + (isSelected ? 0.25 : hovered ? 0.15 : 0)
    g.position.y += (targetY - g.position.y) * 0.15
    if (!hovered && !isSelected) {
      const t = performance.now() * 0.001
      g.position.y += Math.sin(t * 1.5) * 0.02
    }
    const baseScaleAnim = isSelected ? 1.1 : 1.0
    const t = performance.now() * 0.001
    const bounce = hovered ? 1 + Math.sin(t * 8) * 0.05 : 0
    const s = baseScaleAnim + bounce
    g.scale.set(s, s, s)
    g.rotation.z = isFlipped ? Math.PI / 2 : 0
  })

  if (!isFaceUp) {
    return (
      <group
        ref={groupRef}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <mesh>
          <primitive object={CARD_PLANE} attach="geometry" />
          <meshStandardMaterial color={CARD_FACE_DOWN_COLOR} roughness={0.85} metalness={0.05} />
        </mesh>
        {isSelected && <Outlines thickness={0.04} color={SELECTION_COLOR} />}
      </group>
    )
  }

  return (
    <group
      ref={groupRef}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      <mesh>
        <primitive object={CARD_PLANE} attach="geometry" />
        <meshStandardMaterial
          ref={matRef}
          {...getCardMatProps(compositeTexture)}
        />
      </mesh>
      {isSelected && <Outlines thickness={0.04} color={SELECTION_COLOR} />}
    </group>
  )
})

export default GameObject