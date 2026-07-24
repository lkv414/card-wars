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
import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../utils/supabase'
import { getGuestId } from '../../utils/guestId'
import { GameBoard } from './GameBoard'
import { GameBoard3D } from './GameBoard3D'
import { useGameAction } from '../../hooks/useGameAction'

export function GameScreen() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const guestId = getGuestId()

  const [game, setGame] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadGame = useCallback(async () => {
    if (!gameId) return
    setLoading(true)
    setError(null)
    try {
      // 1. game core
      const { data: g, error: gErr } = await supabase
        .from('games')
        .select('id, lobby_id, status, current_turn, current_player_id, game_state, version, winner_id, started_at')
        .eq('id', gameId)
        .maybeSingle()

      if (gErr) throw new Error(gErr.message)
      if (!g) throw new Error('Игра не найдена')

      // 2. players
      const { data: players, error: pErr } = await supabase
        .from('game_players')
        .select('game_id, player_id, nickname, position, health, hand, deck_remaining, player_order, last_seen')
        .eq('game_id', gameId)
        .order('player_order', { ascending: true })

      if (pErr) throw new Error(pErr.message)

      // 3. zones
      const { data: zones, error: zErr } = await supabase
        .from('game_zones')
        .select('id, game_id, player_id, zone_position, cards, land_id')
        .eq('game_id', gameId)
        .order('player_id')
        .order('zone_position')

      if (zErr) throw new Error(zErr.message)

      // 4. Собрать структуру players с zones
      const playersWithZones = (players || []).map((p) => {
        const ownZones = (zones || []).filter((z) => z.player_id === p.player_id)
        // Упорядочить по zone_position, Map {1: [...], 2: [...], 3: [...], 4: [...]}
        const zonesMap = { 1: [], 2: [], 3: [], 4: [] }
        for (const z of ownZones) {
          if (z.zone_position >= 1 && z.zone_position <= 4) {
            zonesMap[z.zone_position] = z.cards || []
          }
        }
        return {
          id: p.player_id,
          player_id: p.player_id,
          nickname: p.nickname,
          position: p.position,
          health: p.health,
          hand: p.hand || [],
          zones: [zonesMap[1], zonesMap[2], zonesMap[3], zonesMap[4]],
          deck_remaining: p.deck_remaining,
          player_order: p.player_order,
        }
      })

      setGame({ ...g, players: playersWithZones })
    } catch (err) {
      setError(err.message || 'Не удалось загрузить игру')
    } finally {
      setLoading(false)
    }
  }, [gameId])

  const { playCard, attack, endTurn } = useGameAction(game, loadGame)

  // initial load + Realtime subscription
  useEffect(() => {
    loadGame()

    const channel = supabase
      .channel(`game:${gameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => loadGame(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
        () => loadGame(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_zones', filter: `game_id=eq.${gameId}` },
        () => loadGame(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [gameId, loadGame])

  if (loading) {
    return <div className="game-loading">Загружаем игру...</div>
  }

  if (error) {
    return (
      <main className="game-error">
        <h1>Ошибка</h1>
        <p>{error}</p>
        <button onClick={() => navigate('/lobby')}>← Назад в лобби</button>
      </main>
    )
  }

  if (!game) {
    return <div className="game-loading">Игра не найдена</div>
  }

  return (
    <GameBoard3D
      game={game}
      playerId={guestId}
      onGameEnd={() => navigate('/lobby')}
      onPlayCard={playCard}
      onAttack={attack}
      onEndTurn={endTurn}
    />
  )
}
