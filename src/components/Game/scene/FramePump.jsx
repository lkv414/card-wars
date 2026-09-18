/* eslint-disable react-refresh/only-export-components, react-hooks/refs --
 * Контекст экспорт и self-referential rAF — специфика модуля.
 */
/**
 * FramePump — «насос кадров» для `frameloop="demand"`.
 *
 * Зачем: карточная сцена статична ~95% времени. В режиме `always` мы всё равно
 * отдаём GPU 60 кадров в секунду → греем телефон → троттлинг → просадка FPS
 * как раз в момент хода. В режиме `demand` кадр рисуется только когда что-то
 * изменилось.
 *
 * Что само умеет будить рендер в demand-режиме:
 *   - R3F: любое изменение пропсов/структуры дерева (invalidateInstance);
 *   - drei OrbitControls: вызывает invalidate() на событии 'change', так что
 *     damping сам себя подпитывает до полной остановки.
 *
 * Чего не хватает — анимаций, которые живут «внутри» useFrame и не меняют
 * пропсов: вспышка урона, покачивание карты, всплывающие числа. Для них здесь
 * есть `pulse(ms)` — «рисуй кадры ещё ms миллисекунд».
 *
 * Использование:
 *   const pulse = useFramePulse()
 *   useEffect(() => { if (active) pulse(700) }, [active, pulse])
 */
import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'

const noop = () => {}

const PulseContext = createContext(noop)

/**
 * @returns {(durationMs?: number) => void} pulse — продлить анимацию на N мс
 */
export function useFramePulse() {
  return useContext(PulseContext)
}

/**
 * Рендерит children и даёт им доступ к pulse.
 * Должен лежать ВНУТРИ <Canvas>.
 */
export function FramePump({ children }) {
  const invalidate = useThree((state) => state.invalidate)
  const deadlineRef = useRef(0)
  const rafRef = useRef(0)

  const stop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [])

  // tick/pulse используют рекурсию через requestAnimationFrame — внутри useCallback
  // `tick` ссылается сам на себя. Используем ref-обёртку, чтобы линтер не жаловался
  // на TDZ при recursive capture (при первом запуске rAF уже видит заполненный ref).
  const tickRef = useRef(() => {})
  const tick = useCallback(() => {
    rafRef.current = 0
    invalidate?.()
    if (performance.now() < deadlineRef.current) {
      rafRef.current = requestAnimationFrame(tickRef.current)
    }
  }, [invalidate])
  tickRef.current = tick

  const pulse = useCallback(
    (durationMs = 700) => {
      if (typeof durationMs !== 'number' || durationMs <= 0) return
      deadlineRef.current = Math.max(deadlineRef.current, performance.now() + durationMs)
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick)
    },
    [tick],
  )

  // Первый кадр после монтирования сцены: гарантируем отрисовку даже если
  // ни один проп не менялся (например, игра загружена из session-кэша).
  useEffect(() => {
    pulse(120)
    return stop
  }, [pulse, stop])

  return <PulseContext.Provider value={pulse}>{children}</PulseContext.Provider>
}

export default FramePump
