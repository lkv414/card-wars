/**
 * GameCanvas — единая R3F-обвязка игрового 3D-стола.
 *
 * По паттерну testing_3d (SceneCanvas): Canvas + shadows + dpr=[1,2] + antialias +
 * onPointerMissed для сброса выбора + ACES tone-mapping + WebGL context-loss guard.
 * Внутри — <Suspense> + children (домен-компоненты).
 */
import { Suspense, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'

const CAMERA_FOV = 42

/**
 * @param {object} props
 * @param {boolean} [props.shadows] shadows on/off
 * @param {(e: any) => void} [props.onPointerMissed] снятие выбора кликом в пустоту
 * @param {(gl: any) => void} [props.onCreated] хук после init WebGL
 * @param {(message: string) => void} [props.onToastError] показать toast при потере контекста
 * @param {React.ReactNode} props.children
 */
export function GameCanvas({
  shadows = true,
  onPointerMissed,
  onCreated,
  onToastError,
  children,
}) {
  const handlePointerMissed = useCallback(
    (e) => {
      onPointerMissed?.(e)
    },
    [onPointerMissed],
  )

  const handleCreated = useCallback(
    ({ gl }) => {
      gl.domElement.style.touchAction = 'none'
      gl.toneMapping = THREE.ACESFilmicToneMapping
      gl.toneMappingExposure = 1.08
      if (shadows) gl.shadowMap.type = THREE.PCFShadowMap
      gl.outputColorSpace = THREE.SRGBColorSpace

      const canvas = gl.domElement
      const handleContextLost = (event) => {
        event.preventDefault()
        onToastError?.('WebGL контекст потерян — перезагрузите страницу')
      }
      canvas.addEventListener('webglcontextlost', handleContextLost)

      onCreated?.({ gl })
    },
    [shadows, onCreated, onToastError],
  )

  return (
    <Canvas
      shadows={shadows}
      camera={{
        fov: CAMERA_FOV,
        near: 0.1,
        far: 100,
        position: [0, 6, 8],
      }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ background: 'linear-gradient(180deg, #5a6a75 0%, #3d4a52 100%)' }}
      onCreated={handleCreated}
      onPointerMissed={handlePointerMissed}
    >
      <Suspense fallback={null}>{children}</Suspense>
    </Canvas>
  )
}

export default GameCanvas
