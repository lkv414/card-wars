import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { logError } from '../utils/errorLogger'
import { getGuestId } from '../utils/guestId'
import { ensureGuestId } from '../utils/guestSession'
import { generateLobbyCode } from '../utils/lobbyCode'
import {
  saveLobbySession,
  loadLobbySession,
  clearLobbySession,
  cleanupOldLobbies,
} from '../utils/lobbySession'
import { createLobbyChannel } from './lobby/createLobbyChannel'

export function useLobby() {
  // 'idle' | 'restoring' | 'loading' | 'waiting' | 'in_game' | 'error' | 'dismissed'
  const [status, setStatus] = useState('restoring')

  useEffect(() => {
    ensureGuestId()
  }, [])

  const [lobbyId, setLobbyId] = useState(null)
  const [lobbyCode, setLobbyCode] = useState(null)
  const [players, setPlayers] = useState([])
  const [error, setError] = useState(null)
  const [isHost, setIsHost] = useState(false)
  const [hostId, setHostId] = useState(null)
  const [dismissedMessage, setDismissedMessage] = useState(null)

  const channelRef = useRef(null)
  const lobbyIdRef = useRef(null)
  const isHostRef = useRef(false)

  useEffect(() => { lobbyIdRef.current = lobbyId }, [lobbyId])
  useEffect(() => { isHostRef.current = isHost }, [isHost])

  const resetLobbyState = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    setLobbyId(null)
    setLobbyCode(null)
    setPlayers([])
    setIsHost(false)
    setHostId(null)
  }, [])

  const subscribeToLobby = useCallback((id) => {
    if (channelRef.current) supabase.removeChannel(channelRef.current)

    channelRef.current = createLobbyChannel(id, {
      setPlayers,
      setStatus,
      setDismissedMessage,
      resetLobby: resetLobbyState,
    })
  }, [resetLobbyState])

  useEffect(() => {
    let cancelled = false

    const session = loadLobbySession()
    if (!session) {
      requestAnimationFrame(() => {
        if (!cancelled) setStatus('idle')
      })
      return () => {
        cancelled = true
      }
    }

    const guestId = getGuestId()

    ;(async () => {
      const { data: lobby, error: lobbyError } = await supabase
        .from('lobbies')
        .select('*')
        .eq('id', session.lobbyId)
        .maybeSingle()

      if (cancelled) return
      if (lobbyError) {
        logError(lobbyError, { hook: 'useLobby', action: 'restoreLobby' })
      }

      if (!lobby) {
        clearLobbySession()
        requestAnimationFrame(() => {
          if (!cancelled) setStatus('idle')
        })
        return
      }

      if (lobby.status === 'in_game') {
        clearLobbySession()
        requestAnimationFrame(() => {
          if (!cancelled) setStatus('idle')
        })
        return
      }

      const { data: me } = await supabase
        .from('lobby_players')
        .select('player_id')
        .eq('lobby_id', lobby.id)
        .eq('player_id', guestId)
        .maybeSingle()

      if (cancelled) return

      if (!me) {
        clearLobbySession()
        requestAnimationFrame(() => {
          if (!cancelled) setStatus('idle')
        })
        return
      }

      const { data: playersList } = await supabase
        .from('lobby_players')
        .select('*')
        .eq('lobby_id', lobby.id)

      if (cancelled) return

      requestAnimationFrame(() => {
        if (cancelled) return
        setLobbyId(lobby.id)
        setLobbyCode(lobby.code)
        setIsHost(lobby.host_id === guestId)
        setHostId(lobby.host_id)
        setPlayers(playersList ?? [])
        setStatus('waiting')
      })
      subscribeToLobby(lobby.id)
    })()

    return () => {
      cancelled = true
    }
  }, [subscribeToLobby])

  useEffect(() => {
    const handleUnload = () => {
      clearLobbySession()
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [])

  /**
   * @param {string} nickname
   * @param {object|null} deckPayload
   */
  const createLobby = useCallback(async (nickname, deckPayload = null) => {
    setStatus('loading')
    setError(null)
    setDismissedMessage(null)
    const guestId = getGuestId()

    cleanupOldLobbies(supabase)

    let code = generateLobbyCode()
    for (let i = 0; i < 4; i++) {
      const { data: existing } = await supabase.from('lobbies').select('id').eq('code', code).maybeSingle()
      if (!existing) break
      code = generateLobbyCode()
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

    const { data: player, error: playerErr } = await supabase.rpc('upsert_lobby_player', {
      p_guest_id: guestId,
      p_lobby_id: lobby.id,
      p_nickname: nickname.trim() || 'Игрок',
      p_ready: false,
      p_deck: deckPayload,
    })

    if (playerErr || !player) {
      console.error('lobby_players upsert error:', playerErr)
      setError(`Не удалось добавить игрока: ${playerErr?.message || 'RPC не вернул игрока'}`)
      setStatus('error')
      return
    }

    setLobbyId(lobby.id)
    setLobbyCode(code)
    setIsHost(true)
    setHostId(guestId)
    subscribeToLobby(lobby.id)

    const { data: playersList } = await supabase.from('lobby_players').select('*').eq('lobby_id', lobby.id)
    setPlayers(playersList ?? [])
    setStatus('waiting')

    saveLobbySession(lobby.id, code, guestId, true)
    return code
  }, [subscribeToLobby])

  /**
   * @param {string} code
   * @param {string} nickname
   * @param {object|null} deckPayload
   */
  const joinLobby = useCallback(async (code, nickname, deckPayload = null) => {
    setStatus('loading')
    setError(null)
    setDismissedMessage(null)
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

    const { data: existing } = await supabase
      .from('lobby_players')
      .select('player_id')
      .eq('lobby_id', lobby.id)
      .eq('player_id', guestId)
      .maybeSingle()

    if (existing) {
      await supabase.rpc('upsert_lobby_player', {
        p_guest_id: guestId,
        p_lobby_id: lobby.id,
        p_nickname: nickname.trim() || 'Игрок',
        p_ready: false,
        p_deck: deckPayload,
      })
    } else {
      const { data: allPlayers } = await supabase
        .from('lobby_players')
        .select('player_id')
        .eq('lobby_id', lobby.id)

      if ((allPlayers ?? []).length >= 4) {
        setError('Лобби уже заполнено (максимум 4 игрока)')
        setStatus('error')
        return
      }

      const { data: player, error: joinErr } = await supabase.rpc('upsert_lobby_player', {
        p_guest_id: guestId,
        p_lobby_id: lobby.id,
        p_nickname: nickname.trim() || 'Игрок',
        p_ready: false,
        p_deck: deckPayload,
      })

      if (joinErr || !player) {
        console.error('lobby_players upsert error:', joinErr)
        setError(`Не удалось войти в лобби: ${joinErr?.message || 'RPC не вернул игрока'}`)
        setStatus('error')
        return
      }
    }

    setLobbyId(lobby.id)
    setLobbyCode(lobby.code)
    setIsHost(lobby.host_id === guestId)
    setHostId(lobby.host_id)
    setStatus(lobby.status === 'waiting' ? 'waiting' : lobby.status)
    subscribeToLobby(lobby.id)

    const { data: playersList } = await supabase.from('lobby_players').select('*').eq('lobby_id', lobby.id)
    setPlayers(playersList ?? [])

    saveLobbySession(lobby.id, lobby.code, lobby.host_id, lobby.host_id === guestId)
  }, [subscribeToLobby])

  const setReady = useCallback(async () => {
    const guestId = getGuestId()
    const id = lobbyIdRef.current
    if (!id) return

    const { data, error: readyErr } = await supabase.rpc('set_lobby_player_ready', {
      p_guest_id: guestId,
      p_lobby_id: id,
      p_ready: true,
    })

    if (readyErr) {
      setError(`Не удалось отметить готовность: ${readyErr.message}`)
      return
    }

    setPlayers((current) => current.map((player) =>
      player.player_id === guestId ? { ...player, ready: true, ...(data || {}) } : player
    ))
  }, [])

  const leaveLobby = useCallback(async () => {
    const guestId = getGuestId()
    const id = lobbyIdRef.current

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }

    if (id) {
      await supabase.from('lobby_players').delete().eq('lobby_id', id).eq('player_id', guestId)

      if (isHostRef.current) {
        await supabase.from('lobbies').delete().eq('id', id)
      }
    }

    clearLobbySession()
    setLobbyId(null)
    setLobbyCode(null)
    setPlayers([])
    setIsHost(false)
    setHostId(null)
    setDismissedMessage(null)
    setStatus('idle')
    setError(null)
  }, [])

  useEffect(() => {
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [])

  return {
    status,
    lobbyId,
    lobbyCode,
    players,
    error,
    isHost,
    hostId,
    dismissedMessage,
    createLobby,
    joinLobby,
    setReady,
    leaveLobby,
  }
}
