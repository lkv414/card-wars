import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeAblyLobby } from './createLobbyChannel'

export function useLobbyChannel({
  setPlayers,
  setStatus,
  setDismissedMessage,
  resetLobbyState,
  onGameStarted,
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
    setOnlinePlayerIds([])
    resetLobbyState?.()
  }, [resetLobbyState])

  const subscribeToLobby = useCallback((id, { nickname } = {}) => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
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
  }, [resetLobby])

  useEffect(
    () => () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    },
    []
  )

  return { unsubscribeRef, subscribeToLobby, connectionStatus, onlinePlayerIds }
}
