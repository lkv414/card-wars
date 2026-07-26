/**
 * Card3DModel — 3D-карта для Three.js сцены.
 *
 * Используется внутри <Canvas> в @react-three/fiber.
 * Каждая карта — это плоскость с PNG-текстурой (card.image_url из БД).
 *
 * Hover/select эффекты через onPointerOver/onPointerOut/onClick.
 *
 * @example
 * <Card3DModel
 *   card={{ name: 'Fire Dragon', image_url: 'https://...png', cost: 3 }}
 *   position={[0, 0.5, 0]}
 *   rotation={[0, -0.3, 0]}
 *   onClick={() => playCard(...)}
 *   onAttack={() => attack(...)}
 * />
 */
import { useMemo, useRef, useState } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { TextureLoader } from 'three'

// Размер карты в мировых координатах (метры в нашей шкале)
const CARD_WIDTH = 0.7
const CARD_HEIGHT = 1.0

// Placeholder-цвет, пока текстура грузится / не задана
const PLACEHOLDER_COLOR = '#5d4e8a'

/**
 * Скелетон-карта: тёмный plane с надписью. Используется, когда image_url отсутствует.
 */
function CardBackdrop({ color = PLACEHOLDER_COLOR }) {
  return (
    <mesh>
      <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
      <meshStandardMaterial color={color} roughness={0.85} metalness={0.05} />
    </mesh>
  )
}

export function Card3DModel({
  card,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  onClick = null,
  onAttack = null,
  isFaceUp = true,
  isSelected = false,
}) {
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef(null)

  // Загружаем текстуру из card.image_url. Если нет — null, fallback на backdrop.
  const texture = useLoader(
    TextureLoader,
    card?.image_url || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
    (loader) => {
      loader.crossOrigin = 'anonymous'
    }
  )

  // Запоминаем текстуру, чтобы не пересоздавать на каждый рендер
  const memoTexture = useMemo(() => texture, [texture])

  // Target Y (высота над столом): select > hover > idle
  const targetY = position[1] + (isSelected ? 0.25 : hovered ? 0.15 : 0)

  // Анимация каждый кадр: smooth lerp Y + gentle float + scale-bounce на hover
  useFrame((state) => {
    const g = groupRef.current
    if (!g) return
    const t = state.clock.elapsedTime

    // 1. Smooth Y (lerp к targetY, фактор ~0.15)
    g.position.y += (targetY - g.position.y) * 0.15

    // 2. Gentle float на idle (sin wave, ±0.02)
    if (!hovered && !isSelected) {
      g.position.y += Math.sin(t * 1.5) * 0.02
    }

    // 3. Scale-bounce на hover (1 + sin*5% * 0.08)
    const baseScale = isSelected ? 1.1 : 1.0
    const bounce = hovered ? 1 + Math.sin(t * 8) * 0.05 : 0
    const s = baseScale + bounce
    g.scale.set(s, s, s)
  })

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={rotation}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
        document.body.style.cursor = onClick || onAttack ? 'pointer' : 'default'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = 'default'
      }}
      onClick={(e) => {
        e.stopPropagation()
        if (onAttack) onAttack()
        else if (onClick) onClick()
      }}
    >
      {!card?.image_url ? (
        <CardBackdrop />
      ) : (
        <mesh castShadow receiveShadow>
          <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
          <meshStandardMaterial
            map={isFaceUp ? memoTexture : null}
            color={isFaceUp ? '#ffffff' : '#2c3e50'}
            roughness={0.6}
            metalness={0.1}
            emissive={hovered || isSelected ? '#4caf50' : '#000000'}
            emissiveIntensity={hovered || isSelected ? 0.4 : 0}
          />
        </mesh>
      )}

      {/* Если рубашкой — показываем серую грань (простое замещение) */}
      {!isFaceUp && card?.image_url && (
        <mesh position={[0, 0, 0.001]}>
          <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT]} />
          <meshStandardMaterial color="#34495e" roughness={0.9} />
        </mesh>
      )}

      {/* Если выбрана — зелёная рамка вокруг */}
      {isSelected && (
        <mesh position={[0, 0, 0.005]}>
          <planeGeometry args={[CARD_WIDTH + 0.05, CARD_HEIGHT + 0.05]} />
          <meshBasicMaterial color="#4caf50" wireframe />
        </mesh>
      )}
    </group>
  )
}

export default Card3DModel