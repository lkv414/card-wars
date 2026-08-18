import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/**
 * Подписаться на статус lobbyTransport через useSyncExternalStore.
 * Заменяет useEffect+setState паттерн (react-hooks/set-state-in-effect).
 */
function useLobbyStatus(lobbyTransport) {
  return useSyncExternalStore(
    (cb) => {
      if (!lobbyTransport?.subscribe) return () => {}
      return lobbyTransport.subscribe(cb)
    },
    () => lobbyTransport?.status ?? 'idle',
    () => 'idle',
  )
}

export function useLobbyChannel({ resetLobbyState, lobbyTransport }) {
  const unsubscribeRef = useRef(null)
  const transportStatus = useLobbyStatus(lobbyTransport)
  const [onlinePlayerIds, setOnlinePlayerIds] = useState([])

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
    (id) => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
      if (lobbyTransport?.connect) {
        lobbyTransport.connect(id)
        unsubscribeRef.current = () => lobbyTransport.disconnect()
      }
    },
    [lobbyTransport],
  )

  useEffect(
    () => () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    },
    [],
  )

  // connectionStatus — derived state из transportStatus.
  const connectionStatus = (() => {
    if (!transportStatus || transportStatus === 'idle' || transportStatus === 'disabled') {
      return 'none'
    }
    if (transportStatus === 'connected') return 'connected'
    if (transportStatus === 'connecting') return 'connecting'
    if (transportStatus === 'reconnecting') return 'reconnecting'
    return 'disconnected'
  })()

  return {
    unsubscribeRef,
    subscribeToLobby,
    connectionStatus,
    onlinePlayerIds,
    resetLobby,
  }
}