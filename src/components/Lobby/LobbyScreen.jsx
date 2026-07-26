import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getGuestNickname, setGuestNickname, getGuestId } from '../../utils/guestId'
import { useLobby } from '../../hooks/useLobby'
import { useDecks } from '../../hooks/useDecks'
import { supabase } from '../../utils/supabase'
import { buildLobbyDeckPayload } from '../../utils/lobbyDeck'
import { useRealtimeChannel } from '../../hooks/useRealtimeChannel'
import { LobbyRoom } from './LobbyRoom'
import './Lobby.css'

export function LobbyScreen({ toast }) {
  const navigate = useNavigate()
  const { code: codeFromUrl } = useParams()
  const [nickname, setNickname] = useState(getGuestNickname)
  const [joinCode, setJoinCode] = useState(codeFromUrl ?? '')
  const [submitting, setSubmitting] = useState(false)

  const { status, players, error, isHost, hostId, lobbyId, lobbyCode, dismissedMessage, createLobby, joinLobby, setReady, leaveLobby } = useLobby()
  const { getSelectedDeck, selectedDeckId } = useDecks()
  const selectedDeck = getSelectedDeck()
  
  // Realtime status для баннера reconnect
  const realtimeStatus = useRealtimeChannel({
    channelName: lobbyId ? `lobby:${lobbyId}` : null,
    subscriptions: useMemo(() => {
      if (!lobbyId) return []
      return [
        { table: 'lobbies', filter: `id=eq.${lobbyId}`, callback: () => {} },
        { table: 'lobby_players', filter: `lobby_id=eq.${lobbyId}`, callback: () => {} },
      ]
    }, [lobbyId]),
  })
  // Когда статус 'in_game' — найти gameId для этого лобби и перейти.
  // Realtime может прийти раньше, чем INSERT в games зафиксируется для SELECT.
  // Стратегия: 1 retry через 300мс — обычно хватает (RPC быстрый).
  useEffect(() => {
    if (status !== 'in_game' || !lobbyId) return
    let cancelled = false
    const findGameAndGo = async () => {
      try {
        const { data, error } = await supabase
          .from('games')
          .select('id')
          .eq('lobby_id', lobbyId)
          .maybeSingle()
        if (cancelled) return
        if (data?.id) {
          navigate(`/game/${data.id}`)
          return
        }
        // 1 retry через 300мс
        await new Promise((r) => setTimeout(r, 300))
        if (cancelled) return
        const { data: data2, error: err2 } = await supabase
          .from('games')
          .select('id')
          .eq('lobby_id', lobbyId)
          .maybeSingle()
        if (cancelled) return
        if (data2?.id) {
          navigate(`/game/${data2.id}`)
          return
        }
        if (!cancelled) {
          toast?.('error', 'Игра создаётся, но не найдена. Обновите страницу.')
        }
        if (error || err2) {
          toast?.('error', 'Не удалось найти игру: ' + ((error || err2)?.message || ''))
        }
      } catch (err) {
        if (!cancelled) {
          toast?.('error', 'Не удалось найти игру: ' + (err?.message || err))
        }
      }
    }
    findGameAndGo()
    return () => { cancelled = true }
  }, [status, lobbyId, navigate, toast])

  const handleStartGame = async () => {
    if (!lobbyId) return
    // RPC name/params must match SECURITY DEFINER in
    // supabase/migrations/20260726050000_upsert_lobby_player_guest.sql
    const { data: gameId, error: startErr } = await supabase.rpc('start_game_for_lobby', {
      p_lobby_id: lobbyId,
      p_guest_id: getGuestId(),
    })

    if (startErr || !gameId) {
      toast?.('error', startErr?.message || 'Не удалось создать игру')
      return
    }

    navigate(`/game/${gameId}`)
  }

  // Обновить URL когда код лобби становится известен
  useEffect(() => {
    if (lobbyCode) {
      navigate(`/lobby/${lobbyCode}`, { replace: true })
    }
  }, [lobbyCode, navigate])

  /** Собрать deck payload из выбранной локальной колоды */
  const resolveDeckPayload = async () => {
    const deck = getSelectedDeck()
    if (!deck) {
      toast?.('error', 'Сначала выберите колоду в «Мои колоды»')
      return null
    }
    const cardTotal = Object.values(deck.selectedCards || {}).reduce(
      (s, q) => s + Number(q || 0),
      0
    )
    if (cardTotal === 0) {
      toast?.('error', 'Выбранная колода пустая — добавьте карты в редакторе')
      return null
    }
    try {
      return await buildLobbyDeckPayload(deck, supabase)
    } catch (err) {
      toast?.('error', err?.message || 'Не удалось подготовить колоду')
      return null
    }
  }

  const handleCreate = async () => {
    if (!nickname.trim()) {
      toast?.('error', 'Введите никнейм')
      return
    }
    setSubmitting(true)
    try {
      const deckPayload = await resolveDeckPayload()
      if (!deckPayload) return
      setGuestNickname(nickname)
      await createLobby(nickname, deckPayload)
      toast?.('success', `Колода «${deckPayload.name}» прикреплена (${deckPayload.cardCount} карт)`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleJoin = async () => {
    if (!nickname.trim()) {
      toast?.('error', 'Введите никнейм')
      return
    }
    if (!joinCode.trim()) {
      toast?.('error', 'Введите код лобби')
      return
    }
    setSubmitting(true)
    try {
      const deckPayload = await resolveDeckPayload()
      if (!deckPayload) return
      setGuestNickname(nickname)
      await joinLobby(joinCode, nickname, deckPayload)
      toast?.('success', `Колода «${deckPayload.name}» прикреплена (${deckPayload.cardCount} карт)`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleLeave = async () => {
    await leaveLobby()
    navigate('/lobby', { replace: true })
  }

  // Пока восстанавливаем сессию из localStorage — показываем заглушку
  if (status === 'restoring') {
    return (
      <main className="lobby-screen" role="main">
        <div className="lobby-screen__content">
          <p className="lobby-restoring" role="status" aria-live="polite">Загрузка...</p>
        </div>
      </main>
    )
  }

  // Показать комнату если есть активное лобби (в т.ч. восстановленное из localStorage)
  if (status === 'waiting' || status === 'in_game') {
    return (
      <>
        {realtimeStatus === 'disconnected' && (
          <div className="connection-banner" role="alert" aria-live="polite">
            <span className="connection-spinner" aria-hidden="true"></span>
            <span>Нет соединения. Пытаемся переподключиться...</span>
          </div>
        )}
        <LobbyRoom
          code={lobbyCode ?? ''}
          players={players}
          status={status}
          isHost={isHost}
          hostId={hostId}
          onReady={setReady}
          onLeave={handleLeave}
          onStartGame={handleStartGame}
          toast={toast}
        />
      </>
    )
  }

  const deckCardCount = selectedDeck
    ? Object.values(selectedDeck.selectedCards || {}).reduce((s, q) => s + Number(q || 0), 0)
    : 0
  const busy = status === 'loading' || submitting

  return (
    <main className="lobby-screen" role="main">
      {realtimeStatus === 'disconnected' && (
        <div className="connection-banner" role="alert" aria-live="polite">
          <span className="connection-spinner" aria-hidden="true"></span>
          <span>Нет соединения. Пытаемся переподключиться...</span>
        </div>
      )}
      <div className="lobby-screen__content">
        <button className="lobby-back-btn" onClick={() => navigate('/')} aria-label="Назад в главное меню">
          ← Назад
        </button>

        <h1>Онлайн игра</h1>

        <div className="lobby-form">
          <div className="lobby-form__group">
            <label htmlFor="lob-nickname">Ваш никнейм</label>
            <input
              id="lob-nickname"
              type="text"
              maxLength={24}
              placeholder="Введите никнейм"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
            />
          </div>

          <div className="lobby-deck-picker">
            <div className="lobby-deck-picker__label">Ваша колода</div>
            {selectedDeck && deckCardCount > 0 ? (
              <div className="lobby-deck-picker__active">
                <strong>{selectedDeck.name}</strong>
                <span>
                  {deckCardCount} карт
                  {selectedDeck.code
                    ? ` · ${String(selectedDeck.code).slice(0, 12)}…`
                    : ''}
                </span>
              </div>
            ) : (
              <div className="lobby-deck-picker__empty">
                {selectedDeckId
                  ? 'Выбранная колода пустая'
                  : 'Колода не выбрана'}
              </div>
            )}
            <button
              type="button"
              className="lobby-btn lobby-btn--deck"
              onClick={() => navigate('/decks')}
            >
              {selectedDeck ? 'Сменить колоду' : 'Выбрать колоду'}
            </button>
          </div>

          <div className="lobby-divider">
            <div className="lobby-option">
              <h2>Создать лобби</h2>
              <p>Вы получите код — поделитесь им с другом</p>
              <button
                className="lobby-btn lobby-btn--create"
                onClick={handleCreate}
                disabled={busy || !selectedDeck || deckCardCount === 0}
                aria-busy={busy && !joinCode}
                aria-label={busy && !joinCode ? 'Создание комнаты' : 'Создать комнату'}
              >
                {busy && !joinCode ? 'Создаём...' : 'Создать комнату'}
              </button>
            </div>

            <span className="lobby-or">или</span>

            <div className="lobby-option">
              <h2>Войти по коду</h2>
              <div className="lobby-form__group">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="XXXXXX"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && handleJoin()}
                  className="lobby-code-input"
                />
              </div>
              <button
                className="lobby-btn lobby-btn--join"
                onClick={handleJoin}
                disabled={busy || !selectedDeck || deckCardCount === 0}
                aria-busy={busy && joinCode}
                aria-label={busy && joinCode ? 'Вход в лобби' : 'Войти в лобби'}
              >
                {busy && joinCode ? 'Входим...' : 'Войти'}
              </button>
            </div>
          </div>

          {dismissedMessage && <p className="lobby-error">{dismissedMessage}</p>}
          {error && <p className="lobby-error">{error}</p>}
        </div>
      </div>
    </main>
  )
}
