/**
 * GameLand — земля игрока (Lane) на 3D-столе.
 *
 * По паттерну testing_3d (SceneObject): switch(landType) → geometry + material +
 * Outlines для выбора. Включает:
 *   - LandMat: плоскость земли LANE_WIDTH × HALF_LANE_DEPTH с цветом по типу
 *   - LandOutline: тонкая оранжевая обводка по периметру (inset)
 *   - SlotPad (creature): подслот снизу, светло-зелёный подсветка
 *   - SlotPad (building): подслот сверху, светло-красный подсветка
 *   - AttackTarget: красный оверлей когда зона доступна для атаки
 *
 * Карты существ ставятся в building (нижняя половина), строения — в creature (верхняя).
 * Это потому что игрок видит поле «от себя» и размещает карты ближе к себе.
 */
import { memo, useMemo } from 'react'
import * as THREE from 'three'
import { Outlines } from '@react-three/drei'
import {
  getLandPalette,
  LAND_BORDER_COLOR,
  CREATURE_SLOT_COLOR,
  BUILDING_SLOT_COLOR,
} from '../../../constants/landColors'
import {
  LANE_WIDTH,
  HALF_LANE_DEPTH,
  getLandSlotLayout,
} from '../../../utils/gameObjectPlacement'

const LAND_SURFACE_Y = 0.002

/** Плоская земля — ровно LANE_WIDTH × HALF_LANE_DEPTH, без налезания на соседей. */
function LandMat({ landType, isSelected, dropState }) {
  const palette = getLandPalette(landType)
  const fill = useMemo(() => new THREE.Color(palette.fill), [palette.fill])

  const dropColor =
    dropState === 'invalid' ? '#ff5252' : dropState === 'valid' ? '#fff3c4' : null

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, LAND_SURFACE_Y, 0]}
      receiveShadow
    >
      <planeGeometry args={[LANE_WIDTH, HALF_LANE_DEPTH]} />
      <meshStandardMaterial
        color={isSelected ? '#fff8e1' : dropState === 'valid' ? palette.fill : fill}
        roughness={0.92}
        metalness={0}
      />
      {isSelected && <Outlines thickness={0.05} color="#fbbf24" />}
      {dropColor && <Outlines thickness={dropState === 'invalid' ? 0.07 : 0.05} color={dropColor} />}
    </mesh>
  )
}

/** Тонкая обводка только по периметру (inset), не расширяет землю. */
function LandOutline() {
  const inset = 0.018
  const w = LANE_WIDTH - inset * 2
  const d = HALF_LANE_DEPTH - inset * 2
  const lineW = 0.014

  const edges = [
    { args: [w, lineW], pos: [0, LAND_SURFACE_Y + 0.0008, -d / 2] },
    { args: [w, lineW], pos: [0, LAND_SURFACE_Y + 0.0008, d / 2] },
    { args: [lineW, d], pos: [-w / 2, LAND_SURFACE_Y + 0.0008, 0] },
    { args: [lineW, d], pos: [w / 2, LAND_SURFACE_Y + 0.0008, 0] },
  ]

  return (
    <group>
      {edges.map(({ args, pos }, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={pos}>
          <planeGeometry args={args} />
          <meshBasicMaterial color={LAND_BORDER_COLOR} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Hit-area = ровно половина земли.
 * position.z > 0 = creature-слот (ближе к игроку), position.z < 0 = building.
 */
function SlotPad({ slot, playable, rayHovered, tint, dropState, onClick }) {
  const show = playable || rayHovered || Boolean(dropState)
  const color = dropState === 'invalid' ? '#ff5252' : dropState === 'valid' ? tint : show ? tint : '#000000'

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[slot.x, LAND_SURFACE_Y + 0.001, slot.z]}
      onClick={onClick}
    >
      <planeGeometry args={[slot.width, slot.depth]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={
          dropState === 'invalid'
            ? 0.4
            : dropState === 'valid'
              ? 0.3
              : show
                ? rayHovered
                  ? 0.38
                  : 0.18
                : 0.03
        }
        roughness={1}
        depthWrite={false}
      />
    </mesh>
  )
}

/**
 * GameLand — одна зона игрока.
 *
 * Геометрия подслотов (из layout.js):
 *   - creature (z<0) — дальняя половина, существа ставятся сюда
 *   - building (z>0) — ближняя половина, строения ставятся сюда
 *
 * @param {object} props
 * @param {string|null} props.landType один из corn/ice/good/swamp/sand/blue/any
 * @param {boolean} [props.selected]
 * @param {boolean} [props.isAttackTarget] красная подсветка для атаки
 * @param {boolean} [props.creaturePlayable] слот существа принимает карту
 * @param {boolean} [props.buildingPlayable] слот строения принимает карту
 * @param {boolean} [props.creatureRayHover] наведение на creature-слот
 * @param {boolean} [props.buildingRayHover] наведение на building-слот
 * @param {'valid'|'invalid'|null} [props.dropState] подсветка при перетаскивании
 *   карты: valid — земля совпадает (цвет земли), invalid — не совпадает (красный).
 * @param {(e: any) => void} [props.onLandClick]
 * @param {(e: any) => void} [props.onCreatureClick]
 * @param {(e: any) => void} [props.onBuildingClick]
 * @param {(e: any) => void} [props.onZoneAttackClick]
 */
export const GameLand = memo(function GameLand({
  landType,
  selected = false,
  isAttackTarget = false,
  creaturePlayable = false,
  buildingPlayable = false,
  creatureRayHover = false,
  buildingRayHover = false,
  dropState = null,
  onLandClick,
  onCreatureClick,
  onBuildingClick,
  onZoneAttackClick,
}) {
  const slots = getLandSlotLayout()

  return (
    <group>
      <LandMat landType={landType} isSelected={selected} dropState={dropState} onClick={onLandClick} />
      <LandOutline />

      {/* Красная подсветка для attack-target */}
      {isAttackTarget && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, LAND_SURFACE_Y + 0.0005, 0]}
          onClick={(e) => {
            e.stopPropagation()
            onZoneAttackClick?.()
          }}
        >
          <planeGeometry args={[LANE_WIDTH * 0.96, HALF_LANE_DEPTH * 0.96]} />
          <meshBasicMaterial color="#ff5252" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}

      {/* Creature slot (z<0) — существа */}
      <SlotPad
        slot={slots.creature}
        playable={creaturePlayable}
        rayHovered={creatureRayHover}
        tint={CREATURE_SLOT_COLOR}
        dropState={dropState}
        onClick={(e) => {
          e.stopPropagation()
          if (creaturePlayable) onCreatureClick?.()
        }}
      />

      {/* Building slot (z>0) — строения */}
      <SlotPad
        slot={slots.building}
        playable={buildingPlayable}
        rayHovered={buildingRayHover}
        tint={BUILDING_SLOT_COLOR}
        dropState={dropState}
        onClick={(e) => {
          e.stopPropagation()
          if (buildingPlayable) onBuildingClick?.()
        }}
      />
    </group>
  )
})

export default GameLand