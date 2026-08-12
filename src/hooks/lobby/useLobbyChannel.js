import { useCallback, useEffect, useRef } from 'react'
import { supabase } from '../../utils/supabase'
import { createLobbyChannel } from './createLobbyChannel'

export function useLobbyChannel({ setPlayers, setStatus, setDismissedMessage, resetLobbyState }) {
  const channelRef = useRef(null)

  const resetLobby = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    resetLobbyState?.()
  }, [resetLobbyState])

  const subscribeToLobby = useCallback(
    (id) => {
      if (channelRef.current) supabase.removeChannel(channelRef.current)
      channelRef.current = createLobbyChannel(id, {
        setPlayers,
        setStatus,
        setDismissedMessage,
        resetLobby,
      })
    },
    [setPlayers, setStatus, setDismissedMessage, resetLobby]
  )

  useEffect(
    () => () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    },
    []
  )

  return { channelRef, subscribeToLobby }
}
