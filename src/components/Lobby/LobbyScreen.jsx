import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useBackNavigation, useNavigateWithOrigin } from '../../hooks/useBackNavigation'
import { getGuestNickname, setGuestNickname } from '../../utils/guestId'
import { useLobby } from '../../hooks/useLobby'
import { useDecks } from '../../hooks/useDecks'
import { useHeroes } from '../../hooks/useHeroes'
import { isOfflineTestMode } from '../../utils/offlineMode'
import { getLocalTestDeckPayload } from '../../fixtures/testDeck'
import { buildLobbyDeckPayload } from '../../utils/lobbyDeck'
import { LobbyRoom } from './LobbyRoom'
import { HeroDisplay } from '../HeroDisplay'
import './Lobby.css'

/**
 * Preload hint для 3D-чанка (PERFORMANCE_AUDIT_3D D4).
 * Когда пользователь попадает на лобби — самое время начать качать
 * GameBoard3D (~56 КБ) и его зависимости (r3f, drei, three-core — 1 МБ+).
 * Если пользователь всё-таки зайдёт в /game/:id, чанк уже в кеше.
 *
 * Делаем это тихо, без показа loading-UI — фоновый preload.
 */
function usePreload3DChunk() {
  useEffect(() => {
    // Idle-callback: даём браузеру отрисовать лобби до начала сетевой загрузки.
    const id = window.setTimeout(() => {
      import('../Game/GameBoard3D').catch(() => {
        // Если chunk уже не нужен / упал — это фоновый preload, не критично.
      })
    }, 250)
    return () => window.clearTimeout(id)
  }, [])
}

export function LobbyScreen({ toast }) {
  const navigate = useNavigateWithOrigin()
  const goBack = useBackNavigation('/')
  const { code: codeFromUrl } = useParams()
  const [nickname, setNickname] = useState(getGuestNickname)
  const [joinCode, setJoinCode] = useState(codeFromUrl ?? '')
  const [submitting, setSubmitting] = useState(false)

  usePreload3DChunk()

  const { status, players, error, isHost, hostId, lobbyId, lobbyCode, dismissedMessage, pendingGameId, connectionStatus, onlinePlayerIds, createLobby, joinLobby, setReady, startGame, leaveLobby } = useLobby()
  const { getSelectedDeck, selectedDeckId } = useDecks()
  const { heroes } = useHeroes()
  const selectedDeck = getSelectedDeck()
  const selectedHero = useMemo(() => {
    if (!selectedDeck?.heroId || !heroes?.length) return null
    return heroes.find((h) => h.id === selectedDeck.heroId) || null
  }, [selectedDeck?.heroId, heroes])

  useEffect(() => {
    if (pendingGameId) {
      navigate(`/game/${pendingGameId}`)
      return
    }
    // Game creation is owned by LobbyRoom and delivered as `game_id` in the
    // lobby snapshot. Never query Supabase for lobby/game linkage anymore.
    if (status !== 'in_game' || !lobbyId) return
  }, [status, lobbyId, pendingGameId, navigate])

  const handleStartGame = async (landPlacementRule) => {
    if (!lobbyId) return
    setSubmitting(true)
    try {
      const result = await startGame(landPlacementRule)
      if (result?.error) {
        toast?.('error', result.error)
        return
      }
      if (result?.gameId) {
        navigate(`/game/${result.gameId}`)
      }
    } finally {
      setSubmitting(false)
    }
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
      if (isOfflineTestMode) return getLocalTestDeckPayload()
      return await buildLobbyDeckPayload(deck)
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
      const code = await createLobby(nickname, deckPayload)
      if (!code) {
        toast?.('error', 'Не удалось создать лобби')
        return
      }
      toast?.('success', `Лобби создано: код ${code}`)
    } catch (err) {
      toast?.('error', err?.message || 'Не удалось создать лобби')
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
      toast?.('success', `Подключение к лобби ${joinCode}…`)
    } catch (err) {
      toast?.('error', err?.message || 'Не удалось войти в лобби')
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
        {error && <div className="lobby-error" role="alert">{error}</div>}
        {(connectionStatus === 'disconnected' || connectionStatus === 'reconnecting') && (
          <div className="connection-banner" role="alert" aria-live="polite">
            <span className="connection-spinner" aria-hidden="true"></span>
            <span>Нет соединения. Пытаемся переподключиться...</span>
          </div>
        )}
        <LobbyRoom
          code={lobbyCode ?? ''}
          players={players}
          onlinePlayerIds={onlinePlayerIds}
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
      {(connectionStatus === 'disconnected' || connectionStatus === 'reconnecting') && (
        <div className="connection-banner" role="alert" aria-live="polite">
          <span className="connection-spinner" aria-hidden="true"></span>
          <span>Нет соединения. Пытаемся переподключиться...</span>
        </div>
      )}
      <div className="lobby-screen__content">
        <button className="lobby-back-btn" onClick={goBack} aria-label="Назад">
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
                <div className="lobby-deck-picker__row">
                  <div className="lobby-deck-picker__name">
                    <strong>{selectedDeck.name}</strong>
                    <span>
                      {deckCardCount} карт
                      {selectedDeck.code
                        ? ` · ${String(selectedDeck.code).slice(0, 12)}…`
                        : ''}
                    </span>
                  </div>
                  {selectedHero && (
                    <div className="lobby-deck-picker__hero">
                      <HeroDisplay hero={selectedHero} align="right" />
                    </div>
                  )}
                </div>
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
              <h2 id="lobby-join-heading">Войти по коду</h2>
              <div className="lobby-form__group">
                <label htmlFor="lob-join-code" className="visually-hidden">
                  Код лобби
                </label>
                <input
                  id="lob-join-code"
                  type="text"
                  maxLength={6}
                  placeholder="XXXXXX"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && handleJoin()}
                  className="lobby-code-input"
                  aria-labelledby="lobby-join-heading"
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