/**
 * GameBoard - Main game board component
 * UNO-like layout: 4 zones (2x2 grid)
 */
import { useState, useEffect } from 'react'
import GameEngine from '../game/gameEngine'
import './GameBoard.css'
import GameZone from './GameZone'
import PlayerHand from './PlayerHand'
import GameLog from './GameLog'
import GameStatus from './GameStatus'

export function GameBoard({ game, playerId, onGameEnd }) {
  const [engine, setEngine] = useState(null)
  const [gameState, setGameState] = useState(null)
  const [selectedCardIndex, setSelectedCardIndex] = useState(null)
  const [targetZone, setTargetZone] = useState(null)
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Initialize game engine
  useEffect(() => {
    try {
      const player1Id = game.players[0].id
      const player2Id = game.players[1].id
      const deck1 = game.players[0].deck
      const deck2 = game.players[1].deck
      const lands1 = game.players[0].lands
      const lands2 = game.players[1].lands

      const newEngine = new GameEngine(player1Id, player2Id, deck1, deck2, lands1, lands2)
      const initialState = newEngine.initialize()

      setEngine(newEngine)
      setGameState(initialState)
      setLog(newEngine.gameState.log)
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [game])

  if (loading) return <div className="game-board loading">Loading game...</div>
  if (error) return <div className="game-board error">Error: {error}</div>

  if (!engine || !gameState) return null

  const isYourTurn = gameState.gameState.currentPlayerId === playerId
  const isPlayer1 = playerId === game.players[0].id
  const currentPlayerState = isPlayer1 ? gameState.player1 : gameState.player2
  const opponentState = isPlayer1 ? gameState.player2 : gameState.player1

  // Handle card play
  const handlePlayCard = (cardIndex, zoneIndex) => {
    try {
      const result = engine.playCard(playerId, cardIndex, zoneIndex, 1)
      setGameState({ ...engine.getGameState() })
      setSelectedCardIndex(null)
      setLog([...engine.gameState.log])
    } catch (err) {
      setError(err.message)
      setTimeout(() => setError(null), 3000)
    }
  }

  // Handle attack
  const handleAttack = (fromZone, cardId, toOpponentZone) => {
    try {
      const result = engine.attack(playerId, fromZone, cardId, toOpponentZone)
      setGameState({ ...engine.getGameState() })
      setLog([...engine.gameState.log])
    } catch (err) {
      setError(err.message)
      setTimeout(() => setError(null), 3000)
    }
  }

  // Handle end turn
  const handleEndTurn = () => {
    try {
      engine.endTurn()
      setGameState({ ...engine.getGameState() })
      setLog([...engine.gameState.log])
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="game-board">
      {/* Opponent view */}
      <div className="game-section opponent-section">
        <GameStatus player={opponentState} isOpponent={true} />
        <div className="zones-grid opponent-zones">
          {[0, 1, 2, 3].map(zoneIndex => (
            <GameZone
              key={`opponent-zone-${zoneIndex}`}
              zoneIndex={zoneIndex}
              cards={opponentState.zones[zoneIndex]}
              isOpponentZone={true}
              onCardClick={() => {}}
            />
          ))}
        </div>
      </div>

      {/* Center - Actions and Status */}
      <div className="game-center">
        <div className="turn-info">
          <div className="turn-status">
            <h2>
              {gameState.gameState.status === 'finished'
                ? `🎉 ${gameState.gameState.winner === playerId ? 'Вы выиграли!' : 'Вы проиграли!'}`
                : isYourTurn
                  ? '👉 Ваш ход'
                  : '⏳ Ход противника'}
            </h2>
            <p>Ход #{gameState.gameState.currentTurn}</p>
          </div>

          {isYourTurn && gameState.gameState.status !== 'finished' && (
            <div className="actions">
              <div className="action-info">
                <span>Действий осталось: {currentPlayerState.actionsRemaining}</span>
                {currentPlayerState.hasAttacked && <span className="attacked">✓ Атаковали</span>}
              </div>
              <button className="btn-primary" onClick={handleEndTurn}>
                Закончить ход
              </button>
            </div>
          )}

          {gameState.gameState.status === 'finished' && (
            <button className="btn-primary" onClick={() => onGameEnd?.()}>
              Вернуться в меню
            </button>
          )}
        </div>

        <GameLog log={log.slice(-5)} />
      </div>

      {/* Your zones */}
      <div className="game-section player-section">
        <div className="zones-grid player-zones">
          {[0, 1, 2, 3].map(zoneIndex => (
            <GameZone
              key={`player-zone-${zoneIndex}`}
              zoneIndex={zoneIndex}
              cards={currentPlayerState.zones[zoneIndex]}
              isOpponentZone={false}
              onCardClick={() => {}}
              onAttack={handleAttack}
            />
          ))}
        </div>

        <PlayerHand
          cards={currentPlayerState.hand}
          actionsRemaining={currentPlayerState.actionsRemaining}
          isYourTurn={isYourTurn}
          onPlayCard={handlePlayCard}
          selectedCardIndex={selectedCardIndex}
          onSelectCard={setSelectedCardIndex}
        />
      </div>

      {error && <div className="error-toast">{error}</div>}
    </div>
  )
}

export default GameBoard
