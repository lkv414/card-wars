/**
 * GameCanvas — единая R3F-обвязка игрового 3D-стола.
 *
 * Ключевые решения (по PERFORMANCE_AUDIT_3D.md, блок 🔴 Критично):
 *
 *  1. `frameloop="demand"` — сцена статична почти всегда. Кадр рисуется только
 *     по invalidate(): смена пропсов (R3F делает это сам), OrbitControls
 *     (drei дёргает invalidate на 'change') и явный pulse() из <FramePump>.
 *     Экономия: ~95% GPU-работы в покое, нет нагрева и троттлинга.
 *
 *  2. Тени выключены полностью. В игре нет ни одного объекта с castShadow,
 *     поэтому shadow pass + depth-текстура + USE_SHADOWMAP во всех шейдерах
 *     были чистыми потерями.
 *
 *  3. DPR и MSAA зависят от устройства (skills/3d-web-experience):
 *     мобильные — dpr 1.5 и antialias off.
 *
 *  4. Все объектные пропсы (gl / camera / style) вынесены в модульные
 *     константы: раньше они создавались заново в каждом рендере, из-за чего
 *     R3F на каждом рендере прогонял applyProps(gl, ...) и записывал в
 *     WebGLRenderer мусорные поля antialias/powerPreference.
 *
 *  5. При размонтировании чистим глобальный кэш текстур — иначе VRAM рос
 *     монотонно всю сессию (утечка №1 по аудиту).
 */
import { Suspense, useCallback, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'

import { detectDeviceProfile } from '../../../utils/deviceCapabilities'
import { clearTextureCache } from '../../../utils/textureCache'
import { FramePump } from './FramePump'

const CAMERA_FOV = 42

const { maxDpr, antialias } = detectDeviceProfile()

/** Статичный конфиг рендерера — один объект на модуль, не на рендер. */
const GL_CONFIG = Object.freeze({ antialias, powerPreference: 'high-performance' })
const CAMERA_CONFIG = Object.freeze({
  fov: CAMERA_FOV,
  near: 0.1,
  far: 100,
  position: [0, 6, 8],
})
const CANVAS_STYLE = Object.freeze({
  background: '#3d4f5f',
  touchAction: 'none',
})
const DPR_RANGE = [1, maxDpr]

/**
 * @param {object} props
 * @param {(e: any) => void} [props.onPointerMissed] снятие выбора кликом в пустоту
 * @param {(gl: any) => void} [props.onCreated] хук после init WebGL
 * @param {(message: string) => void} [props.onToastError] показать toast при потере контекста
 * @param {'always'|'demand'|'never'} [props.frameloop]
 * @param {React.ReactNode} props.children
 */
export function GameCanvas({
  onPointerMissed,
  onCreated,
  onToastError,
  frameloop = 'demand',
  children,
}) {
  const handlePointerMissed = useCallback(
    (e) => {
      onPointerMissed?.(e)
    },
    [onPointerMissed],
  )

  // Текстуры карт живут в модульном кэше (textureCache) и не принадлежат R3F,
  // поэтому сами по себе не освобождаются при unmount. Чистим их здесь —
  // иначе VRAM растёт монотонно от партии к партии вплоть до потери контекста.
  useEffect(() => () => clearTextureCache(), [])

  const handleCreated = useCallback(
    ({ gl }) => {
      gl.domElement.style.touchAction = 'none'
      gl.toneMapping = THREE.ACESFilmicToneMapping
      gl.toneMappingExposure = 1.08
      gl.outputColorSpace = THREE.SRGBColorSpace
      // Тени осознанно не включаем: в сцене нет castShadow-объектов.
      gl.shadowMap.enabled = false

      const canvas = gl.domElement
      const handleContextLost = (event) => {
        event.preventDefault()
        onToastError?.('WebGL контекст потерян — перезагрузите страницу')
      }
      canvas.addEventListener('webglcontextlost', handleContextLost)

      onCreated?.({ gl })
    },
    [onCreated, onToastError],
  )

  return (
    <Canvas
      camera={CAMERA_CONFIG}
      dpr={DPR_RANGE}
      gl={GL_CONFIG}
      style={CANVAS_STYLE}
      frameloop={frameloop}
      onCreated={handleCreated}
      onPointerMissed={handlePointerMissed}
    >
      <FramePump>
        <Suspense fallback={null}>{children}</Suspense>
      </FramePump>
    </Canvas>
  )
}

export default GameCanvas
