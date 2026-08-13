import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { supabase } from '../utils/supabase'
import { logError } from '../utils/errorLogger'
import { getGuestId, getGuestNickname } from '../utils/guestId'
import { ensureGuestId } from '../utils/guestSession'
import {
  loadLobbySession,
  clearLobbySession,
} from '../utils/lobbySession'
import { useLobbyChannel } from './lobby/useLobbyChannel'
import { createLobbyAction } from './lobby/useCreateLobby'
import { joinLobbyAction } from './lobby/useJoinLobby'
import { publishLobbySync } from '../utils/lobbySync'
import { isGameWsEnabled } from '../utils/gameWebSocket'
import { useLobbyWebSocketTransport } from './useLobbyWebSocketTransport'
import { mapLobbyPlayers, lobbyStatus } from '../utils/mapGameState'

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
  const [pendingGameId, setPendingGameId] = useState(null)

  const lobbyIdRef = useRef(null)
  const isHostRef = useRef(false)

  const resetLobbyState = useCallback(() => {
    setLobbyId(null)
    setLobbyCode(null)
    setPlayers([])
    setIsHost(false)
    setHostId(null)
  }, [])

  const onGameStarted = useCallback((gameId) => {
    setPendingGameId(gameId)
    setStatus('in_game')
  }, [])

  const handleLobbyWsUpdate = useCallback(
    async (lobbyRow) => {
      if (!lobbyRow) return
      const playersList = mapLobbyPlayers(lobbyRow)
      if (playersList) setPlayers(playersList)
      if (lobbyStatus(lobbyRow) === 'in_game') {
        const id = lobbyRow.id ?? lobbyIdRef.current
        const { data: game } = await supabase
          .from('games')
          .select('id')
          .eq('lobby_id', id)
          .maybeSingle()
        if (game?.id) {
          onGameStarted(game.id)
        } else {
          setStatus('in_game')
        }
      }
    },
    [onGameStarted]
  )

  const lobbyTransport = useLobbyWebSocketTransport(lobbyId, getGuestId(), {
    onLobbyUpdate: handleLobbyWsUpdate,
  })

  const { unsubscribeRef, subscribeToLobby, connectionStatus, onlinePlayerIds } = useLobbyChannel({
    setPlayers,
    setStatus,
    setDismissedMessage,
    resetLobbyState,
    onGameStarted,
    lobbyTransport,
  })

  const subscribeRef = useRef(subscribeToLobby)
  useEffect(() => {
    subscribeRef.current = subscribeToLobby
  }, [subscribeToLobby])

  useEffect(() => { lobbyIdRef.current = lobbyId }, [lobbyId])
  useEffect(() => { isHostRef.current = isHost }, [isHost])

  // Fallback poll when Ably/WS push missed
  useEffect(() => {
    if (isGameWsEnabled()) return undefined
    if (!lobbyId || status !== 'waiting') return undefined

    let cancelled = false
    const poll = async () => {
      const { data: lobby } = await supabase
        .from('lobbies')
        .select('status')
        .eq('id', lobbyId)
        .maybeSingle()
      if (cancelled) return

      if (lobby?.status === 'in_game') {
        const { data: game } = await supabase
          .from('games')
          .select('id')
          .eq('lobby_id', lobbyId)
          .maybeSingle()
        if (game?.id) {
          onGameStarted(game.id)
        } else {
          setStatus('in_game')
        }
        return
      }

      const { data: playersList } = await supabase
        .from('lobby_players')
        .select('*')
        .eq('lobby_id', lobbyId)
      if (!cancelled && playersList) setPlayers(playersList)
    }

    poll()
    const timer = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [lobbyId, status, onGameStarted])

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
      subscribeRef.current(lobby.id, { nickname: getGuestNickname() })
    })()

    return () => {
      cancelled = true
    }
  }, [])

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

    if (isGameWsEnabled()) {
      try {
        await lobbyTransport.sendActionAsync('set_ready', { ready: true })
      } catch (err) {
        setError(`Не удалось отметить готовность: ${err.message}`)
      }
      return
    }

    const { data, error: readyErr } = await supabase.rpc('set_lobby_player_ready', {
      p_guest_id: guestId,
      p_lobby_id: id,
      p_ready: true,
    })

    if (readyErr) {
      setError(`Не удалось отметить готовность: ${readyErr.message}`)
      return
    }

    setPlayers((current) =>
      current.map((player) =>
        player.player_id === guestId ? { ...player, ready: true, ...(data || {}) } : player
      )
    )

    const { data: playersList } = await supabase.from('lobby_players').select('*').eq('lobby_id', id)
    if (playersList) {
      setPlayers(playersList)
      await publishLobbySync(id, { type: 'players', players: playersList, actorId: guestId })
    }
  }, [lobbyTransport])

  const startGame = useCallback(async () => {
    const guestId = getGuestId()
    const id = lobbyIdRef.current
    if (!id) return { error: 'Лобби не найдено' }

    if (isGameWsEnabled()) {
      try {
        await lobbyTransport.sendActionAsync('start_game', {})
        const { data: game } = await supabase
          .from('games')
          .select('id')
          .eq('lobby_id', id)
          .maybeSingle()
        if (game?.id) {
          onGameStarted(game.id)
          return { gameId: game.id }
        }
        return { error: 'Игра создаётся…' }
      } catch (err) {
        return { error: err.message || 'Не удалось создать игру' }
      }
    }

    const { data: gameId, error: startErr } = await supabase.rpc('start_game_for_lobby', {
      p_lobby_id: id,
      p_guest_id: guestId,
    })
    if (startErr || !gameId) {
      return { error: startErr?.message || 'Не удалось создать игру' }
    }
    await publishLobbySync(id, {
      type: 'game_started',
      gameId,
      status: 'in_game',
      actorId: guestId,
    })
    return { gameId }
  }, [lobbyTransport, onGameStarted])

  const leaveLobby = useCallback(async () => {
    const guestId = getGuestId()
    const id = lobbyIdRef.current

    if (id && isGameWsEnabled()) {
      try {
        await lobbyTransport.sendActionAsync('leave', {})
      } catch {
        /* still clear local session */
      }
    }

    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
    }

    if (id && !isGameWsEnabled()) {
      if (isHostRef.current) {
        await publishLobbySync(id, { type: 'closed', actorId: guestId })
      } else {
        const { data: playersList } = await supabase
          .from('lobby_players')
          .select('*')
          .eq('lobby_id', id)
        await publishLobbySync(id, {
          type: 'players',
          players: playersList ?? [],
          actorId: guestId,
        })
      }
      await supabase.rpc('leave_lobby', {
        p_guest_id: guestId,
        p_lobby_id: id,
      })
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
  }, [lobbyTransport, unsubscribeRef])

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [unsubscribeRef])

  return {
    status,
    lobbyId,
    lobbyCode,
    players,
    error,
    isHost,
    hostId,
    dismissedMessage,
    pendingGameId,
    connectionStatus,
    onlinePlayerIds,
    createLobby,
    joinLobby,
    setReady,
    startGame,
    leaveLobby,
  }
}
