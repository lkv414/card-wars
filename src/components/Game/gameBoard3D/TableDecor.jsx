import * as THREE from 'three'
import { TABLE_RADIUS } from './layout'

export function TableDecor() {
  return (
    <>
      <mesh receiveShadow position={[0, 0, 0]}>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.18, 64]} />
        <meshStandardMaterial color="#1f2940" roughness={0.95} metalness={0.05} />
      </mesh>

      <mesh receiveShadow position={[0, 0.092, 0]}>
        <cylinderGeometry args={[TABLE_RADIUS - 0.5, TABLE_RADIUS - 0.5, 0.02, 64]} />
        <meshStandardMaterial color="#2a3554" roughness={0.7} metalness={0.15} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.094, 0]}>
        <ringGeometry args={[TABLE_RADIUS - 0.55, TABLE_RADIUS - 0.4, 64]} />
        <meshStandardMaterial color="#ffd700" emissive="#ffd700" emissiveIntensity={0.35} side={THREE.DoubleSide} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.095, 0]}>
        <ringGeometry args={[1.6, 2.0, 48]} />
        <meshStandardMaterial color="#ffd700" emissive="#ffd700" emissiveIntensity={0.3} side={THREE.DoubleSide} />
      </mesh>

      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i / 8) * Math.PI * 2
        const r = 1.8
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        return (
          <mesh key={`rune-${i}`} rotation={[-Math.PI / 2, 0, a]} position={[x, 0.097, z]}>
            <ringGeometry args={[0.12, 0.18, 6]} />
            <meshStandardMaterial color="#7fb3ff" emissive="#7fb3ff" emissiveIntensity={0.6} side={THREE.DoubleSide} />
          </mesh>
        )
      })}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.093, 0]}>
        <circleGeometry args={[1.55, 48]} />
        <meshStandardMaterial color="#3d5a8a" transparent opacity={0.18} side={THREE.DoubleSide} />
      </mesh>
    </>
  )
}
