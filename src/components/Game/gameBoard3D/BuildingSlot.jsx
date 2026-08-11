import { SLOT_WIDTH, SLOT_DEPTH } from './layout'

export function BuildingSlot({ position, isOpponent = false }) {
  return (
    <mesh receiveShadow position={position}>
      <boxGeometry args={[SLOT_WIDTH, 0.1, SLOT_DEPTH]} />
      <meshStandardMaterial
        color={isOpponent ? '#1a2335' : '#243a52'}
        emissive="#3b82f6"
        emissiveIntensity={0.15}
        roughness={0.6}
      />
    </mesh>
  )
}
