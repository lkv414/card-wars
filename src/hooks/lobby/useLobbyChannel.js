import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeAblyLobby } from './createLobbyChannel'
import { isGameWsEnabled } from '../../utils/gameWebSocket'

export function useLobbyChannel({
  setPlayers,
  setStatus,
  setDismissedMessage,
  resetLobbyState,
  onGameStarted,
  lobbyTransport,
}) {
  const unsubscribeRef = useRef(null)
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [onlinePlayerIds, setOnlinePlayerIds] = useState([])

  const handlersRef = useRef({})
  handlersRef.current = {
    setPlayers,
    setStatus,
    setDismissedMessage,
    onGameStarted,
  }

  const resetLobby = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
    }
    lobbyTransport?.disconnect?.()
    setOnlinePlayerIds([])
    resetLobbyState?.()
  }, [resetLobbyState, lobbyTransport])

  const subscribeToLobby = useCallback(
    (id, { nickname } = {}) => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }

      if (isGameWsEnabled() && lobbyTransport?.connect) {
        lobbyTransport.connect(id)
        unsubscribeRef.current = () => lobbyTransport.disconnect()
        return
      }

      const h = handlersRef.current
      unsubscribeRef.current = subscribeAblyLobby(id, {
        nickname,
        setPlayers: h.setPlayers,
        setStatus: h.setStatus,
        setDismissedMessage: h.setDismissedMessage,
        resetLobby,
        onGameStarted: h.onGameStarted,
        onConnectionChange: setConnectionStatus,
        onPresenceChange: setOnlinePlayerIds,
      })
    },
    [resetLobby, lobbyTransport]
  )

  useEffect(
    () => () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    },
    []
  )

  const wsStatus = lobbyTransport?.status
  const effectiveConnectionStatus =
    isGameWsEnabled() && wsStatus && wsStatus !== 'idle' && wsStatus !== 'disabled'
      ? wsStatus === 'connected'
        ? 'connected'
        : wsStatus === 'connecting'
          ? 'connecting'
          : 'disconnected'
      : connectionStatus

  return {
    unsubscribeRef,
    subscribeToLobby,
    connectionStatus: effectiveConnectionStatus,
    onlinePlayerIds,
  }
}
