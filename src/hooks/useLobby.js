import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { supabase } from '../utils/supabase'
import { logError } from '../utils/errorLogger'
import { getGuestId } from '../utils/guestId'
import { ensureGuestId } from '../utils/guestSession'
import {
  loadLobbySession,
  clearLobbySession,
} from '../utils/lobbySession'
import { useLobbyChannel } from './lobby/useLobbyChannel'
import { createLobbyAction } from './lobby/useCreateLobby'
import { joinLobbyAction } from './lobby/useJoinLobby'
import { useLobbyWebSocketTransport } from './useLobbyWebSocketTransport'
import { mapLobbyPlayers, lobbyStatus } from '../utils/mapGameState'
import { getGameWsBaseUrl } from '../utils/gameWebSocket'

export function useLobby() {
  const [status, setStatus] = useState('restoring')
  const [lobbyId, setLobbyId] = useState(null)
  const [lobbyCode, setLobbyCode] = useState(null)
  const [players, setPlayers] = useState([])
  const [error, setError] = useState(null)
  const [isHost, setIsHost] = useState(false)
  const [hostId, setHostId] = useState(null)
  const [dismissedMessage, setDismissedMessage] = useState(null)
  const [pendingGameId, setPendingGameId] = useState(null)
  const [onlinePlayerIds, setOnlinePlayerIds] = useState([])

  const lobbyIdRef = useRef(null)
  const isHostRef = useRef(false)

  useEffect(() => {
    ensureGuestId()
  }, [])

  const resetLobbyState = useCallback(() => {
    setLobbyId(null)
    setLobbyCode(null)
    setPlayers([])
    setIsHost(false)
    setHostId(null)
    setOnlinePlayerIds([])
  }, [])

  const onGameStarted = useCallback((gameId) => {
    setPendingGameId(gameId)
    setStatus('in_game')
  }, [])

  const handleLobbyClosed = useCallback(() => {
    clearLobbySession()
    resetLobbyState()
    setDismissedMessage('Хост закрыл лобби')
    setStatus('dismissed')
  }, [resetLobbyState])

  const handleLobbyWsUpdate = useCallback(
    async (lobbyRow) => {
      if (!lobbyRow) {
        handleLobbyClosed()
        return
      }
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
    [onGameStarted, handleLobbyClosed]
  )

  const lobbyTransport = useLobbyWebSocketTransport(lobbyId, getGuestId(), {
    onLobbyUpdate: handleLobbyWsUpdate,
    onClosed: handleLobbyClosed,
    onPresence: setOnlinePlayerIds,
  })

  const { unsubscribeRef, subscribeToLobby, connectionStatus } = useLobbyChannel({
    resetLobbyState,
    lobbyTransport,
  })

  const subscribeRef = useRef(subscribeToLobby)
  useEffect(() => {
    subscribeRef.current = subscribeToLobby
  }, [subscribeToLobby])

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
      subscribeRef.current(lobby.id)
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

  const createLobby = useCallback(
    async (nickname, deckPayload = null) => {
      const guestId = getGuestId()
      return createLobbyAction(guestId, nickname, deckPayload, {
        subscribeToLobby,
        setState: lobbySetState,
      })
    },
    [subscribeToLobby, lobbySetState]
  )

  const joinLobby = useCallback(
    async (code, nickname, deckPayload = null) => {
      const guestId = getGuestId()
      return joinLobbyAction(guestId, code, nickname, deckPayload, {
        subscribeToLobby,
        setState: lobbySetState,
      })
    },
    [subscribeToLobby, lobbySetState]
  )

  const setReady = useCallback(async () => {
    const id = lobbyIdRef.current
    if (!id) return
    try {
      if (lobbyTransport?.enabled && typeof lobbyTransport.sendActionAsync === 'function') {
        await lobbyTransport.sendActionAsync('set_ready', { ready: true })
        return
      }
    } catch (err) {
      console.warn('[setReady] WS failed, falling back to RPC', err)
    }
    // REST fallback: если WS не подключён или action провалился — отправляем
    // напрямую в Supabase, потом notify чтобы второй клиент получил push.
    const { error: rpcErr } = await supabase.rpc('set_lobby_player_ready', {
      p_guest_id: getGuestId(),
      p_lobby_id: id,
      p_ready: true,
    })
    if (rpcErr) {
      setError(`Не удалось отметить готовность: ${rpcErr.message}`)
      return
    }
    await fetch(`${getGameWsBaseUrl()}/lobby/${id}/notify`, { method: 'POST' }).catch(() => {})
  }, [lobbyTransport])

  const startGame = useCallback(async () => {
    const id = lobbyIdRef.current
    if (!id) return { error: 'Лобби не найдено' }
    try {
      if (lobbyTransport?.enabled && typeof lobbyTransport.sendActionAsync === 'function') {
        await lobbyTransport.sendActionAsync('start_game', {})
      } else {
        const { error: rpcErr } = await supabase.rpc('start_game_for_lobby', {
          p_guest_id: getGuestId(),
          p_lobby_id: id,
        })
        if (rpcErr) throw new Error(rpcErr.message)
      }
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
  }, [lobbyTransport, onGameStarted])

  const leaveLobby = useCallback(async () => {
    const id = lobbyIdRef.current

    if (id) {
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

    clearLobbySession()
    resetLobbyState()
    setDismissedMessage(null)
    setStatus('idle')
    setError(null)
  }, [lobbyTransport, unsubscribeRef, resetLobbyState])

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
