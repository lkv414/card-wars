/**
 * GameObject — 3D-карта на столе (land area) или в руке.
 *
 * По паттерну testing_3d (SceneObject): switch(type) → geometry + material +
 * Outlines для выбора. Поддерживает:
 *   - flatOnTable режим: лежит на земле, не «летает» (для land зон)
 *   - Индикаторы cost (оранжевый), attack (красный), hp/defense (зелёный), flip-icon (жёлтый)
 *   - hover-анимация: приподнимается над столом
 *   - selection: карта подсвечивается Outlines
 *   - flip: поворот на 90° (для флюпнутых карт)
 *
 * Текстуры лениво через TextureLoader с кэшированием (через getPlaceholderTextureUrl).
 */
import { memo, useRef, useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, Outlines } from '@react-three/drei'
import * as THREE from 'three'

import {
  isCreatureCard,
  isBuildingCard,
  getCardAttack,
  getCardHealth,
} from '../../../utils/cardFields.ts'
import { hasFlipAbility } from '../../../hooks/game/cardAbilities.js'
import { resolveCardImageUrl } from '../../../utils/enrichGameCards.js'
import { getPlaceholderTextureUrl } from '../../../utils/textureCache.js'
import { useCardTexture } from '../../../utils/useCardTexture.js'

// Размер карты в мировых координатах
const CARD_WIDTH = 0.7
const CARD_HEIGHT = 1.0

// Цвета для элементов земель (для подсказок на картах)
const LAND_TYPE_ICONS = {
  corn: '🌽',
  ice: '❄️',
  good: '🌸',
  swamp: '🌿',
  sand: '🏜️',
  blue: '🔵',
  any: '🌈',
}

// Placeholder-цвет, пока текстура грузится / не задана
const PLACEHOLDER_COLOR = '#5d4e8a'

function CardBackdrop({ color = PLACEHOLDER_COLOR }) {
  return (
    <mesh>
      <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
      <meshStandardMaterial color={color} roughness={0.85} metalness={0.05} />
    </mesh>
  )
}

/** Индикатор стоимости (оранжевый квадрат) */
function CostIndicator({ cost, position }) {
  if (cost === undefined || cost === null) return null
  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[0.25, 0.2]} />
        <meshStandardMaterial color="#FF9800" transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      <Text
        color="#000"
        fontSize={0.14}
        maxWidth={0.2}
        lineHeight={1}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
        position={[0, 0, 0.005]}
      >
        {String(cost)}
      </Text>
    </group>
  )
}

/** Индикатор атаки (красный) */
function AttackIndicator({ attack, position }) {
  if (attack === undefined || attack === null) return null
  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[0.25, 0.2]} />
        <meshStandardMaterial color="#F44336" transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      <Text
        color="#000"
        fontSize={0.13}
        maxWidth={0.2}
        lineHeight={1}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
        position={[0, 0, 0.005]}
      >
        {`⚔${attack}`}
      </Text>
    </group>
  )
}

/** Индикатор HP/защиты (зелёный) */
function DefenseIndicator({ defense, position }) {
  if (defense === undefined || defense === null) return null
  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[0.25, 0.2]} />
        <meshStandardMaterial color="#4CAF50" transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      <Text
        color="#000"
        fontSize={0.13}
        maxWidth={0.2}
        lineHeight={1}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
        position={[0, 0, 0.005]}
      >
        {`♥${defense}`}
      </Text>
    </group>
  )
}

/** Индикатор типа земли (иконка) */
function LandTypeIndicator({ landType, position }) {
  if (!landType || landType === 'any') return null
  const icon = LAND_TYPE_ICONS[landType] || '?'
  return (
    <Text
      color="#FFF"
      fontSize={0.16}
      lineHeight={1}
      textAlign="center"
      anchorX="center"
      anchorY="middle"
      position={position}
      outlineWidth={0.01}
      outlineColor="#000"
    >
      {icon}
    </Text>
  )
}

/** Индикатор флипа (жёлтый ↻) */
function FlipIndicator({ position }) {
  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[0.2, 0.2]} />
        <meshStandardMaterial color="#FFC107" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <Text
        color="#000"
        fontSize={0.12}
        lineHeight={1}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
        position={[0, 0, 0.005]}
      >
        ↻
      </Text>
    </group>
  )
}

