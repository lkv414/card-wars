/**
 * GameDamageFloater — 3D-числа урона над пострадавшими картами.
 *
 * По паттерну testing_3d: чистый компонент, отвечает только за отрисовку
 * чисел с анимацией. Доменная логика (кто получил урон) приходит снаружи.
 */
import { useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'

const LIFETIME_MS = 1400
const RISE_DISTANCE = 0.7

/**
 * @param {object} props
 * @param {string[]} props.markerKeys список стабильных ключей (на каждый "удар" — новый ключ)
 * @param {number} [props.playerId] id игрока, чьи маркеры рисовать
 * @param {number} [props.zoneIndex] индекс зоны
 * @param {number} [props.amount] число урона
 * @param {[number,number,number]} [props.position] мировая позиция
 */
export function GameDamageFloater({
  markerKeys,
  amount = 0,
  position = [0, 0.42, 0],
}) {
  const groupRef = useRef(null)
  const startTimeRef = useRef(0)

  useEffect(() => {
    startTimeRef.current = performance.now()
  }, [])

  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    const elapsed = performance.now() - startTimeRef.current
    const t = Math.min(elapsed / LIFETIME_MS, 1)
    // Поднимаемся вверх и угасаем
    g.position.y = position[1] + t * RISE_DISTANCE
    const opacity = 1 - t
    if (g.children[0]?.material) {
      g.children[0].material.opacity = opacity
    }
  })

  return (
    <group
      key={markerKeys.join('|')}
      ref={groupRef}
      position={position}
    >
      <Text
        color="#ff1744"
        fontSize={0.28}
        fontWeight="bold"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.025}
        outlineColor="#ffffff"
        material-transparent
        material-opacity={1}
      >
        {`-${amount}`}
      </Text>
    </group>
  )
}

export default GameDamageFloater