import { supabase } from '../../utils/supabase'
import { clearLobbySession } from '../../utils/lobbySession'

/**
 * Subscribe to lobby_players and lobbies changes for a given lobby id.
 * Returns the Supabase channel (caller stores ref and removes on unmount).
 */
export function createLobbyChannel(id, { setPlayers, setStatus, setDismissedMessage, resetLobby }) {
  const channel = supabase
    .channel(`lobby_room:${id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'lobby_players', filter: `lobby_id=eq.${id}` },
      async () => {
        const { data } = await supabase.from('lobby_players').select('*').eq('lobby_id', id)
        setPlayers(data ?? [])
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${id}` },
      ({ new: updated }) => {
        if (updated?.status) setStatus(updated.status)
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'lobbies', filter: `id=eq.${id}` },
      () => {
        clearLobbySession()
        resetLobby()
        setDismissedMessage('Хост закрыл лобби')
        setStatus('idle')
      }
    )
    .subscribe()

  return channel
}
