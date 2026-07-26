/**
 * GameStatus - Display player status (health, frozen tokens)
 */
import './GameStatus.css'
import { safePlayer } from '../../utils/safePlayer'

export function GameStatus({ player, isOpponent }) {
  // Защита: player может прийти undefined из Realtime payload.
  // safePlayer гарантирует все нужные поля.
  const safeP = safePlayer([player].filter(Boolean), player?.player_id)

  return (
    <div className={`game-status ${isOpponent ? 'opponent' : 'player'}`}>
      <div className="player-info">
        <h3 className="player-title">{isOpponent ? 'Противник' : 'Вы'}</h3>

        <div className="health-section">
          <div className="health-display">
            <span className="health-label">❤️ Здоровье</span>
            <span className="health-value">{safeP.health}/25</span>
          </div>
          <div className="health-bar">
            <div
              className="health-fill"
              style={{
                width: `${(Math.max(0, safeP.health) / 25) * 100}%`,
              }}
            />
          </div>
        </div>

        {safeP.frozenTokens > 0 && (
          <div className="frozen-tokens">
            <span className="frozen-label">❄️ Заморожено</span>
            <span className="frozen-count">{safeP.frozenTokens}</span>
          </div>
        )}

        <div className="deck-info">
          <span className="deck-label">📚 В колоде</span>
          <span className="deck-count">{safeP.deckCount ?? safeP.deck_pile?.length ?? 0}</span>
        </div>
      </div>
    </div>
  )
}

export default GameStatus
