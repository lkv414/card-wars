import { useCallback, useEffect, useRef, useState } from 'react'

export function useLobbyChannel({ resetLobbyState, lobbyTransport }) {
  const unsubscribeRef = useRef(null)
  const [connectionStatus, setConnectionStatus] = useState('connecting')
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

  useEffect(() => {
    const wsStatus = lobbyTransport?.status
    if (!wsStatus || wsStatus === 'idle' || wsStatus === 'disabled') {
      setConnectionStatus('none')
      return
    }
    if (wsStatus === 'connected') setConnectionStatus('connected')
    else if (wsStatus === 'connecting') setConnectionStatus('connecting')
    else if (wsStatus === 'reconnecting') setConnectionStatus('reconnecting')
    else setConnectionStatus('disconnected')
  }, [lobbyTransport?.status])

  return {
    unsubscribeRef,
    subscribeToLobby,
    connectionStatus,
    onlinePlayerIds,
    resetLobby,
  }
}