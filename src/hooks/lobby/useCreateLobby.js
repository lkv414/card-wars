import { supabase } from '../../utils/supabase'
import { generateLobbyCode } from '../../utils/lobbyCode'
import { saveLobbySession } from '../../utils/lobbySession'
import { cleanupOldLobbies } from '../../utils/lobbySession'
import { publishLobbySync } from '../../utils/lobbySync'

export async function createLobbyAction(guestId, nickname, deckPayload, { subscribeToLobby, setState }) {
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

  cleanupOldLobbies(supabase)

  let code = generateLobbyCode()
  for (let i = 0; i < 4; i++) {
    const { data: existing } = await supabase.from('lobbies').select('id').eq('code', code).maybeSingle()
    if (!existing) break
    code = generateLobbyCode()
  }

  const { data: lobby, error: lobbyErr } = await supabase
    .from('lobbies')
    .insert({ code, host_id: guestId })
    .select()
    .single()

  if (lobbyErr) {
    setError('Не удалось создать лобби')
    setStatus('error')
    return null
  }

  const { data: player, error: playerErr } = await supabase.rpc('upsert_lobby_player', {
    p_guest_id: guestId,
    p_lobby_id: lobby.id,
    p_nickname: nickname.trim() || 'Игрок',
    p_ready: false,
    p_deck: deckPayload,
  })

  if (playerErr || !player) {
    setError(`Не удалось добавить игрока: ${playerErr?.message || 'RPC не вернул игрока'}`)
    setStatus('error')
    return null
  }

  setLobbyId(lobby.id)
  setLobbyCode(code)
  setIsHost(true)
  setHostId(guestId)
  subscribeToLobby(lobby.id, { nickname: nickname.trim() || 'Игрок' })

  const { data: playersList } = await supabase.from('lobby_players').select('*').eq('lobby_id', lobby.id)
  setPlayers(playersList ?? [])
  await publishLobbySync(lobby.id, { type: 'players', players: playersList ?? [], actorId: guestId })
  setStatus('waiting')
  saveLobbySession(lobby.id, code, guestId, true)
  return code
}
