import * as THREE from 'three'
import { PLAY_MAT_COLOR } from '../../../constants/landColors'
import { PLAY_FIELD_Y, PLAY_FIELD_WIDTH, PLAY_FIELD_DEPTH, TABLE_RADIUS } from './layout'
import { PlayFieldGrid } from './PlayFieldGrid'

function PlayFieldMat() {
  return (
    <group position={[0, PLAY_FIELD_Y - 0.002, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[PLAY_FIELD_WIDTH + 0.2, PLAY_FIELD_DEPTH + 0.2]} />
        <meshStandardMaterial color={PLAY_MAT_COLOR} roughness={0.95} metalness={0} />
      </mesh>
      <PlayFieldGrid />
    </group>
  )
}

export function TableDecor({ playerCount = 2 }) {
  return (
    <>
      <mesh receiveShadow position={[0, 0.04, 0]}>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS + 0.06, 0.08, 64]} />
        <meshStandardMaterial color="#5d4037" roughness={0.94} metalness={0.02} />
      </mesh>

      <mesh receiveShadow position={[0, 0.085, 0]}>
        <cylinderGeometry args={[TABLE_RADIUS - 0.2, TABLE_RADIUS - 0.2, 0.012, 64]} />
        <meshStandardMaterial color="#6d4c41" roughness={0.88} metalness={0.04} />
      </mesh>

      {playerCount === 2 && <PlayFieldMat />}
    </>
  )
}
