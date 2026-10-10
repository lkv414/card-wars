/**
 * GameLand — земля игрока (Lane) на 3D-доске.
 *
 * Что изменилось по PERFORMANCE_AUDIT_3D.md (🔴 Критично):
 *   - Все геометрии — модульные из sceneResources.js (CARD_PLANE, LAND_PLANE, ...).
 *     Раньше каждый SlotPad создавал свой <planeGeometry args=[...]>.
 *   - Базовый материал — общий MeshStandardMaterial на уровне модуля (нет 8 разных).
 *   - Принимает `onClick` (а не только `onLandClick`) — раньше GameBoard3D передавал
 *     onClick, а GameLand деструктурировал onLandClick → клики по земле не работали.
 *   - SlotPad регистрирует playable-слоты через `registerPlayableSlot` →
 *     `placementRaycast.js` больше не делает `scene.traverse()` на каждый drop.
 *   - Не рендерит SlotPad (opacity 0.03), когда playable=false и нет dropState —
 *     это убирает ~16 прозрачных quad'ов с blend-стоимостью в покое.
 */
/**
 * GameLand — земля игрока (Lane) на 3D-доске.
 * Обводки вынесены в BoardOutlines (InstancedMesh). SlotPad регистрирует playable-слоты через registerPlayableSlot.
 */
import { memo, useMemo, useRef, useCallback, useEffect } from 'react'
import * as THREE from 'three'
import { Outlines } from '@react-three/drei'

import {
  getLandPalette,
  CREATURE_SLOT_COLOR,
  BUILDING_SLOT_COLOR,
} from '../../../constants/landColors'
import {
  LANE_WIDTH,
  HALF_LANE_DEPTH,
} from '../../../utils/gameObjectPlacement'
import {
  LAND_PLANE,
  LAND_SLOT_LAYOUT,
  LAND_SURFACE_Y,
} from '../../../utils/sceneResources'
import { registerPlayableSlot } from '../gameBoard3D/slotRegistry'

const ATTACK_TARGET_Y = LAND_SURFACE_Y + 0.0005

/** Material cache per landType — разделяемый между LandMat для одного типа. */
const landMaterialCache = new Map()

function getLandMaterial(palette, isSelected, dropState) {
  const key = `${palette.fill}|${isSelected}|${dropState ?? 'none'}`
  if (landMaterialCache.has(key)) return landMaterialCache.get(key)
  const color = isSelected
    ? '#fff8e1'
    : dropState === 'valid'
      ? palette.fill
      : palette.fill
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.92,
    metalness: 0,
  })
  landMaterialCache.set(key, mat)
  return mat
}

const SLOT_MATERIAL_CACHE = new Map()

function getSlotMaterial(colorKey, opacity, isInvalid = false) {
  const key = `${colorKey}|${opacity.toFixed(2)}|${isInvalid ? 'inv' : 'norm'}`
  if (SLOT_MATERIAL_CACHE.has(key)) return SLOT_MATERIAL_CACHE.get(key)
  const mat = new THREE.MeshStandardMaterial({
    color: colorKey,
    transparent: true,
    opacity,
    roughness: 1,
    depthWrite: false,
    side: THREE.FrontSide,
  })
  SLOT_MATERIAL_CACHE.set(key, mat)
  return mat
}

function LandMat({ landType, isSelected, dropState }) {
  const palette = getLandPalette(landType)
  const paletteFill = palette.fill
  const material = useMemo(
    () => getLandMaterial(palette, isSelected, dropState),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- material only depends on palette.fill, isSelected, dropState
    [paletteFill, isSelected, dropState],
  )

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, LAND_SURFACE_Y, 0]}
      matrixAutoUpdate={false}
    >
      <primitive object={LAND_PLANE} attach="geometry" />
      <primitive object={material} attach="material" />
      {isSelected && <Outlines thickness={0.05} color="#fbbf24" />}
      {dropState === 'invalid' && <Outlines thickness={0.07} color="#ff5252" />}
      {dropState === 'valid' && <Outlines thickness={0.05} color="#fff3c4" />}
    </mesh>
  )
}

/**
 * SlotPad — подслот земли. Раньше всегда рендерил полупрозрачный quad с opacity 0.03,
 * что давало 16 blend-слоёв в покое. Теперь не рендерится вообще, когда нет активности.
 * При playable/hover/dropState — рисуется и регистрируется в slotRegistry для
 * placementRaycast (вместо scene.traverse()).
 */
