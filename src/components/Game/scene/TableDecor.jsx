/**
 * TableDecor — круглый деревянный стол + сукно с разметкой lane-линий.
 *
 * По паттерну testing_3d: один компонент, отвечает за «окружение» стола.
 * Чистый 3D, без доменной логики.
 */
import { memo } from 'react'
import { PLAY_MAT_COLOR } from '../../../constants/landColors'
import {
  PLAY_FIELD_WIDTH,
  PLAY_FIELD_DEPTH,
  TABLE_RADIUS,
} from '../../../utils/gameObjectPlacement'
import { PlayFieldGrid } from './PlayFieldGrid'

const TABLE_BASE_Y = 0.04
const TABLE_FELT_Y = 0.085
const FELT_THICKNESS = 0.012

/**
 * Сукно (зелёное поле) с разметкой lane-линий.
 */
function PlayFieldMat() {
  return (
    <group position={[0, TABLE_FELT_Y - 0.002, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[PLAY_FIELD_WIDTH + 0.2, PLAY_FIELD_DEPTH + 0.2]} />
        <meshStandardMaterial color={PLAY_MAT_COLOR} roughness={0.95} metalness={0} />
      </mesh>
      <PlayFieldGrid />
    </group>
  )
}

/**
 * Круглый деревянный стол + сукно. В 2-игрокном режиме сукно накрывает поле.
 *
 * Все меши статичны — matrixAutoUpdate=false убирает пересчёт матриц каждый кадр.
 */
export const TableDecor = memo(function TableDecor({ playerCount = 2 }) {
  return (
    <>
      {/* Большой деревянный стол */}
      <mesh receiveShadow position={[0, TABLE_BASE_Y, 0]} matrixAutoUpdate={false}>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS + 0.06, 0.08, 64]} />
        <meshStandardMaterial color="#5d4037" roughness={0.94} metalness={0.02} />
      </mesh>

      {/* Внутренний круг — поле/сукно */}
      <mesh receiveShadow position={[0, TABLE_FELT_Y, 0]} matrixAutoUpdate={false}>
        <cylinderGeometry
          args={[TABLE_RADIUS - 0.2, TABLE_RADIUS - 0.2, FELT_THICKNESS, 64]}
        />
        <meshStandardMaterial color="#6d4c41" roughness={0.88} metalness={0.04} />
      </mesh>

      {/* Зелёное сукно с разметкой (только 2 игрока) */}
      {playerCount === 2 && <PlayFieldMat />}
    </>
  )
})

export default TableDecor