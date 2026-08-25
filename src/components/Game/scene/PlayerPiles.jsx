/**
 * PlayerPiles — свои зоны колоды и сброса у каждого игрока (пункты 5.1–5.3).
 *
 * Два прямоугольника (3D-фигуры) по краям от крайних земель игрока:
 *  - левый: КОЛОДА — счётчик карт сверху слева;
 *    клик по своей колоде = взять одну бесплатную карту за ход (5.2)
 *  - правый: СБРОС — счётчик карт сверху справа;
 *    клик по своему сбросу при выбранной карте = отправить её в сброс (5.3)
 *
 * По паттерну testing_3d: чистая отрисовка + колбэки снаружи.
 */
import { memo, useState } from 'react'
import { Text, useCursor } from '@react-three/drei'
import {
  PLAY_FIELD_Y,
  PLAY_FIELD_WIDTH,
  HALF_LANE_DEPTH,
} from '../../../utils/gameObjectPlacement'

const PILE_GAP = 0.3
const PILE_W = 0.95
const PILE_D = 1.32
const PILE_H = 0.08

/** X-центр пайла относительно центра поля (влево для колоды, вправо для сброса). */
const PILE_X = PLAY_FIELD_WIDTH / 2 + PILE_GAP + PILE_W / 2

const DECK_COLOR = '#7a5c44'
const DECK_COLOR_HOT = '#a07b5c'
const DISCARD_COLOR = '#4e4a45'
const DISCARD_COLOR_HOT = '#6e675f'

function PileBox({ position, baseColor, hotColor, hot, onClick }) {
  const [hovered, setHovered] = useState(false)
  const interactive = Boolean(onClick)
  useCursor(hovered && interactive, 'pointer')

  return (
    <mesh
      position={[position[0], PLAY_FIELD_Y + PILE_H / 2, position[2]]}
      castShadow
      receiveShadow
      onClick={
        interactive
          ? (e) => {
              e.stopPropagation()
              onClick()
            }
          : undefined
      }
      onPointerOver={
        interactive
          ? (e) => {
              e.stopPropagation()
              setHovered(true)
            }
          : undefined
      }
      onPointerOut={() => setHovered(false)}
    >
      <boxGeometry args={[PILE_W, PILE_H, PILE_D]} />
      <meshStandardMaterial
        color={hot || hovered ? hotColor : baseColor}
        roughness={0.85}
        metalness={0.05}
        transparent
        opacity={interactive || hovered ? 0.98 : 0.85}
      />
    </mesh>
  )
}

/**
 * @param {object} props
 * @param {Array<object>} props.players — игроки партии
 * @param {number} props.myIndex — индекс локального игрока
 * @param {boolean} props.canFreeDraw — можно ли взять бесплатную карту
 * @param {boolean} props.hasActiveCard — в руке выбрана карта (для сброса)
 * @param {Function} props.onDeckClick
 * @param {Function} props.onDiscardClick
 */
export const PlayerPiles = memo(function PlayerPiles({
  players,
  myIndex,
  canFreeDraw = false,
  hasActiveCard = false,
  onDeckClick,
  onDiscardClick,
}) {
  if (!Array.isArray(players) || players.length !== 2) return null

  return (
    <group>
      {players.map((player, idx) => {
        if (!player || (player.health ?? 0) <= 0) return null
        const isMine = idx === myIndex
        const zSign = isMine ? 1 : -1
        const z = zSign * (HALF_LANE_DEPTH / 2)

        const deckCount = player.deck_pile?.length ?? player.deck_remaining ?? 0
        const discardCount = player.discard_pile?.length ?? player.discard_count ?? 0

        const deckClickable = isMine && canFreeDraw && deckCount > 0
        const discardClickable = isMine && hasActiveCard

        return (
          <group key={`piles-${player.player_id ?? idx}`}>
            {/* Колода — слева от крайней левой земли */}
            <PileBox
              position={[-PILE_X, 0, z]}
              baseColor={DECK_COLOR}
              hotColor={DECK_COLOR_HOT}
              hot={deckClickable}
              onClick={deckClickable ? onDeckClick : undefined}
            />
            <Text
              position={[-PILE_X - PILE_W / 2 + 0.14, PLAY_FIELD_Y + 0.34, z - PILE_D / 2]}
              fontSize={0.16}
              color="#ffe082"
              anchorX="left"
              anchorY="middle"
              outlineWidth={0.015}
              outlineColor="#1a1a1a"
              fontWeight="bold"
            >
              {`📚 ${deckCount}`}
            </Text>

            {/* Сброс — справа от крайней правой земли */}
            <PileBox
              position={[PILE_X, 0, z]}
              baseColor={DISCARD_COLOR}
              hotColor={DISCARD_COLOR_HOT}
              hot={discardClickable}
              onClick={discardClickable ? onDiscardClick : undefined}
            />
            <Text
              position={[PILE_X + PILE_W / 2 - 0.14, PLAY_FIELD_Y + 0.34, z - PILE_D / 2]}
              fontSize={0.16}
              color="#ffb3ab"
              anchorX="right"
              anchorY="middle"
              outlineWidth={0.015}
              outlineColor="#1a1a1a"
              fontWeight="bold"
            >
              {`🗑️ ${discardCount}`}
            </Text>
          </group>
        )
      })}
    </group>
  )
})

export default PlayerPiles
