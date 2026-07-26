/**
 * useStartGame
 * Хост жмёт «Старт» → хук создаёт в Supabase:
 *   1. games (1 запись, status='active', version=1)
 *   2. game_players (по одной на каждого lobby_players:
 *        hand = стартовая раздача из lobby_players.deck.cards,
 *        deck_remaining = оставшиеся в колоде)
 *   3. game_zones (по 4 на каждого; land_id из deck.lands если есть)
 *
 * Колода приходит локально → расшифровывается при входе в лобби
 * (buildLobbyDeckPayload) → лежит в lobby_players.deck → здесь раздаётся.
 *
 * Возвращает { startGame, isStarting, error }.
 * Рейс-условие: только host вызывает startGame. Если игра уже создана
 * (race между двумя вкладками) — возвращаем существующую.
 */
import { useCallback, useState } from 'react'
import { supabase } from '../utils/supabase'
import { getGuestId } from '../utils/guestId'
import { ensureGuestId } from '../utils/guestSession'
import { STARTING_HAND_SIZE } from '../constants/game'
import { dealStartingHand, isLobbyDeckPlayable } from '../utils/lobbyDeck'

const POSITIONS = ['player1', 'player2', 'player3', 'player4']

/**
 * @param {string} lobbyId
 * @param {string} hostId  guestId текущего пользователя
 * @returns {Promise<{gameId: string}|null>}
 */
async function startGameForLobby(lobbyId, hostId) {
  // Фаза 6: RLS требует guest_id в сеансе.
  await ensureGuestId()

  // 1. Загрузить игроков лобби (с колодами)
  const { data: players, error: playersErr } = await supabase
    .from('lobby_players')
    .select('player_id, nickname, deck, ready')
    .eq('lobby_id', lobbyId)
    .order('joined_at', { ascending: true })

  if (playersErr) throw new Error(`Не удалось загрузить игроков: ${playersErr.message}`)
  if (!players || players.length < 2) {
    throw new Error('Нужно минимум 2 готовых игрока')
  }

  // 1b. У каждого должна быть прикреплённая колода с картами
  const withoutDeck = players.filter((p) => !isLobbyDeckPlayable(p.deck))
  if (withoutDeck.length > 0) {
    const names = withoutDeck
      .map((p) => p.nickname || p.player_id.slice(0, 6))
      .join(', ')
    throw new Error(`Нет колоды у: ${names}. Выберите колоду в «Мои колоды» и перезайдите в лобби.`)
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
  const hostIndex = players.findIndex((p) => p.player_id === hostId)
  if (hostIndex === -1) {
    throw new Error('Только хост может начать игру')
  }

  // Reorder: host первым, остальные по joined_at
  const ordered = [
    players[hostIndex],
    ...players.slice(0, hostIndex),
    ...players.slice(hostIndex + 1),
  ]

  // 4. Подготовить игровые строки до создания games.
  // Триггер games_validate проверяет current_player_id по game_players,
  // поэтому INSERT games должен выполняться после game_players.
  const firstPlayerId = ordered[0].player_id
  const initialGameState = {
    status: 'active',
    currentTurn: 0,
    currentPlayerId: firstPlayerId,
    turnPhase: 'draw',
    log: ordered.map((p) => ({
      timestamp: Date.now(),
      message: `${p.nickname || 'Игрок'} · колода «${p.deck?.name || '—'}» (${p.deck?.cardCount ?? p.deck?.cards?.length ?? 0} карт)`,
    })),
  }

  const dealtByPlayer = ordered.map((p) => {
    const dealt = dealStartingHand(p.deck, STARTING_HAND_SIZE)
    return { player: p, ...dealt }
  })

  // 5. Сначала создать временную games-запись без current_player_id.
  // Затем добавить game_players и отдельным UPDATE назначить первый ход.
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .insert({
      lobby_id: lobbyId,
      status: 'setup',
      current_turn: 0,
      current_player_id: null,
      game_state: { ...initialGameState, status: 'setup', currentPlayerId: null },
      version: 1,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (gameErr || !game?.id) {
    throw new Error(`Не удалось создать игру: ${gameErr?.message || 'unknown'}`)
  }

  const gameId = game.id

  const gamePlayersRows = dealtByPlayer.map(({ player: p, hand, deckRemaining, deckPile }, idx) => ({
    game_id: gameId,
    player_id: p.player_id,
    nickname: p.nickname || `Игрок ${idx + 1}`,
    health: 25,
    hand,
    deck_pile: deckPile,
    deck_remaining: deckRemaining,
    position: POSITIONS[idx] || `player${idx + 1}`,
    player_order: idx + 1,
  }))

  const { error: gpErr } = await supabase
    .from('game_players')
    .insert(gamePlayersRows)

  if (gpErr) {
    throw new Error(`Не удалось создать игроков: ${gpErr.message}`)
  }

  // 6. Создать game_zones для каждого (4 зоны + земли из колоды, если есть)
  const zonesRows = []
  for (const { player: p, lands } of dealtByPlayer) {
    for (let z = 1; z <= 4; z += 1) {
      const land = lands[z - 1]
      zonesRows.push({
        game_id: gameId,
        player_id: p.player_id,
        zone_position: z,
        cards: [],
        land_id: land?.id || null,
      })
    }
  }

  const { error: zonesErr } = await supabase
    .from('game_zones')
    .insert(zonesRows)

  if (zonesErr) {
    throw new Error(`Не удалось создать зоны: ${zonesErr.message}`)
  }

  const { error: activateErr } = await supabase
    .from('games')
    .update({
      status: 'active',
      current_player_id: firstPlayerId,
      game_state: initialGameState,
      version: 2,
    })
    .eq('id', gameId)
    .eq('version', 1)

  if (activateErr) {
    throw new Error(`Не удалось активировать игру: ${activateErr.message}`)
  }

  // 8. Обновить статус лобби (useLobby подхватит через Realtime)
  await supabase
    .from('lobbies')
    .update({ status: 'in_game' })
    .eq('id', lobbyId)

  return { gameId }
}

export function useStartGame() {
  const [, setIsStarting] = useState(false)
  const [, setError] = useState(null)

  const startGame = useCallback(async (lobbyId) => {
    if (!lobbyId) {
      const e = 'lobbyId обязателен'
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

  return { startGame, isStarting: false, error: null }
}
