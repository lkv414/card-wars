/**
 * EnhancedCard3DModel — Улучшенная 3D-карта с отображением характеристик
 *
 * Отображает:
 * - Стоимость (слева сверху)
 * - Атаку (снизу слева)
 * - HP/Защиту (снизу справа)
 * - При наведении: описание карты во всплывающем окне
 *
 * Поддержка:
 * - Флюп (flip) механика: карта поворачивается на 90 градусов
 * - Выбор между атакой и флюпом для карт с способностью Флюп
 * - Разные цвета для разных типов карт
 *
 * Ориентация: родительская группа (EnhancedSlot) поворачивает всю сцену
 * по Y на угол владельца. Текст и текстура внутри карты НЕ поворачиваются
 * дополнительно — они и так уже ориентированы правильно после поворота
 * группы. Это работает потому что текстура имеет side=DoubleSide.
 */

import { useMemo, useRef, useState } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { TextureLoader } from 'three'
import * as THREE from 'three'
import { hasFlipAbility } from '../../hooks/game/cardAbilities.js'
import {
  getCardHealth,
  getCardAttack,
  isCreatureCard,
  isBuildingCard,
} from '../../utils/cardFields.ts'
import { resolveCardImageUrl } from '../../utils/enrichGameCards.js'
import { getPlaceholderTextureUrl, loadCachedTexture } from '../../utils/textureCache.js'

class CachedTextureLoader extends TextureLoader {
  load(url, onLoad, onProgress, onError) {
    loadCachedTexture(url || getPlaceholderTextureUrl(), { crossOrigin: 'anonymous' })
      .then(onLoad)
      .catch(onError)
    return this
  }
}

// Placeholder-цвет, пока текстура грузится / не задана
const PLACEHOLDER_COLOR = '#5d4e8a'

// Размер карты в мировых координатах
const CARD_WIDTH = 0.7
const CARD_HEIGHT = 1.0

// Цвета для элементов земель
const LAND_TYPE_ICONS = {
  corn: '🌽',
  ice: '❄️',
  good: '🌸',
  swamp: '🌿',
  sand: '🏜️',
  blue: '🔵',
  any: '🌈',
}

// Скелетон-карта: тёмный plane с надписью. Используется, когда image_url отсутствует.
function CardBackdrop({ color = PLACEHOLDER_COLOR }) {
  return (
    <mesh>
      <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
      <meshStandardMaterial color={color} roughness={0.85} metalness={0.05} />
    </mesh>
  )
}

/**
 * Форматирует текст для 3D рендеринга
 */
function create3DText(text, color = 'white', fontSize = 0.12, maxWidth = 0.6) {
  return (
    <Text
      color={color}
      fontSize={fontSize}
      maxWidth={maxWidth}
      lineHeight={1}
      letterSpacing={0.02}
      textAlign="left"
      anchorX="left"
      anchorY="top"
    >
      {text}
    </Text>
  )
}

/**
 * Иконка стоимости карты
 */
function CostIndicator({ cost, position }) {
  if (cost === undefined || cost === null) return null

  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[0.25, 0.2]} />
        <meshStandardMaterial
          color="#FF9800"
          transparent={true}
          opacity={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>
      {create3DText(String(cost), '#000', 0.14, 0.2)}
    </group>
  )
}

/**
 * Индикатор атаки
 */
function AttackIndicator({ attack, position }) {
  if (attack === undefined || attack === null) return null

  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[0.25, 0.2]} />
        <meshStandardMaterial
          color="#F44336"
          transparent={true}
          opacity={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>
      {create3DText(`⚔️${attack}`, '#000', 0.14, 0.2)}
    </group>
  )
}

/**
 * Индикатор защиты/HP
 */
function DefenseIndicator({ defense, position }) {
  if (defense === undefined || defense === null) return null

  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[0.25, 0.2]} />
        <meshStandardMaterial
          color="#4CAF50"
          transparent={true}
          opacity={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>
      {create3DText(`❤️${defense}`, '#000', 0.14, 0.2)}
    </group>
  )
}

/**
 * Индикатор типа земли (для карт, требующих определенные земли)
 */
function LandTypeIndicator({ landType, position }) {
  if (!landType || landType === 'any') return null

  const icon = LAND_TYPE_ICONS[landType] || '?'

  return (
    <group position={position}>
      {create3DText(icon, '#FFF', 0.16)}
    </group>
  )
}

/**
 * Иконка флюпа (если карта может флюпаться)
 */
function FlipIndicator({ canFlip, position }) {
  if (!canFlip) return null

  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[0.2, 0.2]} />
        <meshStandardMaterial
          color="#FFC107"
          transparent={true}
          opacity={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      {create3DText('↻', '#000', 0.12)}
    </group>
  )
}