function SlotPad({
  slot,
  slotType,
  zoneIndex,
  playable,
  rayHovered,
  tint,
  dropState,
  onClick,
}) {
  const meshRef = useRef(null)
  const show = playable || rayHovered || Boolean(dropState)

  const isInvalid = dropState === 'invalid'
  const isValid = dropState === 'valid'
  const color = isInvalid ? '#ff5252' : tint
  const opacity = isInvalid
    ? 0.4
    : isValid
      ? 0.3
      : rayHovered
        ? 0.38
        : 0.18

  const material = useMemo(
    () => getSlotMaterial(color, opacity, isInvalid),
    [color, opacity, isInvalid],
  )

  const slotUserData = useMemo(
    () => ({ slotTarget: true, playable, zoneIndex, slotType }),
    [playable, zoneIndex, slotType],
  )

  // Регистрируем только когда playable=true (drop целится в этот слот).
  const onClickStable = useCallback((e) => {
    e.stopPropagation()
    onClick?.()
  }, [onClick])

  // Регистрируем playable-слот в slotRegistry при mount, снимаем при unmount.
  // Делаем это в эффекте (не в рендере), чтобы ref.current был уже выставлен.
  useEffect(() => {
    if (!playable || !meshRef.current) return undefined
    return registerPlayableSlot(meshRef.current)
  }, [playable, slotType, zoneIndex])

  // Hooks вызываются всегда; сам mesh рендерится только когда есть активность.
  if (!show) return null

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[slot.x, LAND_SURFACE_Y + 0.001, slot.z]}
      onClick={onClickStable}
      userData={slotUserData}
    >
      <planeGeometry args={[slot.width, slot.depth]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}

function AttackTarget({ onClick }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, ATTACK_TARGET_Y, 0]}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    >
      <planeGeometry args={[LANE_WIDTH * 0.96, HALF_LANE_DEPTH * 0.96]} />
      <meshBasicMaterial color="#ff5252" transparent opacity={0.22} depthWrite={false} side={THREE.FrontSide} />
    </mesh>
  )
}

export const GameLand = memo(function GameLand({
  landType,
  selected = false,
  isAttackTarget = false,
  creaturePlayable = false,
  buildingPlayable = false,
  creatureRayHover = false,
  buildingRayHover = false,
  dropState = null,
  zoneIndex = null,
  // Поддерживаем ОБА имени: onClick (как передаёт GameBoard3D) и onLandClick
  // (обратная совместимость с более старыми потребителями).
  onClick,
  onLandClick,
  onCreatureClick,
  onBuildingClick,
  onZoneAttackClick,
}) {
  const handleLand = useCallback(
    (e) => {
      e.stopPropagation()
      ;(onClick || onLandClick)?.()
    },
    [onClick, onLandClick],
  )

  const handleCreature = useCallback(
    (e) => {
      e.stopPropagation()
      onCreatureClick?.()
    },
    [onCreatureClick],
  )

  const handleBuilding = useCallback(
    (e) => {
      e.stopPropagation()
      onBuildingClick?.()
    },
    [onBuildingClick],
  )

  const slots = LAND_SLOT_LAYOUT

  return (
    <group>
      <LandMat landType={landType} isSelected={selected} dropState={dropState} />
      {/* Обводки — InstancedMesh в BoardOutlines (BoardScene). */}

      {/* Mesh земли — кликабельный, чтобы onLandClick/onClick работали. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, LAND_SURFACE_Y - 0.001, 0]}
        onClick={handleLand}
        matrixAutoUpdate={false}
      >
        <primitive object={LAND_PLANE} attach="geometry" />
        <meshStandardMaterial color="#ffffff" opacity={0} transparent depthWrite={false} />
      </mesh>

      {isAttackTarget && <AttackTarget onClick={onZoneAttackClick} />}

      {/* Creature slot (z<0) — существа */}
      <SlotPad
        slot={slots.creature}
        slotType="creature"
        zoneIndex={zoneIndex}
        playable={creaturePlayable}
        rayHovered={creatureRayHover}
        tint={CREATURE_SLOT_COLOR}
        dropState={dropState}
        onClick={handleCreature}
      />

      {/* Building slot (z>0) — строения */}
      <SlotPad
        slot={slots.building}
        slotType="building"
        zoneIndex={zoneIndex}
        playable={buildingPlayable}
        rayHovered={buildingRayHover}
        tint={BUILDING_SLOT_COLOR}
        dropState={dropState}
        onClick={handleBuilding}
      />
    </group>
  )
})

export default GameLand