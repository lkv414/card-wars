/**
 * GameLog - Display last game actions
 */
import './GameLog.css'

export function GameLog({ log }) {
  return (
    <div className="game-log">
      <h4>История ходов</h4>
      <div className="log-entries">
        {log && log.length > 0 ? (
          log.map((entry, idx) => (
            <div key={idx} className="log-entry">
              <span className="log-time">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className="log-message">{entry.message}</span>
            </div>
          ))
        ) : (
          <div className="empty-log">Нет действий</div>
        )}
      </div>
    </div>
  )
}

export default GameLog
