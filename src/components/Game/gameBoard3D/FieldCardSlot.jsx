/**
 * Persistent field slot — empty transparent placeholder or card face on the same mesh.
 * Avoids mount/unmount + useLoader when cards are played (no scene "reload").
 */
import { memo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Text } from '@react-three/drei'
import { getCardAttack, getCardHealth } from '../../../utils/cardFields.ts'
import { isCreatureCard } from '../../../hooks/game/combat'
import { resolveCardImageUrl } from '../../../utils/enrichGameCards'
import { loadCachedTexture, getPlaceholderTextureUrl } from '../../../utils/textureCache'
import { computeFieldCardScale } from './layout'

const LAND_SURFACE_Y = 0.004
const CARD_WIDTH = 0.7
const CARD_HEIGHT = 1.0
const FIELD_SCALE = computeFieldCardScale(0.88)

const EMPTY_COLORS = {
  creature: '#5c6b7a',
  building: '#4a5662',
}

export const FieldCardSlot = memo(function FieldCardSlot({
  slot,
  slotKind = 'creature',
  card = null,
  isSelected = false,
  isFlipped = false,
  onClick,
}) {
  const groupRef = useRef(null)
  const matRef = useRef(null)
  const occupied = Boolean(card)

  useEffect(() => {
    const mat = matRef.current
    if (!mat) return undefined

    if (!occupied) {
      mat.map = null
      mat.opacity = 0.14
      mat.color.set(EMPTY_COLORS[slotKind] ?? EMPTY_COLORS.creature)
      mat.emissive.set('#000000')
      mat.emissiveIntensity = 0
      mat.needsUpdate = true
      return undefined
    }

    const url = resolveCardImageUrl(card) || getPlaceholderTextureUrl()
    let cancelled = false

    loadCachedTexture(url, { crossOrigin: 'anonymous' }).then((texture) => {
      if (cancelled || !matRef.current) return
      matRef.current.map = texture
      matRef.current.opacity = 1
      matRef.current.color.set('#ffffff')
      matRef.current.needsUpdate = true
    })

    return () => {
      cancelled = true
    }
  }, [occupied, slotKind, card?.id, card?.instanceId, card?.image_url, card?.name])

  useEffect(() => {
    const g = groupRef.current
    if (!g) return
    const flipZ = isFlipped ? Math.PI / 2 : 0
    g.rotation.set(-Math.PI / 2, 0, flipZ)
    const s = isSelected ? FIELD_SCALE * 1.04 : FIELD_SCALE
    g.scale.set(s, s, s)
  }, [isFlipped, isSelected])

  const showStats = occupied && slotKind === 'creature' && isCreatureCard(card)
  const atk = showStats ? getCardAttack(card) : null
  const hp = showStats ? getCardHealth(card) : null

  return (
    <group
      ref={groupRef}
      position={[slot.x, LAND_SURFACE_Y, slot.z]}
      onClick={
        occupied
          ? (e) => {
              e.stopPropagation()
              onClick?.(card)
            }
          : undefined
      }
    >
      <mesh>
        <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
        <meshStandardMaterial
          ref={matRef}
          transparent
          opacity={0.14}
          color={EMPTY_COLORS[slotKind]}
          roughness={0.75}
          metalness={0.05}
          side={THREE.DoubleSide}
          depthWrite={occupied}
        />
      </mesh>

      {showStats && (atk != null || hp != null) && (
        <group position={[0, 0.01, 0]}>
          {atk != null && (
            <Text
              position={[-CARD_WIDTH * 0.32, -CARD_HEIGHT * 0.38, 0.002]}
              fontSize={0.11}
              color="#ffcdd2"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.012}
              outlineColor="#1a1a1a"
            >
              {`⚔${atk}`}
            </Text>
          )}
          {hp != null && (
            <Text
              position={[CARD_WIDTH * 0.32, -CARD_HEIGHT * 0.38, 0.002]}
              fontSize={0.11}
              color="#c8e6c9"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.012}
              outlineColor="#1a1a1a"
            >
              {`♥${hp}`}
            </Text>
          )}
        </group>
      )}
    </group>
  )
})
