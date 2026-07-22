/**
 * GameStatus - Display player status (health, frozen tokens)
 */
import './GameStatus.css'

export function GameStatus({ player, isOpponent }) {
  return (
    <div className={`game-status ${isOpponent ? 'opponent' : 'player'}`}>
      <div className="player-info">
        <h3 className="player-title">{isOpponent ? 'Противник' : 'Вы'}</h3>

        <div className="health-section">
          <div className="health-display">
            <span className="health-label">❤️ Здоровье</span>
            <span className="health-value">{player.health}/25</span>
          </div>
          <div className="health-bar">
            <div
              className="health-fill"
              style={{
                width: `${(Math.max(0, player.health) / 25) * 100}%`,
              }}
            />
          </div>
        </div>

        {player.frozenTokens > 0 && (
          <div className="frozen-tokens">
            <span className="frozen-label">❄️ Заморожено</span>
            <span className="frozen-count">{player.frozenTokens}</span>
          </div>
        )}

        <div className="deck-info">
          <span className="deck-label">📚 В колоде</span>
          <span className="deck-count">{player.deckCount}</span>
        </div>
      </div>
    </div>
  )
}

export default GameStatus
