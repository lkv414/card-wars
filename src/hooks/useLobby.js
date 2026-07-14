import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { getGuestId } from '../utils/guestId'

/**
 * @typedef {'idle'|'loading'|'waiting'|'ready'|'in_game'|'error'} LobbyStatus
 *
 * @typedef {Object} Player
 * @property {string} player_id
 * @property {string} nickname
 * @property {boolean} ready
 *
 * @typedef {Object} UseLobbyResult
 * @property {LobbyStatus} status
 * @property {string|null} lobbyId
 * @property {Player[]} players
 * @property {string|null} error
 * @property {boolean} isHost
 * @property {(nickname: string) => Promise<string>} createLobby  — возвращает код
 * @property {(code: string, nickname: string) => Promise<void>} joinLobby
 * @property {() => Promise<void>} setReady
 * @property {() => void} leaveLobby
 */

/** @returns {UseLobbyResult} */
export function useLobby() {
  const [status, setStatus] = useState('idle')
  const [lobbyId, setLobbyId] = useState(null)
  const [players, setPlayers] = useState([])
  const [error, setError] = useState(null)
  const [isHost, setIsHost] = useState(false)
  const [hostId, setHostId] = useState(null)

  const channelRef = useRef(null)
  const lobbyIdRef = useRef(null)

  // Синхронизируем ref с state, чтобы использовать актуальное значение внутри колбэков
  useEffect(() => {
    lobbyIdRef.current = lobbyId
  }, [lobbyId])

  const subscribeToLobby = useCallback((id) => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    const channel = supabase
      .channel(`lobby_room:${id}`)
      // Слушаем изменения участников
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lobby_players', filter: `lobby_id=eq.${id}` },
        async () => {
          const { data } = await supabase
            .from('lobby_players')
            .select('*')
            .eq('lobby_id', id)
          setPlayers(data ?? [])
        }
      )
      // Слушаем изменения самого лобби (статус in_game)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${id}` },
        ({ new: updated }) => {
          if (updated?.status) setStatus(updated.status)
        }
      )
      .subscribe()

    channelRef.current = channel
  }, [])

  const createLobby = useCallback(async (nickname) => {
    setStatus('loading')
    setError(null)
    const guestId = getGuestId()

    // Генерировать уникальный код
    let code
    let attempts = 0
    while (attempts < 5) {
      const { generateLobbyCode } = await import('../utils/lobbyCode.js')
      code = generateLobbyCode()
      const { data: existing } = await supabase
        .from('lobbies')
        .select('id')
        .eq('code', code)
        .maybeSingle()
      if (!existing) break
      attempts++
    }

    const { data: lobby, error: lobbyErr } = await supabase
      .from('lobbies')
      .insert({ code, host_id: guestId })
      .select()
      .single()

    if (lobbyErr) {
      setError('Не удалось создать лобби')
      setStatus('error')
      return
    }

    const { error: playerErr } = await supabase.from('lobby_players').insert({
      lobby_id: lobby.id,
      player_id: guestId,
      ready: false,
    })

    if (playerErr) {
      console.error('lobby_players insert error:', playerErr)
      setError(`Не удалось добавить игрока: ${playerErr.message}`)
      setStatus('error')
      return
    }

    setLobbyId(lobby.id)
    setIsHost(true)
    setHostId(guestId)
    subscribeToLobby(lobby.id)

    const { data: playersList } = await supabase
      .from('lobby_players')
      .select('*')
      .eq('lobby_id', lobby.id)
    setPlayers(playersList ?? [])
    setStatus('waiting')

    return code
  }, [subscribeToLobby])

  const joinLobby = useCallback(async (code, nickname) => {
    setStatus('loading')
    setError(null)
    const guestId = getGuestId()

    const { data: lobby, error: findErr } = await supabase
      .from('lobbies')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .maybeSingle()

    if (findErr || !lobby) {
      setError('Лобби с таким кодом не найдено')
      setStatus('error')
      return
    }

    if (lobby.status === 'in_game') {
      setError('Игра уже началась')
      setStatus('error')
      return
    }

    // Проверить, уже ли в лобби
    const { data: existing } = await supabase
      .from('lobby_players')
      .select('player_id')
      .eq('lobby_id', lobby.id)
      .eq('player_id', guestId)
      .maybeSingle()

    if (!existing) {
      const { data: allPlayers } = await supabase
        .from('lobby_players')
        .select('player_id')
        .eq('lobby_id', lobby.id)

      if ((allPlayers ?? []).length >= 4) {
        setError('Лобби уже заполнено (максимум 4 игрока)')
        setStatus('error')
        return
      }

      const { error: joinErr } = await supabase.from('lobby_players').insert({
        lobby_id: lobby.id,
        player_id: guestId,
        ready: false,
      })

      if (joinErr) {
        setError('Не удалось войти в лобби')
        setStatus('error')
        return
      }
    }

    setLobbyId(lobby.id)
    setIsHost(lobby.host_id === guestId)
    setHostId(lobby.host_id)
    setStatus(lobby.status === 'waiting' ? 'waiting' : lobby.status)
    subscribeToLobby(lobby.id)

    const { data: playersList } = await supabase
      .from('lobby_players')
      .select('*')
      .eq('lobby_id', lobby.id)
    setPlayers(playersList ?? [])
  }, [subscribeToLobby])

  const setReady = useCallback(async () => {
    const guestId = getGuestId()
    const id = lobbyIdRef.current
    if (!id) return

    await supabase
      .from('lobby_players')
      .update({ ready: true })
      .eq('lobby_id', id)
      .eq('player_id', guestId)

    // Проверить, все ли готовы — если 2 игрока и все ready, обновить статус лобби
    const { data: playersList } = await supabase
      .from('lobby_players')
      .select('*')
      .eq('lobby_id', id)

    // Все готовы и игроков минимум 2 — запускаем игру
    const allReady = playersList?.length >= 2 && playersList.every(p => p.ready)
    if (allReady) {
      await supabase.from('lobbies').update({ status: 'in_game' }).eq('id', id)
    }
  }, [])

  const leaveLobby = useCallback(async () => {
    const guestId = getGuestId()
    const id = lobbyIdRef.current

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }

    if (id) {
      await supabase
        .from('lobby_players')
        .delete()
        .eq('lobby_id', id)
        .eq('player_id', guestId)
    }

    setLobbyId(null)
    setPlayers([])
    setIsHost(false)
    setHostId(null)
    setStatus('idle')
    setError(null)
  }, [])

  // Отписаться при размонтировании
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [])

  return { status, lobbyId, players, error, isHost, hostId, createLobby, joinLobby, setReady, leaveLobby }
}
