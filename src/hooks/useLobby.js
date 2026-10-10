import { useEffect, useRef, useState, useCallback } from 'react'
import { getGuestId } from '../utils/guestId'
import { ensureGuestId } from '../utils/guestSession'
import {
  loadLobbySession,
  clearLobbySession,
  saveLobbySession,
} from '../utils/lobbySession'
import { useLobbyChannel } from './lobby/useLobbyChannel'
import { useLobbyWebSocketTransport } from './useLobbyWebSocketTransport'
import { mapLobbyPlayers, lobbyStatus } from '../utils/mapGameState'
import { createLocalLobby, getLocalLobby, joinLocalLobby } from '../utils/localLobbyClient'

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
        if (lobbyRow.game_id) onGameStarted(lobbyRow.game_id)
        else setStatus('in_game')
      }
    },
    [onGameStarted, handleLobbyClosed]
  )

  const lobbyTransport = useLobbyWebSocketTransport(lobbyId, getGuestId(), {
    onLobbyUpdate: handleLobbyWsUpdate,
    onClosed: handleLobbyClosed,
    onPresence: setOnlinePlayerIds,
    onError: setError,
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

    getLocalLobby(session.lobbyId)
      .then((lobby) => {
        if (cancelled || !lobby || lobby.status === 'in_game') return
        requestAnimationFrame(() => {
          setLobbyId(lobby.id)
          setLobbyCode(lobby.code)
          setIsHost(lobby.host_id === guestId)
          setHostId(lobby.host_id)
          setPlayers(lobby.lobby_players || [])
          setStatus('waiting')
        })
        subscribeRef.current(lobby.id)
      })
      .catch(() => {
        clearLobbySession()
        setStatus('idle')
      })

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
      const lobby = await createLocalLobby(guestId, nickname, deckPayload)
      setLobbyId(lobby.id)
      setLobbyCode(lobby.code)
      setIsHost(true)
      setHostId(guestId)
      setPlayers(lobby.lobby_players || [])
      setStatus('waiting')
      subscribeToLobby(lobby.id)
      saveLobbySession(lobby.id, lobby.code, guestId, true)
      return lobby.code
    },
    [subscribeToLobby]
  )

  const joinLobby = useCallback(
    async (code, nickname, deckPayload = null) => {
      const guestId = getGuestId()
      const lobby = await joinLocalLobby(code.trim().toUpperCase(), guestId, nickname, deckPayload)
      setLobbyId(lobby.id)
      setLobbyCode(lobby.code)
      setIsHost(lobby.host_id === guestId)
      setHostId(lobby.host_id)
      setPlayers(lobby.lobby_players || [])
      setStatus(lobby.status === 'in_game' ? 'in_game' : 'waiting')
      subscribeToLobby(lobby.id)
      saveLobbySession(lobby.id, lobby.code, lobby.host_id, lobby.host_id === guestId)
      return lobby
    },
    [subscribeToLobby]
  )

  const setReady = useCallback(async () => {
    if (!lobbyIdRef.current) return
    if (!lobbyTransport?.enabled || typeof lobbyTransport.sendActionAsync !== 'function') {
      setError('Realtime лобби недоступно')
      return
    }
    try {
      await lobbyTransport.sendActionAsync('set_ready', { ready: true })
    } catch (err) {
      setError(err?.message || 'Не удалось отметить готовность')
    }
  }, [lobbyTransport])

  const startGame = useCallback(async (landPlacementRule = 'strict') => {
    if (!lobbyIdRef.current) return { error: 'Лобби не найдено' }
    if (!lobbyTransport?.enabled || typeof lobbyTransport.sendActionAsync !== 'function') {
      return { error: 'Realtime лобби недоступно' }
    }
    try {
      await lobbyTransport.sendActionAsync('start_game', { landPlacementRule })
      return { success: true }
    } catch (err) {
      return { error: err.message || 'Не удалось создать игру' }
    }
  }, [lobbyTransport])

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