function CardFaceMesh({ card, memoTexture, showNameFallback = false }) {
  const resolvedUrl = resolveCardImageUrl(card)
  if (!resolvedUrl) {
    return (
      <>
        <CardBackdrop />
        {showNameFallback && card?.name && (
          <Text
            color="#ffffff"
            fontSize={0.11}
            maxWidth={CARD_WIDTH * 0.85}
            textAlign="center"
            anchorX="center"
            anchorY="middle"
            position={[0, 0, 0.01]}
          >
            {card.name}
          </Text>
        )}
      </>
    )
  }

  return (
    <mesh>
      <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
      <meshStandardMaterial
        map={memoTexture}
        roughness={0.7}
        metalness={0.1}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

export function EnhancedCard3DModel({
  card,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  onClick = null,
  onAttack = null,
  onFlip = null,
  onRequestActionMenu = null,
  isFaceUp = true,
  isSelected = false,
  isFlipped = false,
  showStats = false,
  showFlipOption = false,
  flatOnTable = false,
  tableScale = 1,
}) {
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef(null)

  const canFlip = hasFlipAbility(card)
  const textureUrl = resolveCardImageUrl(card) || getPlaceholderTextureUrl()

  // Загружаем текстуру
  const texture = useLoader(CachedTextureLoader, textureUrl)

  const memoTexture = useMemo(() => texture, [texture])

  const targetY = flatOnTable
    ? position[1]
    : position[1] + (isSelected ? 0.25 : hovered ? 0.15 : 0)

  useFrame((state) => {
    const g = groupRef.current
    if (!g) return

    if (flatOnTable) {
      g.position.set(position[0], position[1], position[2])
      g.rotation.set(rotation[0], rotation[1], isFlipped ? Math.PI / 2 : rotation[2])
      const s = isSelected ? tableScale * 1.04 : tableScale
      g.scale.set(s, s, s)
      return
    }

    const t = state.clock.elapsedTime
    g.position.y += (targetY - g.position.y) * 0.15

    if (!hovered && !isSelected) {
      g.position.y += Math.sin(t * 1.5) * 0.02
    }

    const baseScale = isSelected ? 1.1 : 1.0
    const bounce = hovered ? 1 + Math.sin(t * 8) * 0.05 : 0
    const s = baseScale + bounce
    g.scale.set(s, s, s)

    if (isFlipped) {
      g.rotation.z = Math.PI / 2
    } else {
      g.rotation.z = 0
    }
  })

  // Обработка клика с выбором между атакой и флюпом
  const handleClick = (e) => {
    e.stopPropagation()

    if (showFlipOption && canFlip && (onRequestActionMenu || onFlip || onAttack)) {
      if (onRequestActionMenu) {
        onRequestActionMenu(card)
        return
      }
      onAttack?.(card)
      return
    } else if (onClick) {
      onClick(card)
    } else if (onAttack) {
      onAttack(card)
    }
  }

  // Позиции для индикаторов
  const costPos = [-CARD_WIDTH/2 + 0.15, CARD_HEIGHT/2 - 0.12, 0.01]
  const landTypePos = [-CARD_WIDTH/2 + 0.15, CARD_HEIGHT/2 - 0.25, 0.01]
  const attackPos = [-CARD_WIDTH/2 + 0.15, -CARD_HEIGHT/2 + 0.12, 0.01]
  const defensePos = [CARD_WIDTH/2 - 0.15, -CARD_HEIGHT/2 + 0.12, 0.01]
  const flipPos = [CARD_WIDTH/2 - 0.1, CARD_HEIGHT/2 - 0.12, 0.01]

  // Если карта лицом вниз, показываем обратную сторону
  if (!isFaceUp) {
    return (
      <group
        ref={groupRef}
        position={position}
        rotation={[rotation[0], rotation[1], isFlipped ? Math.PI / 2 : rotation[2]]}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
        onClick={handleClick}
      >
        <CardBackdrop color="#1a1a2e" />
        {create3DText('🂠', '#FFF', 0.3, 1)}
      </group>
    )
  }

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[rotation[0], rotation[1], isFlipped ? Math.PI / 2 : rotation[2]]}
      onPointerOver={(e) => {
        e.stopPropagation()
        if (!flatOnTable) setHovered(true)
        document.body.style.cursor = onClick || onAttack || onFlip ? 'pointer' : 'default'
      }}
      onPointerOut={() => {
        if (!flatOnTable) setHovered(false)
        document.body.style.cursor = 'default'
      }}
      onClick={handleClick}
    >
      {/* Текстура карты или fallback с названием */}
      <CardFaceMesh
        card={card}
        memoTexture={memoTexture}
        showNameFallback={flatOnTable}
      />

      {/* Индикаторы характеристик */}
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
          <FlipIndicator canFlip={canFlip} position={flipPos} />
        </>
      )}

    </group>
  )
}

// Backward compatibility
EnhancedCard3DModel.displayName = 'EnhancedCard3DModel'

export default EnhancedCard3DModel