/**
 * PlayerNameLabels — 3D-текст с никами над зонами игроков.
 *
 * По паттерну testing_3d: простой компонент, отвечает только за отрисовку
 * текстовых меток. Доменная логика (resolveName, currentPlayer) приходит
 * снаружи через props.
 */
import { memo } from 'react'
import { Text } from '@react-three/drei'
import {
  calculatePlayerSlotPositions,
  PLAY_FIELD_Y,
} from '../../../utils/gameObjectPlacement'

const LABEL_Y = PLAY_FIELD_Y + 0.55

/**
 * @param {object} props
 * @param {Array<object>} props.players
 * @param {string|null} props.currentPlayerId
 */
export const PlayerNameLabels = memo(function PlayerNameLabels({
  players,
  currentPlayerId,
}) {
  if (!Array.isArray(players)) return null

  return (
    <group>
      {players.map((player, idx) => {
        const slots = calculatePlayerSlotPositions(idx, players.length)
        if (!slots.length) return null

        // Центр ряда земель игрока
        const cx =
          slots.reduce((sum, s) => sum + s.center[0], 0) / slots.length
        const cz =
          slots.reduce((sum, s) => sum + s.center[2], 0) / slots.length

        const isMyTurn = currentPlayerId === player.player_id
        const name = player?.nickname?.trim() || `Игрок ${idx + 1}`
        const color = isMyTurn ? '#fbbf24' : '#cccccc'

        return (
          <Text
            key={player.player_id ?? idx}
            position={[cx, LABEL_Y, cz]}
            rotation={[0, 0, 0]}
            fontSize={0.18}
            color={color}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.018}
            outlineColor="#1a1a1a"
            fontWeight="bold"
          >
            {name}
            {isMyTurn ? ' ★' : ''}
          </Text>
        )
      })}
    </group>
  )
})

export default PlayerNameLabels