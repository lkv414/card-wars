/**
 * useCardAnimation — анимации карт без лишних ре-рендеров.
 *
 * Принцип: анимации управляются через useFrame и императивные обновления
 * позиции/масштаба/прозрачности, а не через React state. Это позволяет
 * избежать ре-рендеров на каждый кадр анимации.
 *
 * Анимации:
 * - spawn: подброс при появлении карты на поле
 * - hover: подъём карты при наведении
 * - death: растворение при удалении карты
 */
import { useRef, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const SPAWN_DURATION = 0.4
const SPAWN_HEIGHT = 0.8
const HOVER_LIFT = 0.15
const DEATH_DURATION = 0.5

/**
 * @param {object} params
 * @param {boolean} params.isNew — карта только что появилась
 * @param {boolean} params.isHovered — карта под курсором
 * @param {boolean} params.isDying — карта удаляется
 * @param {THREE.Group} params.groupRef — ссылка на группу карты
 */
export function useCardAnimation({ isNew, isHovered, isDying, groupRef }) {
  const animState = useRef({
    spawnProgress: isNew ? 0 : 1,
    deathProgress: 0,
    hoverOffset: 0,
  })

  // Сброс анимации при появлении новой карты
  if (isNew && animState.current.spawnProgress === 1) {
    animState.current.spawnProgress = 0
  }

  const update = useCallback((delta) => {
    const g = groupRef.current
    if (!g) return

    const state = animState.current

    // Spawn анимация: подброс сверху вниз
    if (state.spawnProgress < 1) {
      state.spawnProgress = Math.min(1, state.spawnProgress + delta / SPAWN_DURATION)
      const t = state.spawnProgress
      // Easing: ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      const y = (1 - eased) * SPAWN_HEIGHT
      g.position.y += y
      // Лёгкое вращение при подбросе
      g.rotation.x = (1 - eased) * -Math.PI / 4
    }

    // Hover анимация: плавный подъём
    const targetHover = isHovered ? HOVER_LIFT : 0
    state.hoverOffset = THREE.MathUtils.lerp(state.hoverOffset, targetHover, delta * 10)
    if (!isDying) {
      g.position.y += state.hoverOffset
    }

    // Death анимация: растворение
    if (isDying && state.deathProgress < 1) {
      state.deathProgress = Math.min(1, state.deathProgress + delta / DEATH_DURATION)
      const t = state.deathProgress
      const eased = t * t
      g.scale.setScalar(1 - eased * 0.5)
      g.position.y += eased * 0.3
      // Можно добавить прозрачность через материал, если нужно
    }
  }, [isHovered, isDying, groupRef])

  return { update, animState }
}

export default useCardAnimation
