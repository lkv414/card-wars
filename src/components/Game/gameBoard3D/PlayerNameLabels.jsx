import { Html } from '@react-three/drei'
import { getPlayerNameLabelAnchor } from './layout'

function displayName(player, playerIndex) {
  const nick = player?.nickname?.trim()
  if (nick) return nick
  const id = player?.player_id
  if (id) return `Игрок ${id.slice(0, 6).toUpperCase()}`
  return `Игрок ${playerIndex + 1}`
}

/** Всплывающие облачка с никами над рядом земель каждого игрока. */
export function PlayerNameLabels({
  players = [],
  playerCount,
  myIndex,
  myPlayerId,
  currentPlayerId,
}) {
  if (playerCount < 2) return null

  return players.map((player, playerIndex) => {
    if ((player?.health ?? 0) <= 0) return null

    const isMe = player.player_id === myPlayerId
    const isTurn = Boolean(currentPlayerId) && player.player_id === currentPlayerId
    const name = displayName(player, playerIndex)
    const position = getPlayerNameLabelAnchor(playerIndex, playerCount, myIndex)

    const className = [
      'player-name-bubble',
      isMe && 'player-name-bubble--me',
      isTurn && 'player-name-bubble--turn',
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <Html
        key={player.player_id || playerIndex}
        position={position}
        center
        distanceFactor={9}
        zIndexRange={[40, 0]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        className="player-name-bubble-html"
      >
        <div className={className} aria-label={`${name}${isMe ? ', вы' : ''}${isTurn ? ', ход' : ''}`}>
          <span className="player-name-bubble-text">
            {name}
            {isMe ? ' (вы)' : ''}
          </span>
          {isTurn && (
            <span className="player-name-bubble-turn-badge" aria-hidden>
              ход
            </span>
          )}
        </div>
      </Html>
    )
  })
}
