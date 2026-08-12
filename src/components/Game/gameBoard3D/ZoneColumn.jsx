import * as THREE from 'three'
import { Text } from '@react-three/drei'
import { useMemo, useEffect, useRef } from 'react'
import { EnhancedCard3DModel } from '../EnhancedCard3DModel'
import {
  computeFieldCardScale,
  getLandSlotLayout,
  HALF_LANE_DEPTH,
  LANE_WIDTH,
} from './layout'
import {
  BUILDING_SLOT_COLOR,
  CREATURE_SLOT_COLOR,
  LAND_BORDER_COLOR,
  getLandPalette,
} from '../../../constants/landColors'
import { SLOT_BUILDING, SLOT_CREATURE, splitZoneCards } from '../../../hooks/game/zoneCards'
import { registerPlayableSlot } from './slotRegistry'
import { CreatureFieldStats } from './CreatureFieldStats'

const LAND_SURFACE_Y = 0.002
const FIELD_CARD_SCALE = computeFieldCardScale(0.88)

/** Плоская земля — ровно LANE_WIDTH × HALF_LANE_DEPTH, без налезания на соседей. */
function LandMat({ landType, onClick, isSelected }) {
  const palette = getLandPalette(landType)
  const fill = useMemo(() => new THREE.Color(palette.fill), [palette.fill])

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, LAND_SURFACE_Y, 0]}
      receiveShadow
      onClick={onClick}
    >
      <planeGeometry args={[LANE_WIDTH, HALF_LANE_DEPTH]} />
      <meshStandardMaterial
        color={isSelected ? '#fff8e1' : fill}
        roughness={0.92}
        metalness={0}
        emissive={isSelected ? '#ff9800' : '#000000'}
        emissiveIntensity={isSelected ? 0.15 : 0}
      />
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

/** Hit-area = ровно половина земли, центр совпадает с центром карты. */
function SlotPad({ slot, slotType, zoneIndex, playable, rayHovered, tint, onClick }) {
  const meshRef = useRef(null)
  const show = playable || rayHovered

  useEffect(() => {
    if (!meshRef.current || !playable) return undefined
    return registerPlayableSlot(meshRef.current)
  }, [playable, zoneIndex, slotType])

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[slot.x, LAND_SURFACE_Y + 0.001, slot.z]}
      onClick={onClick}
      userData={{ slotTarget: true, slotType, zoneIndex, playable }}
    >
      <planeGeometry args={[slot.width, slot.depth]} />
      <meshStandardMaterial
        color={show ? tint : '#000000'}
        transparent
        opacity={show ? (rayHovered ? 0.38 : 0.18) : 0.03}
        roughness={1}
        depthWrite={false}
      />
    </mesh>
  )
}

function renderFieldCard(card, slot, { isMyTurn, isOwnerMe, isSelected, isAttackerSelected, onZoneCardClick, recentDamage }) {
  if (!card) return null
  const isFlipped = card?.status === 'flipped' || card?.isFlipped
  return (
    <EnhancedCard3DModel
      key={card.id || card.instanceId}
      card={card}
      position={[slot.x, LAND_SURFACE_Y + 0.004, slot.z]}
      rotation={[-Math.PI / 2, 0, isFlipped ? Math.PI / 2 : 0]}
      flatOnTable
      tableScale={FIELD_CARD_SCALE}
      isFaceUp
      isSelected={isSelected || isAttackerSelected}
      isFlipped={isFlipped}
      showStats={false}
      showFlipOption={isMyTurn && isOwnerMe}
      onClick={() => onZoneCardClick?.(card)}
    />
  )
}

function DamageFloater({ amount, slot }) {
  if (!amount) return null
  return (
    <Text
      position={[slot.x, LAND_SURFACE_Y + 0.42, slot.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      fontSize={0.22}
      color="#ff1744"
      anchorX="center"
      anchorY="middle"
      outlineWidth={0.015}
      outlineColor="#ffffff"
    >
      -{amount}
    </Text>
  )
}

export function ZoneColumn({
  center,
  rotationY = 0,
  landType = null,
  zoneIndex = 0,
  cards = [],
  isOwnerMe = false,
  isSelected = false,
  isMyTurn = false,
  isAttackerSelected = false,
  isAttackTarget = false,
  damageAmount = null,
  creaturePlayable = false,
  buildingPlayable = false,
  creatureRayHover = false,
  buildingRayHover = false,
  onCreatureSlotClick,
  onBuildingSlotClick,
  onZoneAttackClick,
  onZoneCardClick,
  onLandClick,
}) {
  const slots = getLandSlotLayout()
  const { creatureCard, buildingCard } = splitZoneCards(cards)

  return (
    <group position={center} rotation={[0, rotationY, 0]}>
      <LandMat landType={landType} onClick={onLandClick} isSelected={isSelected} />
      <LandOutline />

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

      <SlotPad
        slot={slots.creature}
        slotType={SLOT_CREATURE}
        zoneIndex={zoneIndex}
        playable={creaturePlayable}
        rayHovered={creatureRayHover}
        tint={CREATURE_SLOT_COLOR}
        onClick={(e) => {
          e.stopPropagation()
          if (creaturePlayable) onCreatureSlotClick?.()
        }}
      />

      <SlotPad
        slot={slots.building}
        slotType={SLOT_BUILDING}
        zoneIndex={zoneIndex}
        playable={buildingPlayable}
        rayHovered={buildingRayHover}
        tint={BUILDING_SLOT_COLOR}
        onClick={(e) => {
          e.stopPropagation()
          if (buildingPlayable) onBuildingSlotClick?.()
        }}
      />

      {renderFieldCard(creatureCard, slots.creature, {
        isMyTurn,
        isOwnerMe,
        isSelected,
        isAttackerSelected,
        onZoneCardClick,
      })}
      {renderFieldCard(buildingCard, slots.building, {
        isMyTurn,
        isOwnerMe,
        isSelected: false,
        isAttackerSelected: false,
        onZoneCardClick,
      })}

      {damageAmount != null && creatureCard && (
        <DamageFloater amount={damageAmount} slot={slots.creature} />
      )}

      {creatureCard && (
        <CreatureFieldStats card={creatureCard} slot={slots.creature} rotationY={rotationY} />
      )}
    </group>
  )
}
