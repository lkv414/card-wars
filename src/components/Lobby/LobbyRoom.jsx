import { useState } from 'react'
import { getGuestId } from '../../utils/guestId'
import './Lobby.css'

export function LobbyRoom({ code, players, status, isHost, hostId, onReady, onLeave, toast }) {
  const [copied, setCopied] = useState(false)
  const guestId = getGuestId()

  const myPlayer = players.find(p => p.player_id === guestId)
  const amReady = myPlayer?.ready ?? false

  const handleCopy = () => {
    const url = `${window.location.origin}/lobby/${code}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <main className="lobby-room">
      <div className="lobby-room__content">
        <button className="lobby-back-btn" onClick={onLeave}>
          ← Выйти из лобби
        </button>

        <h1>Лобби</h1>

        <div className="lobby-code-display">
          <span className="lobby-code-label">Код комнаты</span>
          <div className="lobby-code-value">
            <span>{code}</span>
            <button className="lobby-copy-btn" onClick={handleCopy} title="Скопировать код">
              {copied ? '✓' : '⎘'}
            </button>
          </div>
          <p className="lobby-code-hint">Поделитесь этим кодом с другом</p>
        </div>

        <div className="lobby-players">
          <h2>Игроки ({players.length}/4)</h2>
          <ul className="lobby-players__list">
            {players.map(p => (
              <li key={p.player_id} className="lobby-player">
                <span className="lobby-player__name">
                  {p.player_id === hostId && <span className="lobby-player__host" title="Хост">♛ </span>}
                  {p.nickname || `Игрок ${p.player_id.slice(0, 6).toUpperCase()}`}
                  {p.player_id === guestId && <span className="lobby-player__you"> (вы)</span>}
                </span>
                <span className={`lobby-player__status ${p.ready ? 'ready' : 'waiting'}`}>
                  {p.ready ? '✓ Готов' : 'Ожидание...'}
                </span>
              </li>
            ))}

            {Array.from({ length: Math.max(0, 4 - players.length) }).map((_, i) => (
              <li key={`empty-${i}`} className="lobby-player lobby-player--empty">
                <span className="lobby-player__name">Свободное место</span>
                <span className="lobby-player__status waiting">—</span>
              </li>
            ))}
          </ul>
          {players.length < 2 && (
            <p className="lobby-players__hint">Нужно минимум 2 игрока для старта</p>
          )}
        </div>

        {status === 'in_game' ? (
          <div className="lobby-game-start">
            <p>Игра началась!</p>
          </div>
        ) : (
          <button
            className={`lobby-btn ${amReady ? 'lobby-btn--ready-done' : 'lobby-btn--ready'}`}
            onClick={onReady}
            disabled={amReady || players.length < 2}
            title={players.length < 2 ? 'Нужно минимум 2 игрока' : undefined}
          >
            {amReady ? '✓ Вы готовы' : 'Готов'}
          </button>
        )}
      </div>
    </main>
  )
}
