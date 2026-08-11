import { useState } from 'react'
import * as THREE from 'three'
import { EnhancedCard3DModel } from '../EnhancedCard3DModel'
import { SLOT_WIDTH, SLOT_DEPTH } from './layout'

export function EnhancedSlot({
  position,
  cards = [],
  ownerAngleRad = 0,
  isOwnerMe = false,
  isSelected = false,
  isMyTurn = false,
  onClick,
  onZoneCardClick,
  highlighted = false,
}) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <group position={position} rotation={[0, ownerAngleRad, 0]}>
      <mesh
        receiveShadow
        castShadow
        onClick={(e) => {
          e.stopPropagation()
          onClick?.()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setIsHovered(true)
          if (isMyTurn && highlighted) {
            document.body.style.cursor = 'grab'
          }
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          setIsHovered(false)
          document.body.style.cursor = 'default'
        }}
      >
        <boxGeometry args={[SLOT_WIDTH, 0.5, SLOT_DEPTH]} />
        <meshStandardMaterial
          color={
            isHovered && highlighted
              ? '#7d6eaa'
              : highlighted
                ? '#5d4e8a'
                : isOwnerMe
                  ? '#2c3e5e'
                  : '#1f2a40'
          }
          emissive={highlighted ? (isHovered ? '#80ff80' : '#4caf50') : '#000000'}
          emissiveIntensity={isHovered && highlighted ? 0.6 : highlighted ? 0.4 : 0}
          roughness={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>

      {cards.map((card, ci) => {
        const isFlipped = card?.status === 'flipped' || card?.isFlipped
        return (
          <EnhancedCard3DModel
            key={card.id || card.instanceId || ci}
            card={card}
            position={[0, 0.55 + ci * 0.18, -SLOT_DEPTH / 2 + 0.5 + ci * 0.18]}
            rotation={[-Math.PI / 2.4, 0, isFlipped ? Math.PI / 2 : 0]}
            isFaceUp
            isSelected={isSelected}
            isFlipped={isFlipped}
            showStats={false}
            showFlipOption={isMyTurn && isOwnerMe}
            onClick={() => onZoneCardClick?.(card, ci)}
          />
        )
      })}
    </group>
  )
}
