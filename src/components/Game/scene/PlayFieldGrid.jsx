/**
 * PlayFieldGrid — печатная разметка на сукне для 2-игрокного режима.
 *
 * Тонкие линии по границам и между вертикальными lanes.
 * Используется как нижний слой под зонами, не требует props.
 */
import { memo } from 'react'
import {
  calculateSharedLaneXs,
  LANE_FULL_DEPTH,
  PLAY_FIELD_DEPTH,
  PLAY_FIELD_WIDTH,
} from '../../../utils/gameObjectPlacement'
import { LAND_BORDER_COLOR } from '../../../constants/landColors'

const LINE_Y = 0.001
const LINE_W = 0.012

function MatLine({ args, position }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={position} matrixAutoUpdate={false}>
      <planeGeometry args={args} />
      <meshBasicMaterial color="#2e5a28" transparent opacity={0.45} />
    </mesh>
  )
}

/**
 * Тонкая печатная разметка на сукне — без неона.
 */
export const PlayFieldGrid = memo(function PlayFieldGrid() {
  const laneXs = calculateSharedLaneXs()
  const halfW = PLAY_FIELD_WIDTH / 2
  const halfD = PLAY_FIELD_DEPTH / 2

  const verticalDividers = []
  for (let i = 0; i < laneXs.length - 1; i++) {
    const x = (laneXs[i] + laneXs[i + 1]) / 2
    verticalDividers.push(
      <MatLine key={`v-${i}`} args={[LINE_W, LANE_FULL_DEPTH]} position={[x, LINE_Y, 0]} />,
    )
  }

  return (
    <group>
      <MatLine args={[PLAY_FIELD_WIDTH, LINE_W]} position={[0, LINE_Y, 0]} />
      {verticalDividers}

      {/* Граница поля (чуть шире, плотнее) */}
      <MatLine
        args={[PLAY_FIELD_WIDTH + 0.06, LINE_W * 1.4]}
        position={[0, LINE_Y, halfD + 0.01]}
      />
      <MatLine
        args={[PLAY_FIELD_WIDTH + 0.06, LINE_W * 1.4]}
        position={[0, LINE_Y, -halfD - 0.01]}
      />
      <MatLine
        args={[LINE_W * 1.4, PLAY_FIELD_DEPTH + 0.06]}
        position={[-halfW - 0.01, LINE_Y, 0]}
      />
      <MatLine
        args={[LINE_W * 1.4, PLAY_FIELD_DEPTH + 0.06]}
        position={[halfW + 0.01, LINE_Y, 0]}
      />

      {/* Тёмная рамка */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, LINE_Y - 0.0005, 0]}>
        <planeGeometry args={[PLAY_FIELD_WIDTH + 0.08, PLAY_FIELD_DEPTH + 0.08]} />
        <meshBasicMaterial color={LAND_BORDER_COLOR} transparent opacity={0.35} />
      </mesh>
    </group>
  )
})

export default PlayFieldGrid