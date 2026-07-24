/**
 * GameBoard - Main game board
 * Layout (от противника к игроку, сверху вниз):
 *   1. Полоска статуса противника (HP, карты в руке рубашкой)
 *   2. Ряд земель противника (ближе к центру стола)
 *   3. Ряд строений противника (ближе к центру, над землями? нет — между землями и центром)
 *   4. Центр стола (наклон rotateX)
 *   5. Ряд строений игрока (ближе к центру)
 *   6. Ряд земель игрока (ближе к игроку)
 *   7. Полоска статуса игрока (HP, карты в руке лицом)
 *   8. Летающие карты в воздухе перед игроком (overlap статус)
 */
import { useState, useEffect } from 'react'
import { gameToEngineFormat } from '../../hooks/useGameAction'
import './GameBoard.css'
import { Card3D } from './Card3D'
import { GameLog } from './GameLog'

const NUM_SLOTS = 4

export function GameBoard({ game, playerId, onGameEnd, onPlayCard, onAttack, onEndTurn }) {
  const [gameState, setGameState] = useState(null)
  const [selectedCardIndex, setSelectedCardIndex] = useState(null)
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    try {
      const formatted = gameToEngineFormat(game, playerId)
      if (!formatted) throw new Error('Не удалось собрать состояние игры')
      setGameState(formatted)
      setLog(formatted.gameState.log || [])
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [game, playerId])

  if (loading) return <div className="game-board loading">Загрузка...</div>
  if (error) return <div className="game-board error">Ошибка: {error}</div>
  if (!gameState) return null

  const isYourTurn = gameState.gameState.currentPlayerId === playerId
  const isPlayer1 = playerId === game.players[0].player_id
  const currentPlayerState = isPlayer1 ? gameState.player1 : gameState.player2
  const opponentState = isPlayer1 ? gameState.player2 : gameState.player1

  // Helper: клик по слоту земли → playCard в этот слот
  const handleLandClick = (zoneIndex) => {
    if (!isYourTurn) return
    if (selectedCardIndex === null) return
    if (onPlayCard) {
      const result = onPlayCard(selectedCardIndex, zoneIndex, 1)
      if (result?.error) {
        setError(result.error)
        setTimeout(() => setError(null), 3000)
      }
      setSelectedCardIndex(null)
    }
  }

  // Helper: клик по слоту строения → playCard (карта кладётся на землю под строением,
  // или атакует из строения). Упрощённо: для существ нельзя — пропускаем.
  // Здесь playCard обрабатывает универсально.

  const handleAttack = (fromZone, cardId, toOppZone) => {
    if (onAttack) {
      const result = onAttack(fromZone, cardId, toOppZone)
      if (result?.error) {
        setError(result.error)
        setTimeout(() => setError(null), 3000)
      }
    }
  }

  const handleEndTurn = () => {
    if (onEndTurn) {
      const result = onEndTurn()
      if (result?.error) setError(result.error)
    }
  }

  return (
    <div className="game-board">
      {/* 1. Полоска статуса противника */}
      <div className="opponent-bar">
        <div className="opponent-health">
          <span className="opponent-name">Противник</span>
          <span className="opponent-hp">❤️ {opponentState.health}/25</span>
        </div>
        <div className="opponent-hand-count">
          <span>🂠 × {opponentState.hand.length}</span>
        </div>
      </div>

      {/* 2. Сторона противника: строения (ближе к центру) + земли (ближе к игроку-через-центр) */}
      <div className="opponent-side">
        <div className="slot-row slot-buildings">
          {Array.from({ length: NUM_SLOTS }).map((_, i) => (
            <Slot key={`opp-b-${i}`} index={i} isOpponent onAttack={null} />
          ))}
        </div>
        <div className="slot-row slot-lands">
          {Array.from({ length: NUM_SLOTS }).map((_, i) => {
            const cards = opponentState.zones[i] || []
            return (
              <Slot
                key={`opp-l-${i}`}
                index={i}
                isOpponent
                cards={cards}
                onLandClick={null}
                onAttack={(cid) => handleAttack(i, cid, i)}
              />
            )
          })}
        </div>
      </div>

      {/* 3. Центральная панель: ход + кнопка завершения + лог */}
      <div className="center-bar">
        <div className="turn-info">
          <h2>
            {gameState.gameState.status === 'finished'
              ? `🎉 ${gameState.gameState.winner === playerId ? 'Вы выиграли!' : 'Вы проиграли!'}`
              : isYourTurn
                ? '👉 Ваш ход'
                : '⏳ Ход противника'}
          </h2>
          <p>Ход #{gameState.gameState.currentTurn}</p>
          {isYourTurn && gameState.gameState.status !== 'finished' && (
            <>
              <span>Действий: {currentPlayerState.actionsRemaining ?? 2}</span>
              <button className="btn-end-turn" onClick={handleEndTurn}>Закончить ход</button>
            </>
          )}
          {gameState.gameState.status === 'finished' && (
            <button className="btn-end-turn" onClick={() => onGameEnd?.()}>
              Вернуться в меню
            </button>
          )}
        </div>
        <div className="log-info">
          <GameLog log={log.slice(-5)} />
        </div>
      </div>

      {/* 4. Моя сторона: строения (ближе к центру) + земли (ближе ко мне) */}
      <div className="player-side">
        <div className="slot-row slot-buildings">
          {Array.from({ length: NUM_SLOTS }).map((_, i) => (
            <Slot
              key={`me-b-${i}`}
              index={i}
              isOpponent={false}
              onLandClick={() => handleLandClick(i)}
              selected={selectedCardIndex !== null && isYourTurn}
            />
          ))}
        </div>
        <div className="slot-row slot-lands">
          {Array.from({ length: NUM_SLOTS }).map((_, i) => {
            const cards = currentPlayerState.zones[i] || []
            return (
              <Slot
                key={`me-l-${i}`}
                index={i}
                isOpponent={false}
                cards={cards}
                onLandClick={() => handleLandClick(i)}
                onAttack={null}
                selected={selectedCardIndex !== null && isYourTurn}
              />
            )
          })}
        </div>
      </div>

      {/* 5. Летающие карты в воздухе перед игроком (поверх status-bar) */}
      <div className="hand-air">
        <div className="hand-air-inner">
          {(currentPlayerState.hand || []).map((card, idx) => (
            <div
              key={idx}
              className={`flying-card ${selectedCardIndex === idx ? 'selected' : ''}`}
              style={{ '--i': idx, '--n': currentPlayerState.hand.length }}
              onClick={() => {
                if (!isYourTurn) return
                setSelectedCardIndex(selectedCardIndex === idx ? null : idx)
              }}
            >
              <Card3D card={card} isOpponent={false} />
            </div>
          ))}
        </div>
      </div>

      {/* 6. Полоска моего статуса (внизу под картами) */}
      <div className="player-bar">
        <div className="player-health">
          <span className="player-name">Вы</span>
          <span className="player-hp">❤️ {currentPlayerState.health}/25</span>
        </div>
        <div className="player-info">
          <span>🃏 В руке: {currentPlayerState.hand.length}</span>
          <span>📚 В колоде: {currentPlayerState.deck_remaining}</span>
        </div>
      </div>

      {error && <div className="error-toast">{error}</div>}
    </div>
  )
}

/**
 * Slot — пустой или с картами (вид сверху-сбоку, как на столе).
 */
function Slot({ index, isOpponent, cards = [], onLandClick, onAttack, selected }) {
  const hasCards = cards.length > 0
  return (
    <div
      className={`slot ${hasCards ? 'has-cards' : 'empty'} ${selected ? 'selectable' : ''} ${isOpponent ? 'opponent' : 'mine'}`}
      onClick={() => {
        if (onLandClick) onLandClick()
      }}
    >
      <span className="slot-label">{index + 1}</span>
      {hasCards && cards.map((card, ci) => (
        <div key={ci} className="slot-card">
          <Card3D card={card} isOpponent={isOpponent} onAttack={onAttack ? () => onAttack(card.id) : null} />
        </div>
      ))}
    </div>
  )
}

export default GameBoard