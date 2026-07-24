/**
 * useStartGame
 * Хост жмёт «Старт» → хук создаёт в Supabase:
 *   1. games (1 запись, status='active', version=1)
 *   2. game_players (по одной на каждого lobby_players, player_order=1..N)
 *   3. game_zones (по 4 на каждого игрока, cards=[], land_id=null)
 *
 * Возвращает { startGame, isStarting, error }.
 * Рейс-условие: только host вызывает startGame. Если игры уже создана
 * (race между двумя вкладками) — возвращаем существующую.
 */
import { useCallback, useState } from 'react'
import { supabase } from '../utils/supabase'
import { getGuestId } from '../utils/guestId'

const POSITIONS = ['player1', 'player2', 'player3', 'player4']

/**
 * @param {string} lobbyId
 * @param {string} hostId  guestId текущего пользователя
 * @returns {Promise<{gameId: string}|null>}
 */
async function startGameForLobby(lobbyId, hostId) {
  // 1. Загрузить игроков лобби
  const { data: players, error: playersErr } = await supabase
    .from('lobby_players')
    .select('player_id, nickname, deck, ready')
    .eq('lobby_id', lobbyId)
    .order('joined_at', { ascending: true })

  if (playersErr) throw new Error(`Не удалось загрузить игроков: ${playersErr.message}`)
  if (!players || players.length < 2) {
    throw new Error('Нужно минимум 2 готовых игрока')
  }

  // 2. Проверить, не создана ли уже игра для этого лобби (race-condition)
  const { data: existing } = await supabase
    .from('games')
    .select('id')
    .eq('lobby_id', lobbyId)
    .maybeSingle()

  if (existing?.id) {
    return { gameId: existing.id }
  }

  // 3. Найти хоста (player_id === host_id) — он первый ходит
  const hostIndex = players.findIndex(p => p.player_id === hostId)
  if (hostIndex === -1) {
    throw new Error('Только хост может начать игру')
  }

  // Reorder: host первым, остальные по joined_at
  const ordered = [
    players[hostIndex],
    ...players.slice(0, hostIndex),
    ...players.slice(hostIndex + 1),
  ]

  // 4. Создать game
  const firstPlayerId = ordered[0].player_id
  const initialGameState = {
    status: 'active',
    currentTurn: 0,
    currentPlayerId: firstPlayerId,
    turnPhase: 'draw',
    log: [],
  }

  const { data: game, error: gameErr } = await supabase
    .from('games')
    .insert({
      lobby_id: lobbyId,
      status: 'active',
      current_turn: 0,
      current_player_id: firstPlayerId,
      game_state: initialGameState,
      version: 1,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (gameErr || !game?.id) {
    throw new Error(`Не удалось создать игру: ${gameErr?.message || 'unknown'}`)
  }

  const gameId = game.id

  // 5. Создать game_players для каждого
  const gamePlayersRows = ordered.map((p, idx) => ({
    game_id: gameId,
    player_id: p.player_id,
    nickname: p.nickname || `Игрок ${idx + 1}`,
    health: 25,
    hand: [],
    deck_remaining: Array.isArray(p.deck?.cards) ? p.deck.cards.length : 0,
    position: POSITIONS[idx] || `player${idx + 1}`,
    player_order: idx + 1,
  }))

  const { error: gpErr } = await supabase
    .from('game_players')
    .insert(gamePlayersRows)

  if (gpErr) {
    throw new Error(`Не удалось создать игроков: ${gpErr.message}`)
  }

  // 6. Создать game_zones для каждого (4 зоны)
  const zonesRows = []
  for (const p of ordered) {
    for (let z = 1; z <= 4; z++) {
      zonesRows.push({
        game_id: gameId,
        player_id: p.player_id,
        zone_position: z,
        cards: [],
        land_id: null,
      })
    }
  }

  const { error: zonesErr } = await supabase
    .from('game_zones')
    .insert(zonesRows)

  if (zonesErr) {
    throw new Error(`Не удалось создать зоны: ${zonesErr.message}`)
  }

  // 7. Обновить статус лобби (useLobby подхватит через Realtime)
  await supabase
    .from('lobbies')
    .update({ status: 'in_game' })
    .eq('id', lobbyId)

  return { gameId }
}

export function useStartGame() {
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState(null)

  const startGame = useCallback(async (lobbyId) => {
    if (!lobbyId) {
      const e = 'lobbyId обязателен'
      setError(e)
      return { error: e }
    }

    setIsStarting(true)
    setError(null)

    try {
      const result = await startGameForLobby(lobbyId, getGuestId())
      return result
    } catch (err) {
      const msg = err?.message || 'Неизвестная ошибка'
      setError(msg)
      return { error: msg }
    } finally {
      setIsStarting(false)
    }
  }, [])

  return { startGame, isStarting, error }
}