/**
 * GameObject — единая 3D-карта.
 *
 * @param {object} props
 * @param {object} card данные карты
 * @param {[number,number,number]} position мировые координаты
 * @param {[number,number,number]} [rotation] базовый поворот
 * @param {boolean} [props.flatOnTable] лежит плоско на столе (без hover-анимации)
 * @param {number} [props.tableScale] scale для flatOnTable
 * @param {boolean} [props.isFaceUp] видна ли рубашка
 * @param {boolean} [props.isSelected] подсветка выбора
 * @param {boolean} [props.isFlipped] поворот на 90° (флипнутые карты)
 * @param {boolean} [props.showStats] показывать cost/atk/hp индикаторы
 * @param {boolean} [props.showFlipOption] показывать flip-индикатор (если есть flip ability)
 * @param {boolean} [props.damageFlash] включить анимацию урона (красная вспышка + шевеление)
 * @param {(e:any) => void} [props.onClick]
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

  const canFlip = hasFlipAbility(card)
  const textureUrl = resolveCardImageUrl(card) || getPlaceholderTextureUrl()
  // Без Suspense: текстура либо готова, либо null (покажем placeholder-цвет).
  // Это убирает RC1: Suspense в GameCanvas больше не срабатывает на каждой
  // новой карте и при каждой смене URL, поэтому 3D-сцена не перезагружается.
  const texture = useCardTexture(textureUrl)

  // Позиция с учётом hover (только если не flatOnTable)
  const targetY = flatOnTable
    ? position[1]
    : position[1] + (isSelected ? 0.25 : hovered ? 0.15 : 0)

  useEffect(() => {
    const g = groupRef.current
    if (!g) return
    if (flatOnTable) {
      g.position.set(position[0], position[1], position[2])
      g.rotation.set(rotation[0], rotation[1], isFlipped ? Math.PI / 2 : rotation[2])
      const s = isSelected ? tableScale * 1.04 : tableScale
      g.scale.set(s, s, s)
    }
  }, [position, rotation, isFlipped, isSelected, tableScale, flatOnTable])

  useEffect(() => {
    if (damageFlash) damageStartRef.current = performance.now()
  }, [damageFlash])

  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    if (flatOnTable) {
      // position/scale уже выставлены в useEffect
      // Но damageFlash покачивает карту
      if (damageFlash) {
        const elapsed = performance.now() - damageStartRef.current
        const t = Math.min(elapsed / 600, 1)
        const shake = Math.sin(t * Math.PI * 4) * 0.05 * (1 - t)
        g.position.x = position[0] + shake
        g.position.z = position[2] + shake * 0.5
      }
      // Эмиссия — красная, фейдит за 0.6с
      if (matRef.current) {
        const dt = damageFlash
          ? Math.min((performance.now() - damageStartRef.current) / 600, 1)
          : 1
        const intensity = damageFlash ? (1 - dt) * 1.4 : 0
        matRef.current.emissive.setRGB(intensity, 0, 0)
      }
      return
    }

    // Плавный hover-эффект
    g.position.y += (targetY - g.position.y) * 0.15

    if (!hovered && !isSelected) {
      const t = performance.now() * 0.001
      g.position.y += Math.sin(t * 1.5) * 0.02
    }

    const baseScale = isSelected ? 1.1 : 1.0
    const t = performance.now() * 0.001
    const bounce = hovered ? 1 + Math.sin(t * 8) * 0.05 : 0
    const s = baseScale + bounce
    g.scale.set(s, s, s)

    if (isFlipped) {
      g.rotation.z = Math.PI / 2
    } else {
      g.rotation.z = 0
    }
  })

  const handleClick = (e) => {
    // R3F автоматически останавливает пропагацию к <Canvas onPointerMissed>,
    // когда есть <group onClick>. Поэтому stopPropagation вручную не нужен.
    onClick?.(card, e)
  }

  const handlePointerOver = (e) => {
    e.stopPropagation()
    if (!flatOnTable) setHovered(true)
    document.body.style.cursor = onClick ? 'pointer' : 'default'
  }

  const handlePointerOut = () => {
    if (!flatOnTable) setHovered(false)
    document.body.style.cursor = 'default'
  }

  // Позиции индикаторов (на лицевой стороне карты)
  const costPos = [-CARD_WIDTH / 2 + 0.15, CARD_HEIGHT / 2 - 0.12, 0.01]
  const landTypePos = [-CARD_WIDTH / 2 + 0.15, CARD_HEIGHT / 2 - 0.25, 0.01]
  const attackPos = [-CARD_WIDTH / 2 + 0.15, -CARD_HEIGHT / 2 + 0.12, 0.01]
  const defensePos = [CARD_WIDTH / 2 - 0.15, -CARD_HEIGHT / 2 + 0.12, 0.01]
  const flipPos = [CARD_WIDTH / 2 - 0.1, CARD_HEIGHT / 2 - 0.12, 0.01]

  // Рубашка
  if (!isFaceUp) {
    return (
      <group
        ref={groupRef}
        position={position}
        rotation={[rotation[0], rotation[1], isFlipped ? Math.PI / 2 : rotation[2]]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <CardBackdrop color="#1a1a2e" />
        <Text
          color="#FFF"
          fontSize={0.3}
          lineHeight={1}
          anchorX="center"
          anchorY="middle"
          position={[0, 0, 0.01]}
        >
          🂠
        </Text>
        {isSelected && <Outlines thickness={0.04} color="#fbbf24" />}
      </group>
    )
  }

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[rotation[0], rotation[1], isFlipped ? Math.PI / 2 : rotation[2]]}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      <mesh>
        <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
        <meshStandardMaterial
          ref={matRef}
          map={texture || undefined}
          color={texture ? '#ffffff' : PLACEHOLDER_COLOR}
          roughness={0.7}
          metalness={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {isSelected && <Outlines thickness={0.04} color="#fbbf24" />}

      {showStats && (
        <>
          <CostIndicator cost={card?.cost} position={costPos} />
          <LandTypeIndicator landType={card?.land_type} position={landTypePos} />
          {isCreatureCard(card) && (
            <>
              <AttackIndicator attack={getCardAttack(card)} position={attackPos} />
              <DefenseIndicator defense={getCardHealth(card)} position={defensePos} />
            </>
          )}
          {isBuildingCard(card) && (
            <DefenseIndicator defense={getCardHealth(card)} position={defensePos} />
          )}
        </>
      )}

      {showFlipOption && canFlip && <FlipIndicator position={flipPos} />}
    </group>
  )
})

export default GameObject