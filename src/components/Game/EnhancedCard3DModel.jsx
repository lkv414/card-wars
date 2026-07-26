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
 */

import { useMemo, useRef, useState } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { TextureLoader } from 'three'
import * as THREE from 'three'

// Placeholder-цвет, пока текстура грузится / не задана
const PLACEHOLDER_COLOR = '#5d4e8a'

// Размер карты в мировых координатах
const CARD_WIDTH = 0.7
const CARD_HEIGHT = 1.0

// Цвета для типов карт
const TYPE_COLORS = {
  creature: '#4CAF50',    // Зелёный для существ
  building: '#2196F3',    // Синий для строений
  spell: '#9C27B0',       // Пурпурный для заклинаний
}

// Цвета для элементов земель
const LAND_TYPE_ICONS = {
  corn: '🌽',
  ice: '❄️',
  desert: '🏜️',
  good: '🌸',
  swamp: '🌿',
  sand: '🏖️',
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
 * Рамка карты с цветом по типу
 */
function CardFrame({ card, width = CARD_WIDTH + 0.05, height = CARD_HEIGHT + 0.05 }) {
  const typeColor = TYPE_COLORS[card?.type] || PLACEHOLDER_COLOR
  
  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial 
        color={typeColor}
        transparent={true}
        opacity={0.3}
        side={THREE.DoubleSide}
      />
    </mesh>
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

export function EnhancedCard3DModel({
  card,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  onClick = null,
  onAttack = null,
  onFlip = null,
  isFaceUp = true,
  isSelected = false,
  isFlipped = false,
  showStats = true,
  showFlipOption = false,
  isOpponent = false, // если true — текст name/description «смотрит» к владельцу, не к центру
}) {
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef(null)
  
  // Проверяем, можно ли флюпать эту карту
  const canFlip = card?.abilities?.includes('Флюп') || card?.flip_ability
  
  // Загружаем текстуру
  const texture = useLoader(
    TextureLoader,
    card?.image_url || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
    (loader) => {
      loader.crossOrigin = 'anonymous'
    }
  )

  const memoTexture = useMemo(() => texture, [texture])

  // Target Y для анимаций
  const targetY = position[1] + (isSelected ? 0.25 : hovered ? 0.15 : 0)

  // Анимации через useFrame
  useFrame((state) => {
    const g = groupRef.current
    if (!g) return
    const t = state.clock.elapsedTime

    // Smooth Y
    g.position.y += (targetY - g.position.y) * 0.15

    // Gentle float на idle
    if (!hovered && !isSelected) {
      g.position.y += Math.sin(t * 1.5) * 0.02
    }

    // Scale-bounce на hover
    const baseScale = isSelected ? 1.1 : 1.0
    const bounce = hovered ? 1 + Math.sin(t * 8) * 0.05 : 0
    const s = baseScale + bounce
    g.scale.set(s, s, s)
    
    // Rotate для флюпнутой карты
    if (isFlipped) {
      g.rotation.z = Math.PI / 2  // 90 градусов
    } else {
      g.rotation.z = 0
    }
  })

  // Обработка клика с выбором между атакой и флюпом
  const handleClick = (e) => {
    e.stopPropagation()
    
    if (showFlipOption && canFlip && onFlip) {
      // Показываем меню выбора
      const choice = window.confirm('Флюпнуть карту вместо атаки?')
      if (choice) {
        onFlip(card)
      } else if (onAttack) {
        onAttack(card)
      }
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
        setHovered(true)
        document.body.style.cursor = onClick || onAttack || onFlip ? 'pointer' : 'default'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = 'default'
      }}
      onClick={handleClick}
    >
      {/* Рамка карты */}
      <CardFrame card={card} />
      
      {/* Текстура карты */}
      <mesh>
        <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
        <meshStandardMaterial 
          map={memoTexture}
          roughness={0.7}
          metalness={0.1}
        />
      </mesh>
      
      {/* Индикаторы характеристик */}
      {showStats && (
        <>
          <CostIndicator cost={card?.cost} position={costPos} />
          <LandTypeIndicator landType={card?.land_type} position={landTypePos} />
          {card?.type === 'creature' && (
            <>
              <AttackIndicator attack={card?.attack} position={attackPos} />
              <DefenseIndicator defense={card?.defense} position={defensePos} />
            </>
          )}
          {card?.type === 'building' && (
            <DefenseIndicator defense={card?.defense} position={defensePos} />
          )}
          <FlipIndicator canFlip={canFlip} position={flipPos} />
        </>
      )}
      
      {/* Название карты — всегда видно сверху (компактнее чем раньше) */}
      {card?.name && (
        <group
          position={[0, CARD_HEIGHT/2 + 0.15, 0]}
          // Для оппонента — поворачиваем текст на 180° вокруг Y, чтобы имя
          // «смотрело» к владельцу (от центра стола наружу), а не к центру.
          rotation={isOpponent ? [0, Math.PI, 0] : [0, 0, 0]}
        >
          <mesh>
            {/* Плашка чуть уже карты, чтобы оставаться в пределах CARD_WIDTH */}
            <planeGeometry args={[CARD_WIDTH * 1.05, 0.2]} />
            <meshStandardMaterial color="#000" transparent={true} opacity={0.6} />
          </mesh>
          {/* fontSize снижен, maxWidth = CARD_WIDTH — текст не выходит за рамки */}
          {create3DText(card.name, '#FFF', 0.09, CARD_WIDTH * 0.95)}
        </group>
      )}

      {/* Описание карты — всегда видно снизу. Размер плашки фиксированный
          (избегаем пересоздания текстурного атласа troika-three-text на hover);
          hover-эффект даётся через opacity, scale группы и позицию. */}
      {card?.description && (
        <group
          position={[0, -CARD_HEIGHT/2 - 0.22, 0]}
          scale={hovered ? [1, 1.4, 1] : [1, 1, 1]}
          rotation={isOpponent ? [0, Math.PI, 0] : [0, 0, 0]}
        >
          <mesh>
            {/* Плашка уже карты */}
            <planeGeometry args={[CARD_WIDTH * 1.2, 0.5]} />
            <meshStandardMaterial color="#000" transparent={true} opacity={hovered ? 0.78 : 0.5} side={THREE.DoubleSide} />
          </mesh>
          {/* fontSize снижен до 0.06; maxWidth = CARD_WIDTH — текст в рамках */}
          {create3DText(card.description, '#FFF', 0.06, CARD_WIDTH * 0.95)}
        </group>
      )}
    </group>
  )
}

// Backward compatibility
EnhancedCard3DModel.displayName = 'EnhancedCard3DModel'

export default EnhancedCard3DModel
