import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { getGuestId } from '../utils/guestId'
import { ensureGuestId } from '../utils/guestSession'
import { generateLobbyCode } from '../utils/lobbyCode'

const LOBBY_STORAGE_KEY = 'activeLobby'
const LOBBY_MAX_AGE_HOURS = 6

function saveLobbySession(lobbyId, code, hostId, isHost) {
  localStorage.setItem(LOBBY_STORAGE_KEY, JSON.stringify({ lobbyId, code, hostId, isHost, savedAt: Date.now() }))
}

function loadLobbySession() {
  try {
    const raw = localStorage.getItem(LOBBY_STORAGE_KEY)
    if (!raw) return null
    const session = JSON.parse(raw)
    const ageHours = (Date.now() - session.savedAt) / 1000 / 3600
    if (ageHours > LOBBY_MAX_AGE_HOURS) {
      localStorage.removeItem(LOBBY_STORAGE_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

function clearLobbySession() {
  localStorage.removeItem(LOBBY_STORAGE_KEY)
}

async function cleanupOldLobbies() {
  const cutoff = new Date(Date.now() - LOBBY_MAX_AGE_HOURS * 3600 * 1000).toISOString()
  await supabase.from('lobbies').delete().lt('created_at', cutoff)
}

export function useLobby() {
  // 'idle' | 'restoring' | 'loading' | 'waiting' | 'in_game' | 'error' | 'dismissed'
  const [status, setStatus] = useState('restoring')

  // Фаза 6: RLS — установить guest_id в Postgres-сеанс при старте.
  useEffect(() => {
    ensureGuestId()
  }, [])

  const [lobbyId, setLobbyId] = useState(null)
  const [lobbyCode, setLobbyCode] = useState(null)
  const [players, setPlayers] = useState([])
  const [error, setError] = useState(null)
  const [isHost, setIsHost] = useState(false)
  const [hostId, setHostId] = useState(null)
  const [dismissedMessage, setDismissedMessage] = useState(null)

  const channelRef = useRef(null)
  const lobbyIdRef = useRef(null)
  const isHostRef = useRef(false)

  useEffect(() => { lobbyIdRef.current = lobbyId }, [lobbyId])
  useEffect(() => { isHostRef.current = isHost }, [isHost])

  const subscribeToLobby = useCallback((id) => {
    if (channelRef.current) supabase.removeChannel(channelRef.current)

    const channel = supabase
      .channel(`lobby_room:${id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'lobby_players', filter: `lobby_id=eq.${id}` },
        async () => {
          const { data } = await supabase.from('lobby_players').select('*').eq('lobby_id', id)
          setPlayers(data ?? [])
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'lobbies', filter: `id=eq.${id}` },
        ({ new: updated }) => {
          if (updated?.status) setStatus(updated.status)
        }
      )
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'lobbies', filter: `id=eq.${id}` },
        () => {
          clearLobbySession()
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current)
            channelRef.current = null
          }
          setLobbyId(null)
          setLobbyCode(null)
          setPlayers([])
          setIsHost(false)
          setHostId(null)
          // Показать сообщение что лобби было закрыто хостом
          setDismissedMessage('Хост закрыл лобби')
          setStatus('idle')
        }
      )
      .subscribe()

    channelRef.current = channel
  }, [])

  // Восстановить лобби из localStorage при монтировании
  useEffect(() => {
    const session = loadLobbySession()
    if (!session) {
      setStatus('idle')
      return
    }

    const guestId = getGuestId()

    ;(async () => {
      const { data: lobby } = await supabase
        .from('lobbies')
        .select('*')
        .eq('id', session.lobbyId)
        .maybeSingle()

      if (!lobby) {
        clearLobbySession()
        setStatus('idle')
        return
      }

      if (lobby.status === 'in_game') {
        clearLobbySession()
        setStatus('idle')
        return
      }

      const { data: me } = await supabase
        .from('lobby_players')
        .select('player_id')
        .eq('lobby_id', lobby.id)
        .eq('player_id', guestId)
        .maybeSingle()

      if (!me) {
        clearLobbySession()
        setStatus('idle')
        return
      }

      const { data: playersList } = await supabase
        .from('lobby_players')
        .select('*')
        .eq('lobby_id', lobby.id)

      setLobbyId(lobby.id)
      setLobbyCode(lobby.code)
      setIsHost(lobby.host_id === guestId)
      setHostId(lobby.host_id)
      setPlayers(playersList ?? [])
      setStatus('waiting')
      subscribeToLobby(lobby.id)
    })()
  }, [subscribeToLobby])

  // Удалить игрока при закрытии вкладки (sendBeacon не работает с DELETE через Supabase REST,
  // поэтому полагаемся на cleanupOldLobbies + leaveLobby)
  useEffect(() => {
    const handleUnload = () => {
      clearLobbySession()
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [])

  /**
   * @param {string} nickname
   * @param {object|null} deckPayload  payload из buildLobbyDeckPayload (локальная колода)
   */
  const createLobby = useCallback(async (nickname, deckPayload = null) => {
    setStatus('loading')
    setError(null)
    setDismissedMessage(null)
    const guestId = getGuestId()

    cleanupOldLobbies()

    // Генерировать уникальный код (импорт вынесен наружу цикла)
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
      return
    }

    const { data: player, error: playerErr } = await supabase.rpc('upsert_lobby_player', {
      p_guest_id: guestId,
      p_lobby_id: lobby.id,
      p_nickname: nickname.trim() || 'Игрок',
      p_ready: false,
      p_deck: deckPayload,
    })

    if (playerErr || !player) {
      console.error('lobby_players upsert error:', playerErr)
      setError(`Не удалось добавить игрока: ${playerErr?.message || 'RPC не вернул игрока'}`)
      setStatus('error')
      return
    }

    setLobbyId(lobby.id)
    setLobbyCode(code)
    setIsHost(true)
    setHostId(guestId)
    subscribeToLobby(lobby.id)

    const { data: playersList } = await supabase.from('lobby_players').select('*').eq('lobby_id', lobby.id)
    setPlayers(playersList ?? [])
    setStatus('waiting')

    saveLobbySession(lobby.id, code, guestId, true)
    return code
  }, [subscribeToLobby])

  /**
   * @param {string} code
   * @param {string} nickname
   * @param {object|null} deckPayload  payload из buildLobbyDeckPayload
   */
  const joinLobby = useCallback(async (code, nickname, deckPayload = null) => {
    setStatus('loading')
    setError(null)
    setDismissedMessage(null)
    const guestId = getGuestId()

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
      // Уже в лобби — обновить ник, колоду и сбросить ready
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
        console.error('lobby_players upsert error:', joinErr)
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
    subscribeToLobby(lobby.id)

    const { data: playersList } = await supabase.from('lobby_players').select('*').eq('lobby_id', lobby.id)
    setPlayers(playersList ?? [])

    saveLobbySession(lobby.id, lobby.code, lobby.host_id, lobby.host_id === guestId)
  }, [subscribeToLobby])

  const setReady = useCallback(async () => {
    const guestId = getGuestId()
    const id = lobbyIdRef.current
    if (!id) return

    const { data, error: readyErr } = await supabase.rpc('set_lobby_player_ready', {
      p_guest_id: guestId,
      p_lobby_id: id,
      p_ready: true,
    })

    if (readyErr) {
      setError(`Не удалось отметить готовность: ${readyErr.message}`)
      return
    }

    setPlayers((current) => current.map((player) =>
      player.player_id === guestId ? { ...player, ready: true, ...(data || {}) } : player
    ))
  }, [])

  const leaveLobby = useCallback(async () => {
    const guestId = getGuestId()
    const id = lobbyIdRef.current

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }

    if (id) {
      await supabase.from('lobby_players').delete().eq('lobby_id', id).eq('player_id', guestId)

      if (isHostRef.current) {
        await supabase.from('lobbies').delete().eq('id', id)
      }
    }

    clearLobbySession()
    setLobbyId(null)
    setLobbyCode(null)
    setPlayers([])
    setIsHost(false)
    setHostId(null)
    setDismissedMessage(null)
    setStatus('idle')
    setError(null)
  }, [])

  useEffect(() => {
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [])

  return { status, lobbyId, lobbyCode, players, error, isHost, hostId, dismissedMessage, createLobby, joinLobby, setReady, leaveLobby }
}
