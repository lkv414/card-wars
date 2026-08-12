import { Text } from '@react-three/drei'
import { PLAY_FIELD_Y } from './layout'

/** Arrow hint showing attack direction from selected zone toward target. */
export function AttackDirectionHint({ fromCenter, toCenter, label = '⚔️' }) {
  if (!fromCenter || !toCenter) return null

  const dx = toCenter[0] - fromCenter[0]
  const dz = toCenter[2] - fromCenter[2]
  const len = Math.hypot(dx, dz)
  if (len < 0.01) return null

  const midX = (fromCenter[0] + toCenter[0]) / 2
  const midZ = (fromCenter[2] + toCenter[2]) / 2
  const angleY = Math.atan2(dx, dz)

  return (
    <group position={[midX, PLAY_FIELD_Y + 0.06, midZ]} rotation={[0, angleY, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[Math.min(len * 0.6, 2.5), 0.08]} />
        <meshBasicMaterial color="#ff9800" transparent opacity={0.75} depthWrite={false} />
      </mesh>
      <Text
        position={[0, 0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.18}
        color="#ffe082"
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  )
}
