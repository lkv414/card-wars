/**
 * Освещение — мягкий свет над игровым столом (реалистичная комната).
 */
export function SceneLighting() {
  return (
    <>
      <color attach="background" args={['#3d4f5f']} />
      <fog attach="fog" args={['#4a5d6a', 18, 40]} />

      <hemisphereLight args={['#e8eef2', '#4a3728', 0.5]} />
      <ambientLight intensity={0.38} />

      <directionalLight
        position={[3, 9, 4]}
        intensity={1.05}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={24}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.0002}
      />

      <pointLight position={[0, 5, 2]} intensity={0.25} color="#fff5e6" distance={14} decay={2} />
    </>
  )
}
