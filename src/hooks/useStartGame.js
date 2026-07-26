import { useCallback, useState } from 'react'
import { supabase } from '../utils/supabase'
import { getGuestId } from '../utils/guestId'
import { isLobbyDeckPlayable } from '../utils/lobbyDeck'

async function startGameForLobby(lobbyId, hostId) {
  const { data: players, error: playersErr } = await supabase
    .from('lobby_players')
    .select('player_id, nickname, deck')
    .eq('lobby_id', lobbyId)

  if (playersErr) throw new Error(`Не удалось загрузить игроков: ${playersErr.message}`)
  if (!players || players.length < 2) throw new Error('Нужно минимум 2 игрока')

  const withoutDeck = players.filter((player) => !isLobbyDeckPlayable(player.deck))
  if (withoutDeck.length > 0) {
    const names = withoutDeck.map((player) => player.nickname || player.player_id.slice(0, 6)).join(', ')
    throw new Error(`Нет колоды у: ${names}. Выберите колоду и перезайдите в лобби.`)
  }

  const { data: gameId, error: startErr } = await supabase.rpc('start_game_for_lobby', {
    p_guest_id: hostId,
    p_lobby_id: lobbyId,
  })

  if (startErr || !gameId) {
    throw new Error(`Не удалось создать игру: ${startErr?.message || 'RPC не вернул game_id'}`)
  }

  return { gameId }
}

export function useStartGame() {
  const [, setIsStarting] = useState(false)
  const [, setError] = useState(null)

  const startGame = useCallback(async (lobbyId) => {
    if (!lobbyId) return { error: 'lobbyId обязателен' }
    setIsStarting(true)
    setError(null)
    try {
      return await startGameForLobby(lobbyId, getGuestId())
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
