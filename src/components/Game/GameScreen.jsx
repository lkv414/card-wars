/**
 * GameScreen
 * Загружает gameState из Supabase по gameId и передаёт в GameBoard.
 * Подписывается на изменения games/game_zones через Realtime.
 *
 * Структура `game` для GameBoard (см. GameBoard.jsx):
 *   game = {
 *     id, lobby_id, status, current_turn, current_player_id,
 *     game_state: { status, currentTurn, currentPlayerId, turnPhase, log },
 *     players: [{ id, player_id, nickname, position, health, hand, zones,
 *                deck_remaining, player_order }],
 *   }
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../utils/supabase'
import { getGuestId } from '../../utils/guestId'
import { ensureGuestId } from '../../utils/guestSession'
import { GameBoard3D } from './GameBoard3D'
import { useGameAction } from '../../hooks/game'
import { useRealtimeChannel } from '../../hooks/useRealtimeChannel'

export function GameScreen() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const guestId = getGuestId()

  const [game, setGame] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadGame = useCallback(async () => {
      if (!gameId) return
      await ensureGuestId()
      setLoading(true)
      setError(null)
      try {
        // Фаза 6: читаем через get_player_game_state — функция сама
        // скрывает hand/deck_pile оппонента и возвращает счётчики.
        const { data: state, error: rpcErr } = await supabase
          .rpc('get_player_game_state', {
            p_game_id: gameId,
            p_player_id: guestId,
          })

        if (rpcErr) throw new Error(rpcErr.message)
        if (!state) throw new Error('Игра не найдена или доступ запрещён')

        setGame({
          id: state.id,
          lobby_id: state.lobby_id,
          status: state.status,
          current_turn: state.current_turn,
          current_player_id: state.current_player_id,
          winner_id: state.winner_id,
          game_state: state.game_state,
          version: state.version,
          started_at: state.started_at,
          ended_at: state.ended_at,
          players: (state.players || []).map((p) => ({
            ...p,
            zones: Array.isArray(p.zones)
              ? p.zones
                  .sort((a, b) => a.zone_position - b.zone_position)
                  .map((z) => z.cards || [])
              : [[], [], [], []],
          })),
        })
      } catch (err) {
        setError(err.message || 'Не удалось загрузить игру')
      } finally {
        setLoading(false)
      }
    }, [gameId, guestId])

  const { playCard, attack, endTurn, forfeit, flipCard } = useGameAction(game, loadGame)

  // Initial load при монтировании если gameId есть
  useEffect(() => {
    if (gameId) {
      // Используем requestAnimationFrame чтобы избежать синхронного setState в useEffect
      const frameId = requestAnimationFrame(() => {
        loadGame()
      })
      return () => cancelAnimationFrame(frameId)
    }
  }, [gameId, loadGame])

  // Realtime subscription (с state machine + reconnect)
  const realtimeStatus = useRealtimeChannel({
    channelName: gameId ? `game:${gameId}` : null,
    subscriptions: useMemo(() => {
      if (!gameId) return []
      const onChange = () => loadGame()
      return [
        { table: 'games', filter: `id=eq.${gameId}`, callback: onChange },
        { table: 'game_players', filter: `game_id=eq.${gameId}`, callback: onChange },
        { table: 'game_zones', filter: `game_id=eq.${gameId}`, callback: onChange },
      ]
    }, [gameId, loadGame]),
  })

  if (loading) {
    return <div className="game-loading" role="status" aria-live="polite">Загружаем игру...</div>
  }

  if (error) {
    return (
      <main className="game-error" role="main" aria-live="assertive">
        <h1>Ошибка</h1>
        <p>{error}</p>
        <button onClick={() => navigate('/lobby')}>← Назад в лобби</button>
      </main>
    )
  }

  if (!game) {
    return <div className="game-loading" role="status" aria-live="polite">Игра не найдена</div>
  }

  return (
    <GameBoard3D
      game={game}
      playerId={guestId}
      onGameEnd={() => navigate('/lobby')}
      onPlayCard={playCard}
      onAttack={attack}
      onFlipCard={flipCard}
      onEndTurn={endTurn}
      onForfeit={forfeit}
      realtimeStatus={realtimeStatus}
    />
  )
}
