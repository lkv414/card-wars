import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { supabase } from '../utils/supabase'
import { logError } from '../utils/errorLogger'
import { getGuestId } from '../utils/guestId'
import { ensureGuestId } from '../utils/guestSession'
import {
  saveLobbySession,
  loadLobbySession,
  clearLobbySession,
} from '../utils/lobbySession'
import { useLobbyChannel } from './lobby/useLobbyChannel'
import { createLobbyAction } from './lobby/useCreateLobby'
import { joinLobbyAction } from './lobby/useJoinLobby'

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

  const lobbyIdRef = useRef(null)
  const isHostRef = useRef(false)

  const resetLobbyState = useCallback(() => {
    setLobbyId(null)
    setLobbyCode(null)
    setPlayers([])
    setIsHost(false)
    setHostId(null)
  }, [])

  const { channelRef, subscribeToLobby } = useLobbyChannel({
    setPlayers,
    setStatus,
    setDismissedMessage,
    resetLobbyState,
  })

  useEffect(() => { lobbyIdRef.current = lobbyId }, [lobbyId])
  useEffect(() => { isHostRef.current = isHost }, [isHost])

  const lobbySetState = useMemo(
    () => ({
      setStatus,
      setError,
      setDismissedMessage,
      setLobbyId,
      setLobbyCode,
      setIsHost,
      setHostId,
      setPlayers,
    }),
    []
  )

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
    const guestId = getGuestId()
    return createLobbyAction(guestId, nickname, deckPayload, {
      subscribeToLobby,
      setState: lobbySetState,
    })
  }, [subscribeToLobby, lobbySetState])

  /**
   * @param {string} code
   * @param {string} nickname
   * @param {object|null} deckPayload
   */
  const joinLobby = useCallback(async (code, nickname, deckPayload = null) => {
    const guestId = getGuestId()
    return joinLobbyAction(guestId, code, nickname, deckPayload, {
      subscribeToLobby,
      setState: lobbySetState,
    })
  }, [subscribeToLobby, lobbySetState])

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
