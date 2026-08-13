import { supabase } from '../../utils/supabase'
import { saveLobbySession } from '../../utils/lobbySession'
import { publishLobbySync } from '../../utils/lobbySync'

export async function joinLobbyAction(guestId, code, nickname, deckPayload, { subscribeToLobby, setState }) {
  const {
    setStatus,
    setError,
    setDismissedMessage,
    setLobbyId,
    setLobbyCode,
    setIsHost,
    setHostId,
    setPlayers,
  } = setState

  setStatus('loading')
  setError(null)
  setDismissedMessage(null)

  const { data: lobby, error: findErr } = await supabase
    .from('lobbies')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .maybeSingle()

  if (findErr || !lobby) {
    setError('Лобби с таким кодом не найдено')
    setStatus('error')
    return
  }

  if (lobby.status === 'in_game') {
    setError('Игра уже началась')
    setStatus('error')
    return
  }

  const { data: existing } = await supabase
    .from('lobby_players')
    .select('player_id')
    .eq('lobby_id', lobby.id)
    .eq('player_id', guestId)
    .maybeSingle()

  if (existing) {
    await supabase.rpc('upsert_lobby_player', {
      p_guest_id: guestId,
      p_lobby_id: lobby.id,
      p_nickname: nickname.trim() || 'Игрок',
      p_ready: false,
      p_deck: deckPayload,
    })
  } else {
    const { data: allPlayers } = await supabase
      .from('lobby_players')
      .select('player_id')
      .eq('lobby_id', lobby.id)

    if ((allPlayers ?? []).length >= 4) {
      setError('Лобби уже заполнено (максимум 4 игрока)')
      setStatus('error')
      return
    }

    const { data: player, error: joinErr } = await supabase.rpc('upsert_lobby_player', {
      p_guest_id: guestId,
      p_lobby_id: lobby.id,
      p_nickname: nickname.trim() || 'Игрок',
      p_ready: false,
      p_deck: deckPayload,
    })

    if (joinErr || !player) {
      setError(`Не удалось войти в лобби: ${joinErr?.message || 'RPC не вернул игрока'}`)
      setStatus('error')
      return
    }
  }

  setLobbyId(lobby.id)
  setLobbyCode(lobby.code)
  setIsHost(lobby.host_id === guestId)
  setHostId(lobby.host_id)
  setStatus(lobby.status === 'waiting' ? 'waiting' : lobby.status)
  subscribeToLobby(lobby.id, { nickname: nickname.trim() || 'Игрок' })

  const { data: playersList } = await supabase.from('lobby_players').select('*').eq('lobby_id', lobby.id)
  setPlayers(playersList ?? [])
  await publishLobbySync(lobby.id, { type: 'players', players: playersList ?? [], actorId: guestId })
  saveLobbySession(lobby.id, lobby.code, lobby.host_id, lobby.host_id === guestId)
}
